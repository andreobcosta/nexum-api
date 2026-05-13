const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../db/firestore');
const drive = require('../services/drive');
const claude = require('../services/claude');

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

// POST /api/reports/generate/:patient_id
router.post('/generate/:patient_id', async (req, res) => {
  try {
    const db = getDb();

    // H4: limpar job travado (processando há mais de 15 minutos)
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
    if (!patient.drive_folder_id) return res.status(400).json({ error: 'Paciente sem pasta no Drive' });

    if (patientDoc.data()?.pipeline_ativo) {
      return res.status(409).json({ error: 'Geração já em andamento para este paciente' });
    }
    const patRef = db.collection('patients').doc(req.params.patient_id);
    await patRef.update({ pipeline_ativo: true, pipeline_iniciado_em: new Date().toISOString() });

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
      await patRef.update({ pipeline_ativo: false, pipeline_iniciado_em: null });
      return res.status(400).json({
        error: 'Dados incompletos', missing,
        message: `Faltam: ${missing.join(', ')}. Envie force=true para gerar mesmo assim.`
      });
    }

    // Cria job e responde imediatamente — pipeline roda em background
    const jobId = uuidv4();
    const jobRef = db.collection('jobs').doc(jobId);
    await jobRef.set({ status: 'processando', etapa: 'iniciando', agente: null, patient_id: req.params.patient_id, created_at: new Date().toISOString() });
    res.status(202).json({ job_id: jobId, status: 'processando' });

    setImmediate(async () => {
      try {
        // Coleta dados do Firestore e Drive
        const dataPackage = {};
        const filesLog = [];
        const firestoreFileNames = new Set();

        for (const f of filesSnap.docs) {
          const file = f.data();
          const folderName = drive.CATEGORY_TO_FOLDER[file.category] || file.category;
          if (!dataPackage[folderName]) dataPackage[folderName] = [];
          if (file.transcription) {
            dataPackage[folderName].push({ name: file.original_name, type: 'text/plain', transcription: file.transcription, content: null, source: 'firestore_transcription' });
            filesLog.push(file.original_name + ' (transcrição áudio)');
            firestoreFileNames.add(file.original_name);
          } else if (file.drive_file_id) {
            dataPackage[folderName].push({ name: file.original_name, type: file.file_type || 'application/octet-stream', transcription: null, content: null, drive_file_id: file.drive_file_id, source: 'firestore_pending' });
            filesLog.push(file.original_name + ' (aguardando Drive)');
            firestoreFileNames.add(file.original_name);
          }
        }

        let driveFalhou = false;
        try {
          const driveData = await drive.collectPatientData(patient.drive_folder_id);
          for (const folder in driveData) {
            if (!dataPackage[folder]) dataPackage[folder] = [];
            for (const df of driveData[folder]) {
              const pendingIdx = dataPackage[folder].findIndex(f => f.name === df.name && f.source === 'firestore_pending');
              if (pendingIdx >= 0) {
                dataPackage[folder][pendingIdx].content = df.content;
                dataPackage[folder][pendingIdx].type = df.type || dataPackage[folder][pendingIdx].type;
                dataPackage[folder][pendingIdx].source = 'drive_filled';
                filesLog.push(df.name + ' (conteúdo Drive carregado)');
              } else if (!firestoreFileNames.has(df.name)) {
                dataPackage[folder].push({ name: df.name, type: df.type, content: df.content, size: df.size, source: 'drive_only' });
                filesLog.push(df.name + ' (Drive — não registrado no Firestore)');
              }
            }
          }
        } catch (driveErr) {
          driveFalhou = true;
          console.error('[Reports] Drive INACESSÍVEL:', driveErr.message);
          await jobRef.update({ etapa: 'Aviso: Drive inacessível — coletando dados do Firestore' }).catch(() => {});
        }

        // BUG 1: arquivos que não encontraram match por nome (encoding NFD vs NFC) ficam como
        // firestore_pending — baixa direto via drive_file_id que é imune a variante de encoding
        const pendingDownloads = [];
        for (const folder in dataPackage) {
          for (const f of dataPackage[folder]) {
            if (f.source === 'firestore_pending' && f.drive_file_id) pendingDownloads.push({ folder, file: f });
          }
        }
        if (pendingDownloads.length > 0) {
          console.log(`[Reports] BUG1 — ${pendingDownloads.length} arquivo(s) sem match de nome — baixando via drive_file_id`);
          await Promise.all(pendingDownloads.map(async ({ file }) => {
            try {
              const buffer = await drive.downloadFile(file.drive_file_id);
              file.content = buffer.toString('base64');
              file.source = 'drive_filled_direct';
              filesLog.push(file.name + ' (conteúdo Drive carregado via drive_file_id)');
            } catch (e) {
              console.warn('[Reports] Falha download direto:', file.name, e.message);
            }
          }));
        }

        // BUG 3b: pastas não-padrão do Drive (ex: "LAURA") não são clínicas — remover seus
        // arquivos drive_only; manter apenas se tiverem entrada no Firestore
        const validFolders = new Set(Object.values(drive.CATEGORY_TO_FOLDER));
        for (const folder of Object.keys(dataPackage)) {
          if (!validFolders.has(folder)) {
            dataPackage[folder] = dataPackage[folder].filter(f => f.source !== 'drive_only');
            if (dataPackage[folder].length === 0) delete dataPackage[folder];
          }
        }

        // dataPackage finalizado — BUG 2 e BUG 3 rodam após BUG 3b para operar sobre dados limpos
        // BUG 2: mesmo arquivo pode aparecer duas vezes quando Firestore tem encoding
        // diferente do Drive (NFC vs NFD) — deduplicar por nome normalizado por pasta
        for (const folder in dataPackage) {
          const nomesVistos = new Set();
          dataPackage[folder] = dataPackage[folder].filter(f => {
            const chave = f.name.normalize('NFC').toLowerCase().trim();
            if (nomesVistos.has(chave)) return false;
            nomesVistos.add(chave);
            return true;
          });
        }

        // BUG 3: whitelist de extensões clínicas — aplica a drive_only, drive_filled e drive_filled_direct
        // (firestore_transcription e firestore_pending têm dados clínicos garantidos pelo Firestore)
        const CLINICAL_EXT = ['.docx', '.pdf', '.jpg', '.jpeg', '.png', '.mp3', '.mp4', '.m4a', '.ogg', '.wav'];
        for (const folder in dataPackage) {
          dataPackage[folder] = dataPackage[folder].filter(f => {
            if (f.source === 'firestore_transcription' || f.source === 'firestore_pending') return true;
            const nameLower = f.name.toLowerCase();
            return CLINICAL_EXT.some(e => nameLower.endsWith(e));
          });
        }

        const totalFiles = Object.values(dataPackage).reduce((sum, arr) => sum + arr.length, 0);
        const comConteudo = Object.values(dataPackage).reduce((sum, arr) => sum + arr.filter(f => f.transcription || f.content).length, 0);
        console.log(`[Reports] Arquivos coletados (${totalFiles} total, ${comConteudo} com conteúdo):`, filesLog.join(' | '));

        // Abortar antes dos agentes Claude se não há nenhum dado legível
        if (totalFiles > 0 && comConteudo === 0) {
          const motivo = driveFalhou
            ? `Drive inacessível — nenhum arquivo pôde ser baixado. Verifique a conexão com o Google Drive e o token de autenticação.`
            : `${totalFiles} arquivo(s) encontrado(s), mas nenhum tem conteúdo acessível. Verifique se os arquivos não estão vazios ou se as transcrições foram concluídas.`;
          const errMsg = `Coleta de dados falhou — ${motivo}`;
          console.error('[Reports] Abortando pipeline:', errMsg);
          await jobRef.update({ status: 'erro', erro: errMsg, etapa: 'coleta_dados_falhou', finished_at: new Date().toISOString() }).catch(() => {});
          await patRef.update({ pipeline_ativo: false, pipeline_iniciado_em: null }).catch(() => {});
          return;
        }

        // onProgress atualiza etapa do job no Firestore a cada agente
        const ETAPA_MAP = { analitico: 'Agente Analítico — extraindo dados clínicos', redator: 'Agente Redator — redigindo relatório', revisor: 'Agente Revisor — validando qualidade' };
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
        const reportFileName = `RAN_${nomeBase}_v${version}`;
        let driveFileId = null;
        let driveIsGoogleDoc = false;

        try {
          const subfolderId = await drive.getSubfolderId(patient.drive_folder_id, 'relatorio');
          const { gerarDocx } = require('../services/docx-generator');
          const docxBuf = await gerarDocx(reportContent, nomeBase, req.user.email, patient);
          const driveFile = await drive.uploadDocxAsGoogleDoc(docxBuf, reportFileName, subfolderId);
          driveFileId = driveFile.id;
          driveIsGoogleDoc = true;
          console.log('[Reports] Google Doc criado no Drive:', driveFile.name, '—', driveFile.webViewLink);
        } catch (uploadErr) {
          console.warn('[Reports] Erro ao criar Google Doc — tentando .md:', uploadErr.message);
          try {
            const subfolderId = await drive.getSubfolderId(patient.drive_folder_id, 'relatorio');
            const reportBuffer = Buffer.from(reportContent, 'utf-8');
            const driveFile = await drive.uploadBuffer(reportBuffer, reportFileName + '.md', 'text/markdown', subfolderId);
            driveFileId = driveFile.id;
          } catch (fallbackErr) {
            console.warn('[Reports] Fallback .md também falhou:', fallbackErr.message);
          }
        }

        await db.collection('patients').doc(req.params.patient_id).collection('reports').doc(reportId).set({
          patient_id: req.params.patient_id, version,
          drive_file_id: driveFileId, drive_is_google_doc: driveIsGoogleDoc,
          content_md: reportContent, ran_meta: JSON.stringify(ranMeta),
          status: 'draft', generated_at: now, reviewed_at: null
        });
        const { FieldValue } = require('@google-cloud/firestore');
        await db.collection('patients').doc(req.params.patient_id).update({ status: 'relatorio_gerado', updated_at: now, reports_count: FieldValue.increment(1) });
        await db.collection('activity_log').add({ patient_id: req.params.patient_id, action: 'report_generated', details: JSON.stringify({ version, report_id: reportId }), created_at: now });

        await jobRef.update({ status: 'concluido', etapa: 'Relatório gerado', agente: 'concluido', report_id: reportId, score_qualidade: ranResult.revisao?.score_qualidade, completed_at: now });

        // Sincronizar dados do paciente com o que o pipeline extraiu dos documentos clínicos
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

// GET /api/reports/job/:job_id — consulta status do job de geração
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

// GET /api/reports/:patient_id/:report_id/feedback — feedbacks existentes do relatório
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

// POST /api/reports/:patient_id/:report_id/feedback — registra feedback de um bloco
router.post('/:patient_id/:report_id/feedback', async (req, res) => {
  try {
    const { bloco_id, bloco_heading, feedback_type, bloco_content } = req.body;
    if (!bloco_id || !feedback_type) return res.status(400).json({ error: 'bloco_id e feedback_type são obrigatórios' });
    const db = getDb();
    await db.collection('feedbacks').add({
      patient_id: req.params.patient_id,
      report_id: req.params.report_id,
      bloco_id,
      bloco_heading: bloco_heading || '',
      feedback_type,
      bloco_content: bloco_content || '',
      created_at: new Date().toISOString()
    });
    res.status(201).json({ message: 'Feedback registrado', bloco_id, feedback_type });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao registrar feedback', details: err.message });
  }
});

// POST /api/reports/:patient_id/:report_id/feedback/batch — registra feedbacks em lote
router.post('/:patient_id/:report_id/feedback/batch', async (req, res) => {
  try {
    const feedbacks = req.body;
    if (!Array.isArray(feedbacks) || feedbacks.length === 0) return res.status(400).json({ error: 'Body deve ser array não vazio' });
    const db = getDb();
    const now = new Date().toISOString();
    const saves = feedbacks.map(f => db.collection('feedbacks').add({
      patient_id: req.params.patient_id,
      report_id: req.params.report_id,
      bloco_id: f.bloco_id || '',
      bloco_heading: f.bloco_heading || '',
      feedback_type: f.feedback_type,
      texto_original: f.texto_original || '',
      texto_editado: f.texto_editado || '',
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
    const { version, drive_file_id } = doc.data();

    // H7: remover do Drive (ignorar 404 silenciosamente)
    if (drive_file_id) {
      try {
        await drive.deleteFile(drive_file_id);
      } catch (err) {
        if (!err.message?.includes('404') && err.code !== 404) {
          console.error('[DELETE] Drive error (ignorado):', err.message);
        }
      }
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

    // H4: limpar job travado (processando há mais de 15 minutos)
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
    const systemPrompt = await claude.getSystemPrompt();
    const ranResult = await claude.updateRAN(systemPrompt, patient, ranExistente, novosDocumentos);

    const reportContent = ranResult.relatorio;
    const ranMeta = { diff: ranResult.diff, revisao: ranResult.revisao, elapsed_seconds: ranResult.elapsed_seconds, updated_from: req.params.report_id };

    // Subversão sempre baseada na versão maior mais recente entre todos os relatórios
    const reportsSnap = await db.collection('patients').doc(req.params.patient_id).collection('reports').get();
    const version = calcularProximaSubversao(reportsSnap.docs.map(d => d.data()));
    const reportId = uuidv4();
    const now = new Date().toISOString();

    const nomeBase = patient.full_name.normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^a-zA-Z0-9\s]/g,'').trim().replace(/\s+/g,'_');
    const reportFileName = 'RAN_' + nomeBase + '_v' + version + '_' + now.slice(0, 10);
    let driveFileId = null;
    let driveIsGoogleDoc = false;

    try {
      const subfolderId = await require('../services/drive').getSubfolderId(patient.drive_folder_id, 'relatorio');
      const { gerarDocx } = require('../services/docx-generator');
      const docxBuf = await gerarDocx(reportContent, nomeBase, req.user.email, patient);
      const driveFile = await require('../services/drive').uploadDocxAsGoogleDoc(docxBuf, reportFileName, subfolderId);
      driveFileId = driveFile.id;
      driveIsGoogleDoc = true;
      console.log('[Reports] Google Doc criado no Drive (update):', driveFile.name, '—', driveFile.webViewLink);
    } catch (uploadErr) {
      console.warn('[Reports] Erro ao criar Google Doc (update) — tentando .md:', uploadErr.message);
      try {
        const subfolderId = await require('../services/drive').getSubfolderId(patient.drive_folder_id, 'relatorio');
        const reportBuffer = Buffer.from(reportContent, 'utf-8');
        const driveFile = await require('../services/drive').uploadBuffer(reportBuffer, reportFileName + '.md', 'text/markdown', subfolderId);
        driveFileId = driveFile.id;
      } catch (fallbackErr) {
        console.warn('[Reports] Fallback .md também falhou (update):', fallbackErr.message);
      }
    }

    await db.collection('patients').doc(req.params.patient_id).collection('reports').doc(reportId).set({
      patient_id: req.params.patient_id, version,
      drive_file_id: driveFileId, drive_is_google_doc: driveIsGoogleDoc, content_md: reportContent,
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

// GET /api/reports/:patient_id/:report_id/docx — exporta como .docx
// Google Doc nativo: exporta via Drive API (versão sempre atual)
// Arquivo comum: gera via docx-generator local
router.get('/:patient_id/:report_id/docx', async (req, res) => {
  try {
    const db = getDb();
    const doc = await db.collection('patients').doc(req.params.patient_id).collection('reports').doc(req.params.report_id).get();
    if (!doc.exists) return res.status(404).json({ error: 'Relatório não encontrado' });
    const report = doc.data();
    const patientDoc = await db.collection('patients').doc(req.params.patient_id).get();
    const patient = patientDoc.data();
    const nomeBase = (patient?.full_name || 'paciente').normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^a-zA-Z0-9\s]/g,'').trim().replace(/\s+/g,'_');
    const fileName = 'RAN_' + nomeBase + '_v' + report.version + '.docx';
    // Caminho principal: docx-generator lê content_md do Firestore
    // com headings Word reais. Drive export é fallback (perde headings).
    let buffer;
    try {
      console.log('[DOCX] Gerando DOCX via docx-generator');
      const { gerarDocx } = require('../services/docx-generator');
      buffer = await gerarDocx(report.content_md || '', req.params.patient_id, req.user.email, patient);
    } catch (e) {
      console.warn('[DOCX] Falha no docx-generator, tentando Drive export:', e.message);
      if (report.drive_file_id) {
        try {
          const isDoc = report.drive_is_google_doc || await drive.isGoogleDoc(report.drive_file_id);
          if (isDoc) {
            console.log('[DOCX] Exportando Google Doc como fallback:', report.drive_file_id);
            buffer = await drive.exportAsDocx(report.drive_file_id);
          }
        } catch (e2) { console.warn('[DOCX] Falha no Drive export:', e2.message); }
      }
    }
    if (!buffer) throw new Error('Não foi possível gerar o DOCX por nenhum método disponível');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', 'attachment; filename="' + fileName + '"');
    res.setHeader('Content-Length', buffer.length);
    res.send(buffer);
  } catch (err) {
    console.error('[DOCX]', err);
    res.status(500).json({ error: 'Erro ao gerar DOCX', details: err.message });
  }
});



// GET /api/reports/:patient_id/:report_id/pdf — exporta como PDF
// Google Doc: exporta via Drive API (melhor qualidade)
// Fallback: gera PDF localmente via pdfkit (para relatórios antigos em .md)
router.get('/:patient_id/:report_id/pdf', async (req, res) => {
  try {
    const db = getDb();
    const doc = await db.collection('patients').doc(req.params.patient_id).collection('reports').doc(req.params.report_id).get();
    if (!doc.exists) return res.status(404).json({ error: 'Relatório não encontrado' });
    const report = doc.data();
    const patientDoc = await db.collection('patients').doc(req.params.patient_id).get();
    const patient = patientDoc.data();
    const nomeBase = (patient?.full_name || 'paciente').normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^a-zA-Z0-9\s]/g,'').trim().replace(/\s+/g,'_');
    const fileName = 'RAN_' + nomeBase + '_v' + report.version + '.pdf';

    let buffer;

    // Tenta exportar PDF via Drive (Google Doc nativo)
    if (report.drive_file_id) {
      try {
        const isDoc = report.drive_is_google_doc || await drive.isGoogleDoc(report.drive_file_id);
        if (isDoc) {
          buffer = await drive.exportAsPdf(report.drive_file_id);
        }
      } catch (driveErr) {
        console.error('[PDF] Falha Drive export — file_id:', report.drive_file_id, '| erro:', driveErr.message);
      }
    }

    // Fallback: gera PDF localmente a partir do Markdown
    if (!buffer) {
      console.log('[PDF] Gerando PDF local via pdfkit');
      const { gerarPdfDeMarkdown } = require('../services/docx-generator');
      buffer = await gerarPdfDeMarkdown(report.content_md || '', patient?.full_name || 'Paciente', report.version);
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="' + fileName + '"');
    res.setHeader('Content-Length', buffer.length);
    res.send(buffer);
  } catch (err) {
    console.error('[PDF]', err);
    res.status(500).json({ error: 'Erro ao gerar PDF', details: err.message });
  }
});

// PATCH /api/reports/:patient_id/:report_id — atualiza conteúdo (HTML) e regenera DOCX no Drive
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
    const updates = {
      reviewed_at: now,
      status: 'reviewed',
      last_synced_at: now,
      sync_source: 'app'
    };
    if (content_html) updates.content_html = content_html;
    if (content_md) updates.content_md = content_md;

    await ref.update(updates);

    // Atualiza Google Doc no Drive em background
    setImmediate(async () => {
      try {
        if (reportData.drive_file_id) {
          await drive.updateGoogleDoc(reportData.drive_file_id, conteudo, content_html ? 'text/html' : 'text/markdown');
          console.log('[PATCH] Google Doc atualizado no Drive');
        } else {
          const nomeBase = (patient && patient.full_name ? patient.full_name : 'paciente').normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^a-zA-Z0-9\s]/g,'').trim().replace(/\s+/g,'_');
          const subfolderId = await drive.getSubfolderId(patient.drive_folder_id, 'relatorio');
          const driveFile = await drive.uploadAsGoogleDoc(conteudo, 'RAN_' + nomeBase + '_v' + reportData.version, subfolderId, content_html ? 'text/html' : 'text/markdown');
          await ref.update({ drive_file_id: driveFile.id, drive_is_google_doc: true });
          console.log('[PATCH] Novo Google Doc criado no Drive');
        }
      } catch (driveErr) {
        console.warn('[PATCH] Erro ao atualizar Drive:', driveErr.message);
      }
    });

    await db.collection('activity_log').add({
      patient_id: req.params.patient_id, action: 'report_edited',
      details: JSON.stringify({ report_id: req.params.report_id }),
      created_at: now
    });

    res.json({ message: 'Relatório atualizado — DOCX sendo regenerado no Drive', id: req.params.report_id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao atualizar relatório', details: err.message });
  }
});

// POST /api/reports/:patient_id/:report_id/import-edited
// Recebe DOCX editado pelo cliente, extrai texto e salva como subversão X.Y
// Sem normalização via Claude — o cliente edita o DOCX gerado pelo sistema
router.post('/:patient_id/:report_id/import-edited',
  require('multer')({ dest: require('path').join(__dirname,'../temp'),
    limits:{ fileSize: 20*1024*1024 } }).single('file'),
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

      // Extrair texto do DOCX via mammoth
      const mammoth = require('mammoth');
      const fs = require('fs');
      const docxBuffer = fs.readFileSync(req.file.path);
      const htmlResult = await mammoth.convertToHtml({ buffer: docxBuffer });
      const html = htmlResult.value;
      // Remove <strong>/<b> DENTRO de headings antes de converter headings
      // Isso evita double-bold (****texto****) quando o heading é perdido
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

      // Buscar dados do paciente
      const patientDoc = await db.collection('patients').doc(patient_id).get();
      const patientInfo = patientDoc.exists ? patientDoc.data() : {};

      // Limpar campos corrompidos
      const OUTROS_CAMPOS = ['medicamento','responsável','responsavel','faz uso','escolaridade','nome','data de nasc'];
      const campoCorrompido = (val) => { if (!val) return false; const v = val.toLowerCase(); return OUTROS_CAMPOS.some(c => v.includes(c)); };
      const camposParaLimpar = {};
      if (campoCorrompido(patientInfo.handedness)) { patientInfo.handedness = null; camposParaLimpar.handedness = null; }
      if (campoCorrompido(patientInfo.guardians)) { patientInfo.guardians = null; camposParaLimpar.guardians = null; }
      if (campoCorrompido(patientInfo.medications)) { patientInfo.medications = null; camposParaLimpar.medications = null; }
      if (Object.keys(camposParaLimpar).length > 0) {
        camposParaLimpar.updated_at = new Date().toISOString();
        await db.collection('patients').doc(patient_id).update(camposParaLimpar);
        console.log('[ImportEdit] Campos corrompidos limpos:', Object.keys(camposParaLimpar));
      }

      // Cortar cabeçalho do DOCX importado — usar apenas o corpo a partir de QUEIXA PRINCIPAL
      const marcadores = [
        /^#+\s*\*{0,2}\s*QUEIXA PRINCIPAL/im,
        /^\*\*QUEIXA PRINCIPAL\*\*/im,
        /^QUEIXA PRINCIPAL/im
      ];
      let corpo = null;
      for (const m of marcadores) {
        const i = textoEditado.search(m);
        if (i !== -1) { corpo = textoEditado.slice(i); break; }
      }
      if (!corpo) {
        fs.unlinkSync(req.file.path);
        return res.status(422).json({
          error: 'DOCX inválido: seção "QUEIXA PRINCIPAL" não encontrada.',
          detalhe: 'O documento precisa conter o título "QUEIXA PRINCIPAL" para ser importado. Verifique se o título está presente e tente novamente.'
        });
      }

      // Gerar cabeçalho diretamente dos dados do paciente — não depende do content_md
      const cab = patientInfo;
      const fmtData = (v) => { if (!v) return '[Não informado]'; const d = new Date(v + 'T12:00:00'); return isNaN(d.getTime()) ? v : d.toLocaleDateString('pt-BR', {day:'2-digit',month:'2-digit',year:'numeric'}); };
      const cabecalhoGerado = [
        '| | |',
        '|---|---|',
        '| **Nome completo** | ' + (cab.full_name || '[Não informado]') + ' |',
        '| **Data de nascimento / Idade** | ' + fmtData(cab.birth_date) + '  |  ' + (cab.age ? cab.age + ' anos' : '[Não informado]') + ' |',
        '| **Escolaridade** | ' + (cab.grade || '[Não informado]') + ' |',
        '| **Dominância manual** | ' + (cab.handedness || '[Não informado]') + ' |',
        '| **Medicamentos** | ' + (cab.medications || '[Não informado]') + ' |',
        '| **Responsáveis** | ' + (cab.guardians || '[Não informado]') + ' |',
      ].join('\n');
      const conteudoFinal = cabecalhoGerado + '\n\n' + corpo;

      // Subversão sempre baseada na versão maior mais recente entre todos os relatórios
      const reportsSnap = await db.collection('patients').doc(patient_id).collection('reports').get();
      const novaVersion = calcularProximaSubversao(reportsSnap.docs.map(d => d.data()));
      const novoReportId = require('uuid').v4();
      const now = new Date().toISOString();

      // Salvar nova subversão
      await db.collection('patients').doc(patient_id).collection('reports').doc(novoReportId).set({
        patient_id, version: novaVersion,
        content_md: conteudoFinal, status: 'reviewed',
        reviewed_at: now,
        imported_at: now, imported_from: req.file?.originalname || 'docx',
        sync_source: 'import', generated_at: now,
        base_version: baseVersion,
        drive_file_id: report.drive_file_id || null,
        drive_is_google_doc: report.drive_is_google_doc || false,
        ran_meta: report.ran_meta || null
      });

      res.json({ message: 'Relatório importado com sucesso', imported_at: now, version: novaVersion });

      // Sincronizar dados do paciente com o conteúdo revisado pelo profissional
      try {
        const dadosPaciente = extrairDadosPacienteDoRAN(conteudoFinal);
        if (Object.keys(dadosPaciente).length > 0) {
          await db.collection('patients').doc(patient_id).update({ ...dadosPaciente, updated_at: now });
          console.log('[ImportEdit] Dados do paciente sincronizados:', Object.keys(dadosPaciente).join(', '));
        }
      } catch (e) { console.warn('[ImportEdit] Falha ao sincronizar dados do paciente:', e.message); }

      // Extrair padrões em background
      setImmediate(async () => {
        try {
          const claude = require('../services/claude');
          await claude.extrairPadroesDoRelatorio({
            db, patient_id, report_id: novoReportId,
            textoOriginal: report.content_md || '',
            textoEditado: conteudoFinal,
            userEmail: req.user?.email || 'default'
          });
        } catch (e) { console.error('[ImportEdit] Padrões:', e.message); }
      });

    } catch (err) {
      console.error('[ImportEdit]', err.message);
      if (req.file?.path) { try { require('fs').unlinkSync(req.file.path); } catch {} }
      res.status(500).json({ error: err.message });
    }
  }
);

// POST /api/reports/:patient_id/:report_id/convert — converte .md para Google Doc nativo
router.post('/:patient_id/:report_id/convert', async (req, res) => {
  try {
    const db = getDb();
    const docRef = db.collection('patients').doc(req.params.patient_id).collection('reports').doc(req.params.report_id);
    const snap = await docRef.get();
    if (!snap.exists) return res.status(404).json({ error: 'Relatório não encontrado' });
    const report = snap.data();
    const patientDoc = await db.collection('patients').doc(req.params.patient_id).get();
    const patient = patientDoc.data();

    if (report.drive_is_google_doc) {
      return res.json({ message: 'Relatório já é Google Doc', drive_file_id: report.drive_file_id });
    }

    const nomeBase = (patient?.full_name || 'paciente').normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^a-zA-Z0-9\s]/g,'').trim().replace(/\s+/g,'_');
    const subfolderId = await drive.getSubfolderId(patient.drive_folder_id, 'relatorio');
    const driveFile = await drive.uploadAsGoogleDoc(
      report.content_md || '',
      'RAN_' + nomeBase + '_v' + report.version,
      subfolderId,
      'text/markdown'
    );

    // Remove arquivo antigo .md do Drive se existir
    if (report.drive_file_id && !report.drive_is_google_doc) {
      try {
        await drive.deleteFile(report.drive_file_id);
      } catch (e) {
        console.warn('[Convert] Não removeu arquivo antigo:', e.message);
      }
    }

    await docRef.update({ drive_file_id: driveFile.id, drive_is_google_doc: true });
    res.json({ message: 'Convertido para Google Doc', drive_file_id: driveFile.id, web_view_link: driveFile.webViewLink });
  } catch (err) {
    console.error('[Convert]', err);
    res.status(500).json({ error: 'Erro ao converter', details: err.message });
  }
});


module.exports = router;
