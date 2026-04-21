// Sincronização bidirecional Drive ↔ Firestore
// Usa Google Drive Push Notifications (webhooks) para detectar mudanças em tempo real

const { google } = require('googleapis');
const { getDb } = require('../db/firestore');

const WEBHOOK_TTL_MS = 6 * 24 * 60 * 60 * 1000; // 6 dias (Drive máximo é 7)
const WEBHOOK_URL = process.env.APP_URL + '/api/drive/webhook';

function getDrive() {
  const auth = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
  auth.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
  return google.drive({ version: 'v3', auth });
}

// Registra ou renova webhook para uma pasta do Drive
async function registrarWebhook(folderId, patientId) {
  const drive = getDrive();
  const db = getDb();
  const channelId = `nexum-${patientId}-${Date.now()}`;
  const expiration = Date.now() + WEBHOOK_TTL_MS;

  try {
    const res = await drive.files.watch({
      fileId: folderId,
      requestBody: {
        id: channelId,
        type: 'web_hook',
        address: WEBHOOK_URL,
        expiration: expiration.toString(),
        token: patientId // usado para identificar o paciente na notificação
      }
    });

    // Salva canal no Firestore para poder cancelar/renovar
    await db.collection('drive_webhooks').doc(channelId).set({
      channel_id: channelId,
      resource_id: res.data.resourceId,
      patient_id: patientId,
      folder_id: folderId,
      expiration,
      created_at: new Date().toISOString()
    });

    console.log(`[DriveSync] Webhook registrado para paciente ${patientId} — expira em ${new Date(expiration).toISOString()}`);
    return { channelId, resourceId: res.data.resourceId };
  } catch (err) {
    console.error(`[DriveSync] Erro ao registrar webhook para ${patientId}:`, err.message);
    return null;
  }
}

// Cancela um webhook existente
async function cancelarWebhook(channelId, resourceId) {
  const drive = getDrive();
  try {
    await drive.channels.stop({ requestBody: { id: channelId, resourceId } });
    const db = getDb();
    await db.collection('drive_webhooks').doc(channelId).delete();
    console.log(`[DriveSync] Webhook ${channelId} cancelado`);
  } catch (err) {
    console.warn(`[DriveSync] Erro ao cancelar webhook ${channelId}:`, err.message);
  }
}

// Registra webhooks para todos os pacientes que ainda não têm
async function registrarTodosWebhooks() {
  if (!process.env.APP_URL) {
    console.warn('[DriveSync] APP_URL não configurada — webhooks desabilitados');
    return;
  }

  const db = getDb();
  const patientsSnap = await db.collection('patients').get();
  console.log(`[DriveSync] Verificando webhooks para ${patientsSnap.size} pacientes...`);

  for (const doc of patientsSnap.docs) {
    const patient = doc.data();
    if (!patient.drive_folder_id) continue;

    // Verifica se já tem webhook válido
    const webhooksSnap = await db.collection('drive_webhooks')
      .where('patient_id', '==', doc.id)
      .where('expiration', '>', Date.now())
      .get();

    if (webhooksSnap.empty) {
      await registrarWebhook(patient.drive_folder_id, doc.id);
      await new Promise(r => setTimeout(r, 500)); // throttle
    }
  }
}

// Renova webhooks próximos do vencimento (executar periodicamente)
async function renovarWebhooksVencendo() {
  const db = getDb();
  const limiteRenovacao = Date.now() + 24 * 60 * 60 * 1000; // renova se vence em < 24h
  const snap = await db.collection('drive_webhooks')
    .where('expiration', '<', limiteRenovacao)
    .get();

  for (const doc of snap.docs) {
    const wh = doc.data();
    console.log(`[DriveSync] Renovando webhook para paciente ${wh.patient_id}...`);
    await cancelarWebhook(wh.channel_id, wh.resource_id);
    await registrarWebhook(wh.folder_id, wh.patient_id);
    await new Promise(r => setTimeout(r, 500));
  }
}

// Converte DOCX para HTML usando Claude (preservação fiel de formatação)
async function docxParaHtml(buffer, nomeArquivo) {
  const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
  const base64 = buffer.toString('base64');

  const res = await fetch(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 16000,
      system: `Você é um conversor especializado de documentos DOCX para HTML rico.
Sua função é converter o documento fornecido para HTML preservando FIELMENTE:
- Toda a formatação: negrito, itálico, sublinhado, cores de texto e fundo
- Hierarquia de títulos (h1, h2, h3, h4)
- Tabelas completas com todas as células, bordas e formatação
- Listas com marcadores e numeradas
- Alinhamento de texto (centro, esquerda, direita, justificado)
- Espaçamentos e indentações

Regras:
- Retorne APENAS o HTML do conteúdo (sem <html>, <head>, <body>)
- Use estilos inline para cores e formatação específica
- Para tabelas: use <table style="border-collapse:collapse;width:100%"> com <th> para cabeçalhos
- Preserve o texto exatamente como está no documento, sem alterar conteúdo
- Use <strong> para negrito, <em> para itálico, <u> para sublinhado
- Para cores use style="color:#HEXCODE" ou style="background-color:#HEXCODE"
- Mantenha a estrutura das 12 seções do RAN se presentes`,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'document',
            source: { type: 'base64', media_type: 'application/pdf', data: base64 }
          },
          { type: 'text', text: `Converta este documento "${nomeArquivo}" para HTML rico, preservando toda a formatação fielmente.` }
        ]
      }]
    })
  });

  if (!res.ok) throw new Error(`Claude API error: ${res.status}`);
  const data = await res.json();
  return data.content.filter(b => b.type === 'text').map(b => b.text).join('');
}

