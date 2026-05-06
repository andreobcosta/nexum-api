const express = require('express');
const router = express.Router();
const { getDb } = require('../db/firestore');

const LAYOUT_FIELDS = ['fonte', 'tamanho', 'cores', 'cabecalho', 'logo_url', 'logo_base64'];
const LOGO_BASE64_MAX_BYTES = 800 * 1024;

// GET /api/settings/layout
router.get('/layout', async (req, res) => {
  try {
    const db = getDb();
    const doc = await db.collection('report_layout').doc(req.user.email).get();
    res.json(doc.exists ? doc.data() : { fonte: null, tamanho: null, cores: null, cabecalho: null, logo_url: null, logo_base64: null });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao ler layout', details: err.message });
  }
});

// PUT /api/settings/layout
router.put('/layout', async (req, res) => {
  try {
    if (req.body.logo_base64 && req.body.logo_base64.length > LOGO_BASE64_MAX_BYTES) {
      return res.status(400).json({ error: 'Logo excede 800KB — redimensione antes de salvar' });
    }
    const db = getDb();
    const data = { user_id: req.user.email, updated_at: new Date().toISOString() };
    for (const field of LAYOUT_FIELDS) {
      if (req.body[field] !== undefined) data[field] = req.body[field];
    }
    await db.collection('report_layout').doc(req.user.email).set(data, { merge: true });
    res.json({ message: 'Layout salvo', ...data });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao salvar layout', details: err.message });
  }
});

const DEFAULT_CATEGORIAS = [
  { key: 'anamnese', label: 'Anamnese' },
  { key: 'teste', label: 'Teste' },
  { key: 'sessao', label: 'Sessão' },
  { key: 'externo', label: 'Documento Externo' }
];

// GET /api/settings/categorias
router.get('/categorias', async (req, res) => {
  try {
    const db = getDb();
    const doc = await db.collection('clinic_settings').doc(req.user.email).get();
    const data = doc.exists ? doc.data() : {};
    res.json({ categorias: data.categorias || DEFAULT_CATEGORIAS });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao ler categorias', details: err.message });
  }
});

// PUT /api/settings/categorias
router.put('/categorias', async (req, res) => {
  try {
    const { categorias } = req.body;
    if (!Array.isArray(categorias)) return res.status(400).json({ error: 'categorias deve ser um array' });
    const db = getDb();
    await db.collection('clinic_settings').doc(req.user.email).set({ categorias, updated_at: new Date().toISOString() }, { merge: true });
    res.json({ message: 'Categorias salvas', categorias });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao salvar categorias', details: err.message });
  }
});

module.exports = router;
