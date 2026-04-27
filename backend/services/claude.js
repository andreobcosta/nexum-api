const { getDb } = require('../db/firestore');

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const MODEL_SONNET = 'claude-sonnet-4-20250514';
const MODEL_HAIKU  = 'claude-haiku-4-5-20251001';

let _libraryCache = null;
let _libraryCacheTime = 0;
const LIBRARY_CACHE_TTL = 60 * 60 * 1000;

async function getInstrumentLibrary(db) {
  if (_libraryCache && (Date.now() - _libraryCacheTime) < LIBRARY_CACHE_TTL) {
    return _libraryCache;
  }
  const snap = await db.collection('instrument_library').get();
  const library = {};
  snap.forEach(doc => { library[doc.id] = doc.data(); });
  _libraryCache = library;
  _libraryCacheTime = Date.now();
  console.log('[InstrumentLibrary] Cache atualizado —', Object.keys(library).join(', '));
  return library;
}

const PRICING = {
  [MODEL_SONNET]: { input: 3.00, output: 15.00 },
  [MODEL_HAIKU]:  { input: 0.80, output: 4.00 }
};

function calcCost(model, inputTokens, outputTokens) {
  const p = PRICING[model] || PRICING[MODEL_SONNET];
  return {
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    cost_usd: parseFloat(((inputTokens * p.input + outputTokens * p.output) / 1_000_000).toFixed(6))
  };
}

async function callClaude(systemPrompt, userMessage, maxTokens = 16000, model = MODEL_SONNET, tentativa = 1) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120000);
  try {
    const res = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'prompt-caching-2024-07-31'
      },
      body: JSON.stringify({
        model, max_tokens: maxTokens,
        system: systemPrompt,
        messages: [{ role: 'user', content: userMessage }]
      })
    });
    if (res.status === 429 || res.status === 529) {
      if (tentativa >= 4) throw new Error('Rate limit após 4 tentativas');
      const delay = [0, 15000, 30000, 60000][tentativa];
      await new Promise(r => setTimeout(r, delay));
      return callClaude(systemPrompt, userMessage, maxTokens, model, tentativa + 1);
    }
    if (!res.ok) { const err = await res.text(); throw new Error('Claude API error ' + res.status + ': ' + err); }
    const data = await res.json();
    const text = data.content.filter(b => b.type === 'text').map(b => b.text).join('\n');
    const usage = data.usage || {};
    const cost = calcCost(model, usage.input_tokens || 0, usage.output_tokens || 0);
    return { text, cost };
  } finally {
    clearTimeout(timer);
  }
}

// Monta pacote de dados já processado (transcrições + textos extraídos de PDFs)
// para envio ao Agente Analítico
function buildAnalyticsInput(patientInfo, processedData) {
  const sections = [];
  const filesRead = [];
  const filesEmpty = [];

  for (const [folderName, files] of Object.entries(processedData)) {
    if (!files || files.length === 0) continue;
    sections.push('\n## Pasta: ' + folderName);

    for (const file of files) {
      // Prioridade: transcription (áudio) > content (PDF/imagem extraída) > vazio
      const textContent = file.transcription || file.content;

      if (textContent && String(textContent).trim()) {
        sections.push('\n### Arquivo: ' + file.name);

        // Identifica se é transcrição de áudio para contextualizar o Analítico
        if (file.transcription) {
          sections.push('[TRANSCRIÇÃO DE ÁUDIO — linguagem coloquial, normalizar para técnico clínico]');
        }
        sections.push(String(textContent));
        filesRead.push(file.name + ' (' + (file.transcription ? 'transcrição' : file.type) + ')');
      } else {
        // Arquivo sem conteúdo — não inclui no contexto mas registra
        filesEmpty.push(file.name + ' (sem conteúdo — fonte: ' + (file.source || 'desconhecida') + ')');
        console.log('[Analítico] Arquivo sem conteúdo ignorado:', file.name, '— fonte:', file.source);
      }
    }
  }

  if (filesEmpty.length > 0) {
    sections.push('\n## Arquivos não processados (sem conteúdo legível):');
    sections.push(filesEmpty.map(f => '- ' + f).join('\n'));
    console.log('[Analítico] Total sem conteúdo:', filesEmpty.length, '—', filesEmpty.join(', '));
  }

  const cadastro = [
    '## Dados cadastrais do paciente:',
    '- Nome completo: ' + patientInfo.full_name,
    '- Data de nascimento: ' + (patientInfo.birth_date || '[NÃO INFORMADO]'),
    '- Idade: ' + (patientInfo.age || '[NÃO INFORMADO]') + ' anos',
    '- Escolaridade: ' + (patientInfo.grade || '[NÃO INFORMADO]'),
    '- Dominância manual: ' + (patientInfo.handedness || '[NÃO INFORMADO]'),
    '- Medicamentos em uso: ' + (patientInfo.medications || 'Nenhum informado'),
    '- Responsáveis: ' + (patientInfo.guardians || '[NÃO INFORMADO]'),
    '- Data da avaliação: ' + new Date().toLocaleDateString('pt-BR'),
    '- Local: Uberlândia-MG'
  ].join('\n');

  return { cadastro, sections: sections.join('\n'), filesRead };
}

