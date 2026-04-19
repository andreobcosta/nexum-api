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

    // Monta dataPackage com dados corretos do Firestore
    // Transcrições de áudio são passadas como texto — PDFs como base64 para extração via vision
    const dataPackage = {};
    const filesLog = [];

    for (const f of filesSnap.docs) {
      const file = f.data();
      const folderName = drive.CATEGORY_TO_FOLDER[file.category] || file.category;
      if (!dataPackage[folderName]) dataPackage[folderName] = [];

      if (file.transcription) {
        // Áudio transcrito — passa o texto diretamente
        dataPackage[folderName].push({
          name: file.original_name,
          type: 'text/plain',
          transcription: file.transcription,
          content: null,
          source: 'firestore'
        });
        filesLog.push(file.original_name + ' (transcrição)');
      } else if (file.drive_file_id) {
        // Arquivo sem transcrição — busca do Drive para extração
        filesLog.push(file.original_name + ' (pendente do Drive)');
      }
    }

    // Complementa com arquivos do Drive (PDFs, imagens, documentos)
    try {
      const driveData = await drive.collectPatientData(patient.drive_folder_id);
      for (const folder in driveData) {
        if (!dataPackage[folder]) dataPackage[folder] = [];
        for (const df of driveData[folder]) {
          // Evita duplicar arquivos já presentes via Firestore
          const existsInFirestore = dataPackage[folder].some(f => f.name === df.name && f.transcription);
          if (!existsInFirestore) {
            dataPackage[folder].push({
              name: df.name,
              type: df.type,
              content: df.content, // base64 — será processado pelo pdf-extractor
              size: df.size,
              source: 'drive'
            });
            filesLog.push(df.name + ' (Drive)');
          }
        }
      }
    } catch (driveErr) {
      console.warn('Could not collect from Drive:', driveErr.message);
    }

    console.log('[Reports] Arquivos coletados:', filesLog.join(', '));

    const systemPrompt = getSystemPrompt();
    const ranResult = await claude.generateRAN(systemPrompt, patient, dataPackage);
    const reportContent = ranResult.relatorio;
    const ranMeta = {
      dossie: ranResult.dossie,
      revisao: ranResult.revisao,
      custos: ranResult.custos,
      extraction_meta: ranResult.extraction_meta,
      elapsed_seconds: ranResult.elapsed_seconds
    };

    // Bloqueia salvamento se score de qualidade for muito baixo
    const scoreMinimo = 40;
    if (ranResult.revisao?.score_qualidade < scoreMinimo && !req.body.force_save) {
      return res.status(422).json({
        error: 'Qualidade insuficiente',
        score: ranResult.revisao.score_qualidade,
        minimo: scoreMinimo,
        problemas: ranResult.revisao.problemas_criticos,
        secoes_ausentes: ranResult.revisao.secoes_ausentes,
        message: 'Score ' + ranResult.revisao.score_qualidade + '/100 abaixo do mínimo (' + scoreMinimo + '). Envie force_save=true para salvar mesmo assim.',
        relatorio_preview: reportContent.substring(0, 500)
      });
    }

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
      drive_file_id: driveFileId, content_md: reportContent, ran_meta: JSON.stringify(ranMeta),
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
      content_preview: reportContent.substring(0, 500) + '...', score_qualidade: ranMeta.revisao?.score_qualidade, elapsed_seconds: ranMeta.elapsed_seconds, custo_usd: ranMeta.custos?.total_usd,
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

