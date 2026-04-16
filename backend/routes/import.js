const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../db/connection');

const upload = multer({
  dest: path.join(__dirname, '..', 'temp'),
  limits: { fileSize: 10 * 1024 * 1024 }
});

// POST /api/import/patients — Import patients from CSV without modifying existing
router.post('/patients', upload.single('file'), async (req, res) => {
  var tempPath = req.file && req.file.path;
  try {
    if (!req.file) return res.status(400).json({ error: 'Envie um arquivo CSV' });

    var content = fs.readFileSync(tempPath, 'utf-8');
    var lines = content.split('\n').filter(function(l) { return l.trim(); });
    if (lines.length < 2) return res.status(400).json({ error: 'Arquivo vazio ou sem dados' });

    var db = getDb();
    var existing = db.prepare('SELECT full_name FROM patients').all();
    var existingNames = {};
    for (var e = 0; e < existing.length; e++) {
      existingNames[existing[e].full_name.toLowerCase().trim()] = true;
    }

    var added = 0;
    var skipped = 0;
    var errors = [];

    for (var i = 1; i < lines.length; i++) {
      var cols = lines[i].split(',');
      var nome = cols[1] ? cols[1].trim() : '';
      var nascimento = cols[11] ? cols[11].trim() : '';
      var status = cols[12] ? cols[12].trim() : '';

      if (!nome) continue;
      if (status && status !== 'ATIVO') { skipped++; continue; }

      // Check if already exists (case insensitive)
      if (existingNames[nome.toLowerCase().trim()]) {
        skipped++;
        continue;
      }

      var birthDate = null;
      var age = null;
      if (nascimento && nascimento.indexOf('/') > -1) {
        var p = nascimento.split('/');
        if (p.length === 3 && p[2].length === 4) {
          birthDate = p[2] + '-' + p[1] + '-' + p[0];
          var born = new Date(parseInt(p[2]), parseInt(p[1]) - 1, parseInt(p[0]));
          age = Math.floor((Date.now() - born.getTime()) / (365.25 * 24 * 60 * 60 * 1000));
          if (age < 0 || age > 120) age = null;
        }
      }

      var id = uuidv4();
      try {
        db.prepare("INSERT INTO patients (id, full_name, birth_date, age, grade, handedness, medications, guardians, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'Nao informado', '', '', 'em_avaliacao', datetime('now'), datetime('now'))").run(
          id, nome, birthDate, age, null
        );
        existingNames[nome.toLowerCase().trim()] = true;
        added++;
      } catch (insertErr) {
        errors.push({ name: nome, error: insertErr.message });
      }
    }

    res.json({
      message: added + ' paciente(s) importado(s), ' + skipped + ' ignorado(s) (ja existem ou inativos)',
      added: added,
      skipped: skipped,
      errors: errors,
      total_now: db.prepare('SELECT COUNT(*) as c FROM patients').get().c
    });
  } catch (err) {
    console.error('Import error:', err);
    res.status(500).json({ error: 'Erro ao importar', details: err.message });
  } finally {
    if (tempPath && fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
  }
});

module.exports = router;
