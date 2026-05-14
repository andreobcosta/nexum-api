const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../db/firestore');
const storage = require('../services/storage');
const claude = require('../services/claude');

const CATEGORY_LABEL = {
  anamnese: '01 - Anamnese',
  teste: '02 - Testes aplicados',
  sessao: '03 - Sessões',
  relatorio: '04 - Relatórios',
  intervencao: '05 - Intervenções',
  externo: '06 - Documentos externos'
};

// ── HELPERS DE VERSÃO ──
function parseMajorMinor(v) {
  const s = String(v || '1');
  const parts = s.split('.');
  const major = parseInt(parts[0]) || 1;
  const minor = parts.length > 1 ? (parseInt(parts[1]) || 0) : 0;
  return { major, minor };
}

function calcularProximaVersaoMaior(relatorios) {
  if (!relatorios || relatorios.length === 0) return '1.0';
  const maiorMajor = Math.max(...relatorios.map(r => parseMajorMinor(r.version).major));
  return `${maiorMajor + 1}.0`;
}

function calcularProximaSubversao(relatorios) {
  if (!relatorios || relatorios.length === 0) return '1.1';
  const versoes = relatorios.map(r => parseMajorMinor(r.version));
  const maiorMajor = Math.max(...versoes.map(v => v.major));
  const minorsDesteGrupo = versoes.filter(v => v.major === maiorMajor).map(v => v.minor);
  return `${maiorMajor}.${Math.max(...minorsDesteGrupo) + 1}`;
}

function sortRelatorios(relatorios) {
  return relatorios.slice().sort((a, b) => {
    const va = parseMajorMinor(a.version), vb = parseMajorMinor(b.version);
    return vb.major !== va.major ? vb.major - va.major : vb.minor - va.minor;
  });
}

function extrairDadosPacienteDoRAN(contentMd) {
  if (!contentMd) return {};
  const updates = {};
  const toTC = s => s.replace(/\w\S*/g, t => t.charAt(0).toUpperCase() + t.substr(1).toLowerCase());
  const clean = t => t.replace(/[|*]/g, '').trim();
  for (const linha of contentMd.split('\n')) {
    const nome = linha.match(/Nome da Crian[çc]a\s*:\s*(.+)/i);
    if (nome) { const n = clean(nome[1]); if (n && n.length > 2 && !n.includes('[')) updates.full_name = toTC(n); }
    const nasc = linha.match(/Data de Nascimento\s*:\s*([\d\/]+)/i);
    if (nasc) { const [d, m, y] = nasc[1].split('/'); if (y) updates.birth_date = `${y}-${(m||'01').padStart(2,'0')}-${(d||'01').padStart(2,'0')}`; }
    const idade = linha.match(/Idade\s*:\s*(\d+)/i) || linha.match(/\b(\d+)\s*ANOS\b/);
    if (idade) updates.age = parseInt(idade[1]);
    const escol = linha.match(/Escolaridade\s*:\s*(.+)/i);
    if (escol) { const e = clean(escol[1]); if (e && !e.includes('[')) updates.grade = toTC(e); }
    const dom = linha.match(/Domin[âa]ncia\s*(?:manual)?\s*:\s*(.+)/i);
    if (dom) { const d = clean(dom[1]).toLowerCase(); if (d && !d.includes('[')) updates.handedness = d.includes('destra')||d.includes('direita') ? 'Destro' : d.includes('sinistra')||d.includes('esquerda') ? 'Canhoto' : toTC(clean(dom[1])); }
    const med = linha.match(/Faz uso de medicamentos\??\s*(.+)/i);
    if (med) { const m = clean(med[1]).toLowerCase(); if (!m.includes('[')) updates.medications = (m==='não'||m==='nao') ? '' : clean(med[1]); }
    const resp = linha.match(/Respons[áa]veis\s*:\s*(.+)/i);
    if (resp) { const r = clean(resp[1]); if (r && !r.includes('[')) updates.guardians = toTC(r); }
  }
  return updates;
}

