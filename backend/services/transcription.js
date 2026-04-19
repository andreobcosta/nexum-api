const speech = require('@google-cloud/speech');
const { Storage } = require('@google-cloud/storage');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

const GCS_BUCKET = 'nexum-audio-temp';

function getSpeechClient() { return new speech.SpeechClient(); }
function getStorageClient() { return new Storage(); }

function getAudioEncoding(mimeType) {
  const map = {
    'audio/webm': 'WEBM_OPUS', 'audio/webm;codecs=opus': 'WEBM_OPUS',
    'video/webm': 'WEBM_OPUS', 'audio/mp3': 'MP3', 'audio/mpeg': 'MP3',
    'audio/wav': 'LINEAR16', 'audio/x-wav': 'LINEAR16',
    'audio/flac': 'FLAC', 'audio/x-flac': 'FLAC',
    'audio/ogg': 'OGG_OPUS', 'audio/ogg;codecs=opus': 'OGG_OPUS', 'audio/aac': 'MP3',
  };
  return map[mimeType] || 'WEBM_OPUS';
}

async function uploadToGCS(filePath, mimeType) {
  const storage = getStorageClient();
  const bucket = storage.bucket(GCS_BUCKET);
  const gcsFileName = 'audio_' + uuidv4() + '_' + Date.now();
  await bucket.upload(filePath, { destination: gcsFileName, metadata: { contentType: mimeType } });
  console.log('[Transcritor] Upload GCS concluido:', gcsFileName);
  return { uri: 'gs://' + GCS_BUCKET + '/' + gcsFileName, gcsFileName };
}

async function deleteFromGCS(gcsFileName) {
  try {
    await getStorageClient().bucket(GCS_BUCKET).file(gcsFileName).delete();
    console.log('[Transcritor] Arquivo GCS removido:', gcsFileName);
  } catch (e) { console.warn('[Transcritor] Nao removeu arquivo GCS:', e.message); }
}

async function transcribeAudio(filePath, mimeType, context = '') {
  const client = getSpeechClient();
  const encoding = getAudioEncoding(mimeType);

  const config = {
    encoding,
    languageCode: 'pt-BR',
    enableAutomaticPunctuation: true,
    model: 'latest_long',
    speechContexts: [{
      phrases: [
        'neuropsicopedagogia', 'anamnese', 'TDAH', 'TEA', 'autismo',
        'dislexia', 'disgrafia', 'discalculia', 'TDE', 'ETDAH', 'CARS',
        'consciencia fonologica', 'lateralidade', 'funcoes executivas',
        'memoria de trabalho', 'controle inibitorio', 'grafomotricidade',
        'Patrizia', 'Santarem', 'Uberlandia'
      ],
      boost: 15
    }],
    diarizationConfig: { enableSpeakerDiarization: true, minSpeakerCount: 1, maxSpeakerCount: 3 }
  };

  let gcsFileName = null;
  try {
    console.log('[Transcritor] Fazendo upload para GCS...');
    const { uri, gcsFileName: fileName } = await uploadToGCS(filePath, mimeType);
    gcsFileName = fileName;

    console.log('[Transcritor] Iniciando longRunningRecognize...');
    const [operation] = await client.longRunningRecognize({ config, audio: { uri } });

    console.log('[Transcritor] Aguardando transcricao...');
    const [response] = await operation.promise();

    if (!response.results || response.results.length === 0) {
      return '[Transcricao nao disponivel — audio inaudivel ou formato nao suportado]';
    }

    const lines = [];
    for (const result of response.results) {
      const alt = result.alternatives[0];
      if (!alt) continue;
      if (alt.words && alt.words.length > 0 && alt.words[0].speakerTag > 0) {
        let words = [], speaker = null;
        for (const word of alt.words) {
          if (speaker === null) speaker = word.speakerTag;
          if (word.speakerTag !== speaker) {
            if (words.length > 0) lines.push('Locutor ' + speaker + ': ' + words.join(' '));
            words = [word.word]; speaker = word.speakerTag;
          } else { words.push(word.word); }
        }
        if (words.length > 0) lines.push('Locutor ' + speaker + ': ' + words.join(' '));
      } else {
        lines.push(alt.transcript);
      }
    }
    return lines.join('\n\n');
  } finally {
    if (gcsFileName) await deleteFromGCS(gcsFileName);
  }
}

module.exports = { transcribeAudio };