// Serviço de extração de texto de PDFs via Claude vision
// Usado pelo pipeline de geração de RAN para tornar PDFs legíveis ao Analítico

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const MODEL_SONNET = 'claude-sonnet-4-20250514';

// Tipos de arquivo que podem ser lidos como texto diretamente
const TEXT_MIME_TYPES = [
  'text/plain', 'text/markdown', 'text/csv',
  'application/json', 'text/html'
];

// Tipos de arquivo que precisam de extração via vision
const PDF_MIME_TYPES = [
  'application/pdf'
];

// Tipos de imagem que precisam de extração via vision
const IMAGE_MIME_TYPES = [
  'image/jpeg', 'image/jpg', 'image/png',
  'image/webp', 'image/gif'
];

// Verifica se o arquivo precisa de extração via vision
function needsVisionExtraction(mimeType) {
  return PDF_MIME_TYPES.includes(mimeType) || IMAGE_MIME_TYPES.includes(mimeType);
}

// Verifica se o arquivo é texto legível diretamente
function isTextReadable(mimeType) {
  return TEXT_MIME_TYPES.some(t => mimeType?.includes(t.split('/')[1]));
}

// Extrai texto de PDF ou imagem via Claude vision
// content: buffer base64 do arquivo
// mimeType: tipo MIME do arquivo
// fileName: nome do arquivo (para contexto)
async function extractTextFromFile(contentBase64, mimeType, fileName = '') {
  const systemPrompt = `Você é um extrator especializado de dados clínicos de documentos neuropsicopedagógicos.

Sua função é extrair TODO o conteúdo relevante de PDFs e imagens de protocolos de avaliação, relatórios escolares, laudos médicos e outros documentos clínicos.

Regras de extração:
- Extraia TODO o texto visível, incluindo campos preenchidos, marcações, pontuações e observações manuscritas
- Para protocolos de testes (ETDAH, CARS, TDE-2, etc.): extraia TODOS os itens, respostas marcadas, pontuações brutas, percentis e classificações
- Para tabelas: reproduza a estrutura em formato de texto legível
- Para campos manuscritos: transcreva o que conseguir ler, sinalize com [ILEGÍVEL] o que não conseguir
- Para protocolos com escala Likert ou múltipla escolha: identifique qual opção foi marcada em cada item
- Preserve números, datas e valores exatamente como aparecem
- Se o documento estiver em branco ou vazio, informe: [DOCUMENTO SEM CONTEÚDO RELEVANTE]
- Organize o conteúdo de forma lógica, mantendo a hierarquia do documento original

NÃO interprete os dados — apenas extraia e organize. A interpretação é feita por outro agente.`;

  // Imagens usam tipo 'image', PDFs usam tipo 'document'
  const isImage = IMAGE_MIME_TYPES.includes(mimeType);
  const isPdf = PDF_MIME_TYPES.includes(mimeType);

  let contentBlock;
  if (isImage) {
    contentBlock = {
      type: 'image',
      source: {
        type: 'base64',
        media_type: mimeType,
        data: contentBase64
      }
    };
  } else if (isPdf) {
    contentBlock = {
      type: 'document',
      source: {
        type: 'base64',
        media_type: 'application/pdf',
        data: contentBase64
      }
    };
  } else {
    return null; // Tipo não suportado
  }

  const userContent = [
    contentBlock,
    {
      type: 'text',
      text: `Extraia todo o conteúdo relevante deste arquivo: "${fileName}". Organize o conteúdo de forma estruturada e legível.`
    }
  ];

  // Retry com backoff exponencial para rate limit
  const maxRetries = 3;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(ANTHROPIC_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: MODEL_SONNET,
          max_tokens: 4000,
          system: systemPrompt,
          messages: [{ role: 'user', content: userContent }]
        })
      });

      if (res.status === 429) {
        const waitMs = attempt * 15000; // 15s, 30s, 45s
        console.warn(`[PDF-Extractor] Rate limit — tentativa ${attempt}/${maxRetries} — aguardando ${waitMs/1000}s...`);
        await new Promise(r => setTimeout(r, waitMs));
        continue;
      }

      if (!res.ok) {
        const err = await res.text();
        console.error(`[PDF-Extractor] Erro na API: ${res.status} — ${err}`);
        return null;
      }

      const data = await res.json();
      const text = data.content
        .filter(b => b.type === 'text')
        .map(b => b.text)
        .join('\n');

      const usage = data.usage || {};
      const cost = ((usage.input_tokens || 0) * 3.00 + (usage.output_tokens || 0) * 15.00) / 1_000_000;

      console.log(`[PDF-Extractor] ${fileName} — ${text.length} chars extraídos — $${cost.toFixed(4)}`);
      return { text, cost };

    } catch (err) {
      console.error(`[PDF-Extractor] Erro ao extrair ${fileName} (tentativa ${attempt}):`, err.message);
      if (attempt === maxRetries) return null;
      await new Promise(r => setTimeout(r, 5000));
    }
  }
  return null;
}

