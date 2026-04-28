# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Projeto

**Nexum RAN Clinic** — plataforma clínica SaaS que automatiza a geração de Relatórios de Avaliação Neuropsicopedagógica (RAN) via pipeline de agentes Claude AI. Monousuário para Patrízia Santarém (Uberlândia-MG). Alvo de longo prazo: SaaS multidisciplinar.

Repositório: `github.com/andreobcosta/nexum-api`

---

## Comandos

### Backend (`backend/`)
```bash
npm start        # Produção: node server.js (porta 3001)
npm run dev      # Dev com auto-reload: node --watch server.js
cd backend && npm install mammoth express-rate-limit --save  # Sprint 0
```

### Frontend (`frontend/`)
```bash
npm run dev      # Vite dev server (proxy /api → :3001)
npm run build    # Build para frontend/build/
```

### Docker (raiz do repo)
```bash
docker-compose up -d --build
```

Sem linter ou framework de testes configurado.

---

## Infraestrutura de Produção

| Item | Valor |
|------|-------|
| Deploy backend | Google Cloud Run — us-central1 — nexum-production |
| Serviço Cloud Run | nexum-api |
| URL produção | https://nexum-api-xvxoj574uq-uc.a.run.app |
| URL cliente | https://app.patriziasantarem.com |
| Banco | Firestore — nexum-db (nexum-production) |
| Deploy frontend | Vercel (mesmo repositório GitHub) |
| CI/CD | Cloud Build — push ao main → health check + rollback automático |
| Memory / Timeout | 512Mi / 900s (corrigido em A3) |
| Commit estável | 1fc11e7 / E2+E3 — feedback por bloco |

**Nunca** editar código diretamente no Cloud Run. Alterações chegam via git push → Cloud Build.

---

## Stack

- **Backend:** Node.js/Express 4 — entry point `backend/server.js`
- **Frontend:** React 18 + Vite 5 (build em `frontend/build/`, servido pelo backend em produção)
- **Auth:** Google OAuth2 → JWT 30d, validado por `backend/middleware/verifyAuth.js`
- **Banco:** Google Cloud Firestore (`nexum-db`) — SQLite é legado, não usar
- **Storage:** Google Drive API v3 (pastas por paciente com estrutura fixa)
- **IA:** Claude API (`claude-sonnet-4-20250514` para Analítico/Redator/Revisor, `claude-haiku-4-5-20251001` para Diff/Compressor)
- **Transcrição:** Google Cloud Speech-to-Text v2 — Chirp 2 (`$0.006/min`)

---

## Pipeline de Agentes — Estado Atual

| Agente | Modelo | Input | Output | Custo |
|--------|--------|-------|--------|-------|
| Chirp 2 STT | Google Chirp 2 | Áudio GCS | Transcrição com diarização | $0.45 (75min) |
| Agente Compressor | Claude Haiku | Transcrição bruta | Transcrição renomeada + JSON clínico | $0.019 (×2 áudios) |
| PDF/Image Extractor | Claude Sonnet vision | PDF ou imagem base64 | Texto extraído | $0.032/arquivo |
| Agente Analítico | Claude Sonnet | Transcrições + PDFs ~12.200t | Dossiê JSON ~2.000t | $0.067 |
| Agente Redator | Claude Sonnet | System prompt 7.055t + dossiê 2.000t | RAN Markdown ~8.000t | $0.147 |
| Agente Revisor | Claude Haiku → **Sonnet** | RAN completo ~8.500t | JSON de validação ~300t | $0.008 → $0.027 |
| Agente Diff | Claude Haiku | RAN existente + novos docs | JSON de diferenças | variável |

**Custo total por RAN:** com áudio $0.775 → $0.705 (pós-B5) | sem áudio $0.286 → $0.247

---

## Arquitetura de Arquivos

### Backend

