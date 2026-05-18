// Serviço de extração de texto de PDFs via Claude vision
// Usado pelo pipeline de geração de RAN para tornar PDFs legíveis ao Analítico

const mammoth = require('mammoth');
const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const MODEL_SONNET = 'claude-sonnet-4-20250514';

// Tipos de arquivo que podem ser lidos como texto diretamente
const TEXT_MIME_TYPES = [
  'text/plain', 'text/markdown', 'text/csv',
  'application/json', 'text/html'
];

// Tipos de arquivo que precisam de extração via vision
const PDF_MIME_TYPES = [
  'application/pdf',
  'document',                  // tipo retornado pelo Google Drive para alguns PDFs
  'application/octet-stream'   // binário genérico — tenta como PDF
];

// Tipos de imagem que precisam de extração via vision
const IMAGE_MIME_TYPES = [
  'image/jpeg', 'image/jpg', 'image/png',
  'image/webp', 'image/gif'
];

// Verifica se o arquivo precisa de extração via vision
function needsVisionExtraction(mimeType) {
  if (mimeType === 'image' || mimeType?.startsWith('image/')) return true;
  return PDF_MIME_TYPES.includes(mimeType) || IMAGE_MIME_TYPES.includes(mimeType);
}

// Verifica se o arquivo é texto legível diretamente
function isTextReadable(mimeType) {
  return TEXT_MIME_TYPES.some(t => mimeType?.includes(t.split('/')[1]));
}

// Detecta o instrumento pelo nome do arquivo (case-insensitive)
function detectarInstrumento(nomeArquivo) {
  if (!nomeArquivo) return null;
  const nome = nomeArquivo.toLowerCase();
  if (nome.includes('etdah')) return 'ETDAH';
  if (nome.includes('asrs')) return 'ASRS';
  if (nome.includes('cars')) return 'CARS';
  if (nome.includes('tde')) return 'TDE';
  if (nome.includes('lateralidade')) return 'LATERALIDADE';
  if (nome.includes('fonologica') || nome.includes('fonológica')) return 'FONOLOGICA';
  if (nome.includes('hanoi') || nome.includes('hanói') || nome.includes('torre')) return 'TORRE_HANOI';
  return null;
}