// Processa um pacote de dados do paciente
// Extrai texto de PDFs e imagens, mantém transcrições de áudio
// Retorna pacote pronto para o Agente Analítico
async function processDataPackage(rawDataPackage) {
  const processed = {};
  let totalCost = 0;
  let filesProcessed = 0;
  let filesSkipped = 0;
  const log = [];

  for (const [folderName, files] of Object.entries(rawDataPackage)) {
    if (!files || files.length === 0) continue;
    processed[folderName] = [];

    for (const file of files) {
      try {
        // Caso 1: Arquivo já tem transcrição (áudio transcrito)
        if (file.transcription) {
          processed[folderName].push({
            name: file.name,
            type: 'transcricao_audio',
            content: file.transcription,
            source: 'firestore_transcription'
          });
          log.push(`✓ ${file.name} — transcrição de áudio (${file.transcription.length} chars)`);
          filesProcessed++;
          continue;
        }

        // Caso 2: Arquivo de texto legível diretamente
        if (file.type && isTextReadable(file.type)) {
          const text = file.content
            ? Buffer.from(file.content, 'base64').toString('utf-8')
            : '';
          if (text.trim()) {
            processed[folderName].push({
              name: file.name,
              type: 'texto',
              content: text,
              source: 'text_direct'
            });
            log.push(`✓ ${file.name} — texto direto (${text.length} chars)`);
            filesProcessed++;
          }
          continue;
        }

        // Caso 3: PDF ou imagem — extrai via Claude vision
        if (file.content && needsVisionExtraction(file.type)) {
          console.log(`[PDF-Extractor] Extraindo: ${file.name} (${file.type})`);
          // Delay entre extrações para respeitar rate limit da API
          await new Promise(r => setTimeout(r, 3000));
          const result = await extractTextFromFile(file.content, file.type, file.name);

          if (result && result.text && result.text.trim()) {
            processed[folderName].push({
              name: file.name,
              type: 'pdf_extraido',
              content: result.text,
              source: 'vision_extraction'
            });
            totalCost += result.cost;
            log.push(`✓ ${file.name} — PDF/imagem extraído (${result.text.length} chars, $${result.cost.toFixed(4)})`);
            filesProcessed++;
          } else {
            log.push(`⚠ ${file.name} — extração sem conteúdo útil`);
            filesSkipped++;
          }
          continue;
        }

        // Caso 4: Arquivo binário não suportado (webm sem transcrição, etc.)
        log.push(`✗ ${file.name} — formato não processável (${file.type || 'desconhecido'})`);
        filesSkipped++;

      } catch (err) {
        console.error(`[PDF-Extractor] Erro ao processar ${file.name}:`, err.message);
        log.push(`✗ ${file.name} — erro: ${err.message}`);
        filesSkipped++;
      }
    }
  }

  console.log(`[PDF-Extractor] Processamento concluído:`);
  console.log(`  Processados: ${filesProcessed} | Ignorados: ${filesSkipped} | Custo: $${totalCost.toFixed(4)}`);

  return {
    processed,
    meta: {
      files_processed: filesProcessed,
      files_skipped: filesSkipped,
      extraction_cost_usd: parseFloat(totalCost.toFixed(6)),
      log
    }
  };
}

module.exports = { processDataPackage, extractTextFromFile, needsVisionExtraction };