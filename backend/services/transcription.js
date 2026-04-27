// Agente Transcritor — Google Cloud Speech-to-Text v2 com Chirp 2
// + Agente Compressor (Claude Haiku) — renomeia locutores + extrai repr. clínica em 1 chamada
// Chirp 2: 11.6% WER, diarização nativa, $0.006/min
// Migrado de Speech-to-Text v1 ($0.016/min) em abril/2026

const { SpeechClient } = require('@google-cloud/speech').v2;
const { Storage } = require('@google-cloud/storage');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

const GCS_BUCKET = 'nexum-audio-temp';
const PROJECT_ID = process.env.GCP_PROJECT_ID || 'nexum-production';
const LOCATION = 'us-central1';
const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const MODEL_HAIKU = 'claude-haiku-4-5-20251001';

// Termos clínicos para boosting — melhora precisão em ~15%
const CLINICAL_PHRASES = [
  'neuropsicopedagogia', 'neuropsicopedagógica', 'neuropsicopedagogo',
  'anamnese', 'TDAH', 'TEA', 'autismo', 'dislexia', 'disgrafia', 'discalculia',
  'TDE', 'TDE-2', 'ETDAH', 'CARS', 'DSM-5', 'CID-11',
  'consciência fonológica', 'lateralidade', 'funções executivas',
  'memória de trabalho', 'controle inibitório', 'flexibilidade cognitiva',
  'grafomotricidade', 'processamento auditivo', 'neuropsicomotor',
  'Patrízia', 'Santarém', 'Uberlândia', 'Minas Gerais',
  'fonoaudiologia', 'neuropediatra', 'psicopedagogia',
  'avaliação neuropsicopedagógica', 'relatório RAN'
];

function getSpeechClient() {
  return new SpeechClient({
    apiEndpoint: `${LOCATION}-speech.googleapis.com`
  });
}

function getStorageClient() {
  return new Storage();
}

async function uploadToGCS(filePath, mimeType) {
  const storage = getStorageClient();
  const bucket = storage.bucket(GCS_BUCKET);
  const gcsFileName = `audio_${uuidv4()}_${Date.now()}`;
  await bucket.upload(filePath, {
    destination: gcsFileName,
    metadata: { contentType: mimeType }
  });
  console.log('[Chirp2] Upload GCS concluído:', gcsFileName);
  return { uri: `gs://${GCS_BUCKET}/${gcsFileName}`, gcsFileName };
}

async function deleteFromGCS(gcsFileName) {
  try {
    await getStorageClient().bucket(GCS_BUCKET).file(gcsFileName).delete();
    console.log('[Chirp2] Arquivo GCS removido:', gcsFileName);
  } catch (e) {
    console.warn('[Chirp2] Não removeu arquivo GCS:', e.message);
  }
}

// Formata resultado bruto da diarização com rótulos genéricos
function formatRawTranscription(results) {
  if (!results || results.length === 0) {
    return null;
  }

  const lines = [];
  let currentSpeaker = null;
  let currentWords = [];

  for (const result of results) {
    const alt = result.alternatives?.[0];
    if (!alt?.transcript) continue;

    if (alt.words && alt.words.length > 0 && alt.words[0].speakerLabel) {
      for (const word of alt.words) {
        const speaker = word.speakerLabel;
        if (currentSpeaker === null) currentSpeaker = speaker;

        if (speaker !== currentSpeaker) {
          if (currentWords.length > 0) {
            lines.push(`Locutor ${currentSpeaker}: ${currentWords.join(' ')}`);
          }
          currentWords = [word.word];
          currentSpeaker = speaker;
        } else {
          currentWords.push(word.word);
        }
      }
    } else {
      lines.push(alt.transcript);
    }
  }

  if (currentWords.length > 0) {
    lines.push(`Locutor ${currentSpeaker}: ${currentWords.join(' ')}`);
  }

  return lines.join('\n\n');
}

