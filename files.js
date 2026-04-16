const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../db/connection');
const drive = require('../services/drive');

const upload = multer({
  dest: path.join(__dirname, '..', 'temp'),
  limits: { fileSize: 500 * 1024 * 1024 }
});

// POST /api/files/upload — Upload one or multiple files
router.post('/upload', upload.array('file', 20), async (req, res) => {
  var results = [];
  var errors = [];

  try {
    var patient_id = req.body.patient_id;
    var category = req.body.category;
    if (!patient_id || !category || !req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'patient_id, category e pelo menos um arquivo sao obrigatorios' });
    }
    var db = getDb();
    var patient = db.prepare('SELECT * FROM patients WHERE id = ?').get(patient_id);
    if (!patient) return res.status(404).json({ error: 'Paciente nao encontrado' });
    if (!patient.drive_folder_id) return res.status(400).json({ error: 'Paciente sem pasta no Drive' });

    var subfolderId = await drive.getSubfolderId(patient.drive_folder_id, category);

    for (var i = 0; i < req.files.length; i++) {
      var file = req.files[i];
      try {
        var fileId = uuidv4();
        var mimeType = file.mimetype;
        var originalName = file.originalname;
        var isAudio = mimeType.startsWith('audio/') || mimeType === 'video/webm';
        var isImage = mimeType.startsWith('image/');
        var fileType = isAudio ? 'audio' : isImage ? 'image' : 'document';
        var fileSize = file.size;

        var driveFile = await drive.uploadFile(file.path, originalName, mimeType, subfolderId);

        db.prepare("INSERT INTO files (id, patient_id, original_name, file_type, category, drive_file_id, drive_folder_id, metadata, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'uploaded')").run(
          fileId, patient_id, originalName, fileType, category, driveFile.id, subfolderId,
          JSON.stringify({ size: fileSize, mimeType: mimeType })
        );

        results.push({ id: fileId, name: originalName, type: fileType, drive_id: driveFile.id });
      } catch (fileErr) {
        errors.push({ name: file.originalname, error: fileErr.message });
      } finally {
        if (file.path && fs.existsSync(file.path)) fs.unlinkSync(file.path);
      }
    }

    db.prepare("UPDATE patients SET updated_at = datetime('now') WHERE id = ?").run(patient_id);
    db.prepare('INSERT INTO activity_log (patient_id, action, details) VALUES (?, ?, ?)').run(
      patient_id, 'files_uploaded', JSON.stringify({ count: results.length, category: category })
    );

    res.status(201).json({
      message: results.length + ' arquivo(s) enviado(s)' + (errors.length > 0 ? ', ' + errors.length + ' erro(s)' : ''),
      uploaded: results,
      errors: errors
    });
  } catch (err) {
    console.error('Upload error:', err);
    res.status(500).json({ error: 'Erro ao processar arquivo', details: err.message });
  }
});

// POST /api/files/note
router.post('/note', async (req, res) => {
  try {
    var patient_id = req.body.patient_id;
    var category = req.body.category;
    var title = req.body.title;
    var content = req.body.content;
    if (!patient_id || !category || !content) {
      return res.status(400).json({ error: 'patient_id, category e content sao obrigatorios' });
    }
    var db = getDb();
    var patient = db.prepare('SELECT * FROM patients WHERE id = ?').get(patient_id);
    if (!patient) return res.status(404).json({ error: 'Paciente nao encontrado' });

    var fileId = uuidv4();
    var fileName = (title || 'nota') + '_' + new Date().toISOString().slice(0, 10) + '.txt';
    var subfolderId = await drive.getSubfolderId(patient.drive_folder_id, category);
    var buffer = Buffer.from(content, 'utf-8');
    var driveFile = await drive.uploadBuffer(buffer, fileName, 'text/plain', subfolderId);

    db.prepare("INSERT INTO files (id, patient_id, original_name, file_type, category, drive_file_id, drive_folder_id, transcription, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'uploaded')").run(
      fileId, patient_id, fileName, 'note', category, driveFile.id, subfolderId, content
    );
    db.prepare("UPDATE patients SET updated_at = datetime('now') WHERE id = ?").run(patient_id);
    res.status(201).json({ id: fileId, message: 'Nota salva com sucesso', file_name: fileName, category: category });
  } catch (err) {
    console.error('Note error:', err);
    res.status(500).json({ error: 'Erro ao salvar nota', details: err.message });
  }
});

// GET /api/files/patient/:patient_id — List all files grouped by category
router.get('/patient/:patient_id', (req, res) => {
  var db = getDb();
  var files = db.prepare('SELECT * FROM files WHERE patient_id = ? ORDER BY category, created_at DESC').all(req.params.patient_id);
  var byCategory = {};
  for (var i = 0; i < files.length; i++) {
    if (!byCategory[files[i].category]) byCategory[files[i].category] = [];
    byCategory[files[i].category].push(files[i]);
  }
  res.json({ files: files, by_category: byCategory, total: files.length });
});

// DELETE /api/files/:id — Delete a file from DB (keeps in Drive)
router.delete('/:id', (req, res) => {
  var db = getDb();
  var file = db.prepare('SELECT * FROM files WHERE id = ?').get(req.params.id);
  if (!file) return res.status(404).json({ error: 'Arquivo nao encontrado' });

  db.prepare('DELETE FROM files WHERE id = ?').run(req.params.id);
  db.prepare("UPDATE patients SET updated_at = datetime('now') WHERE id = ?").run(file.patient_id);
  db.prepare('INSERT INTO activity_log (patient_id, action, details) VALUES (?, ?, ?)').run(
    file.patient_id, 'file_deleted', JSON.stringify({ name: file.original_name, category: file.category })
  );

  res.json({ message: 'Arquivo removido', name: file.original_name });
});

module.exports = router;