// Coleta dados do paciente do Firestore + Storage para o pipeline
async function coletarDadosPaciente(patientId, filesSnap) {
  const dataPackage = {};
  const filesLog = [];

  for (const f of filesSnap.docs) {
    const file = f.data();
    const cat = file.category || file.categoria;
    const folderName = CATEGORY_LABEL[cat] || cat || 'Sem categoria';
    if (!dataPackage[folderName]) dataPackage[folderName] = [];

    if (file.transcription) {
      // Arquivo com transcrição disponível (áudio transcrito ou nota)
      dataPackage[folderName].push({
        name: file.original_name,
        type: 'text/plain',
        transcription: file.transcription,
        content: null,
        source: 'firestore_transcription'
      });
      filesLog.push(file.original_name + ' (transcrição)');
    } else if (file.storage_path) {
      // Arquivo no GCS — baixa para o pipeline
      try {
        const buffer = await storage.downloadFile(file.storage_path);
        dataPackage[folderName].push({
          name: file.original_name,
          type: file.file_type || 'application/octet-stream',
          transcription: null,
          content: buffer.toString('base64'),
          source: 'storage'
        });
        filesLog.push(file.original_name + ' (Storage)');
      } catch (e) {
        console.warn('[Reports] Falha ao baixar do Storage:', file.original_name, e.message);
        filesLog.push(file.original_name + ' (falha Storage)');
      }
    } else {
      // Arquivo antigo com drive_file_id sem transcription — inacessível
      filesLog.push(file.original_name + ' (sem storage_path — ignorado)');
    }
  }

  console.log('[Reports] Arquivos coletados:', filesLog.join(' | '));
  return dataPackage;
}

