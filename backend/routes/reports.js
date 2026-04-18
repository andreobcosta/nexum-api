const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');
const { getDb } = require('../db/firestore');
const drive = require('../services/drive');
const claude = require('../services/claude');

const SYSTEM_PROMPT_PATH = path.join(__dirname, '..', 'prompts', 'system_prompt_ran.md');
function getSystemPrompt() {
  return fs.readFileSync(SYSTEM_PROMPT_PATH, 'utf-8');
}

// POST /api/reports/generate/:patient_id
router.post('/generate/:patient_id', async (req, res) => {
  try {
    const db = getDb();
    const patientDoc = await db.collection('patients').doc(req.params.patient_id).get();
    if (!patientDoc.exists) return res.status(404).json({ error: 'Paciente não encontrado' });
    const patient = { id: patientDoc.id, ...patientDoc.data() };
    if (!patient.drive_folder_id) return res.status(400).json({ error: 'Paciente sem pasta no Drive' });

    const filesSnap = await db.collection('patients').doc(req.params.patient_id).collection('files').get();
    const fileCounts = {};
    for (const f of filesSnap.docs) {
      const cat = f.data().category;
      fileCounts[cat] = (fileCounts[cat] || 0) + 1;
    }

    const missing = [];
    if (!fileCounts.anamnese) missing.push('Anamnese');
    if (!fileCounts.teste) missing.push('Testes');
    if (!fileCounts.sessao) missing.push('Sessões');
    if (missing.length > 0 && !req.body.force) {
      return res.status(400).json({
        error: 'Dados incompletos', missing,
        message: `Faltam: ${missing.join(', ')}. Envie force=true para gerar mesmo assim.`
      });
    }

    const dataPackage = {};
    for (const f of filesSnap.docs) {
      const file = f.data();
      const folderName = drive.CATEGORY_TO_FOLDER[file.category] || file.category;
      if (!dataPackage[folderName]) dataPackage[folderName] = [];
      dataPackage[folderName].push({
        name: file.original_name, type: file.file_type,
        content: file.transcription ? Buffer.from(file.transcription).toString('base64') : '[Arquivo binário]',
        size: file.transcription ? Buffer.byteLength(file.transcription) : 0
      });
    }

    try {
      const driveData = await drive.collectPatientData(patient.drive_folder_id);
      for (const folder in driveData) {
        if (!dataPackage[folder]) dataPackage[folder] = [];
        for (const df of driveData[folder]) {
          const exists = dataPackage[folder].some(f => f.name === df.name);
          if (!exists) dataPackage[folder].push(df);
        }
      }
    } catch (driveErr) {
      console.warn('Could not collect from Drive:', driveErr.message);
    }

    const systemPrompt = getSystemPrompt();
    const reportContent = await claude.generateRAN(systemPrompt, patient, dataPackage);

    const reportsSnap = await db.collection('patients').doc(req.params.patient_id).collection('reports').get();
    const version = reportsSnap.size + 1;
    const reportId = uuidv4();
    const now = new Date().toISOString();

    const reportFileName = `RAN_${patient.full_name.replace(/\s+/g, '_')}_v${version}_${now.slice(0, 10)}.md`;
    let driveFileId = null;

    try {
      const subfolderId = await drive.getSubfolderId(patient.drive_folder_id, 'relatorio');
      const reportBuffer = Buffer.from(reportContent, 'utf-8');
      const driveFile = await drive.uploadBuffer(reportBuffer, reportFileName, 'text/markdown', subfolderId);
      driveFileId = driveFile.id;
    } catch (uploadErr) {
      console.warn('Could not upload to Drive:', uploadErr.message);
    }

    await db.collection('patients').doc(req.params.patient_id).collection('reports').doc(reportId).set({
      patient_id: req.params.patient_id, version,
      drive_file_id: driveFileId, content_md: reportContent,
      status: 'draft', generated_at: now, reviewed_at: null
    });
    await db.collection('patients').doc(req.params.patient_id).update({
      status: 'relatorio_gerado', updated_at: now
    });
    await db.collection('activity_log').add({
      patient_id: req.params.patient_id, action: 'report_generated',
      details: JSON.stringify({ version, report_id: reportId }), created_at: now
    });

    res.status(201).json({
      id: reportId, version, patient: patient.full_name,
      drive_file_id: driveFileId, drive_file_name: reportFileName,
      content_preview: reportContent.substring(0, 500) + '...',
      message: `Relatório v${version} gerado com sucesso`
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao gerar relatório', details: err.message });
  }
});

// GET /api/reports/patient/:patient_id
router.get('/patient/:patient_id', async (req, res) => {
  try {
    const db = getDb();
    const snap = await db.collection('patients').doc(req.params.patient_id).collection('reports').orderBy('version', 'desc').get();
    const reports = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    res.json(reports);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao listar relatórios', details: err.message });
  }
});

// GET /api/reports/:patient_id/:report_id
router.get('/:patient_id/:report_id', async (req, res) => {
  try {
    const db = getDb();
    const doc = await db.collection('patients').doc(req.params.patient_id).collection('reports').doc(req.params.report_id).get();
    if (!doc.exists) return res.status(404).json({ error: 'Relatório não encontrado' });
    res.json({ id: doc.id, ...doc.data() });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao buscar relatório', details: err.message });
  }
});

// DELETE /api/reports/:patient_id/:report_id
router.delete('/:patient_id/:report_id', async (req, res) => {
  try {
    const db = getDb();
    const ref = db.collection('patients').doc(req.params.patient_id).collection('reports').doc(req.params.report_id);
    const doc = await ref.get();
    if (!doc.exists) return res.status(404).json({ error: 'Relatório não encontrado' });
    const { version } = doc.data();
    await ref.delete();
    await db.collection('activity_log').add({
      patient_id: req.params.patient_id, action: 'report_deleted',
      details: JSON.stringify({ version }), created_at: new Date().toISOString()
    });
    res.json({ message: `Relatório v${version} removido` });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao remover relatório', details: err.message });
  }
});

module.exports = router;
