const express = require('express');
const router = express.Router();
const { getDb } = require('../db/firestore');

async function logActivity(db, action, admin, details) {
  await db.collection('activity_log').add({ action, admin, details, created_at: new Date().toISOString() });
}

// GET /api/admin/config
router.get('/config', async (req, res) => {
  try {
    const db = getDb();
    const doc = await db.collection('motor_config').doc('global').get();
    res.json(doc.exists ? doc.data() : {});
  } catch (err) {
    res.status(500).json({ error: 'Erro ao ler configuração', details: err.message });
  }
});

// PUT /api/admin/config
router.put('/config', async (req, res) => {
  try {
    const db = getDb();
    await db.collection('motor_config').doc('global').set(req.body, { merge: true });
    await logActivity(db, 'admin_config_updated', req.user.email, JSON.stringify(req.body));
    res.json({ message: 'Configuração atualizada' });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao atualizar configuração', details: err.message });
  }
});

// GET /api/admin/system-prompt
router.get('/system-prompt', async (req, res) => {
  try {
    const db = getDb();
    const doc = await db.collection('system_prompts').doc('active').get();
    res.json(doc.exists ? doc.data() : { conteudo: null, versao: null, updated_at: null });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao ler system prompt', details: err.message });
  }
});

// PUT /api/admin/system-prompt
router.put('/system-prompt', async (req, res) => {
  try {
    const { conteudo } = req.body;
    if (!conteudo) return res.status(400).json({ error: 'conteudo é obrigatório' });
    const db = getDb();
    const now = new Date().toISOString();

    const current = await db.collection('system_prompts').doc('active').get();
    if (current.exists) {
      await db.collection('system_prompts_history').add({ ...current.data(), archived_at: now });
    }

    const newDoc = { conteudo, versao: now, updated_at: now, admin: req.user.email };
    await db.collection('system_prompts').doc('active').set(newDoc);
    await logActivity(db, 'system_prompt_updated', req.user.email, JSON.stringify({ versao: now }));
    res.json({ message: 'System prompt atualizado', versao: now });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao atualizar system prompt', details: err.message });
  }
});

// GET /api/admin/system-prompt/history
router.get('/system-prompt/history', async (req, res) => {
  try {
    const db = getDb();
    const snap = await db.collection('system_prompts_history').orderBy('archived_at', 'desc').limit(20).get();
    res.json(snap.docs.map(d => ({ id: d.id, ...d.data() })));
  } catch (err) {
    res.status(500).json({ error: 'Erro ao listar histórico', details: err.message });
  }
});

// POST /api/admin/system-prompt/rollback/:versao
// :versao = Firestore doc ID retornado pelo GET /history (campo "id")
router.post('/system-prompt/rollback/:versao', async (req, res) => {
  try {
    const db = getDb();
    const histDoc = await db.collection('system_prompts_history').doc(req.params.versao).get();
    if (!histDoc.exists) return res.status(404).json({ error: 'Versão não encontrada' });

    const now = new Date().toISOString();
    const current = await db.collection('system_prompts').doc('active').get();
    if (current.exists) {
      await db.collection('system_prompts_history').add({ ...current.data(), archived_at: now });
    }

    const restored = { ...histDoc.data(), updated_at: now, admin: req.user.email };
    delete restored.archived_at;
    await db.collection('system_prompts').doc('active').set(restored);
    await logActivity(db, 'system_prompt_rollback', req.user.email, JSON.stringify({ versao: req.params.versao }));
    res.json({ message: 'Rollback realizado', versao: req.params.versao });
  } catch (err) {
    res.status(500).json({ error: 'Erro no rollback', details: err.message });
  }
});

// GET /api/admin/activity-log
router.get('/activity-log', async (req, res) => {
  try {
    const db = getDb();
    const snap = await db.collection('activity_log').orderBy('created_at', 'desc').limit(50).get();
    res.json(snap.docs.map(d => ({ id: d.id, ...d.data() })));
  } catch (err) {
    res.status(500).json({ error: 'Erro ao ler activity log', details: err.message });
  }
});

module.exports = router;