// POST /api/reports/generate/:patient_id
router.post('/generate/:patient_id', async (req, res) => {
  try {
    const db = getDb();

    // Limpar job travado (processando há mais de 15 minutos)
    const TIMEOUT_MS = 15 * 60 * 1000;
    const pacienteRef = db.collection('patients').doc(req.params.patient_id);
    const pacienteSnap = await pacienteRef.get();
    if (pacienteSnap.exists) {
      const pd = pacienteSnap.data();
      if (pd.pipeline_ativo && pd.pipeline_iniciado_em) {
        const iniciado = pd.pipeline_iniciado_em.toDate
          ? pd.pipeline_iniciado_em.toDate()
          : new Date(pd.pipeline_iniciado_em);
        if (Date.now() - iniciado.getTime() > TIMEOUT_MS) {
          const jobsSnap = await db.collection('jobs')
            .where('patient_id', '==', req.params.patient_id)
            .where('status', '==', 'processando').get();
          const batch = db.batch();
          jobsSnap.forEach(d => batch.update(d.ref, { status: 'failed', error: 'Timeout automático' }));
          batch.update(pacienteRef, { pipeline_ativo: false, pipeline_iniciado_em: null });
          await batch.commit();
        }
      }
    }

    const patientDoc = await db.collection('patients').doc(req.params.patient_id).get();
    if (!patientDoc.exists) return res.status(404).json({ error: 'Paciente não encontrado' });
    const patient = { id: patientDoc.id, ...patientDoc.data() };

    if (patientDoc.data()?.pipeline_ativo) {
      return res.status(409).json({ error: 'Geração já em andamento para este paciente' });
    }
    const patRef = db.collection('patients').doc(req.params.patient_id);
    await patRef.update({ pipeline_ativo: true, pipeline_iniciado_em: new Date().toISOString() });

    const filesSnap = await db.collection('patients').doc(req.params.patient_id).collection('files').get();
    const fileCounts = {};
    for (const f of filesSnap.docs) {
      const cat = f.data().category || f.data().categoria;
      if (cat) fileCounts[cat] = (fileCounts[cat] || 0) + 1;
    }

    const missing = [];
    if (!fileCounts.anamnese) missing.push('Anamnese');
    if (!fileCounts.teste) missing.push('Testes');
    if (!fileCounts.sessao) missing.push('Sessões');
    if (missing.length > 0 && !req.body.force) {
      await patRef.update({ pipeline_ativo: false, pipeline_iniciado_em: null });
      return res.status(400).json({
        error: 'Dados incompletos', missing,
        message: `Faltam: ${missing.join(', ')}. Envie force=true para gerar mesmo assim.`
      });
    }

    const jobId = uuidv4();
    const jobRef = db.collection('jobs').doc(jobId);
    await jobRef.set({ status: 'processando', etapa: 'iniciando', agente: null, patient_id: req.params.patient_id, created_at: new Date().toISOString() });
    res.status(202).json({ job_id: jobId, status: 'processando' });

    setImmediate(async () => {
      try {
        const dataPackage = await coletarDadosPaciente(req.params.patient_id, filesSnap);

        const totalFiles = Object.values(dataPackage).reduce((sum, arr) => sum + arr.length, 0);
        const comConteudo = Object.values(dataPackage).reduce((sum, arr) => sum + arr.filter(f => f.transcription || f.content).length, 0);

        if (totalFiles > 0 && comConteudo === 0) {
          const errMsg = `Coleta de dados falhou — ${totalFiles} arquivo(s) encontrado(s), mas nenhum tem conteúdo acessível.`;
          console.error('[Reports] Abortando pipeline:', errMsg);
          await jobRef.update({ status: 'erro', erro: errMsg, etapa: 'coleta_dados_falhou', finished_at: new Date().toISOString() }).catch(() => {});
          await patRef.update({ pipeline_ativo: false, pipeline_iniciado_em: null }).catch(() => {});
          return;
        }

        const ETAPA_MAP = {
          analitico: 'Agente Analítico — extraindo dados clínicos',
          redator: 'Agente Redator — redigindo relatório',
          revisor: 'Agente Revisor — validando qualidade'
        };
        const onProgress = async (agent) => {
          if (ETAPA_MAP[agent]) await jobRef.update({ etapa: ETAPA_MAP[agent], agente: agent }).catch(() => {});
        };

        const systemPrompt = await claude.getSystemPrompt();
        const ranResult = await claude.generateRAN(systemPrompt, patient, dataPackage, onProgress, req.user?.email);
        await patRef.update({ pipeline_ativo: false, pipeline_iniciado_em: null });

        const reportContent = ranResult.relatorio;
        const ranMeta = { dossie: ranResult.dossie, revisao: ranResult.revisao, custos: ranResult.custos, extraction_meta: ranResult.extraction_meta, elapsed_seconds: ranResult.elapsed_seconds };

        const reportsSnap = await db.collection('patients').doc(req.params.patient_id).collection('reports').get();
        const version = calcularProximaVersaoMaior(reportsSnap.docs.map(d => d.data()));
        const reportId = uuidv4();
        const now = new Date().toISOString();

        const nomeBase = patient.full_name.normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^a-zA-Z0-9\s]/g,'').trim().replace(/\s+/g,'_');
        const reportFileName = `RAN_${nomeBase}_v${version}.docx`;
        let storagePath = null;

        try {
          const { gerarDocx } = require('../services/docx-generator');
          const docxBuf = await gerarDocx(reportContent, nomeBase, req.user?.email, patient);
          storagePath = storage.reportPath(req.params.patient_id, reportId, reportFileName);
          await storage.uploadBuffer(docxBuf, storagePath, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
          console.log('[Reports] DOCX salvo no Storage:', storagePath);
        } catch (uploadErr) {
          console.warn('[Reports] Erro ao salvar DOCX no Storage:', uploadErr.message);
        }

        await db.collection('patients').doc(req.params.patient_id).collection('reports').doc(reportId).set({
          patient_id: req.params.patient_id, version,
          storage_path: storagePath,
          content_md: reportContent, ran_meta: JSON.stringify(ranMeta),
          status: 'draft', generated_at: now, reviewed_at: null
        });
        const { FieldValue } = require('@google-cloud/firestore');
        await db.collection('patients').doc(req.params.patient_id).update({ status: 'relatorio_gerado', updated_at: now, reports_count: FieldValue.increment(1) });
        await db.collection('activity_log').add({ patient_id: req.params.patient_id, action: 'report_generated', details: JSON.stringify({ version, report_id: reportId }), created_at: now });

        await jobRef.update({ status: 'concluido', etapa: 'Relatório gerado', agente: 'concluido', report_id: reportId, score_qualidade: ranResult.revisao?.score_qualidade, completed_at: now });

        try {
          const dadosPaciente = extrairDadosPacienteDoRAN(reportContent);
          if (Object.keys(dadosPaciente).length > 0) {
            await db.collection('patients').doc(req.params.patient_id).update({ ...dadosPaciente, updated_at: now });
            console.log('[Reports] Dados do paciente sincronizados do RAN:', Object.keys(dadosPaciente).join(', '));
          }
        } catch (e) { console.warn('[Reports] Falha ao sincronizar dados do paciente:', e.message); }

      } catch (bgErr) {
        console.error('[Pipeline] Erro em background:', bgErr);
        await jobRef.update({ status: 'erro', erro: bgErr.message }).catch(() => {});
        await patRef.update({ pipeline_ativo: false, pipeline_iniciado_em: null }).catch(() => {});
      }
    });

  } catch (err) {
    console.error(err);
    try { await db.collection('patients').doc(req.params.patient_id).update({ pipeline_ativo: false, pipeline_iniciado_em: null }); } catch {}
    res.status(500).json({ error: 'Erro ao iniciar geração', details: err.message });
  }
});