// Retorna prompt específico por tipo de instrumento
function promptPorInstrumento(tipo) {
  const base = `Para campos manuscritos: transcreva o que conseguir ler, sinalize com [ILEGÍVEL] o que não conseguir.\nPreserve números, datas e valores exatamente como aparecem.\nNÃO interprete os dados — apenas extraia e organize. A interpretação é feita por outro agente.`;
  const prompts = {
    ETDAH:       `Você está extraindo um protocolo ETDAH (Escala de Transtorno de Déficit de Atenção e Hiperatividade).\nExtraia item a item, identificando qual opção foi marcada em cada item (nunca/raramente/às vezes/frequentemente/sempre ou equivalente).\nInclua obrigatoriamente: dados de identificação, todos os itens numerados com a opção marcada, subtotais por fator (RE/HI/CA/A), total geral, percentil e classificação.\n${base}`,
    ASRS:        `Você está extraindo um protocolo ASRS-18 (Adult ADHD Self-Report Scale) ou sua versão adaptada para avaliação de TDAH.\nExtraia cada um dos 18 itens com a opção marcada (Nunca/Raramente/Às vezes/Frequentemente/Muito frequentemente ou escala numérica equivalente).\nInclua obrigatoriamente: dados de identificação, todos os 18 itens numerados com a resposta marcada, subtotais por subescala (Parte A — itens 1-6, Parte B — itens 7-18 se aplicável), pontuação total e qualquer classificação ou resultado final registrado.\n${base}`,
    CARS:        `Você está extraindo um protocolo CARS (Childhood Autism Rating Scale).\nExtraia a pontuação marcada em cada um dos 15 domínios (valores possíveis: 1, 1.5, 2, 2.5, 3, 3.5 ou 4).\nInclua obrigatoriamente: pontuação de cada domínio com sua descrição, total geral e qualquer observação clínica registrada.\n${base}`,
    TDE:         `Você está extraindo um protocolo TDE-2 (Teste de Desempenho Escolar).\nExtraia: número de acertos por subteste (escrita, leitura, aritmética), tipos de erro identificados (CFG/RC/IL/ENP), estratégias usadas (D/M/RV/A) e classificação por nível escolar.\nInclua todos os itens respondidos com o resultado de cada um.\n${base}`,
    LATERALIDADE: `Você está extraindo um protocolo de Avaliação de Lateralidade.\nExtraia o resultado para cada sistema avaliado: manual (destro/sinistro/misto), podal, visual e auditivo.\nInclua todas as tarefas realizadas e o resultado individual de cada uma.\n${base}`,
    FONOLOGICA:  `Você está extraindo um protocolo de Avaliação de Consciência Fonológica.\nExtraia o desempenho por nível (A a H), incluindo número de acertos, erros e classificação em cada nível.\nPreserve todos os itens testados e as respostas registradas.\n${base}`,
    TORRE_HANOI: `Você está extraindo uma ficha da Torre de Hanói (pode ser Ficha de Aplicação, Ficha de Observação, ou ambas na mesma imagem).

ATENÇÃO CRÍTICA A NÚMEROS MANUSCRITOS: Este documento contém valores numéricos escritos à mão que são clinicamente essenciais e devem ser lidos com máxima precisão. Confusões comuns em escrita manual que você deve evitar:
- "3" pode se parecer com "8" — verifique com atenção a curvatura
- "5" pode se parecer com "6" ou "9"
- "1" pode se parecer com "7"
- "0" pode se parecer com "6"
Se houver qualquer dúvida sobre um dígito, sinalize: [VALOR DUVIDOSO — verificar documento original]

FICHA DE APLICAÇÃO — extraia obrigatoriamente:
1. Identificação: nome do avaliado, idade, data (formato DD/MM/AAAA), aplicador
2. Número de discos usados: verifique qual checkbox está marcado (□3 □4 □5 □6) — informe APENAS o número marcado, nunca assuma
3. Tentativas realizadas: transcreva exatamente o que está escrito (pode ser "não observado" ou um número)
4. Tempo total gasto: leia DÍGITO POR DÍGITO o campo "X min Y seg" — reporte como "X min Y seg". Não arredonde nem estime.
5. Número de movimentos realizados: leia o número exato escrito no campo
6. Número de movimentos mínimos esperados: leia o número exato escrito no campo
7. Erros cometidos: transcreva o texto manuscrito literal
8. Estratégia observada: identifique qual checkbox está marcado (Tentativa e erro / Planejamento antecipado / Mista / Abandono da tarefa)
9. Observações do aplicador: transcreva o texto manuscrito literal, item por item

FICHA DE OBSERVAÇÃO — extraia obrigatoriamente:
1. Identificação: nome do avaliado, idade, data, aplicador
2. Para cada categoria (Atenção e Concentração, Organização e Planejamento, Memória de Trabalho, Comportamento Emocional, Estratégias Utilizadas): liste TODOS os itens e indique quais estão marcados com [X] e quais estão em branco [ ]
3. Observações adicionais manuscritas: transcreva literalmente, mesmo que parcialmente ilegível
4. Anotações manuscritas ao lado dos itens (ex.: notas entre parênteses, comentários): inclua todas

${base}`
  };
  return prompts[tipo] || null;
}