// POST /api/reports/update/:patient_id/:report_id
router.post('/update/:patient_id/:report_id', async (req, res) => {
  try {
    const db = getDb();
    const patientDoc = await db.collection('patients').doc(req.params.patient_id).get();
    if (!patientDoc.exists) return res.status(404).json({ error: 'Paciente não encontrado' });
    const patient = { id: patientDoc.id, ...patientDoc.data() };

    // Busca RAN existente
    const reportDoc = await db.collection('patients').doc(req.params.patient_id).collection('reports').doc(req.params.report_id).get();
    if (!reportDoc.exists) return res.status(404).json({ error: 'Relatório não encontrado' });
    const reportExistente = reportDoc.data();
    const ranExistente = reportExistente.content_md;

    // Busca documentos novos (criados após o relatório)
    const generatedAt = reportExistente.generated_at;
    const filesSnap = await db.collection('patients').doc(req.params.patient_id).collection('files').get();

    // Filtra apenas arquivos novos desde a última geração
    const novosArquivos = filesSnap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(f => f.created_at > generatedAt);

    if (novosArquivos.length === 0 && !req.body.force) {
      return res.status(400).json({
        error: 'Nenhum documento novo desde a última geração',
        generated_at: generatedAt,
        message: 'Envie force=true para atualizar mesmo sem novos documentos'
      });
    }

    // Monta pacote de novos documentos
    const novosSections = [];
    const todosArquivos = req.body.force ? filesSnap.docs.map(d => ({ id: d.id, ...d.data() })) : novosArquivos;

    for (const file of todosArquivos) {
      const folderName = require('../services/drive').CATEGORY_TO_FOLDER[file.category] || file.category;
      novosSections.push('\n### [NOVO] ' + file.original_name + ' (' + folderName + ')');
      if (file.transcription) {
        novosSections.push(file.transcription);
      } else {
        novosSections.push('[Arquivo sem transcricao disponivel]');
      }
    }

    const novosDocumentos = novosSections.join('\n');
    const systemPrompt = getSystemPrompt();
    const ranResult = await claude.updateRAN(systemPrompt, patient, ranExistente, novosDocumentos);

    const reportContent = ranResult.relatorio;
    const ranMeta = { diff: ranResult.diff, revisao: ranResult.revisao, elapsed_seconds: ranResult.elapsed_seconds, updated_from: req.params.report_id };

    // Cria nova versão
    const reportsSnap = await db.collection('patients').doc(req.params.patient_id).collection('reports').get();
    const version = reportsSnap.size + 1;
    const reportId = uuidv4();
    const now = new Date().toISOString();

    const reportFileName = 'RAN_' + patient.full_name.replace(/\s+/g, '_') + '_v' + version + '_' + now.slice(0, 10) + '.md';
    let driveFileId = null;

    try {
      const subfolderId = await require('../services/drive').getSubfolderId(patient.drive_folder_id, 'relatorio');
      const reportBuffer = Buffer.from(reportContent, 'utf-8');
      const driveFile = await require('../services/drive').uploadBuffer(reportBuffer, reportFileName, 'text/markdown', subfolderId);
      driveFileId = driveFile.id;
    } catch (uploadErr) {
      console.warn('Could not upload to Drive:', uploadErr.message);
    }

    await db.collection('patients').doc(req.params.patient_id).collection('reports').doc(reportId).set({
      patient_id: req.params.patient_id, version,
      drive_file_id: driveFileId, content_md: reportContent,
      ran_meta: JSON.stringify(ranMeta),
      status: 'draft', generated_at: now, reviewed_at: null,
      updated_from_version: reportExistente.version,
      novos_documentos_count: novosArquivos.length
    });

    await db.collection('patients').doc(req.params.patient_id).update({ status: 'relatorio_gerado', updated_at: now });
    await db.collection('activity_log').add({
      patient_id: req.params.patient_id, action: 'report_updated',
      details: JSON.stringify({ version, report_id: reportId, from_version: reportExistente.version, novos_docs: novosArquivos.length }),
      created_at: now
    });

    res.status(201).json({
      id: reportId, version, patient: patient.full_name,
      drive_file_id: driveFileId, drive_file_name: reportFileName,
      novos_documentos: novosArquivos.length,
      secoes_afetadas: ranResult.diff?.secoes_afetadas || [],
      score_qualidade: ranMeta.revisao?.score_qualidade,
      elapsed_seconds: ranMeta.elapsed_seconds,
      message: 'Relatório v' + version + ' atualizado com ' + novosArquivos.length + ' novo(s) documento(s)'
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao atualizar relatório', details: err.message });
  }
});