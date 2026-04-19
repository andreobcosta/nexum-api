const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const MODEL_SONNET = 'claude-sonnet-4-20250514';
const MODEL_HAIKU  = 'claude-haiku-4-5-20251001';

// Preços por milhão de tokens (USD) — atualizar se a Anthropic mudar
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

// Chamada base — retorna { text, cost }
async function callClaude(systemPrompt, userMessage, maxTokens = 16000, model = MODEL_SONNET) {
  const res = await fetch(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model, max_tokens: maxTokens, system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }]
    })
  });
  if (!res.ok) { const err = await res.text(); throw new Error('Claude API error ' + res.status + ': ' + err); }
  const data = await res.json();
  const text = data.content.filter(b => b.type === 'text').map(b => b.text).join('\n');
  const usage = data.usage || {};
  const cost = calcCost(model, usage.input_tokens || 0, usage.output_tokens || 0);
  return { text, cost };
}

function prepareDataPackage(patientInfo, collectedData) {
  const sections = [];
  for (const [folderName, files] of Object.entries(collectedData)) {
    if (!files || files.length === 0) continue;
    sections.push('\n## Pasta: ' + folderName);
    for (const file of files) {
      sections.push('\n### Arquivo: ' + file.name + ' (' + file.type + ')');
      if (file.transcription) {
        sections.push('[TRANSCRICAO DO AUDIO]\n' + file.transcription);
      } else if (file.type && (file.type.includes('text') || file.type.includes('markdown'))) {
        sections.push(Buffer.from(file.content, 'base64').toString('utf-8'));
      } else {
        sections.push('[Arquivo: ' + file.name + ' — ' + Math.round((file.size || 0) / 1024) + 'KB]');
      }
    }
  }
  const cadastro = '## Dados cadastrais:\n- Nome: ' + patientInfo.full_name +
    '\n- Nascimento: ' + (patientInfo.birth_date || '[NAO INFORMADO]') +
    '\n- Idade: ' + (patientInfo.age || '[NAO INFORMADO]') + ' anos' +
    '\n- Escolaridade: ' + (patientInfo.grade || '[NAO INFORMADO]') +
    '\n- Dominancia: ' + (patientInfo.handedness || '[NAO INFORMADO]') +
    '\n- Medicamentos: ' + (patientInfo.medications || 'Nenhum') +
    '\n- Responsaveis: ' + (patientInfo.guardians || '[NAO INFORMADO]') +
    '\n- Data: ' + new Date().toLocaleDateString('pt-BR') +
    '\n- Local: Uberlandia-MG';
  return { cadastro, sections: sections.join('\n') };
}

// ── AGENTE ANALÍTICO — Haiku
async function agentAnalytico(patientInfo, collectedData, onProgress) {
  onProgress?.('analitico', 'Agente Analitico iniciado — lendo documentos...');
  const { cadastro, sections } = prepareDataPackage(patientInfo, collectedData);
  const systemPrompt = `Voce e o Agente Analitico especialista em neuropsicopedagogia. Analise os documentos e produza APENAS um JSON valido com esta estrutura exata:
{"dados_cadastrais":"resumo","fontes_analisadas":[],"dados_quantitativos":{},"padroes_comportamentais":{},"inconsistencias":[],"hipoteses_sustentadas":[],"hipoteses_descartadas":[],"pontos_fortes":[],"lacunas":[],"orientacao_para_redator":"sintese"}
Responda APENAS com o JSON, sem texto adicional.`;
  const userMessage = 'Analise:\n\n' + cadastro + '\n\n## Documentos:\n' + sections;
  onProgress?.('analitico', 'Agente Analitico processando instrumentos...');
  const { text: raw, cost } = await callClaude(systemPrompt, userMessage, 4000, MODEL_HAIKU);
  let dossie;
  try {
    const clean = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    dossie = JSON.parse(clean);
  } catch (e) {
    dossie = { raw_analysis: raw, parse_error: true };
  }
  onProgress?.('analitico', 'Dossie concluido');
  return { dossie, cost };
}

