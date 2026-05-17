const mammoth = require('mammoth');
const { extractTextFromFile } = require('./pdf-extractor');

const INELIGIBILITY_MESSAGES = {
  image_illegible:    'Imagem ilegível mesmo após melhoria automática. Fotografe com boa iluminação, câmera estável e foco.',
  pdf_no_text:        'PDF escaneado com resolução insuficiente. Tente reescanear em mín. 300 DPI ou exportar com camada de texto.',
  password_protected: 'Documento protegido por senha. Remova a proteção antes de enviar.',
  file_corrupted:     'Arquivo corrompido ou formato inválido. Tente reexportar ou enviar em outro formato.',
  blank_content:      'Nenhum conteúdo detectado. O documento parece estar em branco ou vazio.'
};

function isContentSufficient(text) {
  if (!text || !text.trim()) return false;
  if (text.trim() === '[DOCUMENTO SEM CONTEÚDO RELEVANTE]') return false;
  if (text.trim().length < 20) return false;
  return true;
}

function hasLowQuality(text) {
  if (!text) return true;
  const ilegCount = (text.match(/\[ILEGÍVEL\]/g) || []).length;
  const ilegRatio = text.length > 0 ? (ilegCount * 10) / text.length : 1;
  return ilegRatio > 0.2;
}

async function enhanceImageBuffer(buffer) {
  const sharp = require('sharp');
  return await sharp(buffer)
    .normalize()
    .sharpen()
    .grayscale()
    .jpeg({ quality: 95 })
    .toBuffer();
}

async function markIneligible(fileRef, db, patient_id, fileId, originalName, reason) {
  await fileRef.update({
    eligibility_status: 'ineligible',
    eligibility_reason: reason,
    eligibility_message: INELIGIBILITY_MESSAGES[reason] || reason
  });
  await db.collection('activity_log').add({
    patient_id,
    action: 'file_ineligible',
    details: JSON.stringify({ file_id: fileId, name: originalName, reason }),
    created_at: new Date().toISOString()
  });
  console.log(`[ELEGIBILIDADE] Inelegível: ${originalName} — ${reason}`);
}

async function assessEligibilityInBackground(patient_id, fileId, storagePath, originalName, mimeType, db, storage) {
  const fileRef = db.collection('patients').doc(patient_id).collection('files').doc(fileId);

  try {
    console.log('[ELEGIBILIDADE] Iniciando avaliação para', originalName);
    await fileRef.update({ eligibility_status: 'pending' });

    const isImage = mimeType.startsWith('image/');
    const isPdf = mimeType === 'application/pdf' || mimeType === 'application/octet-stream';
    const isDocx = originalName.toLowerCase().endsWith('.docx');
    const isTxt = mimeType === 'text/plain' || originalName.toLowerCase().endsWith('.txt');

    // TXT — sempre elegível, sem chamada de IA
    if (isTxt) {
      const buffer = await storage.downloadFile(storagePath);
      const text = buffer.toString('utf-8');
      if (!isContentSufficient(text)) {
        return await markIneligible(fileRef, db, patient_id, fileId, originalName, 'blank_content');
      }
      await fileRef.update({
        eligibility_status: 'eligible',
        eligibility_reason: null,
        eligibility_message: null,
        enhanced: false,
        pre_extracted_content: text
      });
      console.log('[ELEGIBILIDADE] TXT elegível:', originalName, '—', text.length, 'chars');
      return;
    }

    // DOCX — extração via mammoth (sem custo de IA)
    if (isDocx) {
      const buffer = await storage.downloadFile(storagePath);
      let text = null;
      try {
        const result = await mammoth.extractRawText({ buffer });
        text = result.value?.trim() || null;
      } catch (e) {
        console.warn('[ELEGIBILIDADE] Mammoth falhou para', originalName, ':', e.message);
      }
      if (!isContentSufficient(text)) {
        return await markIneligible(fileRef, db, patient_id, fileId, originalName, text === null ? 'file_corrupted' : 'blank_content');
      }
      await fileRef.update({
        eligibility_status: 'eligible',
        eligibility_reason: null,
        eligibility_message: null,
        enhanced: false,
        pre_extracted_content: text
      });
      console.log('[ELEGIBILIDADE] DOCX elegível:', originalName, '—', text.length, 'chars');
      return;
    }

    // PDF ou imagem — Claude Sonnet vision (dual-purpose: elegibilidade + pré-extração)
    const buffer = await storage.downloadFile(storagePath);
    const base64 = buffer.toString('base64');
    const mediaType = isImage ? mimeType : 'application/pdf';

    const result = await extractTextFromFile(base64, mediaType, originalName);

    const firstOk = result && isContentSufficient(result.text) && !hasLowQuality(result.text);
    const firstPartial = result && isContentSufficient(result.text) && hasLowQuality(result.text);

    if (firstOk) {
      await fileRef.update({
        eligibility_status: 'eligible',
        eligibility_reason: null,
        eligibility_message: null,
        enhanced: false,
        pre_extracted_content: result.text
      });
      console.log(`[ELEGIBILIDADE] Elegível: ${originalName} — ${result.text.length} chars — $${result.cost.toFixed(4)}`);
      return;
    }

    // PDF com conteúdo parcial (qualidade baixa mas algo extraído) → elegível mesmo assim
    // Não há como melhorar PDF com Sharp; Analítico trabalha com o que tem
    if (isPdf && firstPartial) {
      await fileRef.update({
        eligibility_status: 'eligible',
        eligibility_reason: null,
        eligibility_message: null,
        enhanced: false,
        pre_extracted_content: result.text
      });
      console.log(`[ELEGIBILIDADE] PDF elegível (qualidade parcial): ${originalName} — ${result.text.length} chars`);
      return;
    }

    // PDF sem conteúdo → inelegível direto
    if (isPdf) {
      return await markIneligible(fileRef, db, patient_id, fileId, originalName, result ? 'blank_content' : 'pdf_no_text');
    }

    // Imagem com qualidade insuficiente → tentar melhoria com Sharp
    if (isImage) {
      console.log('[ELEGIBILIDADE] Qualidade insuficiente — aplicando Sharp:', originalName);
      let enhancedBuffer = null;
      try {
        enhancedBuffer = await enhanceImageBuffer(buffer);
      } catch (e) {
        console.warn('[ELEGIBILIDADE] Sharp falhou:', e.message);
      }

      if (enhancedBuffer) {
        // Substituir arquivo original pela versão melhorada no Storage
        await storage.uploadBuffer(enhancedBuffer, storagePath, 'image/jpeg');
        const base64Enhanced = enhancedBuffer.toString('base64');
        const retry = await extractTextFromFile(base64Enhanced, 'image/jpeg', originalName);

        if (retry && isContentSufficient(retry.text)) {
          await fileRef.update({
            eligibility_status: 'enhanced_eligible',
            eligibility_reason: null,
            eligibility_message: null,
            enhanced: true,
            pre_extracted_content: retry.text
          });
          console.log(`[ELEGIBILIDADE] Elegível após Sharp: ${originalName} — ${retry.text.length} chars`);
          return;
        }
      }

      return await markIneligible(fileRef, db, patient_id, fileId, originalName, 'image_illegible');
    }

  } catch (err) {
    console.error('[ELEGIBILIDADE] Erro para', originalName, ':', err.message);
    try {
      await fileRef.update({ eligibility_status: 'error', eligibility_reason: 'processing_error' });
    } catch (_) {}
  }
}

module.exports = { assessEligibilityInBackground };