// ── AGENTE ANALÍTICO — Sonnet com contexto clínico completo
// Responsabilidade: interpretar instrumentos, cruzar fontes, produzir dossiê robusto
async function agentAnalytico(patientInfo, processedData, onProgress) {
  onProgress?.('analitico', 'Agente Analítico iniciado — analisando documentos clínicos...');

  const { cadastro, sections, filesRead } = buildAnalyticsInput(patientInfo, processedData);

  const systemPrompt = `Você é o Agente Analítico do sistema Nexum, especialista em neuropsicopedagogia clínica com domínio completo de:

- DSM-5 e CID-11 (critérios diagnósticos de TDAH, TEA, transtornos de aprendizagem)
- ETDAH: escala de escores INVERTIDOS — "Superior" indica MAIOR comprometimento. Fatores: RE (Regulação Emocional), HI (Hiperatividade/Impulsividade), CA (Comportamento Adaptativo), A (Atenção). Percentis: ≤24=Inferior, 25-74=Médio, 75-94=Superior, ≥95=Muito Superior
- CARS: sem autismo <30 / leve-moderado 30-36,5 / grave ≥37. Pontuações 27-30 exigem cautela — TDAH pode inflar o escore
- TDE-2: analisa Leitura (tempo + acertos), Escrita (tipos de erro: CFG, RC, IL, ENP) e Aritmética (estratégias: D=dedos, M=mental, RV=representação visual). Classificação por ano escolar
- Consciência Fonológica: 8 níveis (A=Rimas até H=Inversão Silábica). Níveis G e H dependem de funções executivas — dificuldade nesses níveis em TDAH não indica déficit fonológico primário
- Lateralidade: homogênea (típico), cruzada (risco visoespacial), mista/indefinida (imaturidade neurológica)
- Funções executivas: controle inibitório, memória de trabalho, flexibilidade cognitiva, planejamento, monitoramento

Sua função é analisar TODOS os documentos do paciente e produzir um dossiê analítico estruturado em JSON.

REGRA CRÍTICA — EXTRAÇÃO ATIVA: Busque ATIVAMENTE dados cadastrais ausentes (escolaridade, dominância, responsáveis, medicamentos, queixa principal) em TODOS os documentos — transcrições de áudio, relatórios externos, protocolos de testes e imagens. Exemplos:
- Mãe menciona "ela está no 4º ano" → registre "4º ano EF" em escolaridade
- Protocolo de teste mostra nome do responsável → use em responsáveis
- Qualquer documento menciona uso de medicamento → registre em medicamentos
NUNCA marque como [DADO NÃO FORNECIDO] se a informação aparecer em QUALQUER documento fornecido.
ATENÇÃO: Se não houver transcrição de áudio (anamnese), isso significa que a anamnese ainda não foi realizada ou transcrita — sinalize claramente como lacuna clínica, não como falha técnica.

Regras:
1. Extraia TODOS os dados quantitativos (pontuações, percentis, classificações) com precisão
2. Normalize linguagem coloquial das transcrições para termos técnicos — transcrições marcadas com [TRANSCRIÇÃO DE ÁUDIO] chegam em linguagem coloquial
3. Separe fato de opinião — relatos dos pais devem ser identificados como tal
4. Detecte inconsistências entre fontes e registre ambas as perspectivas
5. Identifique hipóteses sustentadas pelos dados E hipóteses descartadas com argumentação
6. Mapeie potencialidades e fatores protetivos — nunca foque só em dificuldades
7. Sinalize lacunas com [DADO NÃO FORNECIDO] APENAS se a informação realmente não constar em NENHUM documento
8. Se um valor de teste parecer fora do intervalo válido do instrumento, sinalize
9. Para cada pasta de documentos, identifique o contexto clínico (Anamnese, Testes, Sessões, Intervenções, Documentos externos) e interprete os dados nesse contexto

Responda APENAS com JSON válido, sem texto adicional:
{
  "dados_cadastrais": "resumo estruturado",
  "fontes_analisadas": ["lista com tipo de cada arquivo lido"],
  "dados_quantitativos": {
    "instrumento": {
      "respondente": "",
      "fatores": {"fator": {"bruto": 0, "percentil": 0, "classificacao": ""}},
      "conclusao": ""
    }
  },
  "anamnese_estruturada": {
    "gestacional_nascimento": "",
    "desenvolvimento_neuropsicomotor": "",
    "aspectos_sensoriais": "",
    "rotina": "",
    "historico_escolar": "",
    "comportamento_atual": "",
    "historico_familiar": "",
    "saude_geral": "",
    "expectativas_familia": ""
  },
  "padroes_comportamentais": {
    "atencao": "",
    "hiperatividade_impulsividade": "",
    "regulacao_emocional": "",
    "aprendizagem": "",
    "social": "",
    "sensorial": ""
  },
  "inconsistencias": ["divergência entre fontes com análise"],
  "hipoteses_sustentadas": [{"hipotese": "", "evidencias": []}],
  "hipoteses_descartadas": [{"hipotese": "", "argumentacao": ""}],
  "pontos_fortes": ["fatores protetivos identificados"],
  "lacunas": ["dados ausentes ou sinalizados"],
  "orientacao_para_redator": "síntese narrativa detalhada orientando tom, foco e ênfases do relatório"
}`;

  const userMessage = cadastro + '\n\n## Documentos para análise:\n' + sections +
    '\n\n---\nArquivos lidos: ' + filesRead.join(', ') +
    '\n\nAnalise todos os documentos acima e produza o dossiê analítico completo em JSON.';

  onProgress?.('analitico', 'Agente Analítico interpretando instrumentos e cruzando fontes...');

  // Sonnet para análise clínica — precisão é crítica aqui
  const { text: raw, cost } = await callClaude(systemPrompt, userMessage, 8000, MODEL_SONNET);

  let dossie;
  try {
    const clean = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    dossie = JSON.parse(clean);
  } catch (e) {
    console.warn('[Analítico] JSON inválido — usando raw analysis');
    dossie = { raw_analysis: raw, parse_error: true };
  }

  // Log de diagnóstico do dossiê
  if (dossie.lacunas && dossie.lacunas.length > 0) {
    console.log('[Analítico] Lacunas identificadas:', dossie.lacunas.join(' | '));
  }
  if (dossie.dados_cadastrais) {
    console.log('[Analítico] Dados cadastrais:', JSON.stringify(dossie.dados_cadastrais).substring(0, 200));
  }
  onProgress?.('analitico', 'Dossiê analítico concluído ✓');
  return { dossie, cost };
}