// Agente Compressor — Claude Haiku
// Uma chamada: renomeia locutores + extrai representação clínica estruturada
// Custo: ~$0.019/par de áudios vs $0.039 do Identificador (−51%)
async function comprimirTranscricao(transcricaoBruta, contexto = '') {
  if (!transcricaoBruta || !transcricaoBruta.includes('Locutor')) {
    return { transcricaoRenomeada: transcricaoBruta, comprimido: null };
  }

  const systemPrompt = `Você é um especialista em análise de sessões clínicas neuropsicopedagógicas.

Você receberá uma transcrição com locutores genéricos (Locutor 1, Locutor 2, etc.).
Retorne APENAS um JSON válido com exatamente 4 campos:

"transcricao_renomeada": string — transcrição completa com locutores renomeados pelo papel real:
  - Patrízia: faz perguntas técnicas, conduz a sessão, usa terminologia clínica
  - Mãe/Pai/Avó/Responsável: relata histórico, descreve comportamentos, linguagem coloquial
  - Criança: falas curtas, simples, responde perguntas diretas
  Mantenha TODO o conteúdo original sem resumir, omitir ou corrigir.

"locutores_identificados": objeto — mapa do rótulo original para o papel identificado.
  Exemplo: { "L1": "Patrízia", "L2": "Mãe", "L3": "Criança" }

"pontos_clinicos": objeto com os subcampos queixa, marcos_desenvolvimento, historico_escolar,
  rotina, saude, historico_familiar. Normalizar coloquial para técnico sem alterar conteúdo factual.
  Exemplo: "fica muito ligado no 220" → "apresenta agitação motora constante".
  Se não houver informação para um subcampo, use null.

"observacoes_comportamentais": array de strings — transcrição LITERAL de momentos relevantes.
  Incluir OBRIGATORIAMENTE quando:
  - Locutor demonstrou emoção perceptível (ansiedade, choro, negação, raiva, orgulho excessivo)
  - Contradição entre relatos do mesmo locutor na mesma sessão
  - Criança recusou, desviou ou não respondeu pergunta direta
  - Responsável minimizou ou exagerou relato de forma perceptível
  - Fala com carga diagnóstica que parafraseada perderia o sentido clínico
  Formato: transcrição LITERAL, sem paráfrase, sem normalização.
  Se não houver, use [].

Retorne APENAS o JSON válido, sem markdown, sem texto adicional.`;

  const userMessage = `${contexto ? `Contexto da sessão: ${contexto}\n\n` : ''}Transcrição para processar:\n\n${transcricaoBruta}`;

  try {
    const res = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: MODEL_HAIKU,
        max_tokens: 8000,
        system: systemPrompt,
        messages: [{ role: 'user', content: userMessage }]
      })
    });

    if (!res.ok) {
      console.warn('[Compressor] Erro na API Claude — fallback para transcrição bruta');
      return { transcricaoRenomeada: transcricaoBruta, comprimido: null };
    }

    const data = await res.json();
    const rawText = data.content.filter(b => b.type === 'text').map(b => b.text).join('\n');

    const usage = data.usage || {};
    const cost = ((usage.input_tokens || 0) * 0.80 + (usage.output_tokens || 0) * 4.00) / 1_000_000;
    console.log(`[Compressor] Processado — $${cost.toFixed(4)} (in:${usage.input_tokens} out:${usage.output_tokens})`);

    let parsed = null;
    try {
      parsed = JSON.parse(rawText.trim());
    } catch {
      const match = rawText.match(/\{[\s\S]*\}/);
      if (match) { try { parsed = JSON.parse(match[0]); } catch { parsed = null; } }
    }

    if (!parsed || !parsed.transcricao_renomeada) {
      console.warn('[Compressor] JSON inválido — fallback para transcrição bruta');
      return { transcricaoRenomeada: transcricaoBruta, comprimido: null };
    }

    console.log('[Compressor] Compressão concluída com sucesso');
    return {
      transcricaoRenomeada: parsed.transcricao_renomeada,
      comprimido: {
        locutores_identificados: parsed.locutores_identificados || {},
        pontos_clinicos: parsed.pontos_clinicos || {},
        observacoes_comportamentais: parsed.observacoes_comportamentais || []
      }
    };

  } catch (err) {
    console.warn('[Compressor] Falha — fallback para transcrição bruta:', err.message);
    return { transcricaoRenomeada: transcricaoBruta, comprimido: null };
  }
}