| Arquivo | Responsabilidade | Status |
|---------|-----------------|--------|
| server.js | Entry point — rotas, CORS, SPA fallback, rate limit, health check | Atualizado Sprint 1 |
| db/firestore.js | Singleton Firestore — getDb() | OK |
| middleware/verifyAuth.js | JWT guard — injeta req.user | OK |
| routes/auth.js | Google OAuth2 callback — gera JWT 30d, redireciona para hash | Corrigido A2 |
| routes/patients.js | CRUD pacientes + contadores desnormalizados | Atualizado D4 |
| routes/files.js | Upload/listagem + incremento de contadores | Atualizado D4 |
| routes/reports.js | Geração + pipeline async + rotas feedback bloco | Atualizado E1+E3 |
| routes/transcribe.js | Transcrição de áudio | OK |
| routes/costs.js | Custos por RAN | OK |
| routes/drive-webhook.js | Notificações Drive | OK |
| services/claude.js | Pipeline 3 agentes + timeout/retry + caching | Atualizado B1/B3/B4 |
| services/drive.js | Drive: upload, export, update | OK |
| services/drive-sync.js | Sync bidirecional webhooks Drive | Inativo sem APP_URL |
| services/pdf-extractor.js | Extração PDF/imagem/DOCX + score legibilidade | Atualizado C1+C3+C4 |
| services/transcription.js | STT Chirp 2 + Compressor | Atualizado B5 |
| services/docx-generator.js | Gera DOCX — fonte Arial (corrigido E6) | Atualizado E6 |
| prompts/system_prompt_ran.md | System prompt RAN — LOCK PERMANENTE | Nunca alterar ética/não-diagnóstico |

### Frontend (`frontend/src/`)

| Arquivo | Responsabilidade | Status |
|---------|-----------------|--------|
| App.jsx | Roteamento SPA + AuthGuard | Atualizado A1 |
| utils/api.js | Funções fetch com Authorization header | Atualizado A4 |
| pages/PatientsPage.jsx | Lista de pacientes | OK |
| pages/PatientDetailPage.jsx | Detalhe + geração de RAN + polling job_id | Atualizado E1 |
| pages/ReportPage.jsx | Visualização + edição inline por bloco + feedback ✓✗✎ | Atualizado E2+E3 |
| pages/NewPatientPage.jsx | Formulário novo paciente | OK |
| pages/EditPatientPage.jsx | Edição de paciente | OK |
| pages/UploadPage.jsx | Upload de arquivos | OK |

---

## Estrutura de Pastas Google Drive (por paciente)

```
Pacientes/
└── [NOME_PACIENTE] ([ano])/
    ├── 01 - Anamnese
    ├── 02 - Testes aplicados
    ├── 03 - Sessões
    ├── 04 - Relatórios
    ├── 05 - Intervenções
    └── 06 - Documentos externos
```

---

## Collections Firestore

**Ativas:**
- `patients` — dados cadastrais + `drive_folder_id` + contadores desnormalizados (`anamnese_count`, `teste_count`, `sessao_count`, `externo_count`, `reports_count`, `pipeline_ativo`)
- `patients/{id}/files` — arquivos com `category` (anamnese/teste/sessao/relatorio/externo/intervencao), `transcription`, Drive IDs
- `patients/{id}/reports` — relatórios versionados (markdown + Drive file ID)
- `activity_log` — auditoria de todas as ações
- `instrument_library` — validações clínicas por instrumento (seed rodado em 27/04/2026 — 6 instrumentos carregados)
- `seed_log` — controle de seeds versionados já executados
- `feedbacks` — feedback por bloco: `{ patient_id, report_id, bloco_id, bloco_heading, feedback_type, bloco_content, created_at }`

**A criar nas próximas sprints:**
- `motor_config`, `feedback_queue`, `system_prompts`, `system_prompts_history`, `report_layout`

---

## Variáveis de Ambiente

| Variável | Secret Manager | Status |
|----------|---------------|--------|
| ANTHROPIC_API_KEY | nexum-anthropic-key | OK |
| JWT_SECRET | nexum-jwt-secret | OK |
| ALLOWED_EMAIL | nexum-allowed-email | OK |
| GOOGLE_CLIENT_ID | nexum-google-client-id | OK |
| GOOGLE_CLIENT_SECRET | nexum-google-client-secret | OK |
| GOOGLE_REFRESH_TOKEN | nexum-google-refresh-token | OK |
| GOOGLE_DRIVE_ROOT_FOLDER_ID | nexum-google-drive-folder-id | OK |
| GOOGLE_LOGIN_CLIENT_ID | nexum-login-client-id | OK |
| GOOGLE_LOGIN_CLIENT_SECRET | nexum-login-client-secret | OK |
| GCP_PROJECT_ID | env var direto | OK |
| FIRESTORE_DATABASE_ID | env var direto | OK |
| APP_URL | Adicionado em A3 | Corrigido |
| GOOGLE_REDIRECT_URI | Adicionado em A3 | Corrigido |

