// Agente Transcritor — Google Cloud Speech-to-Text v2 com Chirp 2
// + Agente Identificador de Locutores (Claude Haiku)
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

// Agente Identificador de Locutores — Claude Haiku
// Analisa o contexto da conversa e renomeia os locutores pelo papel real
async function identificarLocutores(transcricaoBruta, contexto = '') {
  if (!transcricaoBruta || !transcricaoBruta.includes('Locutor')) {
    return transcricaoBruta; // Sem diarização, retorna como está
  }

  const systemPrompt = `Você é um especialista em análise de transcrições de sessões clínicas neuropsicopedagógicas.

Sua tarefa é analisar uma transcrição com locutores identificados genericamente (Locutor 1, Locutor 2, etc.) e renomear cada locutor pelo seu papel real na sessão, baseando-se no conteúdo e contexto das falas.

Regras de identificação:
- **Neuropsicopedagoga (Patrízia):** faz perguntas técnicas e clínicas, conduz a sessão, usa terminologia profissional, pergunta sobre desenvolvimento, comportamento, escola, histórico
- **Responsável (mãe/pai/avó/etc):** relata histórico da criança, descreve comportamentos, responde perguntas sobre o cotidiano, usa linguagem coloquial, fala em primeira pessoa sobre a família
- **Segundo responsável:** quando há dois adultos responsáveis, o segundo geralmente complementa ou confirma falas do primeiro
- **Criança:** falas curtas, simples, às vezes monossilábicas, responde perguntas diretas
- **Outros (professor, médico, etc):** identifica pelo contexto se mencionado

Instruções:
1. Analise o padrão de falas de cada locutor numerado
2. Identifique o papel de cada um
3. Substitua "Locutor X" pelo papel identificado (ex: "Patrízia", "Mãe", "Pai", "Avó", "Responsável", "Criança")
4. Se não conseguir identificar com certeza, use "Responsável 1", "Responsável 2", etc.
5. Mantenha TODO o conteúdo original — não resuma, não omita, não corrija
6. Retorne APENAS a transcrição renomeada, sem explicações adicionais`;

  const userMessage = `${contexto ? `Contexto da sessão: ${contexto}\n\n` : ''}Transcrição para identificar locutores:\n\n${transcricaoBruta}`;

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
      console.warn('[Identificador] Erro na API Claude — mantendo rótulos genéricos');
      return transcricaoBruta;
    }

    const data = await res.json();
    const transcricaoIdentificada = data.content
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('\n');

    console.log('[Identificador] Locutores identificados com sucesso');
    return transcricaoIdentificada;

  } catch (err) {
    console.warn('[Identificador] Falha — mantendo rótulos genéricos:', err.message);
    return transcricaoBruta; // Fallback: retorna transcrição com rótulos genéricos
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

    // Etapa 2: Agente Identificador renomeia os locutores pelo papel real
    console.log('[Identificador] Identificando papéis dos locutores...');
    const transcricaoFinal = await identificarLocutores(transcricaoBruta, context);
    console.log(`[Identificador] Transcrição final: ${transcricaoFinal.length} chars`);

    return transcricaoFinal;

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
      return '[Transcrição não disponível]';
    }

    const transcricaoBruta = response.results
      .map(r => r.alternatives?.[0]?.transcript || '')
      .filter(Boolean)
      .join('\n\n');

    // Mesmo no fallback, tenta identificar os locutores
    return await identificarLocutores(transcricaoBruta);

  } finally {
    if (uploadedHere && gcsFileName) await deleteFromGCS(gcsFileName);
  }
}

module.exports = { transcribeAudio };