// Transcrição principal com Chirp 2
async function transcribeAudio(filePath, mimeType, context = '') {
  const client = getSpeechClient();
  let gcsFileName = null;

  try {
    console.log('[Chirp2] Fazendo upload para GCS...');
    const { uri, gcsFileName: fileName } = await uploadToGCS(filePath, mimeType);
    gcsFileName = fileName;

    const recognizerName = `projects/${PROJECT_ID}/locations/${LOCATION}/recognizers/_`;

    const request = {
      recognizer: recognizerName,
      config: {
        model: 'chirp_2',
        languageCodes: ['pt-BR'],
        features: {
          enableAutomaticPunctuation: true,
          enableWordTimeOffsets: true,
          enableWordConfidence: true,
          diarizationConfig: {
            minSpeakerCount: 1,
            maxSpeakerCount: 4 // Até 4 locutores: Patrízia + até 3 responsáveis/criança
          }
        },
        adaptation: {
          phraseSets: [{
            inline: {
              phrases: CLINICAL_PHRASES.map(phrase => ({ value: phrase, boost: 15 }))
            }
          }]
        },
        autoDecodingConfig: {}
      },
      files: [{ uri }],
      recognitionOutputConfig: {
        inlineResponseConfig: {}
      }
    };

    console.log('[Chirp2] Iniciando BatchRecognize...');
    const [operation] = await client.batchRecognize(request);

    console.log('[Chirp2] Aguardando transcrição...');
    const [response] = await operation.promise();

    const fileResult = Object.values(response.results || {})[0];
    const results = fileResult?.transcript?.results || [];

    if (results.length === 0) {
      console.warn('[Chirp2] Nenhum resultado obtido');
      return '[Transcrição não disponível — áudio pode estar inaudível ou em formato não suportado]';
    }

    // Etapa 1: Formata transcrição com rótulos genéricos
    const transcricaoBruta = formatRawTranscription(results);
    console.log(`[Chirp2] Transcrição bruta: ${transcricaoBruta.length} chars`);

    // Etapa 2: Agente Compressor renomeia locutores + extrai representação clínica
    console.log('[Compressor] Processando transcrição...');
    const { transcricaoRenomeada, comprimido } = await comprimirTranscricao(transcricaoBruta, context);
    console.log(`[Compressor] Transcrição renomeada: ${transcricaoRenomeada.length} chars`);

    return { transcricao: transcricaoRenomeada, comprimido };

  } catch (err) {
    console.error('[Chirp2] Erro — tentando fallback v1:', err.message);
    return await transcribeAudioV1Fallback(filePath, mimeType, gcsFileName);

  } finally {
    if (gcsFileName) await deleteFromGCS(gcsFileName);
  }
}

// Fallback para v1 caso Chirp 2 falhe
async function transcribeAudioV1Fallback(filePath, mimeType, existingGcsFileName) {
  const { SpeechClient: SpeechClientV1 } = require('@google-cloud/speech');
  const client = new SpeechClientV1();
  let gcsFileName = existingGcsFileName;
  let uploadedHere = false;

  try {
    if (!gcsFileName) {
      const result = await uploadToGCS(filePath, mimeType);
      gcsFileName = result.gcsFileName;
      uploadedHere = true;
    }

    const [operation] = await client.longRunningRecognize({
      config: {
        encoding: 'WEBM_OPUS',
        languageCode: 'pt-BR',
        enableAutomaticPunctuation: true,
        model: 'latest_long',
        speechContexts: [{ phrases: CLINICAL_PHRASES, boost: 15 }],
        diarizationConfig: { enableSpeakerDiarization: true, minSpeakerCount: 1, maxSpeakerCount: 4 }
      },
      audio: { uri: `gs://${GCS_BUCKET}/${gcsFileName}` }
    });

    const [response] = await operation.promise();
    if (!response.results || response.results.length === 0) {
      return { transcricao: '[Transcrição não disponível]', comprimido: null };
    }

    const transcricaoBruta = response.results
      .map(r => r.alternatives?.[0]?.transcript || '')
      .filter(Boolean)
      .join('\n\n');

    const { transcricaoRenomeada, comprimido } = await comprimirTranscricao(transcricaoBruta);
    return { transcricao: transcricaoRenomeada, comprimido };

  } finally {
    if (uploadedHere && gcsFileName) await deleteFromGCS(gcsFileName);
  }
}

module.exports = { transcribeAudio };