// Processa notificação do Drive — identifica o que mudou e sincroniza
async function processarNotificacao(patientId, folderId) {
  const drive = getDrive();
  const db = getDb();

  console.log(`[DriveSync] Processando notificação para paciente ${patientId}`);

  try {
    // Lista arquivos atuais na pasta 04 - Relatórios do Drive
    const { google: g } = require('googleapis');
    const driveService = getDrive();

    // Busca subfolder de relatórios
    const subfoldersRes = await driveService.files.list({
      q: `'${folderId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false and name='04 - Relatórios'`,
      fields: 'files(id,name)'
    });

    if (!subfoldersRes.data.files?.length) {
      console.log('[DriveSync] Pasta 04 - Relatórios não encontrada');
      return;
    }

    const relatoriosFolderId = subfoldersRes.data.files[0].id;

    // Lista arquivos DOCX na pasta de relatórios
    const filesRes = await driveService.files.list({
      q: `'${relatoriosFolderId}' in parents and trashed=false`,
      fields: 'files(id,name,modifiedTime,mimeType)',
      orderBy: 'modifiedTime desc'
    });

    const driveFiles = filesRes.data.files || [];
    if (!driveFiles.length) return;

    // Busca relatórios existentes no Firestore
    const reportsSnap = await db.collection('patients').doc(patientId).collection('reports').orderBy('version', 'desc').get();
    const reports = reportsSnap.docs.map(d => ({ id: d.id, ...d.data() }));

    // Para cada arquivo DOCX no Drive, verifica se é novo ou modificado
    for (const driveFile of driveFiles) {
      const isMsDoc = driveFile.mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        || driveFile.mimeType === 'application/msword';

      if (!isMsDoc) continue;

      // Verifica se esse arquivo já está vinculado a algum relatório
      const reportVinculado = reports.find(r => r.drive_file_id === driveFile.id);

      if (reportVinculado) {
        // Arquivo existente — verifica se foi modificado após o último save do app
        const driveModified = new Date(driveFile.modifiedTime).getTime();
        const appModified = new Date(reportVinculado.reviewed_at || reportVinculado.generated_at).getTime();

        if (driveModified > appModified + 60000) { // 1 min de tolerância
          console.log(`[DriveSync] Arquivo modificado no Drive: ${driveFile.name} — sincronizando...`);
          await sincronizarArquivoDosDrive(patientId, reportVinculado.id, driveFile.id, driveFile.name);
        }
      } else {
        // Arquivo novo no Drive — cria novo relatório
        console.log(`[DriveSync] Novo arquivo no Drive: ${driveFile.name} — importando...`);
        await importarNovoArquivoDoDrive(patientId, driveFile.id, driveFile.name);
      }
    }
  } catch (err) {
    console.error(`[DriveSync] Erro ao processar notificação:`, err.message);
  }
}

// Sincroniza um DOCX editado no Drive de volta para o Firestore
async function sincronizarArquivoDosDrive(patientId, reportId, driveFileId, fileName) {
  const drive = getDrive();
  const db = getDb();

  try {
    // Baixa o arquivo do Drive
    const res = await drive.files.get(
      { fileId: driveFileId, alt: 'media' },
      { responseType: 'arraybuffer' }
    );
    const buffer = Buffer.from(res.data);

    // Converte para HTML via Claude
    const htmlContent = await docxParaHtml(buffer, fileName);

    // Atualiza no Firestore
    await db.collection('patients').doc(patientId).collection('reports').doc(reportId).update({
      content_html: htmlContent,
      status: 'reviewed',
      reviewed_at: new Date().toISOString(),
      sync_source: 'drive',
      last_synced_at: new Date().toISOString()
    });

    console.log(`[DriveSync] ✓ Relatório ${reportId} sincronizado do Drive`);
  } catch (err) {
    console.error(`[DriveSync] Erro ao sincronizar ${reportId}:`, err.message);
  }
}

// Importa novo arquivo criado diretamente no Drive
async function importarNovoArquivoDoDrive(patientId, driveFileId, fileName) {
  const drive = getDrive();
  const db = getDb();
  const { v4: uuidv4 } = require('uuid');

  try {
    const res = await drive.files.get(
      { fileId: driveFileId, alt: 'media' },
      { responseType: 'arraybuffer' }
    );
    const buffer = Buffer.from(res.data);
    const htmlContent = await docxParaHtml(buffer, fileName);

    const reportsSnap = await db.collection('patients').doc(patientId).collection('reports').get();
    const version = reportsSnap.size + 1;
    const reportId = uuidv4();
    const now = new Date().toISOString();

    await db.collection('patients').doc(patientId).collection('reports').doc(reportId).set({
      patient_id: patientId,
      version,
      content_html: htmlContent,
      content_md: null,
      drive_file_id: driveFileId,
      status: 'reviewed',
      generated_at: now,
      reviewed_at: now,
      sync_source: 'drive_import'
    });

    console.log(`[DriveSync] ✓ Novo relatório v${version} importado do Drive`);
  } catch (err) {
    console.error(`[DriveSync] Erro ao importar do Drive:`, err.message);
  }
}

module.exports = {
  registrarWebhook,
  cancelarWebhook,
  registrarTodosWebhooks,
  renovarWebhooksVencendo,
  processarNotificacao,
  sincronizarArquivoDosDrive,
  docxParaHtml
};
