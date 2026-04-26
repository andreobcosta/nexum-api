const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../db/firestore');
const { FieldValue } = require('@google-cloud/firestore');
const drive = require('../services/drive');
const { transcribeAudio } = require('../services/transcription');

const upload = multer({
  dest: path.join(__dirname, '..', 'temp'),
  limits: { fileSize: 500 * 1024 * 1024 }
});

// Transcreve áudio em background após upload
async function transcribeInBackground(patient_id, fileId, driveFileId, subfolderId, originalName, mimeType, bgPath = null) {
  const db = getDb();
  const fileRef = db.collection('patients').doc(patient_id).collection('files').doc(fileId);
  let tempPath = null;
  try {
    console.log('[AUTO-TRANSCRIÇÃO] Iniciando para', originalName);
    await fileRef.update({ status: 'transcribing' });

    const buffer = await drive.downloadFile(driveFileId);
    tempPath = path.join(__dirname, '..', 'temp', 'transcribe_' + uuidv4());
    fs.writeFileSync(tempPath, buffer);

    const transcription = await transcribeAudio(tempPath, mimeType, originalName);
    const now = new Date().toISOString();

    await fileRef.update({ transcription, status: 'transcribed', transcribed_at: now });

    // Salva .txt no Drive
    try {
      const txtName = originalName.replace(/\.[^.]+$/, '') + '_transcricao.txt';
      const txtBuffer = Buffer.from('TRANSCRICAO — ' + originalName + '\nGerada em: ' + now + '\n\n' + transcription, 'utf-8');
      await drive.uploadBuffer(txtBuffer, txtName, 'text/plain', subfolderId);
    } catch (e) {
      console.warn('[AUTO-TRANSCRIÇÃO] Nao salvou .txt no Drive:', e.message);
    }

    await db.collection('activity_log').add({
      patient_id, action: 'file_transcribed',
      details: JSON.stringify({ file_id: fileId, name: originalName, auto: true }),
      created_at: new Date().toISOString()
    });

    console.log('[AUTO-TRANSCRIÇÃO] Concluída para', originalName);
  } catch (err) {
    console.error('[AUTO-TRANSCRIÇÃO] Erro em', originalName, ':', err.message);
    try { await fileRef.update({ status: 'transcription_failed' }); } catch (_) {}
  } finally {
    if (tempPath && fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    if (bgPath && fs.existsSync(bgPath)) fs.unlinkSync(bgPath); // cleanup do arquivo _bg
  }
}

// POST /api/files/upload
router.post('/upload', upload.array('file', 20), async (req, res) => {
  const results = [];
  const errors = [];
  try {
    const { patient_id, category } = req.body;
    if (!patient_id || !category || !req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'patient_id, category e pelo menos um arquivo são obrigatórios' });
    }
    const db = getDb();
    const patientDoc = await db.collection('patients').doc(patient_id).get();
    if (!patientDoc.exists) return res.status(404).json({ error: 'Paciente não encontrado' });
    const patient = patientDoc.data();
    if (!patient.drive_folder_id) return res.status(400).json({ error: 'Paciente sem pasta no Drive' });
    const subfolderId = await drive.getSubfolderId(patient.drive_folder_id, category);

    for (const file of req.files) {
      try {
        const fileId = uuidv4();
        const isAudio = file.mimetype.startsWith('audio/') || file.mimetype === 'video/webm';
        const isImage = file.mimetype.startsWith('image/');
        const fileType = isAudio ? 'audio' : isImage ? 'image' : 'document';

        const driveFile = await drive.uploadFile(file.path, file.originalname, file.mimetype, subfolderId);
        const now = new Date().toISOString();

        await db.collection('patients').doc(patient_id).collection('files').doc(fileId).set({
          patient_id,
          original_name: file.originalname,
          file_type: fileType,
          category,
          drive_file_id: driveFile.id,
          drive_folder_id: subfolderId,
          transcription: null,
          metadata: JSON.stringify({ size: file.size, mimeType: file.mimetype }),
          status: isAudio ? 'pending_transcription' : 'uploaded',
          created_at: now
        });

        results.push({
          id: fileId,
          name: file.originalname,
          type: fileType,
          drive_id: driveFile.id,
          transcribing: isAudio
        });

        // Transcrição automática em background para áudios
        if (isAudio) {
          const bgPath = file.path + '_bg';
          fs.copyFileSync(file.path, bgPath);
          transcribeInBackground(patient_id, fileId, driveFile.id, subfolderId, file.originalname, file.mimetype, bgPath)
            .catch(e => console.error('[AUTO-TRANSCRIÇÃO] Falha silenciosa:', e.message));
        }

      } catch (fileErr) {
        errors.push({ name: file.originalname, error: fileErr.message });
      } finally {
        if (file.path && fs.existsSync(file.path)) fs.unlinkSync(file.path);
      }
    }

    const now = new Date().toISOString();
    const countField = category + '_count';
    const countUpdate = { updated_at: now };
    if (['anamnese', 'teste', 'sessao', 'externo'].includes(category)) {
      countUpdate[countField] = FieldValue.increment(results.length);
    }
    await db.collection('patients').doc(patient_id).update(countUpdate);
    await db.collection('activity_log').add({
      patient_id, action: 'files_uploaded',
      details: JSON.stringify({ count: results.length, category }),
      created_at: now
    });

    const hasAudio = results.some(r => r.transcribing);
    res.status(201).json({
      message: `${results.length} arquivo(s) enviado(s)${hasAudio ? ' — áudio(s) sendo transcritos em background' : ''}${errors.length > 0 ? `, ${errors.length} erro(s)` : ''}`,
      uploaded: results,
      errors
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao processar arquivo', details: err.message });
  }
});

// POST /api/files/note
router.post('/note', async (req, res) => {
  try {
    const { patient_id, category, title, content } = req.body;
    if (!patient_id || !category || !content) {
      return res.status(400).json({ error: 'patient_id, category e content são obrigatórios' });
    }
    const db = getDb();
    const patientDoc = await db.collection('patients').doc(patient_id).get();
    if (!patientDoc.exists) return res.status(404).json({ error: 'Paciente não encontrado' });
    const patient = patientDoc.data();
    const fileId = uuidv4();
    const fileName = (title || 'nota') + '_' + new Date().toISOString().slice(0, 10) + '.txt';
    const subfolderId = await drive.getSubfolderId(patient.drive_folder_id, category);
    const buffer = Buffer.from(content, 'utf-8');
    const driveFile = await drive.uploadBuffer(buffer, fileName, 'text/plain', subfolderId);
    const now = new Date().toISOString();
    await db.collection('patients').doc(patient_id).collection('files').doc(fileId).set({
      patient_id, original_name: fileName, file_type: 'note',
      category, drive_file_id: driveFile.id, drive_folder_id: subfolderId,
      transcription: content, status: 'uploaded', created_at: now
    });
    await db.collection('patients').doc(patient_id).update({ updated_at: now });
    res.status(201).json({ id: fileId, message: 'Nota salva com sucesso', file_name: fileName, category });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao salvar nota', details: err.message });
  }
});

// GET /api/files/patient/:patient_id
router.get('/patient/:patient_id', async (req, res) => {
  try {
    const db = getDb();
    const snap = await db.collection('patients').doc(req.params.patient_id).collection('files').orderBy('created_at', 'desc').get();
    const files = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    const byCategory = {};
    for (const f of files) {
      if (!byCategory[f.category]) byCategory[f.category] = [];
      byCategory[f.category].push(f);
    }
    res.json({ files, by_category: byCategory, total: files.length });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao listar arquivos', details: err.message });
  }
});

// DELETE /api/files/:patient_id/:file_id
router.delete('/:patient_id/:file_id', async (req, res) => {
  try {
    const db = getDb();
    const ref = db.collection('patients').doc(req.params.patient_id).collection('files').doc(req.params.file_id);
    const doc = await ref.get();
    if (!doc.exists) return res.status(404).json({ error: 'Arquivo não encontrado' });
    const file = doc.data();
    await ref.delete();
    const now = new Date().toISOString();
    const catField = (file.category || '') + '_count';
    const delUpdate = { updated_at: now };
    if (['anamnese', 'teste', 'sessao', 'externo'].includes(file.category)) {
      delUpdate[catField] = FieldValue.increment(-1);
    }
    await db.collection('patients').doc(req.params.patient_id).update(delUpdate);
    await db.collection('activity_log').add({
      patient_id: req.params.patient_id, action: 'file_deleted',
      details: JSON.stringify({ name: file.original_name, category: file.category }),
      created_at: now
    });
    res.json({ message: 'Arquivo removido', name: file.original_name });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao remover arquivo', details: err.message });
  }
});

module.exports = router;