const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../db/firestore');
const drive = require('../services/drive');

const upload = multer({
  dest: path.join(__dirname, '..', 'temp'),
  limits: { fileSize: 500 * 1024 * 1024 }
});

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
          status: 'uploaded',
          created_at: now
        });
        results.push({ id: fileId, name: file.originalname, type: fileType, drive_id: driveFile.id });
      } catch (fileErr) {
        errors.push({ name: file.originalname, error: fileErr.message });
      } finally {
        if (file.path && fs.existsSync(file.path)) fs.unlinkSync(file.path);
      }
    }

    const now = new Date().toISOString();
    await db.collection('patients').doc(patient_id).update({ updated_at: now });
    await db.collection('activity_log').add({
      patient_id, action: 'files_uploaded',
      details: JSON.stringify({ count: results.length, category }),
      created_at: now
    });

    res.status(201).json({
      message: `${results.length} arquivo(s) enviado(s)${errors.length > 0 ? `, ${errors.length} erro(s)` : ''}`,
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
    const fileName = `${title || 'nota'}_${new Date().toISOString().slice(0, 10)}.txt`;
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
    await db.collection('patients').doc(req.params.patient_id).update({ updated_at: now });
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
