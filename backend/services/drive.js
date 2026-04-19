const { google } = require('googleapis');
require('dotenv').config({path: '/app/backend/.env'});

const FOLDER_STRUCTURE = [
  '01 - Anamnese',
  '02 - Testes aplicados',
  '03 - Sessões',
  '04 - Relatórios',
  '05 - Intervenções',
  '06 - Documentos externos'
];

const CATEGORY_TO_FOLDER = {
  anamnese: '01 - Anamnese',
  teste: '02 - Testes aplicados',
  sessao: '03 - Sessões',
  relatorio: '04 - Relatórios',
  intervencao: '05 - Intervenções',
  externo: '06 - Documentos externos'
};

function getAuth() {
  const auth = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
  auth.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
  return auth;
}

function getDrive() {
  return google.drive({ version: 'v3', auth: getAuth() });
}

// Create a folder in Google Drive
async function createFolder(name, parentId) {
  const drive = getDrive();
  const res = await drive.files.create({
    requestBody: {
      name,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [parentId]
    },
    fields: 'id, name'
  });
  return res.data;
}

// Create the full patient folder structure
async function createPatientFolders(patientName, year) {
  const rootFolderId = process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID;
  const folderName = `${patientName} — ${year}`;

  // Create patient root folder
  const patientFolder = await createFolder(folderName, rootFolderId);

  // Create subfolders
  const subfolders = {};
  for (const subName of FOLDER_STRUCTURE) {
    const sub = await createFolder(subName, patientFolder.id);
    subfolders[subName] = sub.id;
  }

  return {
    rootFolderId: patientFolder.id,
    rootFolderName: folderName,
    subfolders
  };
}

// Upload a file to a specific folder
async function uploadFile(filePath, fileName, mimeType, folderId) {
  const drive = getDrive();
  const fs = require('fs');

  const res = await drive.files.create({
    requestBody: {
      name: fileName,
      parents: [folderId]
    },
    media: {
      mimeType,
      body: fs.createReadStream(filePath)
    },
    fields: 'id, name, webViewLink'
  });

  return res.data;
}

// Upload from buffer (for transcriptions, generated reports)
async function uploadBuffer(buffer, fileName, mimeType, folderId) {
  const drive = getDrive();
  const { Readable } = require('stream');

  const res = await drive.files.create({
    requestBody: {
      name: fileName,
      parents: [folderId]
    },
    media: {
      mimeType,
      body: Readable.from(buffer)
    },
    fields: 'id, name, webViewLink'
  });

  return res.data;
}

// List files in a folder
async function listFiles(folderId) {
  const drive = getDrive();
  const res = await drive.files.list({
    q: `'${folderId}' in parents and trashed = false`,
    fields: 'files(id, name, mimeType, size, createdTime)',
    orderBy: 'createdTime desc'
  });
  return res.data.files || [];
}

// List subfolders of a patient folder
async function listSubfolders(patientFolderId) {
  const drive = getDrive();
  const res = await drive.files.list({
    q: `'${patientFolderId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
    fields: 'files(id, name)',
    orderBy: 'name'
  });
  return res.data.files || [];
}

// Download a file content (for sending to Claude)
async function downloadFile(fileId) {
  const drive = getDrive();
  const res = await drive.files.get(
    { fileId, alt: 'media' },
    { responseType: 'arraybuffer' }
  );
  return Buffer.from(res.data);
}

// Get folder ID by category for a patient
async function getSubfolderId(patientFolderId, category) {
  const folderName = CATEGORY_TO_FOLDER[category];
  if (!folderName) throw new Error(`Invalid category: ${category}`);

  const subfolders = await listSubfolders(patientFolderId);
  const folder = subfolders.find(f => f.name === folderName);
  if (!folder) throw new Error(`Subfolder '${folderName}' not found`);

  return folder.id;
}

// Get completeness status for a patient
async function getPatientCompleteness(patientFolderId) {
  const subfolders = await listSubfolders(patientFolderId);
  const status = {};

  for (const folder of subfolders) {
    const files = await listFiles(folder.id);
    status[folder.name] = {
      folderId: folder.id,
      count: files.length,
      files: files.map(f => ({ id: f.id, name: f.name, type: f.mimeType }))
    };
  }

  return status;
}

// Collect all patient data for RAN generation
async function collectPatientData(patientFolderId) {
  const completeness = await getPatientCompleteness(patientFolderId);
  const allData = {};

  // Pastas excluídas do pipeline de análise — não são input clínico
  const EXCLUDED_FOLDERS = ['04 - Relatórios'];

  for (const [folderName, info] of Object.entries(completeness)) {
    if (info.count === 0) continue;
    if (EXCLUDED_FOLDERS.includes(folderName)) {
      console.log(`[Drive] Ignorando pasta de saída: ${folderName}`);
      continue;
    }

    allData[folderName] = [];
    for (const file of info.files) {
      try {
        const content = await downloadFile(file.id);
        allData[folderName].push({
          name: file.name,
          type: file.type,
          content: content.toString('base64'),
          size: content.length
        });
      } catch (err) {
        console.error(`Failed to download ${file.name}:`, err.message);
      }
    }
  }

  return allData;
}

module.exports = {
  createPatientFolders,
  uploadFile,
  uploadBuffer,
  listFiles,
  listSubfolders,
  downloadFile,
  getSubfolderId,
  getPatientCompleteness,
  collectPatientData,
  FOLDER_STRUCTURE,
  CATEGORY_TO_FOLDER
};