const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../db/firestore');
const { FieldValue } = require('@google-cloud/firestore');
const storage = require('../services/storage');
const { assessEligibilityInBackground } = require('../services/eligibility');

const upload = multer({
  dest: path.join(__dirname, '..', 'temp'),
  limits: { fileSize: 500 * 1024 * 1024, files: 50 }
});

// POST /api/files/upload
router.post('/upload', upload.array('file', 50), async (req, res) => {
  const results = [];
  const errors = [];
  try {
    const { patient_id, category } = req.body;
    if (!patient_id || !req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'patient_id e pelo menos um arquivo são obrigatórios' });
    }
    const db = getDb();
    const patientDoc = await db.collection('patients').doc(patient_id).get();
    if (!patientDoc.exists) return res.status(404).json({ error: 'Paciente não encontrado' });

    for (const file of req.files) {
      try {
        // Áudio desativado — funcionalidade descontinuada
        if (file.mimetype.startsWith('audio/') || file.mimetype === 'video/webm') {
          errors.push({ name: file.originalname, error: 'Upload de áudio desativado. Envie PDF, imagem ou documento de texto.' });
          continue;
        }

        const fileId = uuidv4();
        const isImage = file.mimetype.startsWith('image/');
        const fileType = isImage ? 'image' : 'document';

        const destPath = storage.filePath(patient_id, fileId, file.originalname);
        await storage.uploadFile(file.path, destPath, file.mimetype);
        const now = new Date().toISOString();

        await db.collection('patients').doc(patient_id).collection('files').doc(fileId).set({
          patient_id,
          original_name: file.originalname,
          file_type: fileType,
          category: category || null,
          storage_path: destPath,
          transcription: null,
          metadata: JSON.stringify({ size: file.size, mimeType: file.mimetype }),
          status: 'uploaded',
          created_at: now
        });

        results.push({ id: fileId, name: file.originalname, type: fileType, storage_path: destPath });

        // Avaliação de elegibilidade para todos os arquivos (PDF, imagem, DOCX, TXT)
        assessEligibilityInBackground(patient_id, fileId, destPath, file.originalname, file.mimetype, getDb(), storage)
          .catch(e => console.warn('[ELEGIBILIDADE] Falha silenciosa:', e.message));

      } catch (fileErr) {
        console.error('[Files] Erro ao processar arquivo:', file.originalname, '|', fileErr.message);
        errors.push({ name: file.originalname, error: fileErr.message });
      } finally {
        if (file.path && fs.existsSync(file.path)) fs.unlinkSync(file.path);
      }
    }

    const now = new Date().toISOString();
    const countUpdate = { updated_at: now };
    if (category && ['anamnese', 'teste', 'sessao', 'externo'].includes(category)) {
      countUpdate[category + '_count'] = FieldValue.increment(results.length);
    }
    await db.collection('patients').doc(patient_id).update(countUpdate);
    await db.collection('activity_log').add({
      patient_id, action: 'files_uploaded',
      details: JSON.stringify({ count: results.length, category: category || null }),
      created_at: now
    });

    res.status(201).json({
      message: `${results.length} arquivo(s) enviado(s)${errors.length > 0 ? `, ${errors.length} erro(s)` : ''}`,
      uploaded: results,
      errors
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao processar arquivo', details: err.message });
  }
});

// POST /api/files/note
router.post('/note', async (req, res) => {
  try {
    const { patient_id, category, title, content } = req.body;
    if (!patient_id || !content) {
      return res.status(400).json({ error: 'patient_id e content são obrigatórios' });
    }
    const db = getDb();
    const patientDoc = await db.collection('patients').doc(patient_id).get();
    if (!patientDoc.exists) return res.status(404).json({ error: 'Paciente não encontrado' });

    const fileId = uuidv4();
    const fileName = (title || 'nota') + '_' + new Date().toISOString().slice(0, 10) + '.txt';
    const destPath = storage.filePath(patient_id, fileId, fileName);
    const buffer = Buffer.from(content, 'utf-8');
    await storage.uploadBuffer(buffer, destPath, 'text/plain');

    const now = new Date().toISOString();
    await db.collection('patients').doc(patient_id).collection('files').doc(fileId).set({
      patient_id, original_name: fileName, file_type: 'note',
      category: category || null, storage_path: destPath,
      transcription: content, status: 'uploaded', created_at: now
    });
    await db.collection('patients').doc(patient_id).update({ updated_at: now });
    res.status(201).json({ id: fileId, message: 'Nota salva com sucesso', file_name: fileName, category: category || null });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao salvar nota', details: err.message });
  }
});

// GET /api/files/patient/:patient_id
router.get('/patient/:patient_id', async (req, res) => {
  try {
    const db = getDb();
    const snap = await db.collection('patients').doc(req.params.patient_id).collection('files').orderBy('created_at', 'desc').get();
    const files = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    const byCategory = {};
    for (const f of files) {
      const cat = f.category || 'sem_categoria';
      if (!byCategory[cat]) byCategory[cat] = [];
      byCategory[cat].push(f);
    }
    res.json({ files, by_category: byCategory, total: files.length });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao listar arquivos', details: err.message });
  }
});