`dotenv.config()` deve **sempre** usar path explícito: `dotenv.config({ path: '/app/backend/.env' })`

---

## Fluxo de Geração do RAN

1. Usuário faz upload de arquivos (áudio/PDF/imagem) → `routes/files.js` armazena no Drive
2. Áudios são auto-transcritos por `services/transcription.js` (STT v2 + Haiku diarização)
3. Transcrições salvas no Firestore e como `.txt` no Drive
4. Na geração, `routes/reports.js` verifica lock (`pipeline_ativo`), monta `dataPackage`
5. `services/claude.js` executa pipeline: Analítico → Redator (com prompt caching) → Revisor (Sonnet)
6. Revisor valida com dossiê + RAN completo. Score mínimo: **20** (mantido em 20 para permitir pré-relatórios com dados parciais)
7. Relatório salvo no Firestore e no Drive como Google Doc nativo

---

## Bugs Críticos — Fixes da Sprint 1

### A2 — auth.js: token na URL (exposto em logs)
```js
// Antes:
res.redirect(`/?token=${token}`)
// Depois:
res.redirect(`/#token=${token}`)
```

### A1 — App.jsx: sem autenticação
Adicionar no início do componente App():
```jsx
const [ok, setOk] = useState(false);
useEffect(() => {
  const h = window.location.hash;
  if (h.startsWith("#token=")) {
    localStorage.setItem("nexum_token", h.slice(7));
    window.history.replaceState(null, "", window.location.pathname);
  }
  const t = localStorage.getItem("nexum_token");
  if (!t) { window.location.href = "/api/auth/google"; return; }
  try {
    const pay = JSON.parse(atob(t.split(".")[1]));
    if (pay.exp * 1000 < Date.now()) {
      localStorage.removeItem("nexum_token");
      window.location.href = "/api/auth/google"; return;
    }
    setOk(true);
  } catch {
    localStorage.removeItem("nexum_token");
    window.location.href = "/api/auth/google";
  }
}, []);
if (!ok) return <div className="empty-state"><div className="spinner" /></div>;
```

### A3 — cloudbuild.yaml: APP_URL ausente, timeout insuficiente
```yaml
- '--set-env-vars=GCP_PROJECT_ID=nexum-production,FIRESTORE_DATABASE_ID=nexum-db,NODE_ENV=production,DEPLOY_SHA=$COMMIT_SHA,APP_URL=https://nexum-api-xvxoj574uq-uc.a.run.app,GOOGLE_REDIRECT_URI=https://nexum-api-xvxoj574uq-uc.a.run.app/api/auth/google/callback'
- '--timeout=900'
```

### A5 — server.js: sem rate limit
```js
const rateLimit = require("express-rate-limit");
app.use("/api/", rateLimit({ windowMs: 60000, max: 100, standardHeaders: true }));
app.use("/api/reports/generate", rateLimit({ windowMs: 300000, max: 3, message: { error: "Máximo 3 gerações por 5 minutos" } }));
```

### A7 — server.js: health check sempre retorna 200
```js
app.get("/api/health", async (req, res) => {
  const checks = { firestore: false, anthropic_key: !!process.env.ANTHROPIC_API_KEY };
  try { await getDb().collection("patients").limit(1).get(); checks.firestore = true; } catch {}
  const degraded = !checks.firestore;
  res.status(degraded ? 503 : 200).json({ status: degraded ? "degraded" : "ok", version: "2.0.0", commit: process.env.DEPLOY_SHA || "local", checks });
});
```

### B1 — claude.js: sem timeout nem retry
AbortController 2min + retry exponencial (15s/30s/60s) para 429/529.

### B3 — claude.js: 3 bugs no Revisor
1. No `catch`: mudar `aprovado: true` → `aprovado: false`
2. Passar dossiê resumido ao Revisor no userMessage (primeiros 2000 chars do JSON)
3. Mudar MODEL_HAIKU → MODEL_SONNET na chamada do Revisor

### B4 — claude.js: prompt caching desativado
No agentRedator, system prompt como array com cache_control:
```js
system: [{ type: "text", text: systemPromptRAN, cache_control: { type: "ephemeral" } }]
// + header: 'anthropic-beta': 'prompt-caching-2024-07-31'
```
Economia: $0.019/RAN garantida.

### D4 — patients.js: N+1 queries
- Criar paciente: adicionar `anamnese_count: 0, teste_count: 0, sessao_count: 0, externo_count: 0, reports_count: 0`
- files.js upload: `FieldValue.increment(1)` no contador da categoria
- files.js delete: `FieldValue.increment(-1)` no contador da categoria
- reports.js generate: `FieldValue.increment(1)` em `reports_count`
- reports.js delete: `FieldValue.increment(-1)` em `reports_count`
- GET /patients: remover subcollection queries, usar campos desnormalizados

### E6 — docx-generator.js: Calibri não existe no Cloud Run
Substituir todas as ocorrências de `'Calibri'` por `'Arial'`.

---

## Sprints — Checklist

### Sprint 0 — Pré-condições ✅
- [x] `cd backend && npm install mammoth express-rate-limit --save`
- [x] Criar `.dockerignore` na raiz

### Sprint 1 — Segurança e Estabilidade ✅ (todos `✓`)
- [x] A1+A2: App.jsx AuthGuard + auth.js hash fragment
- [x] A3: cloudbuild.yaml APP_URL + GOOGLE_REDIRECT_URI + timeout 900s
- [x] A4: api.js Authorization header em request() e uploadFile()
- [x] A5: server.js rate limit geral + específico de geração
- [x] A6: reports.js lock pipeline_ativo
- [x] A7: server.js health check real com Firestore
- [x] B1: claude.js AbortController 2min + retry exponencial
- [x] B3: claude.js 3 bugs do Revisor (parse_error + dossiê + Haiku→Sonnet)
- [x] B4: claude.js prompt caching no Redator
- [x] D4: patients.js + files.js + reports.js desnormalizar contadores
- [x] E6: docx-generator.js Calibri → Arial
- [x] H1: .dockerignore criado

**Verificações obrigatórias Sprint 1:**
- [ ] `curl /api/health` retorna `{ "status": "ok", "checks": { "firestore": true } }`
- [ ] Acesso sem token redireciona para /api/auth/google
- [ ] Token após login vai para `/#token=` e não para `/?token=`
- [ ] POST /generate duas vezes simultâneas retorna 409 na segunda
- [ ] `grep "Calibri" backend/services/docx-generator.js` não retorna nada

