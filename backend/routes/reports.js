const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');
const { getDb } = require('../db/connection');
const drive = require('../services/drive');
const claude = require('../services/claude');

var SYSTEM_PROMPT_PATH = path.join(__dirname, '..', 'prompts', 'system_prompt_ran.md');

function getSystemPrompt() {
  return fs.readFileSync(SYSTEM_PROMPT_PATH, 'utf-8');
}

// POST /api/reports/generate/:patient_id
router.post('/generate/:patient_id', async (req, res) => {
  var db = getDb();
  try {
    var patient = db.prepare('SELECT * FROM patients WHERE id = ?').get(req.params.patient_id);
    if (!patient) return res.status(404).json({ error: 'Paciente nao encontrado' });
    if (!patient.drive_folder_id) return res.status(400).json({ error: 'Paciente sem pasta no Drive' });

    var files = db.prepare('SELECT category, COUNT(*) as count FROM files WHERE patient_id = ? GROUP BY category').all(req.params.patient_id);
    var fileCounts = {};
    for (var i = 0; i < files.length; i++) fileCounts[files[i].category] = files[i].count;

    var missing = [];
    if (!fileCounts.anamnese) missing.push('Anamnese');
    if (!fileCounts.teste) missing.push('Testes');
    if (!fileCounts.sessao) missing.push('Sessoes');

    if (missing.length > 0 && !req.body.force) {
      return res.status(400).json({ error: 'Dados incompletos', missing: missing, message: 'Faltam: ' + missing.join(', ') + '. Envie force=true para gerar mesmo assim.' });
    }

    var allFiles = db.prepare('SELECT * FROM files WHERE patient_id = ? ORDER BY category, created_at').all(req.params.patient_id);
    var dataPackage = {};
    for (var j = 0; j < allFiles.length; j++) {
      var file = allFiles[j];
      var folderName = drive.CATEGORY_TO_FOLDER[file.category] || file.category;
      if (!dataPackage[folderName]) dataPackage[folderName] = [];
      dataPackage[folderName].push({
        name: file.original_name,
        type: file.file_type,
        content: file.transcription ? Buffer.from(file.transcription).toString('base64') : '[Arquivo binario]',
        size: file.transcription ? Buffer.byteLength(file.transcription) : 0
      });
    }

    try {
      var driveData = await drive.collectPatientData(patient.drive_folder_id);
      for (var folder in driveData) {
        if (!dataPackage[folder]) dataPackage[folder] = [];
        for (var k = 0; k < driveData[folder].length; k++) {
          var df = driveData[folder][k];
          var exists = dataPackage[folder].some(function(f) { return f.name === df.name; });
          if (!exists) dataPackage[folder].push(df);
        }
      }
    } catch (driveErr) {
      console.warn('Could not collect from Drive:', driveErr.message);
    }

    var systemPrompt = getSystemPrompt();
    var reportContent = await claude.generateRAN(systemPrompt, patient, dataPackage);

    var reportId = uuidv4();
    var existingReports = db.prepare('SELECT MAX(version) as max_v FROM reports WHERE patient_id = ?').get(req.params.patient_id);
    var version = (existingReports && existingReports.max_v || 0) + 1;

    var reportFileName = 'RAN_' + patient.full_name.replace(/\s+/g, '_') + '_v' + version + '_' + new Date().toISOString().slice(0, 10) + '.md';
    var driveFileId = null;

    try {
      var subfolderId = await drive.getSubfolderId(patient.drive_folder_id, 'relatorio');
      var reportBuffer = Buffer.from(reportContent, 'utf-8');
      var driveFile = await drive.uploadBuffer(reportBuffer, reportFileName, 'text/markdown', subfolderId);
      driveFileId = driveFile.id;
    } catch (uploadErr) {
      console.warn('Could not upload to Drive:', uploadErr.message);
    }

    db.prepare("INSERT INTO reports (id, patient_id, version, drive_file_id, content_md, status) VALUES (?, ?, ?, ?, ?, 'draft')").run(
      reportId, req.params.patient_id, version, driveFileId, reportContent
    );
    db.prepare("UPDATE patients SET status = 'relatorio_gerado', updated_at = datetime('now') WHERE id = ?").run(req.params.patient_id);
    db.prepare('INSERT INTO activity_log (patient_id, action, details) VALUES (?, ?, ?)').run(
      req.params.patient_id, 'report_generated', JSON.stringify({ version: version, report_id: reportId })
    );

    res.status(201).json({
      id: reportId, version: version, patient: patient.full_name,
      drive_file_id: driveFileId, drive_file_name: reportFileName,
      content_preview: reportContent.substring(0, 500) + '...',
      message: 'Relatorio v' + version + ' gerado com sucesso'
    });
  } catch (err) {
    console.error('Report generation error:', err);
    res.status(500).json({ error: 'Erro ao gerar relatorio', details: err.message });
  }
});

// GET /api/reports/:id
router.get('/:id', (req, res) => {
  var db = getDb();
  var report = db.prepare('SELECT r.*, p.full_name FROM reports r JOIN patients p ON r.patient_id = p.id WHERE r.id = ?').get(req.params.id);
  if (!report) return res.status(404).json({ error: 'Relatorio nao encontrado' });
  res.json(report);
});

// GET /api/reports/patient/:patient_id
router.get('/patient/:patient_id', (req, res) => {
  var db = getDb();
  var reports = db.prepare('SELECT * FROM reports WHERE patient_id = ? ORDER BY version DESC').all(req.params.patient_id);
  res.json(reports);
});

// DELETE /api/reports/:id
router.delete('/:id', (req, res) => {
  var db = getDb();
  var report = db.prepare('SELECT * FROM reports WHERE id = ?').get(req.params.id);
  if (!report) return res.status(404).json({ error: 'Relatorio nao encontrado' });

  db.prepare('DELETE FROM reports WHERE id = ?').run(req.params.id);
  db.prepare('INSERT INTO activity_log (patient_id, action, details) VALUES (?, ?, ?)').run(
    report.patient_id, 'report_deleted', JSON.stringify({ version: report.version })
  );

  res.json({ message: 'Relatorio v' + report.version + ' removido' });
});

module.exports = router;
