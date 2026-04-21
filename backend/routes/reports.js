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

    // ETAPA 1: Adiciona arquivos do Firestore ao dataPackage
    // Transcrições de áudio → texto direto
    // Outros arquivos (PDFs, imagens) → placeholder para busca no Drive
    const firestoreFileNames = new Set(); // controla arquivos já adicionados

    for (const f of filesSnap.docs) {
      const file = f.data();
      const folderName = drive.CATEGORY_TO_FOLDER[file.category] || file.category;
      if (!dataPackage[folderName]) dataPackage[folderName] = [];

      if (file.transcription) {
        // Áudio com transcrição — passa texto diretamente
        dataPackage[folderName].push({
          name: file.original_name,
          type: 'text/plain',
          transcription: file.transcription,
          content: null,
          source: 'firestore_transcription'
        });
        filesLog.push(file.original_name + ' (transcrição áudio)');
        firestoreFileNames.add(file.original_name);
      } else if (file.drive_file_id) {
        // Arquivo sem transcrição — adiciona placeholder para ser preenchido pelo Drive
        dataPackage[folderName].push({
          name: file.original_name,
          type: file.file_type || 'application/octet-stream',
          transcription: null,
          content: null, // será preenchido abaixo
          drive_file_id: file.drive_file_id,
          source: 'firestore_pending'
        });
        filesLog.push(file.original_name + ' (aguardando Drive)');
        firestoreFileNames.add(file.original_name);
      }
    }

    // ETAPA 2: Busca conteúdo do Drive para todos os arquivos
    // — preenche placeholders pendentes e adiciona arquivos novos do Drive
    try {
      const driveData = await drive.collectPatientData(patient.drive_folder_id);
      for (const folder in driveData) {
        if (!dataPackage[folder]) dataPackage[folder] = [];
        for (const df of driveData[folder]) {
          // Verifica se já existe no dataPackage como placeholder pendente
          const pendingIdx = dataPackage[folder].findIndex(
            f => f.name === df.name && f.source === 'firestore_pending'
          );

          if (pendingIdx >= 0) {
            // Preenche o placeholder com o conteúdo real do Drive
            dataPackage[folder][pendingIdx].content = df.content;
            dataPackage[folder][pendingIdx].type = df.type || dataPackage[folder][pendingIdx].type;
            dataPackage[folder][pendingIdx].source = 'drive_filled';
            filesLog.push(df.name + ' (conteúdo Drive carregado)');
          } else if (!firestoreFileNames.has(df.name)) {
            // Arquivo existe no Drive mas não no Firestore — adiciona diretamente
            dataPackage[folder].push({
              name: df.name,
              type: df.type,
              content: df.content,
              size: df.size,
              source: 'drive_only'
            });
            filesLog.push(df.name + ' (Drive — não registrado no Firestore)');
          }
        }
      }
    } catch (driveErr) {
      console.warn('[Reports] Erro ao coletar Drive:', driveErr.message);
    }

    // ETAPA 3: Log detalhado do que vai para o pipeline
    const totalFiles = Object.values(dataPackage).reduce((sum, arr) => sum + arr.length, 0);
    const comConteudo = Object.values(dataPackage).reduce(
      (sum, arr) => sum + arr.filter(f => f.transcription || f.content).length, 0
    );
    console.log(`[Reports] Arquivos coletados (${totalFiles} total, ${comConteudo} com conteúdo):`, filesLog.join(' | '));

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
    const scoreMinimo = 20;
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
// GET /api/reports/:report_id — busca relatório por ID único (sem patient_id)
router.get('/:report_id', async (req, res) => {
  try {
    const db = getDb();
    // Busca em todos os pacientes (query de coleção)
    const snap = await db.collectionGroup('reports').where('__name__', '==', db.collectionGroup('reports').doc(req.params.report_id)).get().catch(() => null);
    
    // Fallback: busca direta se o ID for composto patient_id/report_id  
    // ou tenta buscar via activity_log
    // Solução pragmática: retorna erro orientativo
    return res.status(400).json({ 
      error: 'Use GET /api/reports/:patient_id/:report_id',
      hint: 'Esta rota requer patient_id. Consulte GET /api/reports/patient/:patient_id para listar relatórios do paciente.'
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


module.exports = router;

// GET /api/reports/:patient_id/:report_id/docx — gera e retorna DOCX
router.get('/:patient_id/:report_id/docx', async (req, res) => {
  try {
    const db = getDb();
    const doc = await db.collection('patients').doc(req.params.patient_id).collection('reports').doc(req.params.report_id).get();
    if (!doc.exists) return res.status(404).json({ error: 'Relatório não encontrado' });
    const report = doc.data();
    const patientDoc = await db.collection('patients').doc(req.params.patient_id).get();
    const patient = patientDoc.data();
    const { gerarDocx } = require('../services/docx-generator');
    const buffer = await gerarDocx(report.content_md || '', report.patient_id);
    const nomeBase = (patient?.full_name || 'paciente').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-zA-Z0-9\s]/g,'').trim().replace(/\s+/g,'_'); const fileName = `RAN_${nomeBase}_v${report.version}.docx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.send(buffer);
  } catch (err) {
    console.error('[DOCX]', err);
    res.status(500).json({ error: 'Erro ao gerar DOCX', details: err.message });
  }
});

// PATCH /api/reports/:patient_id/:report_id — atualiza conteúdo do relatório
router.patch('/:patient_id/:report_id', async (req, res) => {
  try {
    const db = getDb();
    const { content_md } = req.body;
    if (!content_md) return res.status(400).json({ error: 'content_md é obrigatório' });
    const ref = db.collection('patients').doc(req.params.patient_id).collection('reports').doc(req.params.report_id);
    const doc = await ref.get();
    if (!doc.exists) return res.status(404).json({ error: 'Relatório não encontrado' });
    await ref.update({ content_md, reviewed_at: new Date().toISOString(), status: 'reviewed' });
    await db.collection('activity_log').add({
      patient_id: req.params.patient_id, action: 'report_edited',
      details: JSON.stringify({ report_id: req.params.report_id }),
      created_at: new Date().toISOString()
    });
    res.json({ message: 'Relatório atualizado', id: req.params.report_id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao atualizar relatório', details: err.message });
  }
});