// GET /api/reports/patient/:patient_id
router.get('/patient/:patient_id', async (req, res) => {
  try {
    const db = getDb();
    const snap = await db.collection('patients').doc(req.params.patient_id).collection('reports').get();
    const reports = sortRelatorios(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    res.json(reports);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao listar relatórios', details: err.message });
  }
});

// GET /api/reports/job/:job_id
router.get('/job/:job_id', async (req, res) => {
  try {
    const db = getDb();
    const doc = await db.collection('jobs').doc(req.params.job_id).get();
    if (!doc.exists) return res.status(404).json({ error: 'Job não encontrado' });
    res.json({ id: doc.id, ...doc.data() });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao buscar job', details: err.message });
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

// GET /api/reports/:patient_id/:report_id/feedback
router.get('/:patient_id/:report_id/feedback', async (req, res) => {
  try {
    const db = getDb();
    const snap = await db.collection('feedbacks').where('report_id', '==', req.params.report_id).get();
    const map = {};
    for (const doc of snap.docs) {
      const d = doc.data();
      if (!map[d.bloco_id] || d.created_at > map[d.bloco_id].created_at) map[d.bloco_id] = d;
    }
    res.json(Object.fromEntries(Object.entries(map).map(([k,v])=>[k,v.feedback_type])));
  } catch (err) {
    res.status(500).json({ error: 'Erro ao buscar feedbacks', details: err.message });
  }
});

// POST /api/reports/:patient_id/:report_id/feedback
router.post('/:patient_id/:report_id/feedback', async (req, res) => {
  try {
    const { bloco_id, bloco_heading, feedback_type, bloco_content } = req.body;
    if (!bloco_id || !feedback_type) return res.status(400).json({ error: 'bloco_id e feedback_type são obrigatórios' });
    const db = getDb();
    await db.collection('feedbacks').add({
      patient_id: req.params.patient_id, report_id: req.params.report_id,
      bloco_id, bloco_heading: bloco_heading || '', feedback_type,
      bloco_content: bloco_content || '', created_at: new Date().toISOString()
    });
    res.status(201).json({ message: 'Feedback registrado', bloco_id, feedback_type });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao registrar feedback', details: err.message });
  }
});

// POST /api/reports/:patient_id/:report_id/feedback/batch
router.post('/:patient_id/:report_id/feedback/batch', async (req, res) => {
  try {
    const feedbacks = req.body;
    if (!Array.isArray(feedbacks) || feedbacks.length === 0) return res.status(400).json({ error: 'Body deve ser array não vazio' });
    const db = getDb();
    const now = new Date().toISOString();
    const saves = feedbacks.map(f => db.collection('feedbacks').add({
      patient_id: req.params.patient_id, report_id: req.params.report_id,
      bloco_id: f.bloco_id || '', bloco_heading: f.bloco_heading || '',
      feedback_type: f.feedback_type,
      texto_original: f.texto_original || '', texto_editado: f.texto_editado || '',
      created_at: now
    }));
    await Promise.all(saves);
    res.status(201).json({ saved: saves.length });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao registrar feedbacks em lote', details: err.message });
  }
});

// DELETE /api/reports/:patient_id/:report_id
router.delete('/:patient_id/:report_id', async (req, res) => {
  try {
    const db = getDb();
    const ref = db.collection('patients').doc(req.params.patient_id).collection('reports').doc(req.params.report_id);
    const doc = await ref.get();
    if (!doc.exists) return res.status(404).json({ error: 'Relatório não encontrado' });
    const { version, storage_path } = doc.data();

    if (storage_path) {
      await storage.deleteFile(storage_path).catch(e => console.warn('[DELETE] Storage error (ignorado):', e.message));
    }

    await ref.delete();
    const { FieldValue: FV } = require('@google-cloud/firestore');
    await db.collection('patients').doc(req.params.patient_id).update({ reports_count: FV.increment(-1) });
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

    const TIMEOUT_MS = 15 * 60 * 1000;
    const pacienteRef = db.collection('patients').doc(req.params.patient_id);
    const pacienteSnap = await pacienteRef.get();
    if (pacienteSnap.exists) {
      const pd = pacienteSnap.data();
      if (pd.pipeline_ativo && pd.pipeline_iniciado_em) {
        const iniciado = pd.pipeline_iniciado_em.toDate ? pd.pipeline_iniciado_em.toDate() : new Date(pd.pipeline_iniciado_em);
        if (Date.now() - iniciado.getTime() > TIMEOUT_MS) {
          const jobsSnap = await db.collection('jobs').where('patient_id', '==', req.params.patient_id).where('status', '==', 'processando').get();
          const batch = db.batch();
          jobsSnap.forEach(d => batch.update(d.ref, { status: 'failed', error: 'Timeout automático' }));
          batch.update(pacienteRef, { pipeline_ativo: false, pipeline_iniciado_em: null });
          await batch.commit();
        }
      }
    }

    const patientDoc = await db.collection('patients').doc(req.params.patient_id).get();
    if (!patientDoc.exists) return res.status(404).json({ error: 'Paciente não encontrado' });
    const patient = { id: patientDoc.id, ...patientDoc.data() };

    const reportDoc = await db.collection('patients').doc(req.params.patient_id).collection('reports').doc(req.params.report_id).get();
    if (!reportDoc.exists) return res.status(404).json({ error: 'Relatório não encontrado' });
    const reportExistente = reportDoc.data();
    const ranExistente = reportExistente.content_md;

    const generatedAt = reportExistente.generated_at;
    const filesSnap = await db.collection('patients').doc(req.params.patient_id).collection('files').get();
    const novosArquivos = filesSnap.docs.map(d => ({ id: d.id, ...d.data() })).filter(f => f.created_at > generatedAt);

    if (novosArquivos.length === 0 && !req.body.force) {
      return res.status(400).json({
        error: 'Nenhum documento novo desde a última geração',
        generated_at: generatedAt,
        message: 'Envie force=true para atualizar mesmo sem novos documentos'
      });
    }

    const todosArquivos = req.body.force ? filesSnap.docs.map(d => ({ id: d.id, ...d.data() })) : novosArquivos;
    const novosSections = [];
    for (const file of todosArquivos) {
      const folderName = CATEGORY_LABEL[file.category] || file.category || 'Sem categoria';
      novosSections.push('\n### [NOVO] ' + file.original_name + ' (' + folderName + ')');
      if (file.transcription) {
        novosSections.push(file.transcription);
      } else {
        novosSections.push('[Arquivo sem transcrição disponível]');
      }
    }

    const novosDocumentos = novosSections.join('\n');
    const systemPrompt = await claude.getSystemPrompt();
    const ranResult = await claude.updateRAN(systemPrompt, patient, ranExistente, novosDocumentos);

    const reportContent = ranResult.relatorio;
    const ranMeta = { diff: ranResult.diff, revisao: ranResult.revisao, elapsed_seconds: ranResult.elapsed_seconds, updated_from: req.params.report_id };

    const reportsSnap = await db.collection('patients').doc(req.params.patient_id).collection('reports').get();
    const version = calcularProximaSubversao(reportsSnap.docs.map(d => d.data()));
    const reportId = uuidv4();
    const now = new Date().toISOString();

    const nomeBase = patient.full_name.normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^a-zA-Z0-9\s]/g,'').trim().replace(/\s+/g,'_');
    const reportFileName = `RAN_${nomeBase}_v${version}.docx`;
    let storagePath = null;

    try {
      const { gerarDocx } = require('../services/docx-generator');
      const docxBuf = await gerarDocx(reportContent, nomeBase, req.user?.email, patient);
      storagePath = storage.reportPath(req.params.patient_id, reportId, reportFileName);
      await storage.uploadBuffer(docxBuf, storagePath, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      console.log('[Reports] DOCX atualizado salvo no Storage:', storagePath);
    } catch (uploadErr) {
      console.warn('[Reports] Erro ao salvar DOCX atualizado no Storage:', uploadErr.message);
    }

    await db.collection('patients').doc(req.params.patient_id).collection('reports').doc(reportId).set({
      patient_id: req.params.patient_id, version,
      storage_path: storagePath, content_md: reportContent,
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
      storage_path: storagePath,
      novos_documentos: novosArquivos.length,
      secoes_afetadas: ranResult.diff?.secoes_afetadas || [],
      score_qualidade: ranMeta.revisao?.score_qualidade,
      elapsed_seconds: ranMeta.elapsed_seconds,
      message: `Relatório v${version} atualizado com ${novosArquivos.length} novo(s) documento(s)`
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao atualizar relatório', details: err.message });
  }
});

// GET /api/reports/:patient_id/:report_id/docx
router.get('/:patient_id/:report_id/docx', async (req, res) => {
  try {
    const db = getDb();
    const doc = await db.collection('patients').doc(req.params.patient_id).collection('reports').doc(req.params.report_id).get();
    if (!doc.exists) return res.status(404).json({ error: 'Relatório não encontrado' });
    const report = doc.data();
    const patientDoc = await db.collection('patients').doc(req.params.patient_id).get();
    const patient = patientDoc.data();
    const nomeBase = (patient?.full_name || 'paciente').normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^a-zA-Z0-9\s]/g,'').trim().replace(/\s+/g,'_');
    const fileName = `RAN_${nomeBase}_v${report.version}.docx`;

    // Gera sempre via docx-generator (fonte de verdade = content_md no Firestore)
    const { gerarDocx } = require('../services/docx-generator');
    const buffer = await gerarDocx(report.content_md || '', nomeBase, req.user?.email, patient);

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.setHeader('Content-Length', buffer.length);
    res.send(buffer);
  } catch (err) {
    console.error('[DOCX]', err);
    res.status(500).json({ error: 'Erro ao gerar DOCX', details: err.message });
  }
});

// GET /api/reports/:patient_id/:report_id/pdf
router.get('/:patient_id/:report_id/pdf', async (req, res) => {
  console.log('[PDF] Rota acionada — patient:', req.params.patient_id, 'report:', req.params.report_id);
  try {
    const db = getDb();
    const doc = await db.collection('patients').doc(req.params.patient_id).collection('reports').doc(req.params.report_id).get();
    if (!doc.exists) return res.status(404).json({ error: 'Relatório não encontrado' });
    const report = doc.data();
    const patientDoc = await db.collection('patients').doc(req.params.patient_id).get();
    const patient = patientDoc.data();
    const nomeBase = (patient?.full_name || 'paciente').normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^a-zA-Z0-9\s]/g,'').trim().replace(/\s+/g,'_');
    const fileName = `RAN_${nomeBase}_v${report.version}.pdf`;

    let buffer;

    if (report.content_md) {
      try {
        console.log('[PDF] Gerando DOCX para conversão LibreOffice...');
        const { gerarDocx, gerarPdfViaLibreOffice } = require('../services/docx-generator');
        const docxBuffer = await gerarDocx(report.content_md, fileName, req.user?.email, patient);
        console.log('[PDF] DOCX gerado —', docxBuffer.length, 'bytes — iniciando LibreOffice...');
        buffer = await gerarPdfViaLibreOffice(docxBuffer);
        console.log('[PDF] Gerado via LibreOffice —', buffer.length, 'bytes');
      } catch (loErr) {
        console.error('[PDF] LibreOffice falhou:', loErr.message);
        console.log('[PDF] Usando pdfkit fallback...');
      }
    }

    if (!buffer) {
      console.log('[PDF] Gerando via pdfkit fallback');
      const { gerarPdfDeMarkdown } = require('../services/docx-generator');
      buffer = await gerarPdfDeMarkdown(report.content_md || '', patient?.full_name || 'Paciente', report.version);
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.setHeader('Content-Length', buffer.length);
    res.send(buffer);
  } catch (err) {
    console.error('[PDF] Erro fatal:', err.message, err.stack);
    res.status(500).json({ error: 'Erro ao gerar PDF', details: err.message });
  }
});

// PATCH /api/reports/:patient_id/:report_id — atualiza conteúdo editado pelo usuário
router.patch('/:patient_id/:report_id', async (req, res) => {
  try {
    const db = getDb();
    const { content_html, content_md } = req.body;
    const conteudo = content_html || content_md;
    if (!conteudo) return res.status(400).json({ error: 'content_html ou content_md é obrigatório' });

    const ref = db.collection('patients').doc(req.params.patient_id).collection('reports').doc(req.params.report_id);
    const doc = await ref.get();
    if (!doc.exists) return res.status(404).json({ error: 'Relatório não encontrado' });
    const reportData = doc.data();

    const patientDoc = await db.collection('patients').doc(req.params.patient_id).get();
    const patient = patientDoc.data();

    const now = new Date().toISOString();
    const updates = { reviewed_at: now, status: 'reviewed', sync_source: 'app' };
    if (content_html) updates.content_html = content_html;
    if (content_md) updates.content_md = content_md;
    await ref.update(updates);

    // Atualiza DOCX no Storage em background
    setImmediate(async () => {
      try {
        const { gerarDocx } = require('../services/docx-generator');
        const nomeBase = (patient?.full_name || 'paciente').normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^a-zA-Z0-9\s]/g,'').trim().replace(/\s+/g,'_');
        const docxBuf = await gerarDocx(content_md || conteudo, nomeBase, req.user?.email, patient);
        const destPath = reportData.storage_path || storage.reportPath(req.params.patient_id, req.params.report_id, `RAN_${nomeBase}_v${reportData.version}.docx`);
        await storage.uploadBuffer(docxBuf, destPath, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
        if (!reportData.storage_path) await ref.update({ storage_path: destPath });
        console.log('[PATCH] DOCX atualizado no Storage');
      } catch (e) {
        console.warn('[PATCH] Erro ao atualizar DOCX no Storage:', e.message);
      }
    });

    await db.collection('activity_log').add({
      patient_id: req.params.patient_id, action: 'report_edited',
      details: JSON.stringify({ report_id: req.params.report_id }),
      created_at: now
    });

    res.json({ message: 'Relatório atualizado', id: req.params.report_id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao atualizar relatório', details: err.message });
  }
});

// POST /api/reports/:patient_id/:report_id/import-edited
router.post('/:patient_id/:report_id/import-edited',
  require('multer')({ dest: require('path').join(__dirname,'../temp'), limits:{ fileSize: 20*1024*1024 } }).single('file'),
  async (req, res) => {
    try {
      const db = getDb();
      const { patient_id, report_id } = req.params;

      if (!req.file) return res.status(400).json({ error: 'Arquivo DOCX obrigatório' });
      const ext = require('path').extname(req.file.originalname).toLowerCase();
      if (ext !== '.docx') return res.status(400).json({ error: 'Apenas arquivos .docx são aceitos' });

      const reportRef = db.collection('patients').doc(patient_id).collection('reports').doc(report_id);
      const reportDoc = await reportRef.get();
      if (!reportDoc.exists) return res.status(404).json({ error: 'Relatório não encontrado' });
      const report = reportDoc.data();

      const mammoth = require('mammoth');
      const fs = require('fs');
      const docxBuffer = fs.readFileSync(req.file.path);
      const htmlResult = await mammoth.convertToHtml({ buffer: docxBuffer });
      const html = htmlResult.value;
      const htmlNorm = html
        .replace(/<(h[1-4])[^>]*>([\s\S]*?)<\/\1>/gi, (_, tag, inner) => {
          const nivel = tag[1];
          const texto = inner.replace(/<[^>]+>/g, '').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&nbsp;/g,' ').replace(/&quot;/g,'"').trim();
          return '#'.repeat(parseInt(nivel)) + ' ' + texto + '\n';
        });
      const textoEditado = htmlNorm
        .replace(/<strong[^>]*>([\s\S]*?)<\/strong>/gi, '**$1**')
        .replace(/<b[^>]*>([\s\S]*?)<\/b>/gi, '**$1**')
        .replace(/<em[^>]*>([\s\S]*?)<\/em>/gi, '*$1*')
        .replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, '- $1\n')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, '$1\n\n')
        .replace(/<tr[^>]*>([\s\S]*?)<\/tr>/gis, (_,cells)=>{ const cols=cells.match(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gis)||[]; return '| '+cols.map(c=>c.replace(/<[^>]+>/g,'').trim()).join(' | ')+' |\n'; })
        .replace(/<[^>]+>/g, '')
        .replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&nbsp;/g,' ').replace(/&quot;/g,'"')
        .replace(/\*{3,}/g,'**').replace(/\n{3,}/g,'\n\n').trim();

      if (!textoEditado || textoEditado.length < 100) {
        fs.unlinkSync(req.file.path);
        return res.status(400).json({ error: 'DOCX sem conteúdo legível' });
      }
      fs.unlinkSync(req.file.path);

      const patientDoc = await db.collection('patients').doc(patient_id).get();
      const patientInfo = patientDoc.exists ? patientDoc.data() : {};

      const OUTROS_CAMPOS = ['medicamento','responsável','responsavel','faz uso','escolaridade','nome','data de nasc'];
      const campoCorrompido = (val) => { if (!val) return false; const v = val.toLowerCase(); return OUTROS_CAMPOS.some(c => v.includes(c)); };
      const camposParaLimpar = {};
      if (campoCorrompido(patientInfo.handedness)) { patientInfo.handedness = null; camposParaLimpar.handedness = null; }
      if (campoCorrompido(patientInfo.guardians)) { patientInfo.guardians = null; camposParaLimpar.guardians = null; }
      if (campoCorrompido(patientInfo.medications)) { patientInfo.medications = null; camposParaLimpar.medications = null; }
      if (Object.keys(camposParaLimpar).length > 0) {
        camposParaLimpar.updated_at = new Date().toISOString();
        await db.collection('patients').doc(patient_id).update(camposParaLimpar);
      }

      const marcadores = [/^#+\s*\*{0,2}\s*QUEIXA PRINCIPAL/im, /^\*\*QUEIXA PRINCIPAL\*\*/im, /^QUEIXA PRINCIPAL/im];
      let corpo = null;
      for (const m of marcadores) {
        const i = textoEditado.search(m);
        if (i !== -1) { corpo = textoEditado.slice(i); break; }
      }
      if (!corpo) {
        return res.status(422).json({
          error: 'DOCX inválido: seção "QUEIXA PRINCIPAL" não encontrada.',
          detalhe: 'O documento precisa conter o título "QUEIXA PRINCIPAL" para ser importado.'
        });
      }

      const cab = patientInfo;
      const fmtData = (v) => { if (!v) return '[Não informado]'; const d = new Date(v + 'T12:00:00'); return isNaN(d.getTime()) ? v : d.toLocaleDateString('pt-BR', {day:'2-digit',month:'2-digit',year:'numeric'}); };
      const cabecalhoGerado = ['| | |','|---|---|',
        '| **Nome completo** | ' + (cab.full_name || '[Não informado]') + ' |',
        '| **Data de nascimento / Idade** | ' + fmtData(cab.birth_date) + '  |  ' + (cab.age ? cab.age + ' anos' : '[Não informado]') + ' |',
        '| **Escolaridade** | ' + (cab.grade || '[Não informado]') + ' |',
        '| **Dominância manual** | ' + (cab.handedness || '[Não informado]') + ' |',
        '| **Medicamentos** | ' + (cab.medications || '[Não informado]') + ' |',
        '| **Responsáveis** | ' + (cab.guardians || '[Não informado]') + ' |',
      ].join('\n');
      const conteudoFinal = cabecalhoGerado + '\n\n' + corpo;

      const reportsSnap = await db.collection('patients').doc(patient_id).collection('reports').get();
      const novaVersion = calcularProximaSubversao(reportsSnap.docs.map(d => d.data()));
      const novoReportId = require('uuid').v4();
      const now = new Date().toISOString();

      await db.collection('patients').doc(patient_id).collection('reports').doc(novoReportId).set({
        patient_id, version: novaVersion,
        content_md: conteudoFinal, status: 'reviewed',
        reviewed_at: now, imported_at: now,
        imported_from: req.file?.originalname || 'docx',
        sync_source: 'import', generated_at: now,
        base_version: report.version,
        storage_path: report.storage_path || null,
        ran_meta: report.ran_meta || null
      });

      res.json({ message: 'Relatório importado com sucesso', imported_at: now, version: novaVersion });

      try {
        const dadosPaciente = extrairDadosPacienteDoRAN(conteudoFinal);
        if (Object.keys(dadosPaciente).length > 0) {
          await db.collection('patients').doc(patient_id).update({ ...dadosPaciente, updated_at: now });
        }
      } catch (e) { console.warn('[ImportEdit] Falha ao sincronizar dados do paciente:', e.message); }

    } catch (err) {
      console.error('[ImportEdit]', err.message);
      if (req.file?.path) { try { require('fs').unlinkSync(req.file.path); } catch {} }
      res.status(500).json({ error: err.message });
    }
  }
);

module.exports = router;
