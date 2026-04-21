const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../db/firestore');

const upload = multer({
  dest: path.join(__dirname, '..', 'temp'),
  limits: { fileSize: 10 * 1024 * 1024 }
});

// POST /api/import/patients
router.post('/patients', upload.single('file'), async (req, res) => {
  const tempPath = req.file && req.file.path;
  try {
    if (!req.file) return res.status(400).json({ error: 'Envie um arquivo CSV' });

    const content = fs.readFileSync(tempPath, 'utf-8');
    const lines = content.split('\n').filter(l => l.trim());
    if (lines.length < 2) return res.status(400).json({ error: 'Arquivo vazio ou sem dados' });

    const db = getDb();
    const existingSnap = await db.collection('patients').select('full_name').get();
    const existingNames = {};
    for (const doc of existingSnap.docs) {
      existingNames[doc.data().full_name.toLowerCase().trim()] = true;
    }

    let added = 0;
    let skipped = 0;
    const errors = [];
    let batch = db.batch();
    let batchCount = 0;

    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(',');
      const nome = cols[1] ? cols[1].trim() : '';
      const nascimento = cols[11] ? cols[11].trim() : '';
      const status = cols[12] ? cols[12].trim() : '';

      if (!nome) continue;
      if (status && status !== 'ATIVO') { skipped++; continue; }
      if (existingNames[nome.toLowerCase().trim()]) { skipped++; continue; }

      let birthDate = null;
      let age = null;
      if (nascimento && nascimento.indexOf('/') > -1) {
        const p = nascimento.split('/');
        if (p.length === 3 && p[2].length === 4) {
          birthDate = `${p[2]}-${p[1]}-${p[0]}`;
          const born = new Date(parseInt(p[2]), parseInt(p[1]) - 1, parseInt(p[0]));
          age = Math.floor((Date.now() - born.getTime()) / (365.25 * 24 * 60 * 60 * 1000));
          if (age < 0 || age > 120) age = null;
        }
      }

      const id = uuidv4();
      const now = new Date().toISOString();
      const ref = db.collection('patients').doc(id);
      batch.set(ref, {
        full_name: nome, birth_date: birthDate, age,
        grade: null, handedness: 'Não informado',
        medications: null, guardians: null,
        drive_folder_id: null, status: 'em_avaliacao',
        created_at: now, updated_at: now
      });
      existingNames[nome.toLowerCase().trim()] = true;
      added++;
      batchCount++;

      if (batchCount === 400) {
        await batch.commit();
        batch = db.batch(); // novo batch — o anterior está encerrado após commit
        batchCount = 0;
      }
    }

    if (batchCount > 0) await batch.commit();

    const totalSnap = await db.collection('patients').count().get();
    res.json({
      message: `${added} paciente(s) importado(s), ${skipped} ignorado(s)`,
      added, skipped, errors,
      total_now: totalSnap.data().count
    });
  } catch (err) {
    console.error('Import error:', err);
    res.status(500).json({ error: 'Erro ao importar', details: err.message });
  } finally {
    if (tempPath && fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
  }
});

module.exports = router;