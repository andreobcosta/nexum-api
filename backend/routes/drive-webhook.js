const express = require('express');
const router = express.Router();
const { getDb } = require('../db/firestore');
const { processarNotificacao } = require('../services/drive-sync');

// POST /api/drive/webhook — recebe notificações do Google Drive
// O Drive envia headers específicos para identificar o canal e o recurso
router.post('/', async (req, res) => {
  // Responde imediatamente — Drive exige resposta < 3s
  res.status(200).end();

  const channelId = req.headers['x-goog-channel-id'];
  const state = req.headers['x-goog-resource-state'];
  const token = req.headers['x-goog-channel-token']; // patientId

  if (!channelId || !token) {
    console.warn('[Webhook] Notificação sem channel-id ou token');
    return;
  }

  // Ignora notificações de sincronização inicial
  if (state === 'sync') {
    console.log(`[Webhook] Sync inicial para canal ${channelId}`);
    return;
  }

  console.log(`[Webhook] Notificação Drive — state: ${state} — paciente: ${token}`);

  try {
    const db = getDb();
    const wh = await db.collection('drive_webhooks')
      .where('channel_id', '==', channelId)
      .limit(1)
      .get();

    if (wh.empty) {
      console.warn(`[Webhook] Canal ${channelId} não encontrado no Firestore`);
      return;
    }

    const webhook = wh.docs[0].data();

    // Processa em background — não bloqueia a resposta
    processarNotificacao(webhook.patient_id, webhook.folder_id)
      .catch(err => console.error('[Webhook] Erro no processamento:', err.message));

  } catch (err) {
    console.error('[Webhook] Erro:', err.message);
  }
});

// POST /api/drive/webhook/register — registra webhook para um paciente específico
router.post('/register/:patient_id', async (req, res) => {
  try {
    const db = getDb();
    const doc = await db.collection('patients').doc(req.params.patient_id).get();
    if (!doc.exists) return res.status(404).json({ error: 'Paciente não encontrado' });

    const { drive_folder_id } = doc.data();
    if (!drive_folder_id) return res.status(400).json({ error: 'Paciente sem pasta no Drive' });

    const { registrarWebhook } = require('../services/drive-sync');
    const result = await registrarWebhook(drive_folder_id, req.params.patient_id);

    if (result) {
      res.json({ message: 'Webhook registrado', channelId: result.channelId });
    } else {
      res.status(500).json({ error: 'Falha ao registrar webhook' });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/drive/webhook/status — lista webhooks ativos
router.get('/status', async (req, res) => {
  try {
    const db = getDb();
    const snap = await db.collection('drive_webhooks').orderBy('expiration', 'desc').get();
    const webhooks = snap.docs.map(d => ({
      ...d.data(),
      expires_in_hours: Math.round((d.data().expiration - Date.now()) / 3600000)
    }));
    res.json({ total: webhooks.length, webhooks });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
