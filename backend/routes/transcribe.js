const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../db/firestore');
const drive = require('../services/drive');
const { transcribeAudio } = require('../services/transcription');

const upload = multer({
  dest: path.join(__dirname, '..', 'temp'),
  limits: { fileSize: 500 * 1024 * 1024 }
});

router.post('/file/:file_id', async (req, res) => {
  const { patient_id } = req.body;
  if (!patient_id) return res.status(400).json({ error: 'patient_id é obrigatório' });
  let tempPath = null;
  try {
    const db = getDb();
    const fileRef = db.collection('patients').doc(patient_id).collection('files').doc(req.params.file_id);
    const fileDoc = await fileRef.get();
    if (!fileDoc.exists) return res.status(404).json({ error: 'Arquivo não encontrado' });
    const file = fileDoc.data();
    if (file.file_type !== 'audio') return res.status(400).json({ error: 'Arquivo não é um áudio' });
    if (file.transcription) return res.status(400).json({ error: 'Arquivo já transcrito' });
    if (!file.drive_file_id) return res.status(400).json({ error: 'Arquivo sem ID no Drive' });
    await fileRef.update({ status: 'transcribing' });
    const buffer = await drive.downloadFile(file.drive_file_id);
    tempPath = path.join(__dirname, '..', 'temp', `transcribe_${uuidv4()}`);
    fs.writeFileSync(tempPath, buffer);
    const metadata = file.metadata ? JSON.parse(file.metadata) : {};
    const mimeType = metadata.mimeType || 'audio/webm';
    const resultado = await transcribeAudio(tempPath, mimeType, file.original_name);
    const transcricao = resultado.transcricao;
    const comprimido = resultado.comprimido;
    const now = new Date().toISOString();
    await fileRef.update({ transcription: transcricao, transcricao_comprimida: comprimido || null, status: 'transcribed', transcribed_at: now });
    try {
      const txtName = file.original_name.replace(/\.[^.]+$/, '') + '_transcricao.txt';
      const txtBuffer = Buffer.from('TRANSCRIÇÃO — ' + file.original_name + '\nGerada em: ' + now + '\n\n' + transcricao, 'utf-8');
      await drive.uploadBuffer(txtBuffer, txtName, 'text/plain', file.drive_folder_id);
    } catch (driveErr) { console.warn('[Transcritor] Não salvou .txt no Drive:', driveErr.message); }
    await db.collection('activity_log').add({ patient_id, action: 'file_transcribed', details: JSON.stringify({ file_id: req.params.file_id, name: file.original_name }), created_at: now });
    res.json({ message: 'Transcrição concluída', file_id: req.params.file_id, file_name: file.original_name, transcription: transcricao, chars: transcricao.length });
  } catch (err) {
    console.error('[Transcritor] Erro:', err);
    try { const db = getDb(); await db.collection('patients').doc(patient_id).collection('files').doc(req.params.file_id).update({ status: 'uploaded' }); } catch (_) {}
    res.status(500).json({ error: 'Erro na transcrição', details: err.message });
  } finally {
    if (tempPath && fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
  }
});

router.post('/upload', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo enviado' });
  try {
    const resultado = await transcribeAudio(req.file.path, req.file.mimetype || 'audio/webm');
    res.json({ message: 'Transcrição concluída', file_name: req.file.originalname, transcription: resultado.transcricao, chars: resultado.transcricao.length });
  } catch (err) {
    res.status(500).json({ error: 'Erro na transcrição', details: err.message });
  } finally {
    if (req.file?.path && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
  }
});

router.get('/status/:patient_id/:file_id', async (req, res) => {
  try {
    const db = getDb();
    const doc = await db.collection('patients').doc(req.params.patient_id).collection('files').doc(req.params.file_id).get();
    if (!doc.exists) return res.status(404).json({ error: 'Arquivo não encontrado' });
    const file = doc.data();
    res.json({ file_id: req.params.file_id, name: file.original_name, status: file.status, has_transcription: !!file.transcription, transcribed_at: file.transcribed_at || null });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao verificar status', details: err.message });
  }
});

module.exports = router;
