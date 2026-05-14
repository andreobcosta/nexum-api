const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../db/firestore');

// GET /api/patients
router.get('/', async (req, res) => {
  try {
    const db = getDb();
    const snap = await db.collection('patients').orderBy('updated_at', 'desc').get();
    const patients = snap.docs.map(doc => {
      const p = { id: doc.id, ...doc.data() };
      const anamnese = p.anamnese_count || 0;
      const teste = p.teste_count || 0;
      const sessao = p.sessao_count || 0;
      const externo = p.externo_count || 0;
      p.completeness = { anamnese, teste, sessao, externo, reports: p.reports_count || 0 };
      p.ready_for_ran = anamnese > 0 && teste > 0 && sessao > 0;
      return p;
    });
    res.json(patients);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao listar pacientes', details: err.message });
  }
});

// GET /api/patients/:id
router.get('/:id', async (req, res) => {
  try {
    const db = getDb();
    const doc = await db.collection('patients').doc(req.params.id).get();
    if (!doc.exists) return res.status(404).json({ error: 'Paciente não encontrado' });
    const patient = { id: doc.id, ...doc.data() };
    const filesSnap = await db.collection('patients').doc(doc.id).collection('files').orderBy('created_at', 'desc').get();
    const reportsSnap = await db.collection('patients').doc(doc.id).collection('reports').orderBy('version', 'desc').get();
    const filesArr = filesSnap.docs.map(f => ({ id: f.id, ...f.data() }));
    filesArr.sort((a, b) => {
      const ca = (a.categoria || a.category || '').toLowerCase();
      const cb = (b.categoria || b.category || '').toLowerCase();
      if (ca < cb) return -1; if (ca > cb) return 1;
      const na = (a.display_name || a.original_name || '').toLowerCase();
      const nb = (b.display_name || b.original_name || '').toLowerCase();
      return na < nb ? -1 : na > nb ? 1 : 0;
    });
    const counts = { anamnese: 0, teste: 0, sessao: 0, externo: 0 };
    for (const f of filesArr) { if (counts[f.category] !== undefined) counts[f.category]++; }
    patient.files = filesArr;
    patient.reports = reportsSnap.docs.map(r => ({ id: r.id, ...r.data() }));
    patient.completeness = { ...counts, reports: reportsSnap.size };
    patient.ready_for_ran = counts.anamnese > 0 && counts.teste > 0 && counts.sessao > 0;
    res.json(patient);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao buscar paciente', details: err.message });
  }
});

// POST /api/patients
router.post('/', async (req, res) => {
  try {
    const { full_name, birth_date, age, grade, handedness, medications, guardians } = req.body;
    if (!full_name) return res.status(400).json({ error: 'Nome completo é obrigatório' });
    const id = uuidv4();
    const now = new Date().toISOString();
    const db = getDb();
    await db.collection('patients').doc(id).set({
      full_name,
      birth_date: birth_date || null,
      age: age || null,
      grade: grade || null,
      handedness: handedness || 'Não informado',
      medications: medications || null,
      guardians: guardians || null,
      status: 'em_avaliacao',
      anamnese_count: 0, teste_count: 0, sessao_count: 0, externo_count: 0, reports_count: 0,
      pipeline_ativo: false,
      created_at: now,
      updated_at: now
    });
    await db.collection('activity_log').add({
      patient_id: id,
      action: 'patient_created',
      details: JSON.stringify({ full_name }),
      created_at: now
    });
    res.status(201).json({
      id,
      full_name,
      message: `Paciente criado: ${full_name}`
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao criar paciente', details: err.message });
  }
});

// PATCH /api/patients/:id
router.patch('/:id', async (req, res) => {
  try {
    const db = getDb();
    const doc = await db.collection('patients').doc(req.params.id).get();
    if (!doc.exists) return res.status(404).json({ error: 'Paciente não encontrado' });
    const fields = ['full_name', 'birth_date', 'age', 'grade', 'handedness', 'medications', 'guardians', 'status'];
    const updates = { updated_at: new Date().toISOString() };
    for (const field of fields) {
      if (req.body[field] !== undefined) updates[field] = req.body[field];
    }
    if (Object.keys(updates).length === 1) return res.status(400).json({ error: 'Nenhum campo para atualizar' });
    await db.collection('patients').doc(req.params.id).update(updates);
    res.json({ message: 'Paciente atualizado', id: req.params.id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao atualizar paciente', details: err.message });
  }
});

// DELETE /api/patients/:id
router.delete('/:id', async (req, res) => {
  try {
    const db = getDb();
    const doc = await db.collection('patients').doc(req.params.id).get();
    if (!doc.exists) return res.status(404).json({ error: 'Paciente não encontrado' });
    const { full_name } = doc.data();
    await db.collection('patients').doc(req.params.id).delete();
    await db.collection('activity_log').add({
      patient_id: req.params.id,
      action: 'patient_deleted',
      details: JSON.stringify({ name: full_name }),
      created_at: new Date().toISOString()
    });
    res.json({ message: 'Paciente removido (arquivos no Drive mantidos)' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao remover paciente', details: err.message });
  }
});

module.exports = router;
