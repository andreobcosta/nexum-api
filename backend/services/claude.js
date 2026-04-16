require('dotenv').config();

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-sonnet-4-20250514';

async function callClaude(systemPrompt, userMessage, maxTokens = 16000) {
  const res = await fetch(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }]
    })
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Claude API error ${res.status}: ${err}`);
  }

  const data = await res.json();
  return data.content
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('\n');
}

// Transcribe audio using Claude (send as base64)
async function transcribeAudio(audioBase64, mimeType, context = '') {
  const systemPrompt = `Você é um transcritor profissional de áudio clínico. Transcreva o áudio fornecido de forma fiel, mantendo toda a informação factual. Organize o texto em parágrafos. Se houver informações clínicas (nomes de medicamentos, diagnósticos, datas, nomes), transcreva com precisão. Não adicione informações que não estão no áudio.`;

  const userContent = [
    {
      type: 'document',
      source: {
        type: 'base64',
        media_type: mimeType,
        data: audioBase64
      }
    },
    {
      type: 'text',
      text: context
        ? `Transcreva este áudio. Contexto: ${context}`
        : 'Transcreva este áudio fielmente.'
    }
  ];

  const res = await fetch(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 8000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userContent }]
    })
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Transcription error ${res.status}: ${err}`);
  }

  const data = await res.json();
  return data.content
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('\n');
}

// Generate RAN report from collected patient data
async function generateRAN(systemPrompt, patientInfo, collectedData) {
  const dataSections = [];

  for (const [folderName, files] of Object.entries(collectedData)) {
    dataSections.push(`\n## Pasta: ${folderName}`);
    for (const file of files) {
      dataSections.push(`\n### Arquivo: ${file.name} (${file.type})`);
      if (file.type.includes('text') || file.type.includes('markdown')) {
        dataSections.push(Buffer.from(file.content, 'base64').toString('utf-8'));
      } else {
        dataSections.push(`[Arquivo binário: ${file.name} — ${Math.round(file.size / 1024)}KB]`);
      }
    }
  }

  const userMessage = `
# DADOS DO PACIENTE PARA GERAÇÃO DO RELATÓRIO RAN

## Informações cadastrais:
- Nome: ${patientInfo.full_name}
- Data de nascimento: ${patientInfo.birth_date || '[NÃO INFORMADO]'}
- Idade: ${patientInfo.age || '[NÃO INFORMADO]'}
- Escolaridade: ${patientInfo.grade || '[NÃO INFORMADO]'}
- Dominância manual: ${patientInfo.handedness || '[NÃO INFORMADO]'}
- Medicamentos: ${patientInfo.medications || '[NÃO INFORMADO]'}
- Responsáveis: ${patientInfo.guardians || '[NÃO INFORMADO]'}

## Materiais coletados:
${dataSections.join('\n')}

---
Gere o relatório RAN completo seguindo a estrutura de 12 seções.
A data de hoje é ${new Date().toLocaleDateString('pt-BR')}.
Local: Uberlândia-MG.
`;

  return await callClaude(systemPrompt, userMessage, 16000);
}

module.exports = {
  callClaude,
  transcribeAudio,
  generateRAN
};
