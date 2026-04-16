const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../db/connection');
const drive = require('../services/drive');

// GET /api/patients — List all patients
router.get('/', (req, res) => {
  const db = getDb();
  const patients = db.prepare(`
    SELECT p.*,
      (SELECT COUNT(*) FROM files f WHERE f.patient_id = p.id AND f.category = 'anamnese') as anamnese_count,
      (SELECT COUNT(*) FROM files f WHERE f.patient_id = p.id AND f.category = 'teste') as teste_count,
      (SELECT COUNT(*) FROM files f WHERE f.patient_id = p.id AND f.category = 'sessao') as sessao_count,
      (SELECT COUNT(*) FROM files f WHERE f.patient_id = p.id AND f.category = 'externo') as externo_count,
      (SELECT COUNT(*) FROM reports r WHERE r.patient_id = p.id) as report_count
    FROM patients p
    ORDER BY p.updated_at DESC
  `).all();

  const enriched = patients.map(p => ({
    ...p,
    completeness: {
      anamnese: p.anamnese_count,
      teste: p.teste_count,
      sessao: p.sessao_count,
      externo: p.externo_count,
      reports: p.report_count
    },
    ready_for_ran: p.anamnese_count > 0 && p.teste_count > 0 && p.sessao_count > 0
  }));

  res.json(enriched);
});

// GET /api/patients/:id — Get single patient with full details
router.get('/:id', (req, res) => {
  const db = getDb();
  const patient = db.prepare('SELECT * FROM patients WHERE id = ?').get(req.params.id);
  if (!patient) return res.status(404).json({ error: 'Paciente não encontrado' });

  const files = db.prepare('SELECT * FROM files WHERE patient_id = ? ORDER BY created_at DESC').all(req.params.id);
  const reports = db.prepare('SELECT * FROM reports WHERE patient_id = ? ORDER BY version DESC').all(req.params.id);

  // Group files by category
  const filesByCategory = {};
  for (const f of files) {
    if (!filesByCategory[f.category]) filesByCategory[f.category] = [];
    filesByCategory[f.category].push(f);
  }

  res.json({
    ...patient,
    files: filesByCategory,
    reports,
    completeness: {
      anamnese: (filesByCategory.anamnese || []).length,
      teste: (filesByCategory.teste || []).length,
      sessao: (filesByCategory.sessao || []).length,
      externo: (filesByCategory.externo || []).length,
      reports: reports.length
    },
    ready_for_ran:
      (filesByCategory.anamnese || []).length > 0 &&
      (filesByCategory.teste || []).length > 0 &&
      (filesByCategory.sessao || []).length > 0
  });
});

// POST /api/patients — Create a new patient (+ Drive folders)
router.post('/', async (req, res) => {
  try {
    const { full_name, birth_date, age, grade, handedness, medications, guardians } = req.body;

    if (!full_name) return res.status(400).json({ error: 'Nome completo é obrigatório' });

    const id = uuidv4();
    const year = new Date().getFullYear();

    // Create Google Drive folder structure
    const driveResult = await drive.createPatientFolders(full_name, year);

    const db = getDb();
    db.prepare(`
      INSERT INTO patients (id, full_name, birth_date, age, grade, handedness, medications, guardians, drive_folder_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, full_name, birth_date, age, grade, handedness || 'Não informado', medications, guardians, driveResult.rootFolderId);

    // Log activity
    db.prepare('INSERT INTO activity_log (patient_id, action, details) VALUES (?, ?, ?)').run(
      id, 'patient_created', JSON.stringify({ drive_folder: driveResult.rootFolderName })
    );

    res.status(201).json({
      id,
      full_name,
      drive_folder_id: driveResult.rootFolderId,
      subfolders: driveResult.subfolders,
      message: `Paciente criado com pasta no Drive: ${driveResult.rootFolderName}`
    });
  } catch (err) {
    console.error('Error creating patient:', err);
    res.status(500).json({ error: 'Erro ao criar paciente', details: err.message });
  }
});

// PATCH /api/patients/:id — Update patient info
router.patch('/:id', (req, res) => {
  const db = getDb();
  const patient = db.prepare('SELECT * FROM patients WHERE id = ?').get(req.params.id);
  if (!patient) return res.status(404).json({ error: 'Paciente não encontrado' });

  const fields = ['full_name', 'birth_date', 'age', 'grade', 'handedness', 'medications', 'guardians', 'status'];
  const updates = [];
  const values = [];

  for (const field of fields) {
    if (req.body[field] !== undefined) {
      updates.push(`${field} = ?`);
      values.push(req.body[field]);
    }
  }

  if (updates.length === 0) return res.status(400).json({ error: 'Nenhum campo para atualizar' });

  updates.push("updated_at = datetime('now')");
  values.push(req.params.id);

  db.prepare(`UPDATE patients SET ${updates.join(', ')} WHERE id = ?`).run(...values);

  res.json({ message: 'Paciente atualizado', id: req.params.id });
});

// DELETE /api/patients/:id
router.delete('/:id', (req, res) => {
  const db = getDb();
  const patient = db.prepare('SELECT * FROM patients WHERE id = ?').get(req.params.id);
  if (!patient) return res.status(404).json({ error: 'Paciente não encontrado' });

  db.prepare('DELETE FROM patients WHERE id = ?').run(req.params.id);
  db.prepare('INSERT INTO activity_log (patient_id, action, details) VALUES (?, ?, ?)').run(
    req.params.id, 'patient_deleted', JSON.stringify({ name: patient.full_name })
  );

  res.json({ message: 'Paciente removido (arquivos no Drive mantidos)' });
});

module.exports = router;