// ── AGENTE REDATOR — Sonnet com foco em estrutura e estilo
// Responsabilidade: redigir bem as 12 seções com base no dossiê já analisado
async function agentRedator(systemPromptRAN, patientInfo, dossie, onProgress) {
  onProgress?.('redator', 'Agente Redator iniciado — estruturando as 12 seções...');

  const dossieStr = dossie.parse_error
    ? dossie.raw_analysis
    : JSON.stringify(dossie, null, 2);

  const userMessage = [
    '# SOLICITAÇÃO DE REDAÇÃO DO RAN',
    '',
    '## Dados do paciente:',
    '- Nome: ' + patientInfo.full_name,
    '- Data de nascimento: ' + (patientInfo.birth_date || '[NÃO INFORMADO]'),
    '- Idade: ' + (patientInfo.age || '[NÃO INFORMADO]') + ' anos',
    '- Escolaridade: ' + (patientInfo.grade || '[NÃO INFORMADO]'),
    '- Dominância manual: ' + (patientInfo.handedness || '[NÃO INFORMADO]'),
    '- Medicamentos: ' + (patientInfo.medications || 'Nenhum informado'),
    '- Responsáveis: ' + (patientInfo.guardians || '[NÃO INFORMADO]'),
    '',
    '## Dossiê Analítico (produzido pelo Agente Analítico):',
    dossieStr,
    '',
    '---',
    'Com base no dossiê acima, redija o Relatório de Avaliação Neuropsicopedagógica (RAN) completo.',
    'Siga EXATAMENTE a estrutura de 12 seções definida neste system prompt.',
    'Use o primeiro nome da criança ao longo do texto.',
    'Data: ' + new Date().toLocaleDateString('pt-BR') + '. Local: Uberlândia-MG.',
    'Para dados ausentes: [DADO NÃO FORNECIDO — verificar com Patrízia]'
  ].join('\n');

  onProgress?.('redator', 'Agente Redator redigindo relatório...');

  const { text: relatorio, cost } = await callClaude(
    [{ type: 'text', text: systemPromptRAN, cache_control: { type: 'ephemeral' } }],
    userMessage, 16000, MODEL_SONNET
  );

  onProgress?.('redator', 'Relatório redigido ✓');
  return { relatorio, cost };
}