// Extrai texto de PDF ou imagem via Claude vision
// content: buffer base64 do arquivo
// mimeType: tipo MIME do arquivo
// fileName: nome do arquivo (para contexto)
async function extractTextFromFile(contentBase64, mimeType, fileName = '') {
  const tipoInstrumento = detectarInstrumento(fileName);
  if (tipoInstrumento) console.log(`[PDF-Extractor] Instrumento detectado: ${tipoInstrumento} — usando prompt específico`);
  const PROMPT_GENERICO = `Você é um extrator especializado de documentos clínicos multiprofissionais (neuropsicopedagogia, fonoaudiologia, psicologia, terapia ocupacional, medicina e outras áreas da saúde).

ETAPA 1 — IDENTIFIQUE O DOCUMENTO
Analise visualmente o documento e declare no início da extração:
- Tipo: [protocolo de teste / ficha de observação / escala / laudo / relatório / parecer / outro]
- Instrumento/Escala: [nome completo e sigla, se identificável pelo conteúdo] ou [não identificado]
- Área profissional: [neuropsicopedagogia / fonoaudiologia / psicologia / medicina / terapia ocupacional / outro]
- Data: DD/MM/AAAA | Avaliado: [nome] | Aplicador: [nome]

ETAPA 2 — EXTRAIA COM ESTRUTURA PADRONIZADA

Use sempre estas seções na saída, adaptando ao conteúdo encontrado:

=== IDENTIFICAÇÃO ===
[dados da Etapa 1 e campos de identificação presentes no documento]

=== DADOS QUANTITATIVOS ===
Regras obrigatórias para TODOS os campos numéricos (pontuações, tempos, movimentos, percentis, idades, escores, etc.):
▸ Leia DÍGITO POR DÍGITO — nunca estime, arredonde ou interpole
▸ Reporte: [campo] = [valor exato lido]
▸ Se houver qualquer dúvida sobre um dígito: [campo] = [VALOR DUVIDOSO: poderia ser X ou Y — verificar original]
▸ Confusões frequentes em escrita manuscrita: "3"↔"8", "5"↔"6"↔"9", "1"↔"7", "0"↔"6", "4"↔"9"
▸ Nunca crie um valor "plausível" — se não conseguir ler com certeza, sinalize

=== CHECKBOXES / OPÇÕES MARCADAS ===
▸ Liste TODOS os itens/opções presentes e indique: [MARCADO] ou [não marcado]
▸ Descreva brevemente a marca visual observada (X, ✓, círculo preenchido, risco, asterisco)
▸ NUNCA assuma que um item está marcado sem evidência visual clara no documento

=== RESPOSTAS POR ITEM ===
Para escalas Likert, questões numeradas, protocolos item a item, inventários:
▸ Liste cada item numerado com sua resposta/opção marcada
▸ Se ilegível: [ILEGÍVEL]
▸ Se parcialmente legível: transcreva o que conseguiu ler e sinalize [parcialmente ilegível — verificar original]

=== RESULTADOS E PONTUAÇÕES ===
Totais, subtotais, percentis, classificações, escores calculados, conclusões quantitativas presentes no documento.

=== OBSERVAÇÕES E TEXTO LIVRE ===
Transcrição literal de campos abertos, comentários manuscritos, anotações do aplicador, observações clínicas.
NUNCA parafraseie ou normalize — transcreva exatamente o que está escrito, mesmo coloquial ou incompleto.

=== AMBIGUIDADES DETECTADAS ===
Lista de todos os campos onde houve dúvida na leitura:
▸ [campo]: lido como "[valor A]" — pode ser "[valor B]" — [descrição do que dificultou a leitura]

Se o documento estiver em branco ou sem conteúdo relevante: [DOCUMENTO SEM CONTEÚDO RELEVANTE]

NÃO interprete os dados — apenas extraia e organize. A interpretação é feita por outro agente.`;

  const systemPrompt = promptPorInstrumento(tipoInstrumento) || PROMPT_GENERICO;

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

  const instrumentoHint = tipoInstrumento
    ? `O nome do arquivo sugere que este é um documento do instrumento: ${tipoInstrumento}.`
    : 'Identifique o instrumento ou tipo de documento pelo conteúdo visual.';

  const userContent = [
    contentBlock,
    {
      type: 'text',
      text: `Extraia todo o conteúdo deste arquivo: "${fileName}".\n${instrumentoHint}\nSiga a estrutura padronizada de extração definida no system prompt.`
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

      const ilegCount = (text.match(/\[ILEGÍVEL\]/g) || []).length;
      const quality = text.length > 0 && (ilegCount * 10) / text.length > 0.2 ? 'baixa' : 'ok';

      console.log(`[PDF-Extractor] ${fileName} — ${text.length} chars extraídos — qualidade:${quality} — $${cost.toFixed(4)}`);
      return { text, cost, quality };

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
        // Caso 0: Conteúdo pré-extraído na avaliação de elegibilidade — reutiliza sem chamada de IA
        if (file.pre_extracted_content) {
          processed[folderName].push({
            name: file.name,
            type: 'pre_extraido',
            content: file.pre_extracted_content,
            source: 'pre_extracted'
          });
          log.push(`✓ ${file.name} — conteúdo pré-extraído reutilizado (${file.pre_extracted_content.length} chars)`);
          filesProcessed++;
          continue;
        }

        // Caso 1: Arquivo já tem transcrição (áudio transcrito)
        if (file.transcription) {
          // Defensive: extrai string se transcription foi salvo como objeto (bug B5 em files.js — fixed)
          const transcricaoStr = typeof file.transcription === 'object'
            ? (file.transcription.transcricao || '')
            : file.transcription;
          if (!transcricaoStr || !transcricaoStr.trim()) {
            log.push(`⚠ ${file.name} — transcrição corrompida (objeto sem texto útil)`);
            filesSkipped++;
            continue;
          }
          processed[folderName].push({
            name: file.name,
            type: 'transcricao_audio',
            content: transcricaoStr,
            source: 'firestore_transcription'
          });
          log.push(`✓ ${file.name} — transcrição de áudio (${transcricaoStr.length} chars)`);
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

        // Caso 3: DOCX — extrai via mammoth (sem custo de API)
        if (file.content && file.name?.toLowerCase().endsWith('.docx')) {
          const buffer = Buffer.from(file.content, 'base64');
          const result = await mammoth.extractRawText({ buffer });
          const text = result.value?.trim();
          if (text) {
            processed[folderName].push({
              name: file.name,
              type: 'docx_extraido',
              content: text,
              source: 'mammoth'
            });
            log.push(`✓ ${file.name} — DOCX extraído via mammoth (${text.length} chars)`);
            filesProcessed++;
          } else {
            log.push(`⚠ ${file.name} — DOCX sem conteúdo útil`);
            filesSkipped++;
          }
          continue;
        }

        // Caso 4: PDF ou imagem — extrai via Claude vision
        if (file.content && needsVisionExtraction(file.type)) {
          const mediaType = (file.type === 'image') ? 'image/jpeg' : file.type;
          console.log(`[PDF-Extractor] Extraindo: ${file.name} (${mediaType})`);
          // Delay entre extrações para respeitar rate limit da API
          await new Promise(r => setTimeout(r, 3000));
          const result = await extractTextFromFile(file.content, mediaType, file.name);

          if (result && result.text && result.text.trim()) {
            const entry = {
              name: file.name,
              type: 'pdf_extraido',
              content: result.text,
              source: 'vision_extraction'
            };
            if (result.quality === 'baixa') entry.quality = 'baixa';
            processed[folderName].push(entry);
            totalCost += result.cost;
            const qualityTag = result.quality === 'baixa' ? ' ⚠ qualidade:baixa' : '';
            log.push(`✓ ${file.name} — PDF/imagem extraído (${result.text.length} chars, $${result.cost.toFixed(4)})${qualityTag}`);
            filesProcessed++;
          } else {
            log.push(`⚠ ${file.name} — extração sem conteúdo útil`);
            filesSkipped++;
          }
          continue;
        }

        // Caso 5: Arquivo binário não suportado (webm sem transcrição, etc.)
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