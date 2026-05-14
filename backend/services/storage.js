const { Storage } = require('@google-cloud/storage');
require('dotenv').config({ path: '/app/backend/.env' });

const BUCKET_NAME = process.env.GOOGLE_STORAGE_BUCKET || 'nexum-patient-files';

function getBucket() {
  return new Storage().bucket(BUCKET_NAME);
}

// Monta o path de storage para um arquivo de paciente
function filePath(patientId, fileId, fileName) {
  return `patients/${patientId}/files/${fileId}/${fileName}`;
}

// Monta o path de storage para um relatório
function reportPath(patientId, reportId, fileName) {
  return `patients/${patientId}/reports/${reportId}/${fileName}`;
}

// Upload de arquivo local (multipart — vem do multer)
async function uploadFile(localPath, storagePath, mimeType) {
  const bucket = getBucket();
  await bucket.upload(localPath, {
    destination: storagePath,
    metadata: { contentType: mimeType }
  });
  const file = bucket.file(storagePath);
  const [meta] = await file.getMetadata();
  return { path: storagePath, size: Number(meta.size) };
}

// Upload de Buffer (transcrições, relatórios, notas)
async function uploadBuffer(buffer, storagePath, mimeType) {
  const bucket = getBucket();
  const file = bucket.file(storagePath);
  await file.save(buffer, { contentType: mimeType, resumable: false });
  const [meta] = await file.getMetadata();
  return { path: storagePath, size: Number(meta.size) };
}

// Download retorna Buffer
async function downloadFile(storagePath) {
  const bucket = getBucket();
  const [buffer] = await bucket.file(storagePath).download();
  return buffer;
}

// Download como stream (para proxy de download ao cliente)
async function downloadFileStream(storagePath) {
  const bucket = getBucket();
  const file = bucket.file(storagePath);
  const [meta] = await file.getMetadata();
  const stream = file.createReadStream();
  const name = storagePath.split('/').pop();
  return { stream, mimeType: meta.contentType, name };
}

// Deleta arquivo (falha silenciosa para 404)
async function deleteFile(storagePath) {
  try {
    await getBucket().file(storagePath).delete();
  } catch (err) {
    if (!err.message?.includes('No such object') && err.code !== 404) throw err;
  }
}

// Lista todos os arquivos de um paciente (para collectPatientData)
async function listPatientFiles(patientId) {
  const [files] = await getBucket().getFiles({ prefix: `patients/${patientId}/files/` });
  return files.map(f => ({
    path: f.name,
    name: f.name.split('/').pop(),
    mimeType: f.metadata.contentType,
    size: Number(f.metadata.size)
  }));
}

module.exports = {
  filePath,
  reportPath,
  uploadFile,
  uploadBuffer,
  downloadFile,
  downloadFileStream,
  deleteFile,
  listPatientFiles,
  BUCKET_NAME
};