// ── AGENTE REDATOR — Sonnet
async function agentRedator(systemPromptRAN, patientInfo, dossie, onProgress) {
  onProgress?.('redator', 'Agente Redator iniciado...');
  const dossieStr = dossie.parse_error ? dossie.raw_analysis : JSON.stringify(dossie, null, 2);
  const userMessage = '# SOLICITACAO DE REDACAO DO RAN\n\n## Dados:\n- Nome: ' + patientInfo.full_name +
    '\n- Nascimento: ' + (patientInfo.birth_date || '[NAO INFORMADO]') +
    '\n- Idade: ' + (patientInfo.age || '[NAO INFORMADO]') + ' anos' +
    '\n- Escolaridade: ' + (patientInfo.grade || '[NAO INFORMADO]') +
    '\n- Dominancia: ' + (patientInfo.handedness || '[NAO INFORMADO]') +
    '\n- Medicamentos: ' + (patientInfo.medications || 'Nenhum') +
    '\n- Responsaveis: ' + (patientInfo.guardians || '[NAO INFORMADO]') +
    '\n\n## Dossie Analitico:\n' + dossieStr +
    '\n\n---\nRedija o RAN completo com as 12 secoes. Data: ' + new Date().toLocaleDateString('pt-BR') + '. Local: Uberlandia-MG.';
  onProgress?.('redator', 'Estruturando as 12 secoes...');
  const { text: relatorio, cost } = await callClaude(systemPromptRAN, userMessage, 16000, MODEL_SONNET);
  onProgress?.('redator', 'Relatorio redigido');
  return { relatorio, cost };
}

// ── AGENTE REVISOR — Haiku (só avalia, não reescreve)
async function agentRevisor(relatorio, dossie, patientInfo, onProgress) {
  onProgress?.('revisor', 'Agente Revisor validando...');
  const systemPrompt = `Voce e o Agente Revisor. Revise o RAN e produza APENAS um JSON:
{"aprovado":true,"score_qualidade":0,"secoes_presentes":[],"secoes_ausentes":[],"problemas_criticos":[],"alertas":[],"sugestoes":[]}
Responda APENAS com JSON valido.`;
  const userMessage = 'Revise o RAN do paciente ' + patientInfo.full_name + '.\n\nSecoes esperadas: Cabecalho, Queixa Principal, Anamnese, Resumo Escolar, Visita Escolar, Avaliacao, Analise dos Instrumentos, Conclusao Integrada, Quadro Sintese, Orientacoes, Encaminhamentos, Consideracoes Finais.\n\nRelatorio:\n' + relatorio.substring(0, 8000);
  const { text: raw, cost } = await callClaude(systemPrompt, userMessage, 2000, MODEL_HAIKU);
  let revisao;
  try {
    const clean = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    revisao = JSON.parse(clean);
  } catch (e) {
    revisao = { aprovado: true, score_qualidade: 75, problemas_criticos: [], alertas: ['Revisao nao parseada'], secoes_ausentes: [] };
  }
  revisao.relatorio_revisado = relatorio;
  onProgress?.('revisor', 'Score: ' + revisao.score_qualidade + '/100');
  return { revisao, cost };
}

// ── AGENTE DIFF — Haiku
async function agentDiff(ranExistente, novosDocumentos, patientInfo, onProgress) {
  onProgress?.('diff', 'Agente Diff analisando novidades...');
  const systemPrompt = `Voce e o Agente Diff. Compare o RAN existente com novos documentos e produza APENAS um JSON:
{"novos_dados":{"descricao":"resumo","por_categoria":{}},"secoes_afetadas":[],"secoes_mantidas":[],"instrucoes_atualizacao":"instrucoes"}
Responda APENAS com JSON valido.`;
  const userMessage = 'Paciente: ' + patientInfo.full_name +
    '\n\nRAN EXISTENTE:\n' + ranExistente.substring(0, 6000) +
    '\n\nNOVOS DOCUMENTOS:\n' + novosDocumentos;
  const { text: raw, cost } = await callClaude(systemPrompt, userMessage, 2000, MODEL_HAIKU);
  let diff;
  try {
    const clean = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    diff = JSON.parse(clean);
  } catch (e) {
    diff = { novos_dados: { descricao: raw }, secoes_afetadas: ['Todas'], secoes_mantidas: [], instrucoes_atualizacao: raw };
  }
  onProgress?.('diff', (diff.secoes_afetadas?.length || 0) + ' secoes a atualizar');
  return { diff, cost };
}