// DELETE /api/files/:patient_id/:file_id
router.delete('/:patient_id/:file_id', async (req, res) => {
  try {
    const db = getDb();
    const ref = db.collection('patients').doc(req.params.patient_id).collection('files').doc(req.params.file_id);
    const doc = await ref.get();
    if (!doc.exists) return res.status(404).json({ error: 'Arquivo não encontrado' });
    const file = doc.data();

    if (file.storage_path) {
      await storage.deleteFile(file.storage_path).catch(e => console.warn('[Files] deleteFile Storage falhou:', e.message));
    }

    await ref.delete();

    const cat = file.category || file.categoria;
    if (cat && ['anamnese', 'teste', 'sessao', 'externo'].includes(cat)) {
      await db.collection('patients').doc(req.params.patient_id).update({
        [cat + '_count']: FieldValue.increment(-1),
        updated_at: new Date().toISOString()
      }).catch(e => console.warn('[Files] decremento contador falhou:', e.message));
    }

    await db.collection('activity_log').add({
      patient_id: req.params.patient_id, action: 'file_deleted',
      details: JSON.stringify({ name: file.original_name, category: file.category }),
      created_at: new Date().toISOString()
    });
    res.json({ message: 'Arquivo excluído' });
  } catch (err) {
    console.error('[Files] DELETE:', err.message);
    res.status(500).json({ error: 'Erro ao excluir arquivo', details: err.message });
  }
});

// PATCH /api/files/:patient_id/:file_id — renomear, trocar categoria ou salvar rotation
router.patch('/:patient_id/:file_id', async (req, res) => {
  try {
    const db = getDb();
    const ref = db.collection('patients').doc(req.params.patient_id).collection('files').doc(req.params.file_id);
    const doc = await ref.get();
    if (!doc.exists) return res.status(404).json({ error: 'Arquivo não encontrado' });
    const file = doc.data();
    const update = { updated_at: new Date().toISOString() };

    const newCat = req.body.category !== undefined ? req.body.category : req.body.categoria;
    if (newCat !== undefined) {
      const VALID_CATS = ['anamnese', 'teste', 'sessao', 'relatorio', 'intervencao', 'externo'];
      if (!VALID_CATS.includes(newCat)) return res.status(400).json({ error: 'Categoria inválida: ' + newCat });
      const oldCat = file.category || file.categoria;
      update.category = newCat;
      if (oldCat !== newCat) {
        const COUNTED = ['anamnese', 'teste', 'sessao', 'externo'];
        const counterUpdate = { updated_at: update.updated_at };
        if (oldCat && COUNTED.includes(oldCat)) counterUpdate[oldCat + '_count'] = FieldValue.increment(-1);
        if (COUNTED.includes(newCat)) counterUpdate[newCat + '_count'] = FieldValue.increment(1);
        await db.collection('patients').doc(req.params.patient_id).update(counterUpdate)
          .catch(e => console.warn('[Files] atualização de contadores falhou:', e.message));
      }
    }

    if (req.body.display_name !== undefined) update.display_name = req.body.display_name;
    if (req.body.rotation !== undefined) update.rotation = Number(req.body.rotation);
    await ref.update(update);
    res.json({ message: 'Arquivo atualizado', ...update });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao atualizar arquivo', details: err.message });
  }
});

// GET /api/files/:patient_id/:file_id/info
router.get('/:patient_id/:file_id/info', async (req, res) => {
  try {
    const db = getDb();
    const doc = await db.collection('patients').doc(req.params.patient_id)
      .collection('files').doc(req.params.file_id).get();
    if (!doc.exists) return res.status(404).json({ error: 'Arquivo não encontrado' });
    const file = doc.data();
    res.json({
      id: req.params.file_id,
      name: file.display_name || file.original_name,
      original_name: file.original_name,
      file_type: file.file_type,
      storage_path: file.storage_path || null,
      content: file.content || file.transcription || null,
      rotation: file.rotation || 0
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/files/:patient_id/:file_id/download
router.get('/:patient_id/:file_id/download', async (req, res) => {
  try {
    const db = getDb();
    const doc = await db.collection('patients').doc(req.params.patient_id)
      .collection('files').doc(req.params.file_id).get();
    if (!doc.exists) return res.status(404).json({ error: 'Arquivo não encontrado' });
    const file = doc.data();
    if (!file.storage_path) return res.status(404).json({ error: 'Arquivo sem path no Storage' });
    const { stream, mimeType, name } = await storage.downloadFileStream(file.storage_path);
    res.setHeader('Content-Disposition', 'attachment; filename="' + encodeURIComponent(name) + '"');
    res.setHeader('Content-Type', mimeType || 'application/octet-stream');
    stream.pipe(res);
  } catch (err) {
    console.error('[Files] Download error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