// ── AGENTE REVISOR — Sonnet com RAN COMPLETO + validações clínicas da instrument_library
// Responsabilidade: validar estrutura, coerência, completude e conformidade clínica
async function agentRevisor(relatorio, dossie, patientInfo, onProgress) {
  onProgress?.('revisor', 'Agente Revisor validando relatório completo...');

  const library = await getInstrumentLibrary(getDb());
  const libraryStr = JSON.stringify(library, null, 2);

  const systemPrompt = `Você é o Agente Revisor de relatórios neuropsicopedagógicos do sistema Nexum.

CRÍTICO: Responda EXCLUSIVAMENTE com JSON válido. Nenhum texto antes ou depois. Nenhum bloco markdown. Apenas o objeto JSON puro começando com { e terminando com }.

Valide o RAN e produza este JSON:
{
  "aprovado": true,
  "score_qualidade": 0,
  "secoes_presentes": [],
  "secoes_ausentes": [],
  "problemas_criticos": [],
  "alertas": [],
  "sugestoes": []
}

## VALIDAÇÕES OBRIGATÓRIAS DE INSTRUMENTOS

Para cada validação com "acao":"score_zero" abaixo: se a violação for detectada no RAN,
retorne IMEDIATAMENTE score_qualidade:0 e aprovado:false, registrando o id e a mensagem
em problemas_criticos. Não continue pontuando — score zero é definitivo.

Para validações com "acao":"penalizar": subtraia 10 pontos do score final e registre em alertas.

Biblioteca de instrumentos (fonte de verdade para todas as validações):
${libraryStr}

## CRITÉRIOS DE PONTUAÇÃO (score 0-100, aplicar apenas se nenhum score_zero disparou):
- Todas as 12 seções presentes: +40 pontos
- Dados quantitativos dos instrumentos presentes: +20 pontos
- Cruzamento entre instrumentos e anamnese: +15 pontos
- Equilíbrio entre prejuízos e potencialidades: +10 pontos
- Orientações específicas ao perfil: +10 pontos
- Tom formal-técnico acessível: +5 pontos

Seções obrigatórias: Cabeçalho, Queixa Principal, Anamnese, Resumo Escolar, Visita Escolar, Avaliação Neuropsicopedagógica, Análise dos Instrumentos, Conclusão Integrada, Quadro Síntese, Orientações, Encaminhamentos, Considerações Finais.

aprovado=true se score >= 20. Responda APENAS com JSON válido.`;

  // Envia RAN COMPLETO + dossiê resumido — sem truncamento do RAN
  const dossieResumo = dossie && !dossie.parse_error
    ? JSON.stringify(dossie, null, 2).substring(0, 2000)
    : '[dossiê não disponível]';
  const userMessage = 'Dossiê do Analítico (resumo):\n' + dossieResumo +
    '\n\nRAN gerado:\n' + relatorio;

  // Sonnet para validação clínica — Haiku perde atenção em RANs longos (bug B3)
  const { text: raw, cost } = await callClaude(systemPrompt, userMessage, 4000, MODEL_SONNET);

  let revisao;
  try {
    const clean = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    revisao = JSON.parse(clean);
    console.log("[REVISOR] JSON completo: " + JSON.stringify(revisao));
  } catch (e) {
    revisao = {
      aprovado: false,
      score_qualidade: 0,
      problemas_criticos: ['parse_error — JSON da revisão inválido'],
      alertas: ['Revisão automática não parseada — verificar manualmente'],
      secoes_ausentes: []
    };
  }

  onProgress?.('revisor', 'Score: ' + revisao.score_qualidade + '/100 ✓');
  return { revisao, cost };
}