### Sprint 2 — Extração e Qualidade Clínica (pendente)
- [x] C1 ✓: pdf-extractor.js suporte a DOCX via mammoth
- [ ] C2 ~: prompt específico por instrumento (detectar pelo nome do arquivo)
- [x] C3 ✓: score de legibilidade de imagens ([ILEGÍVEL] > 20% → quality:"baixa")
- [x] C4 ✓: drive.js Google Docs via files.export text/plain
- [x] D1 ✓: Revisor valida contra instrument_library (13 validações clínicas)
- [x] D2: descartado por decisão clínica em 26/04/2026 — score mantido em 20
- [x] D3 ✓: getSystemPrompt() async com Firestore + fallback arquivo
- [x] E1 ✓: SSE ou polling por job_id para progresso real
- [x] E4 ✓: api.js + ReportPage download PDF (já implementado — botão PDF no dropdown de download do ReportPage)
- [x] Carregar nexum_biblioteca_clinica_neuropsi.json no Firestore (seed rodado em 27/04/2026)

### Sprint 3 — Novas Funcionalidades (pendente)
- [ ] backend/routes/admin.js + frontend AdminPage.jsx
- [ ] backend/routes/settings.js + frontend SettingsPage.jsx
- [x] B5 ✓: Compressor (substitui Identificador — spec abaixo)
- [x] E2 ✓: edição inline por bloco — parseBlocks + textarea por bloco + PATCH content_md (1fc11e7)
- [x] E3 ✓: feedback por bloco — botões ✓✗✎ + borderLeft colorido + collection feedbacks (1fc11e7)
- [ ] E5 ~: docx-generator.js carregarLayout() do Firestore

### Sprint 4 — Aprendizado Contínuo (após Sprint 3 com feedbacks acumulados)
- [ ] G1-G5 ~: Firestore Vector Search + Motor de Feedback Haiku + RAG + Busca Externa

---

## Spec do Agente Compressor (Sprint 3 — B5 `~`)

Substitui o Identificador de Locutores em `backend/services/transcription.js`. Uma chamada Haiku faz o trabalho de duas. Custo: $0.019 vs $0.039 atual (−51%).

