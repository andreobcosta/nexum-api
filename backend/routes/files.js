const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../db/firestore');
const { FieldValue } = require('@google-cloud/firestore');
const drive = require('../services/drive');
const { transcribeAudio } = require('../services/transcription');
const { extractTextFromFile } = require('../services/pdf-extractor');

const upload = multer({
  dest: path.join(__dirname, '..', 'temp'),
  limits: { fileSize: 500 * 1024 * 1024 }
});

// Transcreve áudio em background após upload
async function transcribeInBackground(patient_id, fileId, driveFileId, subfolderId, originalName, mimeType, bgPath = null) {
  const db = getDb();
  const fileRef = db.collection('patients').doc(patient_id).collection('files').doc(fileId);
  let tempPath = null;
  try {
    console.log('[AUTO-TRANSCRIÇÃO] Iniciando para', originalName);
    await fileRef.update({ status: 'transcribing' });

    const buffer = await drive.downloadFile(driveFileId);
    tempPath = path.join(__dirname, '..', 'temp', 'transcribe_' + uuidv4());
    fs.writeFileSync(tempPath, buffer);

    const resultado = await transcribeAudio(tempPath, mimeType, originalName);
    const transcricao = resultado.transcricao;
    const comprimido = resultado.comprimido;
    const now = new Date().toISOString();

    await fileRef.update({ transcription: transcricao, transcricao_comprimida: comprimido || null, status: 'transcribed', transcribed_at: now });

    // Salva .txt no Drive
    try {
      const txtName = originalName.replace(/\.[^.]+$/, '') + '_transcricao.txt';
      const txtBuffer = Buffer.from('TRANSCRICAO — ' + originalName + '\nGerada em: ' + now + '\n\n' + transcricao, 'utf-8');
      await drive.uploadBuffer(txtBuffer, txtName, 'text/plain', subfolderId);
    } catch (e) {
      console.warn('[AUTO-TRANSCRIÇÃO] Nao salvou .txt no Drive:', e.message);
    }

    await db.collection('activity_log').add({
      patient_id, action: 'file_transcribed',
      details: JSON.stringify({ file_id: fileId, name: originalName, auto: true }),
      created_at: new Date().toISOString()
    });

    console.log('[AUTO-TRANSCRIÇÃO] Concluída para', originalName);
  } catch (err) {
    console.error('[AUTO-TRANSCRIÇÃO] Erro em', originalName, ':', err.message);
    try { await fileRef.update({ status: 'transcription_failed' }); } catch (_) {}
  } finally {
    if (tempPath && fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    if (bgPath && fs.existsSync(bgPath)) fs.unlinkSync(bgPath); // cleanup do arquivo _bg
  }
}

async function scoreImageInBackground(patient_id, fileId, driveFileId, originalName) {
  const db = getDb();
  const fileRef = db.collection('patients').doc(patient_id).collection('files').doc(fileId);
  try {
    console.log('[SCORE-LEGIBILIDADE] Iniciando para', originalName);
    const buffer = await drive.downloadFile(driveFileId);
    const base64 = buffer.toString('base64');
    const result = await extractTextFromFile(base64, 'image/jpeg', originalName);
    if (!result || !result.text) {
      await fileRef.update({ legibility_score: 0, legibility_label: 'baixa' });
      return;
    }
    const ilegCount = (result.text.match(/\[ILEGÍVEL\]/g) || []).length;
    const ilegRatio = result.text.length > 0 ? (ilegCount * 10) / result.text.length : 1;
    const score = Math.round(Math.max(0, Math.min(100, 100 - ilegRatio * 500)));
    const label = score >= 70 ? 'boa' : score >= 40 ? 'parcial' : 'baixa';
    await fileRef.update({ legibility_score: score, legibility_label: label });
    console.log('[SCORE-LEGIBILIDADE] ' + originalName + ' — score:' + score + ' (' + label + ')');
  } catch (err) {
    console.warn('[SCORE-LEGIBILIDADE] Erro para', originalName, ':', err.message);
  }
}

// POST /api/files/upload
router.post('/upload', upload.array('file', 20), async (req, res) => {
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
    const patient = patientDoc.data();
    if (!patient.drive_folder_id) return res.status(400).json({ error: 'Paciente sem pasta no Drive' });
    const driveCat = category || 'externo';
    const subfolderId = await drive.getSubfolderId(patient.drive_folder_id, driveCat);

    for (const file of req.files) {
      try {
        const fileId = uuidv4();
        const isAudio = file.mimetype.startsWith('audio/') || file.mimetype === 'video/webm';
        const isImage = file.mimetype.startsWith('image/');
        const fileType = isAudio ? 'audio' : isImage ? 'image' : 'document';

        const driveFile = await drive.uploadFile(file.path, file.originalname, file.mimetype, subfolderId);
        const now = new Date().toISOString();

        await db.collection('patients').doc(patient_id).collection('files').doc(fileId).set({
          patient_id,
          original_name: file.originalname,
          file_type: fileType,
          category: category || null,
          drive_file_id: driveFile.id,
          drive_folder_id: subfolderId,
          transcription: null,
          metadata: JSON.stringify({ size: file.size, mimeType: file.mimetype }),
          status: isAudio ? 'pending_transcription' : 'uploaded',
          created_at: now
        });

        results.push({
          id: fileId,
          name: file.originalname,
          type: fileType,
          drive_id: driveFile.id,
          transcribing: isAudio
        });

        // Transcrição automática em background para áudios
        if (isAudio) {
          const bgPath = file.path + '_bg';
          fs.copyFileSync(file.path, bgPath);
          transcribeInBackground(patient_id, fileId, driveFile.id, subfolderId, file.originalname, file.mimetype, bgPath)
            .catch(e => console.error('[AUTO-TRANSCRIÇÃO] Falha silenciosa:', e.message));
        }

        // Score de legibilidade em background para imagens
        if (isImage) {
          scoreImageInBackground(patient_id, fileId, driveFile.id, file.originalname)
            .catch(e => console.warn('[SCORE-LEGIBILIDADE] Falha silenciosa:', e.message));
        }

      } catch (fileErr) {
        console.error('[Files] Erro ao processar arquivo:', file.originalname, '|', fileErr.message);
        errors.push({ name: file.originalname, error: fileErr.message });
      } finally {
        if (file.path && fs.existsSync(file.path)) fs.unlinkSync(file.path);
      }
    }

    const now = new Date().toISOString();
    const countField = category + '_count';
    const countUpdate = { updated_at: now };
    if (['anamnese', 'teste', 'sessao', 'externo'].includes(category)) {
      countUpdate[countField] = FieldValue.increment(results.length);
    }
    await db.collection('patients').doc(patient_id).update(countUpdate);
    await db.collection('activity_log').add({
      patient_id, action: 'files_uploaded',
      details: JSON.stringify({ count: results.length, category }),
      created_at: now
    });

    if (results.length === 0) {
      console.error('[Files] Nenhum arquivo processado. Erros:', JSON.stringify(errors));
    }
    const hasAudio = results.some(r => r.transcribing);
    res.status(201).json({
      message: `${results.length} arquivo(s) enviado(s)${hasAudio ? ' — áudio(s) sendo transcritos em background' : ''}${errors.length > 0 ? `, ${errors.length} erro(s)` : ''}`,
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
    if (!patient_id || !category || !content) {
      return res.status(400).json({ error: 'patient_id, category e content são obrigatórios' });
    }
    const db = getDb();
    const patientDoc = await db.collection('patients').doc(patient_id).get();
    if (!patientDoc.exists) return res.status(404).json({ error: 'Paciente não encontrado' });
    const patient = patientDoc.data();
    const fileId = uuidv4();
    const fileName = (title || 'nota') + '_' + new Date().toISOString().slice(0, 10) + '.txt';
    const subfolderId = await drive.getSubfolderId(patient.drive_folder_id, category);
    const buffer = Buffer.from(content, 'utf-8');
    const driveFile = await drive.uploadBuffer(buffer, fileName, 'text/plain', subfolderId);
    const now = new Date().toISOString();
    await db.collection('patients').doc(patient_id).collection('files').doc(fileId).set({
      patient_id, original_name: fileName, file_type: 'note',
      category, drive_file_id: driveFile.id, drive_folder_id: subfolderId,
      transcription: content, status: 'uploaded', created_at: now
    });
    await db.collection('patients').doc(patient_id).update({ updated_at: now });
    res.status(201).json({ id: fileId, message: 'Nota salva com sucesso', file_name: fileName, category });
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
      if (!byCategory[f.category]) byCategory[f.category] = [];
      byCategory[f.category].push(f);
    }
    res.json({ files, by_category: byCategory, total: files.length });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao listar arquivos', details: err.message });
  }
});

// DELETE /api/files/:patient_id/:file_id — remove arquivo do Firestore e do Drive
router.delete('/:patient_id/:file_id', async (req, res) => {
  try {
    const db = getDb();
    const ref = db.collection('patients').doc(req.params.patient_id).collection('files').doc(req.params.file_id);
    const doc = await ref.get();
    if (!doc.exists) return res.status(404).json({ error: 'Arquivo não encontrado' });
    const file = doc.data();

    // Remove do Drive (falha silenciosa — não bloqueia a exclusão local)
    if (file.drive_file_id) {
      await drive.deleteFile(file.drive_file_id).catch(e => console.warn('[Files] deleteFile Drive falhou:', e.message));
    }

    // Remove do Firestore
    await ref.delete();

    // Decrementa contador desnormalizado no paciente
    const cat = file.category || file.categoria;
    if (cat && ['anamnese', 'teste', 'sessao', 'externo'].includes(cat)) {
      await db.collection('patients').doc(req.params.patient_id).update({
        [cat + '_count']: FieldValue.increment(-1),
        updated_at: new Date().toISOString()
      }).catch(e => console.warn('[Files] decremento contador falhou:', e.message));
    }

    res.json({ message: 'Arquivo excluído' });
  } catch (err) {
    console.error('[Files] DELETE:', err.message);
    res.status(500).json({ error: 'Erro ao excluir arquivo', details: err.message });
  }
});

// PATCH /api/files/:patient_id/:file_id — renomear display_name, trocar categoria ou salvar rotation
router.patch('/:patient_id/:file_id', async (req, res) => {
  try {
    const db = getDb();
    const ref = db.collection('patients').doc(req.params.patient_id).collection('files').doc(req.params.file_id);
    const doc = await ref.get();
    if (!doc.exists) return res.status(404).json({ error: 'Arquivo não encontrado' });
    const file = doc.data();
    const update = { updated_at: new Date().toISOString() };

    // Mudança de categoria — aceita tanto "category" (padrão atual) quanto "categoria" (legado)
    const newCat = req.body.category !== undefined ? req.body.category : req.body.categoria;
    if (newCat !== undefined) {
      const VALID_CATS = ['anamnese', 'teste', 'sessao', 'relatorio', 'intervencao', 'externo'];
      if (!VALID_CATS.includes(newCat)) return res.status(400).json({ error: 'Categoria inválida: ' + newCat });
      const oldCat = file.category || file.categoria;
      update.category = newCat;
      // Atualiza contadores desnormalizados se categoria mudou
      if (oldCat !== newCat) {
        const COUNTED = ['anamnese', 'teste', 'sessao', 'externo'];
        const counterUpdate = { updated_at: update.updated_at };
        if (COUNTED.includes(oldCat)) counterUpdate[oldCat + '_count'] = FieldValue.increment(-1);
        if (COUNTED.includes(newCat)) counterUpdate[newCat + '_count'] = FieldValue.increment(1);
        await db.collection('patients').doc(req.params.patient_id).update(counterUpdate)
          .catch(e => console.warn('[Files] atualização de contadores falhou:', e.message));
      }
    }

    if (req.body.display_name !== undefined) {
      update.display_name = req.body.display_name;
      if (file.drive_file_id) await drive.renameFile(file.drive_file_id, req.body.display_name).catch(e => console.warn('[Files] renameFile falhou:', e.message));
    }
    if (req.body.rotation !== undefined) update.rotation = Number(req.body.rotation);
    await ref.update(update);
    res.json({ message: 'Arquivo atualizado', ...update });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao atualizar arquivo', details: err.message });
  }
});

// GET /api/files/:patient_id/:file_id/info — metadados para o preview
router.get('/:patient_id/:file_id/info', async (req, res) => {
  try {
    const db = getDb();
    const doc = await db.collection('patients').doc(req.params.patient_id)
      .collection('files').doc(req.params.file_id).get();
    if (!doc.exists) return res.status(404).json({ error: 'Arquivo não encontrado' });
    const file = doc.data();
    const id = file.drive_file_id;
    res.json({
      id: req.params.file_id,
      name: file.display_name || file.original_name,
      original_name: file.original_name,
      file_type: file.file_type,
      drive_file_id: id,
      content: file.content || file.transcription || null,
      preview_url: id ? 'https://drive.google.com/file/d/' + id + '/preview' : null,
      rotation: file.rotation || 0
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/files/:patient_id/:file_id/download — proxy do arquivo via Drive API
router.get('/:patient_id/:file_id/download', async (req, res) => {
  try {
    const db = getDb();
    const doc = await db.collection('patients').doc(req.params.patient_id)
      .collection('files').doc(req.params.file_id).get();
    if (!doc.exists) return res.status(404).json({ error: 'Arquivo não encontrado' });
    const file = doc.data();
    if (!file.drive_file_id) return res.status(404).json({ error: 'Arquivo sem ID no Drive' });
    const driveService = require('../services/drive');
    const { stream, mimeType, name } = await driveService.downloadFileStream(file.drive_file_id, file.original_name);
    res.setHeader('Content-Disposition', 'attachment; filename="' + encodeURIComponent(name) + '"');
    res.setHeader('Content-Type', mimeType || 'application/octet-stream');
    stream.pipe(res);
  } catch (err) {
    console.error('[Files] Download error:', err.message);
    res.status(500).json({ error: err.message });
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
    await ref.delete();
    const now = new Date().toISOString();
    const catField = (file.category || '') + '_count';
    const delUpdate = { updated_at: now };
    if (['anamnese', 'teste', 'sessao', 'externo'].includes(file.category)) {
      delUpdate[catField] = FieldValue.increment(-1);
    }
    await db.collection('patients').doc(req.params.patient_id).update(delUpdate);
    await db.collection('activity_log').add({
      patient_id: req.params.patient_id, action: 'file_deleted',
      details: JSON.stringify({ name: file.original_name, category: file.category }),
      created_at: now
    });
    res.json({ message: 'Arquivo removido', name: file.original_name });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao remover arquivo', details: err.message });
  }
});

module.exports = router;