// ── AGENTE DIFF — Haiku
async function agentDiff(ranExistente, novosDocumentos, patientInfo, onProgress) {
  onProgress?.('diff', 'Agente Diff analisando novidades...');

  const systemPrompt = `Você é o Agente Diff do sistema Nexum. Compare o RAN existente com novos documentos e identifique o que mudou.

Produza APENAS um JSON:
{
  "novos_dados": {"descricao": "resumo do que é novo", "por_categoria": {}},
  "secoes_afetadas": ["seções que precisam ser atualizadas"],
  "secoes_mantidas": ["seções que podem ser mantidas"],
  "instrucoes_atualizacao": "instruções específicas para o Redator"
}
Responda APENAS com JSON válido.`;

  const userMessage = 'Paciente: ' + patientInfo.full_name +
    '\n\nRAN EXISTENTE:\n' + ranExistente.substring(0, 8000) +
    '\n\nNOVOS DOCUMENTOS:\n' + novosDocumentos;

  const { text: raw, cost } = await callClaude(systemPrompt, userMessage, 4000, MODEL_HAIKU);

  let diff;
  try {
    const clean = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    diff = JSON.parse(clean);
  } catch (e) {
    diff = {
      novos_dados: { descricao: raw },
      secoes_afetadas: ['Todas'],
      secoes_mantidas: [],
      instrucoes_atualizacao: raw
    };
  }

  onProgress?.('diff', (diff.secoes_afetadas?.length || 0) + ' seções a atualizar');
  return { diff, cost };
}

// ── PIPELINE PRINCIPAL — Analítico → Redator → Revisor
async function generateRAN(systemPromptRAN, patientInfo, rawCollectedData, onProgress) {
  const { processDataPackage } = require('./pdf-extractor');
  const startTime = Date.now();
  const log = (agent, msg) => {
    console.log('[' + agent.toUpperCase() + '] ' + msg);
    onProgress?.(agent, msg);
  };

  log('pipeline', 'Iniciando pipeline RAN para ' + patientInfo.full_name);

  // Pré-processamento: extrai texto de PDFs e organiza dados
  log('pipeline', 'Pré-processando documentos (PDFs, transcrições, textos)...');
  const { processed: processedData, meta: extractionMeta } = await processDataPackage(rawCollectedData);

  log('pipeline', `Arquivos processados: ${extractionMeta.files_processed} | Ignorados: ${extractionMeta.files_skipped}`);
  extractionMeta.log.forEach(entry => console.log('[PRÉ-PROCESSADOR] ' + entry));

  // Aguarda 20s após extração para garantir que o rate limit/min foi resetado
  if (extractionMeta.files_processed > 0) {
    log('pipeline', 'Aguardando janela de rate limit antes do Analítico (20s)...');
    await new Promise(r => setTimeout(r, 20000));
  }

  // Etapa 1: Análise clínica profunda
  log('pipeline', 'Etapa 1/3 — Agente Analítico (Sonnet)');
  const { dossie, cost: costAnalitico } = await agentAnalytico(patientInfo, processedData, log);

  // Etapa 2: Redação das 12 seções
  log('pipeline', 'Etapa 2/3 — Agente Redator (Sonnet)');
  const { relatorio, cost: costRedator } = await agentRedator(systemPromptRAN, patientInfo, dossie, log);

  // Etapa 3: Revisão completa
  log('pipeline', 'Etapa 3/3 — Agente Revisor (Haiku)');
  const { revisao, cost: costRevisor } = await agentRevisor(relatorio, dossie, patientInfo, log);

  const elapsed = Math.round((Date.now() - startTime) / 1000);
  const totalCost = parseFloat((
    extractionMeta.extraction_cost_usd +
    costAnalitico.cost_usd +
    costRedator.cost_usd +
    costRevisor.cost_usd
  ).toFixed(6));

  const custos = {
    pre_processamento: { cost_usd: extractionMeta.extraction_cost_usd },
    analitico: costAnalitico,
    redator: costRedator,
    revisor: costRevisor,
    total_usd: totalCost
  };

  log('pipeline', `Concluído em ${elapsed}s — Score: ${revisao.score_qualidade}/100 — Custo: $${totalCost} USD`);
  log('pipeline', `Arquivos processados: ${extractionMeta.log.join(' | ')}`);

  return {
    relatorio,
    dossie,
    revisao: {
      aprovado: revisao.aprovado,
      score_qualidade: revisao.score_qualidade,
      problemas_criticos: revisao.problemas_criticos || [],
      alertas: revisao.alertas || [],
      sugestoes: revisao.sugestoes || [],
      secoes_ausentes: revisao.secoes_ausentes || []
    },
    custos,
    extraction_meta: extractionMeta,
    elapsed_seconds: elapsed
  };
}