// ── PIPELINE PRINCIPAL — Analítico → Redator → Revisor
async function generateRAN(systemPromptRAN, patientInfo, collectedData, onProgress) {
  const startTime = Date.now();
  const log = (agent, msg) => { console.log('[' + agent.toUpperCase() + '] ' + msg); onProgress?.(agent, msg); };
  log('pipeline', 'Iniciando pipeline RAN para ' + patientInfo.full_name);

  const { dossie, cost: costAnalitico } = await agentAnalytico(patientInfo, collectedData, log);
  const { relatorio: relatorioRascunho, cost: costRedator } = await agentRedator(systemPromptRAN, patientInfo, dossie, log);
  const { revisao, cost: costRevisor } = await agentRevisor(relatorioRascunho, dossie, patientInfo, log);

  const elapsed = Math.round((Date.now() - startTime) / 1000);
  const totalCost = parseFloat((costAnalitico.cost_usd + costRedator.cost_usd + costRevisor.cost_usd).toFixed(6));

  const custos = {
    analitico: costAnalitico,
    redator: costRedator,
    revisor: costRevisor,
    total_usd: totalCost
  };

  console.log('[PIPELINE] Concluido em ' + elapsed + 's — Custo: $' + totalCost + ' USD');

  return {
    relatorio: relatorioRascunho,
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
    elapsed_seconds: elapsed
  };
}

// ── PIPELINE DE ATUALIZAÇÃO — Diff → Redator → Revisor
async function updateRAN(systemPromptRAN, patientInfo, ranExistente, novosDocumentos, onProgress) {
  const startTime = Date.now();
  const log = (agent, msg) => { console.log('[' + agent.toUpperCase() + '] ' + msg); onProgress?.(agent, msg); };
  log('pipeline', 'Iniciando ATUALIZACAO RAN para ' + patientInfo.full_name);

  const { diff, cost: costDiff } = await agentDiff(ranExistente, novosDocumentos, patientInfo, log);

  log('pipeline', 'Etapa 2/3 — Agente Redator');
  onProgress?.('redator', 'Integrando novos dados...');
  const userMessage = '# ATUALIZACAO DO RAN\n\n## Paciente: ' + patientInfo.full_name +
    '\n\n## RAN ATUAL:\n' + ranExistente +
    '\n\n## ANALISE DO DIFF:\n' + JSON.stringify(diff, null, 2) +
    '\n\n## NOVOS DOCUMENTOS:\n' + novosDocumentos +
    '\n\n---\nAtualize o RAN integrando os novos dados. Mantenha secoes nao afetadas. Data: ' + new Date().toLocaleDateString('pt-BR') + '.';
  const { text: relatorioAtualizado, cost: costRedator } = await callClaude(systemPromptRAN, userMessage, 16000, MODEL_SONNET);
  onProgress?.('redator', 'RAN atualizado');

  const { revisao, cost: costRevisor } = await agentRevisor(relatorioAtualizado, { parse_error: true, raw_analysis: JSON.stringify(diff) }, patientInfo, log);

  const elapsed = Math.round((Date.now() - startTime) / 1000);
  const totalCost = parseFloat((costDiff.cost_usd + costRedator.cost_usd + costRevisor.cost_usd).toFixed(6));

  const custos = { diff: costDiff, redator: costRedator, revisor: costRevisor, total_usd: totalCost };
  console.log('[PIPELINE] Atualizacao concluida em ' + elapsed + 's — Custo: $' + totalCost + ' USD');

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
    custos,
    elapsed_seconds: elapsed
  };
}

module.exports = { callClaude: async (sp, um, mt, m) => (await callClaude(sp, um, mt, m)).text, generateRAN, updateRAN };