O Firestore continua salvando a transcrição completa renomeada. O Compressor gera uma segunda representação para o pipeline — não substitui o dado salvo.

**3 campos obrigatórios no output JSON:**

**Campo 1 — locutores_identificados** (pode comprimir)
```json
{ "L1": "Patrízia", "L2": "Mãe", "L3": "Criança" }
```

**Campo 2 — pontos_clinicos** (pode comprimir com normalização)
Subcampos: `queixa`, `marcos_desenvolvimento`, `historico_escolar`, `rotina`, `saude`, `historico_familiar`
Normalizar coloquial para técnico sem alterar conteúdo factual.

**Campo 3 — observacoes_comportamentais** (NUNCA comprimir)
Critério: "se omitir essa observação mudaria a interpretação clínica do caso, ela entra aqui".
Incluir obrigatoriamente quando: locutor demonstrou emoção perceptível (ansiedade, choro, negação), contradição entre relatos, criança recusou/desviou pergunta direta, responsável minimizou/exagerou relato, fala com carga diagnóstica que parafraseada perderia sentido clínico.
Formato: lista de strings com transcrição literal — sem paráfrase, sem normalização.

---

## 13 Validações Clínicas do Revisor (Sprint 2 — D1)

1. ETDAH: percentil fora de 1-99 → score 0 imediato
2. ETDAH: fator diferente de RE/HI/CA/A → score 0 (dado fabricado)
3. ETDAH: "Superior = bom desempenho" → score 0 (escala invertida violada)
4. CARS: total fora de 15-60 → score 0 imediato
5. CARS: pontuação por item fora de 1-4 → score 0
6. CARS: diagnóstico fechado de TEA → score 0 (violação ética)
7. CARS < 30: verificar presença da seção "Por que os achados não indicam TEA"
8. CARS 27-30 com ETDAH HI ≥ 95: verificar parágrafo de mimetização TDAH para TEA
9. TDE-2: tipo de erro além de CFG/RC/IL/ENP → score 0 (dado fabricado)
10. TDE-2: estratégia além de D/M/RV/A → score 0 (dado fabricado)
11. Lateralidade: sistema diferente de manual/podal/visual/auditiva → score 0
12. Consciência Fonológica: nível diferente de A-H → score 0
13. Qualquer seção: diagnóstico fechado CID/DSM → score 0 (violação ética crítica)

---

## Princípio do Feedback como Validador Contínuo

O feedback inline da Patrízia (✓ ✗ ✎) ao revisar cada RAN é o validador contínuo de todas as evoluções marcadas como `~`.

**Critério de estabilidade de um item `~`:**
- Taxa de ✗ e ✎ nos blocos afetados NÃO aumenta após a mudança → estável
- Taxa AUMENTA → reverter e investigar

Itens `~` não precisam de teste manual antes de ir para produção. A validação acontece com julgamento clínico real.

---

## Proteções Invioláveis

- **Nunca** diagnóstico fechado CID/DSM — sempre linguagem de hipótese
- **Nunca** inventar dados — sinalizar `[DADO NÃO FORNECIDO — verificar com Patrízia]`
- **Nunca** omitir seções — seção vazia mantém título + `[Seção pendente]`
- Score 0 imediato: dado fabricado, escore impossível, diagnóstico fechado, escala invertida violada
- Score mínimo **nunca remover** — mantido em 20 para permitir pré-relatórios com dados parciais. O D2 (score 40) foi descartado por decisão clínica em 26/04/2026.
- Regras éticas do system prompt: **lock permanente** — nenhuma automação pode alterar

---

## Contexto para Novas Sessões — Anti-Alucinação

### Decisões Arquiteturais (não reverter sem decisão explícita)