// ── PIPELINE DE ATUALIZAÇÃO — Diff → Redator → Revisor
async function updateRAN(systemPromptRAN, patientInfo, ranExistente, rawNovosDocumentos, onProgress) {
  const { processDataPackage } = require('./pdf-extractor');
  const startTime = Date.now();
  const log = (agent, msg) => {
    console.log('[' + agent.toUpperCase() + '] ' + msg);
    onProgress?.(agent, msg);
  };

  log('pipeline', 'Iniciando ATUALIZAÇÃO RAN para ' + patientInfo.full_name);

  // Pré-processa novos documentos
  const { processed: processedNovos, meta: extractionMeta } = await processDataPackage(rawNovosDocumentos);

  // Monta string de novos documentos processados
  const novosSections = [];
  for (const [folderName, files] of Object.entries(processedNovos)) {
    for (const file of files) {
      novosSections.push('\n### [NOVO] ' + file.name + ' (' + folderName + ')');
      novosSections.push(file.content || '[Sem conteúdo]');
    }
  }
  const novosDocumentosStr = novosSections.join('\n');

  // Diff
  const { diff, cost: costDiff } = await agentDiff(ranExistente, novosDocumentosStr, patientInfo, log);

  // Redator com novos dados
  onProgress?.('redator', 'Integrando novos dados ao RAN...');
  const userMessage = [
    '# ATUALIZAÇÃO DO RAN EXISTENTE',
    '',
    '## Paciente: ' + patientInfo.full_name,
    '',
    '## RAN ATUAL (manter seções não afetadas):',
    ranExistente,
    '',
    '## Análise do Agente Diff:',
    JSON.stringify(diff, null, 2),
    '',
    '## Novos documentos processados:',
    novosDocumentosStr,
    '',
    '---',
    'Atualize o RAN integrando os novos dados. Mantenha o conteúdo já revisado das seções não afetadas.',
    'Data: ' + new Date().toLocaleDateString('pt-BR') + '. Local: Uberlândia-MG.'
  ].join('\n');

  const { text: relatorioAtualizado, cost: costRedator } = await callClaude(systemPromptRAN, userMessage, 16000, MODEL_SONNET);
  onProgress?.('redator', 'RAN atualizado ✓');

  const { revisao, cost: costRevisor } = await agentRevisor(relatorioAtualizado, { parse_error: true }, patientInfo, log);

  const elapsed = Math.round((Date.now() - startTime) / 1000);
  const totalCost = parseFloat((
    extractionMeta.extraction_cost_usd +
    costDiff.cost_usd +
    costRedator.cost_usd +
    costRevisor.cost_usd
  ).toFixed(6));

  log('pipeline', `Atualização concluída em ${elapsed}s — Score: ${revisao.score_qualidade}/100 — Custo: $${totalCost} USD`);

  return {
    relatorio: relatorioAtualizado,
    diff,
    revisao: {
      aprovado: revisao.aprovado,
      score_qualidade: revisao.score_qualidade,
      problemas_criticos: revisao.problemas_criticos || [],
      alertas: revisao.alertas || [],
      sugestoes: revisao.sugestoes || [],
      secoes_ausentes: revisao.secoes_ausentes || []
    },
    custos: { diff: costDiff, redator: costRedator, revisor: costRevisor, total_usd: totalCost },
    elapsed_seconds: elapsed
  };
}

module.exports = {
  callClaude: async (sp, um, mt, m) => (await callClaude(sp, um, mt, m)).text,
  generateRAN,
  updateRAN
};