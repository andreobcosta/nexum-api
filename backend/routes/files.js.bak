const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../db/connection');
const drive = require('../services/drive');
const claude = require('../services/claude');

// Configure multer for temp uploads
const upload = multer({
  dest: path.join(__dirname, '..', 'temp'),
  limits: { fileSize: 50 * 1024 * 1024 } // 50MB max
});

// POST /api/files/upload — Upload a file for a patient
router.post('/upload', upload.single('file'), async (req, res) => {
  const tempPath = req.file?.path;

  try {
    const { patient_id, category, context } = req.body;

    if (!patient_id || !category || !req.file) {
      return res.status(400).json({ error: 'patient_id, category e arquivo são obrigatórios' });
    }

    const db = getDb();
    const patient = db.prepare('SELECT * FROM patients WHERE id = ?').get(patient_id);
    if (!patient) return res.status(404).json({ error: 'Paciente não encontrado' });
    if (!patient.drive_folder_id) return res.status(400).json({ error: 'Paciente sem pasta no Drive' });

    const fileId = uuidv4();
    const mimeType = req.file.mimetype;
    const originalName = req.file.originalname;
    let transcription = null;
    let finalFileName = originalName;
    let finalMimeType = mimeType;
    let finalFilePath = tempPath;

    // Process based on file type
    const isAudio = mimeType.startsWith('audio/') || mimeType === 'video/webm';
    const isImage = mimeType.startsWith('image/');

    // 1. Audio files → transcribe with Claude
    if (isAudio) {
      const audioBuffer = fs.readFileSync(tempPath);
      const audioBase64 = audioBuffer.toString('base64');

      transcription = await claude.transcribeAudio(audioBase64, mimeType, context || '');

      // Also save the transcription as a text file to Drive
      const transcriptionFileName = `${path.parse(originalName).name}_transcricao.txt`;
      const subfolderId = await drive.getSubfolderId(patient.drive_folder_id, category);

      // Upload original audio
      await drive.uploadFile(tempPath, originalName, mimeType, subfolderId);

      // Upload transcription
      const transcriptionBuffer = Buffer.from(transcription, 'utf-8');
      const transcriptionDriveFile = await drive.uploadBuffer(
        transcriptionBuffer, transcriptionFileName, 'text/plain', subfolderId
      );

      // Save to database
      db.prepare(`
        INSERT INTO files (id, patient_id, original_name, file_type, category, drive_folder_id, transcription, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'transcribed')
      `).run(fileId, patient_id, originalName, 'audio', category, subfolderId, transcription);

      db.prepare("UPDATE patients SET updated_at = datetime('now') WHERE id = ?").run(patient_id);

      db.prepare('INSERT INTO activity_log (patient_id, action, details) VALUES (?, ?, ?)').run(
        patient_id, 'file_uploaded',
        JSON.stringify({ name: originalName, category, type: 'audio', transcribed: true })
      );

      return res.status(201).json({
        id: fileId,
        message: 'Áudio enviado e transcrito com sucesso',
        original_name: originalName,
        category,
        transcription_preview: transcription.substring(0, 200) + '...',
        transcription_file: transcriptionFileName
      });
    }

    // 2. Image files (photos of protocols) → upload as-is (PDF conversion can be done later)
    if (isImage) {
      const subfolderId = await drive.getSubfolderId(patient.drive_folder_id, category);
      const driveFile = await drive.uploadFile(tempPath, originalName, mimeType, subfolderId);

      db.prepare(`
        INSERT INTO files (id, patient_id, original_name, file_type, category, drive_file_id, drive_folder_id, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'uploaded')
      `).run(fileId, patient_id, originalName, 'image', category, driveFile.id, subfolderId);

      db.prepare("UPDATE patients SET updated_at = datetime('now') WHERE id = ?").run(patient_id);

      db.prepare('INSERT INTO activity_log (patient_id, action, details) VALUES (?, ?, ?)').run(
        patient_id, 'file_uploaded',
        JSON.stringify({ name: originalName, category, type: 'image' })
      );

      return res.status(201).json({
        id: fileId,
        message: 'Imagem enviada com sucesso',
        original_name: originalName,
        category,
        drive_file_id: driveFile.id
      });
    }

    // 3. PDF and other documents → upload directly
    const subfolderId = await drive.getSubfolderId(patient.drive_folder_id, category);
    const driveFile = await drive.uploadFile(tempPath, originalName, mimeType, subfolderId);

    db.prepare(`
      INSERT INTO files (id, patient_id, original_name, file_type, category, drive_file_id, drive_folder_id, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'uploaded')
    `).run(fileId, patient_id, originalName, 'document', category, driveFile.id, subfolderId);

    db.prepare("UPDATE patients SET updated_at = datetime('now') WHERE id = ?").run(patient_id);

    db.prepare('INSERT INTO activity_log (patient_id, action, details) VALUES (?, ?, ?)').run(
      patient_id, 'file_uploaded',
      JSON.stringify({ name: originalName, category, type: 'document' })
    );

    res.status(201).json({
      id: fileId,
      message: 'Arquivo enviado com sucesso',
      original_name: originalName,
      category,
      drive_file_id: driveFile.id
    });

  } catch (err) {
    console.error('Upload error:', err);
    res.status(500).json({ error: 'Erro ao processar arquivo', details: err.message });
  } finally {
    // Cleanup temp file
    if (tempPath && fs.existsSync(tempPath)) {
      fs.unlinkSync(tempPath);
    }
  }
});

// POST /api/files/note — Save a text note for a patient
router.post('/note', async (req, res) => {
  try {
    const { patient_id, category, title, content } = req.body;

    if (!patient_id || !category || !content) {
      return res.status(400).json({ error: 'patient_id, category e content são obrigatórios' });
    }

    const db = getDb();
    const patient = db.prepare('SELECT * FROM patients WHERE id = ?').get(patient_id);
    if (!patient) return res.status(404).json({ error: 'Paciente não encontrado' });

    const fileId = uuidv4();
    const fileName = `${title || 'nota'}_${new Date().toISOString().slice(0, 10)}.txt`;
    const subfolderId = await drive.getSubfolderId(patient.drive_folder_id, category);

    // Upload note to Drive
    const buffer = Buffer.from(content, 'utf-8');
    const driveFile = await drive.uploadBuffer(buffer, fileName, 'text/plain', subfolderId);

    db.prepare(`
      INSERT INTO files (id, patient_id, original_name, file_type, category, drive_file_id, drive_folder_id, transcription, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'uploaded')
    `).run(fileId, patient_id, fileName, 'note', category, driveFile.id, subfolderId, content);

    db.prepare("UPDATE patients SET updated_at = datetime('now') WHERE id = ?").run(patient_id);

    res.status(201).json({
      id: fileId,
      message: 'Nota salva com sucesso',
      file_name: fileName,
      category
    });

  } catch (err) {
    console.error('Note error:', err);
    res.status(500).json({ error: 'Erro ao salvar nota', details: err.message });
  }
});

// GET /api/files/patient/:patient_id — List all files for a patient
router.get('/patient/:patient_id', (req, res) => {
  const db = getDb();
  const files = db.prepare('SELECT * FROM files WHERE patient_id = ? ORDER BY created_at DESC')
    .all(req.params.patient_id);

  const byCategory = {};
  for (const f of files) {
    if (!byCategory[f.category]) byCategory[f.category] = [];
    byCategory[f.category].push(f);
  }

  res.json({ files, by_category: byCategory });
});

module.exports = router;