| Decisão | Motivo |
|---------|--------|
| Frontend é um único arquivo `frontend/build/index.html` (React CDN + Babel standalone) | Vite só existe para dev local — o build de produção é esse arquivo único |
| JSX em event handlers SEMPRE inline, nunca multilinha | Babel standalone quebra silenciosamente com JSX multilinha em handlers |
| Score mínimo = 20 (não 40) | D2 descartado por decisão clínica de Patrízia em 26/04/2026 |
| Revisor usa Claude Sonnet (não Haiku) | B3: Haiku produzia validações clínicas insuficientes |
| Pipeline de geração async via collection `jobs` no Firestore | E1: evita timeout do Cloud Run (900s) em gerações longas |
| `transcribeAudio` retorna `{ transcricao, comprimido }` | B5: Compressor substituiu o Identificador — chamadores usam `.transcricao` |
| Relatórios salvos como Google Docs nativos no Drive | Permite edição direta no Drive sem conversão |
| Firestore é o banco ativo — SQLite é legado | Migração feita — nunca usar SQLite |
| `dotenv.config()` sempre com path explícito `/app/backend/.env` | Sem path explícito falha em volumes Docker montados |
| `parseBlocks(md)` divide markdown por headings `(/^#{1,4}\s+.+/)` | E2: bloco = heading + conteúdo até o próximo heading |
| Feedback por bloco usa `add()` (histórico) não `set()` | E3: feedbacks são imutáveis — GET retorna último por bloco via comparação ISO |
| Block renderer inteiro em UMA linha no index.html | Babel standalone quebra silenciosamente com JSX multilinha em qualquer posição |
| Cores de feedback: `V.green` (ok), `V.red` (erro), `V.amber` (ajuste) | E3: usar sempre constantes V — nunca hex literals |

### Bugs Corrigidos — Não Reintroduzir

| Bug | Fix |
|-----|-----|
| Token OAuth exposto em `/?token=` nos logs do servidor | Corrigido para `/#token=` (hash fragment) — A2 |
| Fonte Calibri não existe no Cloud Run | Substituída por Arial em todos os geradores — E6 |
| Revisor retornava `aprovado: true` no bloco `catch` | Corrigido para `aprovado: false` — B3 |
| Prompt caching desativado no Redator | Reativado com `cache_control: ephemeral` — B4 |
| Geração de RAN bloqueava a resposta HTTP até concluir | Refatorado para async com `setImmediate` + job_id — E1 |

### O que NÃO Existe (não inventar)

- **Sem `routes/admin.js` / AdminPage** — Sprint 3, não implementado
- **Sem `routes/settings.js` / SettingsPage** — Sprint 3, não implementado
- **Sem Motor de Feedback / Vector Search** — Sprint 4, não implementado
- **Sem collections** `motor_config`, `feedback_queue`, `system_prompts`, `system_prompts_history`, `report_layout` — a criar nas próximas sprints
- **Sem SSE** — progresso de geração usa polling HTTP via collection `jobs`
- **Sem testes automatizados** — validação por uso clínico real (Princípio do Feedback)
- **Sem ambiente de staging** — apenas produção (Cloud Run) e local (`docker-compose`)
- **C2 pendente** — prompt específico por instrumento ainda não implementado (Sprint 2 restante)

---

## Constraints Críticos (NÃO IGNORAR)

### Frontend — Babel Standalone
- O frontend usa React via CDN + Babel standalone em `frontend/build/index.html`
- JSX multilinha dentro de `onClick` e outros handlers **QUEBRA** o Babel standalone
- Todo JSX em event handlers deve ser **sempre inline** — nunca multilinha
- Estados React duplicados causam falhas silenciosas — verificar antes de adicionar novos states

### Backend — Configuração
- `dotenv.config()` deve **sempre** usar path explícito: `dotenv.config({ path: '/app/backend/.env' })`
- `dotenv.config()` sem path falha quando serviços são invocados de volumes montados

### Cloud Run — Deploy
- `APP_URL` obrigatório nas env vars do Cloud Run para webhooks funcionarem
- **Nunca** editar código diretamente no Cloud Run
- CI/CD via Cloud Build — push para GitHub dispara deploy automaticamente

### Sistema Clínico
- Firestore é o banco de dados ativo — SQLite é legado, não usar
- Relatórios gerados como Google Docs nativos no Drive
- Revisor lê o RAN **COMPLETO** — nunca truncado (decisão arquitetural definitiva)

## Idioma
Sempre responda em português brasileiro em todas as interações, explicações, commits e comentários de código.

## Padrão de Commits
- Sempre em português brasileiro
- Formato: `tipo: descrição curta`
- Tipos: `feat`, `fix`, `refactor`, `docs`, `chore`
- Exemplos:
  - `feat: adicionar progresso SSE na geração de RAN`
  - `fix: corrigir lock pipeline_ativo no Firestore`
  - `refactor: substituir Identificador pelo Compressor`
