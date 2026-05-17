# Nexum — Documento de Requisitos do Sistema
**Versão:** 4.5  
**Data:** 17/05/2026  
**Status:** Em evolução — SaaS Multidisciplinar

---

## Sumário

1. [Visão Geral](#1-visão-geral)
2. [Perfis de Usuário e Permissões](#2-perfis-de-usuário-e-permissões)
3. [Autenticação](#3-autenticação)
4. [Gestão de Clínicas e Profissionais](#4-gestão-de-clínicas-e-profissionais)
5. [Gestão de Pacientes](#5-gestão-de-pacientes)
6. [Gestão de Arquivos](#6-gestão-de-arquivos)
7. [Pipeline de Geração de Documentos](#7-pipeline-de-geração-de-documentos)
8. [Templates de Documento (Brief)](#8-templates-de-documento-brief)
9. [Biblioteca de Instrumentos](#9-biblioteca-de-instrumentos)
10. [Autoaprendizado e Curadoria](#10-autoaprendizado-e-curadoria)
11. [Perfil Profissional e Capa](#11-perfil-profissional-e-capa)
12. [Configurações](#12-configurações)
13. [Painel Administrativo](#13-painel-administrativo)
14. [Modelo de Negócio e Acompanhamento de Custos](#14-modelo-de-negócio-e-acompanhamento-de-custos)
15. [Proteções Éticas e de Qualidade](#15-proteções-éticas-e-de-qualidade)
16. [Módulo de Conselho Profissional](#16-módulo-de-conselho-profissional)
17. [Conformidade LGPD](#17-conformidade-lgpd)
18. [Infraestrutura Técnica](#18-infraestrutura-técnica)
19. [Requisitos Não-Funcionais](#19-requisitos-não-funcionais)
20. [Restrições e Decisões Arquiteturais](#20-restrições-e-decisões-arquiteturais)
21. [Roadmap de Implementação](#21-roadmap-de-implementação)
22. [Sistema de Notificações In-App](#22-sistema-de-notificações-in-app)

---

## 1. Visão Geral

**Nexum** é uma plataforma SaaS clínica que automatiza a geração de relatórios e documentos de avaliação por meio de um pipeline de agentes de IA (Claude API). O sistema analisa arquivos clínicos do paciente (protocolos de testes, documentos externos, anotações, imagens, laudos em PDF/DOCX) e gera documentos completos e eticamente adequados.

**Público-alvo:** Profissionais de saúde multidisciplinares — Neuropsicopedagogos, Fonoaudiólogos, Psicólogos, Terapeutas Ocupacionais, Neuropsicólogos e outros.

**Modelo de negócio:** SaaS com clínicas como tenant principal e profissionais como usuários dentro de cada clínica.

**Princípio central:** O sistema nunca inventa dados. Todo conteúdo gerado é rastreável a um arquivo de origem. Pendências clínicas são sinalizadas com linguagem profissional, nunca com placeholders técnicos.

---

## 2. Perfis de Usuário e Permissões

O sistema possui cinco papéis de acesso. Os papéis são atribuídos por clínica — um usuário pode ter papéis diferentes em clínicas diferentes (ex: Admin Clínica em uma, Profissional em outra).

### 2.1 Admin Sistema (Nexum)

Escopo: plataforma inteira. Responsável pela manutenção técnica e clínica da base de conhecimento.

| Área | Permissão |
|---|---|
| Biblioteca de instrumentos base | CRUD completo |
| System prompt da plataforma | CRUD completo |
| Motor config (parâmetros do pipeline) | CRUD completo |
| Catálogo de seções e sugestões do Brief | CRUD completo |
| Templates padrão por especialidade | CRUD completo |
| Criar / desativar clínicas | ✅ |
| Ver custos de todas as clínicas | ✅ |
| Ver activity log da plataforma | ✅ |
| Ver dados de qualquer paciente (suporte) | ✅ |

### 2.2 Admin Clínica

Escopo: apenas a clínica da qual é administrador.

| Área | Permissão |
|---|---|
| Biblioteca de instrumentos da clínica | CRUD completo |
| Instrumentos base da plataforma | Confirmar e adicionar notas (não editar) |
| Convidar / remover profissionais da clínica | ✅ |
| Configurar conselhos profissionais disponíveis | ✅ |
| Criar e editar templates de documento da clínica | ✅ |
| Ver e editar perfil de layout da clínica | ✅ |
| Ver todos os pacientes da clínica | ✅ |
| Transferir paciente entre profissionais | ✅ |
| Ver relatórios de todos os profissionais | ✅ (somente leitura) |
| Ver custos de todos os profissionais da clínica | ❌ |
| Ver activity log da clínica | ✅ |
| Editar instrumentos privados de outro profissional | ❌ |

### 2.3 Supervisor

Escopo: profissionais da clínica selecionados pelo Admin Clínica. O Supervisor **não configura nada** — é um papel de visibilidade e supervisão clínica. Suas permissões são definidas pelo Admin Clínica por meio de checkboxes.

**Permissões configuráveis pelo Admin Clínica:**

| Área | Pode habilitar? |
|---|---|
| Ver relatórios de profissionais específicos | ✅ |
| Transferir paciente entre profissionais | ✅ |
| Ver activity log da clínica (somente leitura) | ✅ |
| Ver custos de profissionais selecionados | ❌ (nunca) |
| Editar dados de pacientes de outros profissionais | ❌ (nunca) |
| Editar system prompt ou motor config | ❌ (nunca) |
| Acessar dados de outras clínicas | ❌ (nunca) |

**Regra:** As restrições ❌ são fixas no sistema — o Admin Clínica não pode habilitá-las.

### 2.4 Secretária

Escopo: funcionalidades administrativas da clínica, sem acesso a conteúdo clínico.

| Área | Permissão |
|---|---|
| Cadastrar e editar pacientes (dados cadastrais) | ✅ |
| Fazer upload de arquivos para pacientes | ✅ |
| Ver lista de pacientes da clínica | ✅ |
| Agendar e registrar atendimentos (futuro) | ✅ |
| Ver relatórios gerados | ❌ |
| Ver transcrições ou conteúdo clínico | ❌ |
| Gerar documentos | ❌ |
| Ver custos | ❌ |
| Editar configurações da clínica | ❌ |
| Acessar dados de outras clínicas | ❌ (nunca) |

### 2.5 Profissional

Escopo: apenas os próprios pacientes e documentos dentro da clínica.

| Área | Permissão |
|---|---|
| Instrumentos da clínica | Confirmar e adicionar notas próprias |
| Criar instrumentos privados próprios | ✅ |
| CRUD nos pacientes vinculados a si | ✅ |
| Gerar e editar próprios documentos | ✅ |
| Configurar próprio perfil e templates | ✅ |
| Configurar próprias áreas de atuação | ✅ |
| Ver custos dos próprios documentos | ❌ |
| Ver / editar documentos de outro profissional | ❌ |
| Editar system prompt ou motor config | ❌ |

### 2.6 Hierarquia de herança de configurações

O Supervisor **não faz parte** desta cadeia — ele é um papel de visibilidade, não de configuração. Quando o profissional não configura algo, o sistema busca na camada acima:

```
Plataforma (Admin Sistema)
    ↓ herda se não configurado
  Clínica (Admin Clínica)
      ↓ herda se não configurado
    Profissional
```

Aplica-se a: templates de documento, layout de relatório, catálogo de conselhos profissionais, módulos de conselho profissional.

---

## 3. Autenticação

### 3.1 Fluxo de acesso

- Identidade verificada via **Google OAuth2** (SSO) — o usuário autentica com sua conta Google
- O sistema não cria usuários autonomamente: Admin Clínica cadastra o usuário → sistema envia link de ativação por e-mail → usuário clica no link → autentica com Google → identidade Google é vinculada ao cadastro
- Token JWT emitido após autenticação com validade de **24 horas** (reduzido de 30 dias para segurança)
- Token transmitido via hash fragment (`#token=`) — nunca em query string
- Expiração verificada no frontend antes de qualquer requisição
- JWT inclui: `user_id`, `clinic_id`, `role`, `email`
- Middleware `verifyAuth.js` valida JWT em todas as rotas `/api` (exceto `/api/auth` e `/api/health`)

### 3.2 Revogação de tokens

JWT é stateless — uma vez emitido, não pode ser cancelado até expirar. Para cobrir remoção de usuário ou mudança de role, o sistema usa `valid_from` por usuário:

- Campo `valid_from` (ISO timestamp) armazenado em `clinics/{clinic_id}/users/{user_id}`
- O middleware verifica se `jwt.iat >= valid_from` — se não, rejeita com 401
- Ao remover um usuário ou alterar seu role: `valid_from` é atualizado para `now()` → todos os tokens anteriores ficam inválidos imediatamente
- Expiração de 24h limita a janela de exposição para tokens não revogados

### 3.3 Onboarding de usuário (convidado pelo Admin Clínica)

1. Admin Clínica preenche: nome, e-mail, role, áreas de atuação (para profissionais)
2. Sistema envia e-mail com link único de ativação via **Resend** (expira em 72h)
3. Usuário clica no link → é direcionado para login Google → perfil é criado automaticamente
4. Usuário pode atualizar todos os campos do próprio perfil, exceto o e-mail (somente Admin Clínica pode alterar o e-mail de um usuário)
5. Admin Clínica pode reenviar o link de ativação a qualquer momento

### 3.4 Onboarding da clínica (self-service)

A clínica se cadastra **sem aprovação manual do Admin Sistema**. O processo é totalmente automatizado:

1. Cliente acessa a página de cadastro pública do Nexum
2. Preenche dados da clínica: nome, CNPJ (pessoa jurídica) ou CPF (profissional autônomo), e-mail institucional, endereço
3. Cadastra cartão de crédito para cobrança da mensalidade
4. Pagamento da primeira mensalidade processado imediatamente
5. Clínica criada automaticamente; o cadastrante torna-se o **primeiro Admin Clínica**
6. Acesso liberado imediatamente após confirmação do pagamento

**Anti-burla do trial:** o trial é vinculado ao **CNPJ ou CPF** fornecido no cadastro — não ao e-mail nem ao cartão. Ao criar uma nova clínica, o sistema verifica se aquele documento já utilizou trial anteriormente. Se sim, o trial não é concedido. Verificação via base pública de CNPJ (Receita Federal) e validação de dígito verificador de CPF.

---

## 4. Gestão de Clínicas e Profissionais

### 4.1 Clínica (tenant)

**Campos obrigatórios:**
- Nome da clínica
- E-mail institucional de contato
- Endereço completo (logradouro, cidade, estado, CEP) — usado na capa dos documentos

**Campos opcionais:**
- Logo (imagem, máx. 800KB) — fallback: exibe iniciais do nome da clínica em placeholder
- Telefone / site institucional

### 4.2 Conselhos profissionais

A plataforma mantém um **catálogo fixo** de conselhos profissionais (CRP, CRFa, CREFITO, ABPp, CFO, COREN e outros). Esses conselhos padrão não são editáveis pelo Admin Clínica.

O Admin Clínica pode:
- Selecionar quais conselhos do catálogo ficam disponíveis na sua clínica
- Incluir conselhos personalizados (não existentes no catálogo) — editáveis e excluíveis por ele
- Associar cada conselho a uma ou mais especialidades (ex: CRP → Psicologia)

Profissionais selecionam seus registros da lista configurada pelo Admin Clínica da clínica.

### 4.3 Perfil do Profissional

Campos configurados pelo próprio profissional:
- Nome completo
- Título / formação
- Áreas de atuação (múltipla seleção — ver seção 9.1)
  - Área principal (obrigatória) + áreas secundárias (opcionais)
- Registros profissionais (múltiplos, da lista da clínica)
  - Ex: `CRP 04/XXXXX`, `CRFa XXXXX`
- Assinatura digital (imagem opcional — usada na capa)
- Conselho profissional principal (determina qual módulo de agente especialista é carregado — ver seção 16)

### 4.4 Secretária

Campos: nome completo, e-mail. Sem campos clínicos. Sem assinatura.

---

## 5. Gestão de Pacientes

### 5.1 Vínculo do paciente

**O paciente pertence à clínica**, não ao profissional. Profissionais são vinculados ao paciente pelo Admin Clínica. Regras:

- Um paciente pode ser atendido por múltiplos profissionais da mesma clínica
- Cada profissional tem **visão isolada** — só vê os documentos que ele mesmo gerou
- O Admin Clínica vê documentos de todos os profissionais vinculados ao paciente (somente leitura)
- O Supervisor vê documentos dos profissionais sob sua supervisão (se habilitado)
- Se um profissional sai da clínica, seus documentos **ficam na clínica** — o Admin Clínica mantém acesso; o ex-profissional perde o acesso

### 5.2 Busca e filtragem de pacientes

- Busca por nome com **debounce de 300ms** — não recarrega a página a cada tecla
- Case-insensitive — "joao" encontra "João"
- Busca executada no Firestore com `startAt` / `endAt` sobre campo `search_name` (nome em minúsculas sem acento, armazenado no cadastro)
- Filtros disponíveis: status ativo / inativo
- Resultado exibido em tempo real conforme o usuário digita

### 5.3 Cadastro

**Campos obrigatórios:** nome completo, data de nascimento.  
**Campos opcionais:** escolaridade, dominância manual, medicamentos, responsáveis, observações.

- **Idade**: calculada em runtime a partir de `data_de_nascimento` — nunca armazenada como campo fixo
- Campos desnormalizados (contadores): `anamnese_count`, `teste_count`, `sessao_count`, `reports_count`

**Declaração de consentimento LGPD (obrigatória):**  
Ao criar um paciente, o profissional ou secretária deve marcar o checkbox:

> "Declaro que obtive o consentimento livre e esclarecido do paciente ou responsável legal para coleta, processamento e armazenamento dos dados e documentos clínicos neste sistema, conforme exigido pela Lei Geral de Proteção de Dados (Lei nº 13.709/2018)."

- Sem marcação do checkbox o formulário não pode ser submetido
- Data, hora e `user_id` do declarante registrados no Firestore (`lgpd_consent_at`, `lgpd_consent_by`)
- O registro de consentimento é imutável — não pode ser removido ou alterado
- O paciente nunca acessa o sistema diretamente

### 5.4 Categorias de arquivos

Padrão da plataforma: Anamnese · Testes · Sessões · Relatórios · Intervenções.

- Categoria "Documentos externos" descontinuada — arquivos externos são classificados nas categorias acima conforme conteúdo
- Admin Clínica e profissional podem personalizar rótulos visíveis (sem alterar as chaves internas)
- Chaves internas imutáveis: `anamnese`, `teste`, `sessao`, `relatorio`, `intervencao`

---

## 6. Gestão de Arquivos

### 6.1 Upload

- Upload em lote: até 50 arquivos por requisição
- Tamanho máximo por arquivo: 100MB
- Formatos aceitos: `image/*`, `application/pdf`, `.doc`, `.docx`, `.txt`
- **Áudio não é suportado** — funcionalidade descontinuada (ver nota abaixo)
- Processamento por arquivo individual com tratamento de erro isolado (falha em um arquivo não cancela o lote)
- Arquivos temporários escritos em disco (não em memória) — sem risco de OOM em lotes grandes

> **Nota — descontinuação de áudio e transcrição:** A funcionalidade de upload de áudio com transcrição automática (Google STT Chirp 2 + Agente Compressor) foi descontinuada na versão SaaS. Motivo: custo de transcrição (~$0,45 por sessão de 75min) tornava o modelo de quota inviável. Profissionais que desejam incluir transcrições de sessão devem converter para texto externamente e fazer upload como `.txt` ou `.docx`.

### 6.2 Processamento automático pós-upload

| Tipo | Processamento |
|---|---|
| Qualquer tipo | Pré-classificação por nome de arquivo (ver 6.6) |
| Qualquer tipo | **Avaliação de elegibilidade em background** (ver 6.9) |
| PDF / DOCX | Extração de texto tentada imediatamente na avaliação de elegibilidade |
| Imagem | Extração via Claude vision; se falhar, melhoria automática (Sharp) + retry |
| Texto (.txt) | Sempre elegível — conteúdo disponível diretamente |

### 6.4 Armazenamento

- Google Cloud Storage (bucket `nexum-patient-files`)
- Arquivos organizados por `patients/{patient_id}/{file_id}/{nome}`
- Acesso via Service Account do Cloud Run — sem expiração de credencial

### 6.5 Operações disponíveis

- Download do arquivo original (via Signed URL gerada pelo backend — nunca URL pública)
- Renomear / trocar categoria (PATCH)
- Excluir (soft delete: marca `deleted: true` no Firestore + agenda remoção do GCS após 90 dias)
- Preview (imagens, PDFs — via proxy do backend ou Signed URL temporária)
- Rotação de imagem (salva ângulo no Firestore)

### 6.7 Indicador de progresso no upload

- Barra de progresso por arquivo com percentual
- Para uploads individuais acima de 50MB: exibir velocidade de transferência estimada
- Falha em um arquivo não cancela o lote — arquivo com erro exibe mensagem de falha inline
- Arquivos com sucesso ficam marcados com ✅; com falha com ❌ + mensagem de erro
- O usuário pode tentar novamente apenas os arquivos que falharam

### 6.9 Avaliação de elegibilidade

**Conceito:** após cada upload, o sistema tenta extrair conteúdo do arquivo de verdade. Se consegue ler — **Elegível**. Se não consegue — tenta melhorar automaticamente e repete. Se ainda não consegue — **Inelegível**.

Substitui o antigo score de legibilidade (boa/parcial/baixa), que era uma heurística. A elegibilidade é uma decisão real: o arquivo serve ou não serve para gerar relatório.

**Modelo de IA:** **Claude Sonnet** (mesmo modelo da geração) — não Haiku. Motivo: a extração de elegibilidade é a mesma extração que o Analítico usaria na geração. Fazer com Sonnet agora e armazenar o resultado elimina a chamada Sonnet na geração, tornando o custo total **menor** do que fazer verificação barata (Haiku) + extração na geração (Sonnet).

**Comparativo de custo por arquivo usado em geração:**

| Estratégia | Upload | Geração | Total por arquivo |
|---|---|---|---|
| Haiku check + Sonnet na geração | ~$0,005 | ~$0,020 | **~$0,025** |
| **Sonnet dual-purpose (adotado)** | ~$0,020 | $0 (reutiliza) | **~$0,020** |

Economia: ~20% por arquivo. Vantagem adicional: geração mais rápida (conteúdo já disponível).

> **Único cenário desfavorável:** arquivo carregado mas nunca usado em geração ($0,020 em vez de $0,005). Em contexto clínico, praticamente todos os arquivos são usados — custo residual desprezível.

**Fluxo completo:**

```
Upload concluído
    ↓
Tentativa de extração de conteúdo (Claude Sonnet vision ou mammoth/pdfkit)
  • PDF com camada de texto → extração direta (pdfkit/mammoth)
  • PDF escaneado / imagem → Claude Sonnet vision
  • DOCX → mammoth.js
  • TXT → leitura direta (sempre elegível)
    ↓
    ├── Conteúdo extraído com qualidade suficiente?
    │       ↓ SIM
    │   ✅ ELEGÍVEL
    │   → status: eligible
    │   → conteúdo pré-extraído armazenado (usado na geração sem re-extrair)
    │
    └── NÃO → aplicar melhoria automática de imagem (Sharp):
            • Normalizar contraste e brilho
            • Aguçar nitidez (sharpen)
            • Converter para escala de cinza
            • Corrigir inclinação (deskew)
            • Substituir o arquivo original pela versão melhorada
                ↓
            Retry de extração com versão melhorada
                ↓
            ├── Conseguiu?
            │       ↓ SIM
            │   ✅ ELEGÍVEL (melhorado automaticamente)
            │   → status: enhanced_eligible
            │   → campo enhanced: true
            │
            └── NÃO
                ❌ INELEGÍVEL
                → status: ineligible
                → eligibility_reason: código do motivo
                → Notificação in-app ao profissional
```

**Motivos de inelegibilidade e mensagens ao profissional:**

| Código | Mensagem exibida |
|---|---|
| `image_illegible` | "Imagem ilegível mesmo após melhoria automática. Fotografe com boa iluminação, câmera estável e foco." |
| `pdf_no_text` | "PDF escaneado com resolução insuficiente. Tente reescanear em mín. 300 DPI ou exportar com camada de texto." |
| `password_protected` | "Documento protegido por senha. Remova a proteção antes de enviar." |
| `file_corrupted` | "Arquivo corrompido ou formato inválido. Tente reexportar ou enviar em outro formato." |
| `blank_content` | "Nenhum conteúdo detectado. O documento parece estar em branco ou vazio." |

**Campos no Firestore por arquivo:**

```json
{
  "eligibility_status": "eligible | enhanced_eligible | ineligible | pending",
  "eligibility_reason": null,
  "eligibility_message": null,
  "enhanced": false,
  "pre_extracted_content": "texto extraído — reutilizado na geração sem re-extrair"
}
```

**Interface — badge no arquivo:**

| Status | Badge | Ação disponível |
|---|---|---|
| `pending` | ⏳ Avaliando... | — |
| `eligible` | ✅ Elegível | Pode ser selecionado na geração |
| `enhanced_eligible` | ✅ Elegível (melhorado) | Pode ser selecionado; tooltip: "Qualidade melhorada automaticamente" |
| `ineligible` | ❌ Inelegível | Não pode ser selecionado; tooltip: motivo + sugestão |

**Regras complementares:**
- A melhoria automática (Sharp) se aplica apenas a imagens — PDFs corrompidos e DOCX inválidos vão direto para `ineligible`
- O arquivo original é substituído pela versão melhorada (não há duas versões armazenadas)
- Para substituir um arquivo inelegível: profissional **exclui** o arquivo e faz novo upload — o novo arquivo passa pelo ciclo padrão
- Notificação in-app disparada **apenas** para status `ineligible` — `enhanced_eligible` não notifica (melhoria foi transparente)
- O campo `pre_extracted_content` evita re-extração na geração — melhora performance e consistência
- Se o arquivo for excluído após elegibilidade e um novo for enviado, o ciclo roda do zero — sem reaproveitar conteúdo de versões anteriores

### 6.10 Escaneamento de malware pós-upload

- Todos os arquivos enviados passam por escaneamento via **ClamAV** em Cloud Function
- Escaneamento em background (não bloqueia a resposta de upload)
- Se malware detectado: arquivo marcado como `quarentena` no Firestore, inacessível para o profissional, Admin Clínica notificado
- Custo estimado: ~R$ 0,08/mês para 1.500 uploads — open source sem custo de licença

### 6.6 Pré-classificação por nome de arquivo

No momento do upload, o sistema infere o instrumento ou tipo de conteúdo com base no nome do arquivo:

- Verifica presença de palavras-chave dos instrumentos da biblioteca (`etdah`, `cars`, `tde`, `abfw` etc.)
- Salva campo `inferred_instrument` no registro do arquivo (pode ser `null` se não reconhecido)
- Confiança sempre declarada como `baixa` — baseado apenas no nome
- Tela de cobertura pré-geração exibe: *"ETDAH — identificado pelo nome do arquivo"*
- Classificação definitiva ocorre no Analítico durante a geração

---

## 7. Pipeline de Geração de Documentos

### 7.1 Visão geral do pipeline

```
Arquivos selecionados pelo profissional
(PDF · DOCX · imagem · texto — áudio não suportado)
    ↓
Pré-processador (extração de texto PDF/imagem/DOCX)
    ↓
Agente Analítico (Sonnet) — interpreta, cruza fontes, produz dossiê
    ↓
Agente Redator (Sonnet) — redige o documento com base no dossiê + brief
    ↓
Agente Revisor (Sonnet) — valida regras clínicas e éticas
    ↓
Documento salvo no Firestore + DOCX no GCS
```

### 7.2 Geração assíncrona

- A geração é disparada em background após resposta HTTP imediata com `job_id`
- Frontend usa **Firestore real-time listener** (`onSnapshot`) na collection `jobs` para acompanhar progresso — substitui polling HTTP
- Timeout Cloud Run: 900s
- Lock de pipeline por paciente (`pipeline_ativo` no Firestore): impede geração simultânea pelo mesmo profissional

**Indicador de progresso persistente:**
- Barra de progresso discreta no topo da interface (não bloqueia navegação)
- Exibe etapa atual e percentual de avanço
- A barra **não desaparece** quando o profissional navega para outras telas
- Ao retornar para a tela do relatório, o profissional vê o histórico completo do progresso (em andamento ou finalizado)

**Granularidade do progresso exibida ao profissional:**
```
⏳ Extraindo texto dos arquivos...    [1/4]
⏳ Analisando instrumentos...          [2/4]
⏳ Redigindo documento...              [3/4]
⏳ Revisando regras clínicas...        [4/4]
✅ Relatório pronto!
```

**Histórico de geração:**
- Cada geração fica registrada com: data/hora de início, data/hora de conclusão, status final, etapas concluídas
- Custo de IA **não aparece no histórico visível ao profissional** — campo `custo_ia_usd` é interno, acessível somente ao Admin Sistema
- Acessível em aba "Histórico" dentro do relatório
- Imutável — não pode ser apagado pelo profissional

### 7.3 Proteção contra prompt injection via arquivos

Todo conteúdo extraído de arquivos do paciente (PDFs, transcrições, imagens) é encapsulado em delimitadores XML antes de ser enviado aos agentes, prevenindo prompt injection:

```
<document source="etdah_protocolo.pdf" type="teste">
  [conteúdo extraído]
</document>
```

Os agentes são instruídos explicitamente a **ignorar qualquer instrução presente dentro dos documentos**. O conteúdo dos arquivos é tratado como dado — nunca como instrução. Esta proteção não impacta a extração clínica.

### 7.4 Agente Analítico

**Responsabilidade:** Ler todos os arquivos selecionados, interpretar instrumentos, cruzar fontes, identificar inconsistências e produzir dossiê analítico em JSON.

**Comportamento com dados insuficientes:**
- Dado parcial: analisa o que existe, registra lacuna no dossiê
- Arquivo não reconhecido como instrumento: extrai o que encontrar (modo universal) e registra `[Documento externo — interpretação baseada no conteúdo]`
- Dado ausente: registra como lacuna clínica no dossiê com sugestão de complementação
- **Nunca marca como ausente se o dado aparecer em qualquer documento fornecido**

**Rastreamento de fontes:** todo dado no dossiê tem fonte identificada (`etdah_protocolo.jpg`, `anamnese_01mai.docx`, etc.). O Redator só pode escrever o que está no dossiê com fonte rastreada.

### 7.5 Agente Redator

**Responsabilidade:** Redigir o documento com base exclusivamente no dossiê do Analítico, respeitando o brief do template selecionado e injetando padrões de aprendizado aprovados na curadoria.

**Estrutura do conteúdo injetado no system prompt:**
```
Bloco 1: Competência clínica ética (fixo — inviolável)
Bloco 2: Módulo de conselho profissional (dinâmico — ver seção 16)
Bloco 3: Brief do template selecionado (configurável pelo profissional)
Bloco 4: Critérios dos instrumentos confirmados pelo profissional (dinâmico)
Bloco 5: Padrões de aprendizado aprovados na curadoria (dinâmico — G3)
Bloco 6: Dossiê analítico com fontes (gerado pelo Analítico)
```

**Regra de seções — definitiva:**

| Tipo de seção | Comportamento |
|---|---|
| **Obrigatória** (definida pelo tipo de documento — ver seção 8.6) | Sempre aparece. Com dado: redige normalmente. Sem dado: redige com linguagem clínica de pendência — nunca placeholder técnico |
| **Opcional** (emerge do conteúdo disponível) | Aparece somente se há dado relevante no dossiê |

Subseções em "Observações Complementares": o profissional escreve o conteúdo no brief; o Redator gera o título da sub-seção baseado no conteúdo e o reproduz fielmente — sem interpretar ou expandir.

### 7.6 Agente Revisor

**Responsabilidade:** Validar regras clínicas e éticas antes de aprovar o documento.

**Validações obrigatórias (independem de configuração):**
- Nenhum diagnóstico fechado CID/DSM
- Nenhum dado inventado sem fonte rastreável no dossiê
- Nenhum escore fora do range válido do instrumento
- Validações específicas por instrumento (ver seção 9)
- Validações específicas do conselho profissional (ver seção 16)

**Fluxo quando o Revisor reprova:**

1. Documento salvo com `status: reprovado` + campo `alertas_revisor` (lista das regras violadas)
2. Profissional é notificado via notificação in-app + e-mail (badge na lista de relatórios + ícone de notificação no header)
3. Cada alerta exibido ao profissional contém três campos:
   - **Código** (técnico — para logs e auditoria): ex: `etdah_percentil_range`
   - **Descrição clínica** (linguagem acessível): ex: *"O percentil informado está fora do range válido (1–99) para o ETDAH. Verifique o protocolo original."*
   - **Sugestão de ação**: ex: *"Corrija o dado no protocolo, atualize o arquivo e gere novamente."*
4. Profissional pode solicitar **regeneração** (pipeline reinicia do zero)
5. **Nunca** é possível forçar publicação de documento reprovado — isso burlaria a proteção ética
6. Admin Clínica enxerga documentos reprovados na lista com badge "Reprovado pelo Revisor"
7. Motivo da reprovação fica no Firestore para auditoria permanente

### 7.7 Dossiê analítico — persistência obrigatória

O dossiê produzido pelo Analítico é **persistido** no Firestore como campo `dossie_json` (string) no documento do relatório. Motivos:

- É o elo de rastreabilidade entre fontes e texto gerado (proteção 15.3)
- Permite regenerar apenas o Redator sem re-executar o Analítico
- Em contestação clínica ou legal, é o único artefato que prova de onde vieram os dados

### 7.8 Seleção de arquivos na geração

O profissional vê todos os arquivos do paciente com checkbox antes de confirmar a geração:

- Pré-seleção inteligente: arquivos usados na última geração ficam marcados por padrão
- Botão "Selecionar todos" (seleciona apenas elegíveis)
- Arquivos **inelegíveis** aparecem na lista com ❌ e **checkbox desabilitado** — não podem ser selecionados; tooltip exibe o motivo e a sugestão de ação
- Arquivos com avaliação `pending` (ainda sendo avaliados) aparecem com ⏳ e checkbox desabilitado temporariamente
- Arquivos `enhanced_eligible` aparecem normalmente com ✅ (sem distinção visual especial — a melhoria foi transparente)
- Profissional pode incluir ou excluir qualquer arquivo elegível para aquela geração específica
- Arquivos selecionados são registrados no histórico do relatório (auditoria clínica — imutável)
- Schema do campo `arquivos_usados` (snapshot imutável — preservado mesmo se arquivo for excluído):
  ```json
  [{ "file_id": "uuid", "original_name": "etdah.jpg", "category": "teste", "file_type": "image", "storage_path": "patients/...", "eligibility_status": "eligible" }]
  ```
- O Analítico usa o campo `pre_extracted_content` quando disponível — evita re-extração e garante consistência com a avaliação de elegibilidade
- **Custo não é exibido** nesta tela — aparece apenas na área de acompanhamento de custos

### 7.9 Cobertura do documento

Antes de confirmar a geração, o sistema exibe resumo de cobertura:

```
✅ Anamnese              dados presentes
✅ Avaliação ETDAH       dados presentes
⚠  Histórico escolar     arquivo não selecionado nesta geração
⚠  Documentos externos  não existem no cadastro do paciente
```

O profissional decide conscientemente se prossegue ou adiciona arquivos. O sistema nunca bloqueia a geração.

---

## 8. Templates de Documento (Brief)

### 8.1 Conceito

O profissional não configura seções nem edita prompts. Configura o **propósito e estilo** do documento por meio de um formulário (Brief). O sistema usa esse brief para parametrizar o Redator. Seções emergem do conteúdo — não de um catálogo fixo.

### 8.2 Campos do Brief

| Campo | Tipo | Obrigatório |
|---|---|---|
| Nome do template | Texto livre | ✅ |
| Tipo de documento | Dropdown (RAN · Laudo · Relatório de Acompanhamento · Relatório de Evolução · Parecer Técnico) | ✅ |
| Para quem é | Dropdown (Outros profissionais de saúde · Escola / Educadores · Família / Responsáveis · Judiciário) | ✅ |
| Tom | Dropdown (Formal técnico · Formal acessível · Semi-formal · Formal legal) | ✅ |
| Propósito | Texto livre (2–3 frases) | ✅ |
| Sempre priorizar | Texto livre (opcional) | ❌ |
| Sempre incluir | Texto livre (opcional) | ❌ |
| Nunca incluir | Texto livre (opcional) | ❌ |
| Categorias de arquivo | Checkboxes (Anamnese · Testes · Sessões · Intervenções · Externos) | ✅ |

### 8.3 Sugestões contextuais

Cada campo de texto exibe chips de sugestão que mudam conforme:
- Especialidade do profissional
- Público selecionado
- Tipo de documento

O profissional clica no chip para inserir e edita se necessário. Nunca digita do zero.

**Exemplos de sugestões por contexto:**

| Campo | Público: Família | Público: Escola | Público: Judiciário |
|---|---|---|---|
| Propósito | "Orientar a família sobre o desenvolvimento..." | "Subsidiar adaptações pedagógicas..." | "Subsidiar decisão judicial com embasamento técnico..." |
| Sempre priorizar | "Potencialidades antes das dificuldades" | "Impacto funcional no cotidiano escolar" | "Embasamento técnico com citação de instrumentos" |
| Nunca incluir | "Terminologia diagnóstica direta" | "Pontuações brutas dos testes" | "Especulações sem embasamento" |

### 8.4 Comportamento do template

- Template é sempre usado exatamente como configurado (sem ajuste por geração)
- Profissional pode ter múltiplos templates salvos
- Admin Clínica pode criar templates padrão para a clínica inteira — todos herdam
- Plataforma já vem com templates pré-configurados por especialidade

### 8.5 Templates pré-configurados na plataforma

| Especialidade | Templates incluídos |
|---|---|
| Neuropsicopedagogia | RAN Completa · Laudo · Parecer Técnico |
| Fonoaudiologia | Relatório Fonoaudiológico · Parecer de Linguagem · Laudo |
| Psicologia | Laudo Psicológico · Relatório de Acompanhamento · Parecer |
| Terapia Ocupacional | Relatório TO · Relatório Sensorial · Parecer Funcional |
| Neuropsicologia | Laudo Neuropsicológico · Relatório Cognitivo |

Nota: "Relatório Escolar" não é um tipo de documento — é uma **seção** incluída em documentos do tipo Laudo ou Parecer quando o público-alvo é "Escola / Educadores". O campo "Para quem é" no brief parametriza o Redator para incluir essa seção quando aplicável.

Admin Clínica pode renomear templates para adequar à identidade da clínica. Estrutura interna é mantida.

### 8.6 Seções obrigatórias por tipo de documento

Independem do brief — sempre geradas pelo Redator:

| Tipo | Seções obrigatórias |
|---|---|
| RAN | Identificação do paciente · Identificação do profissional · Queixa Principal · Hipóteses Diagnósticas · Encaminhamentos |
| Laudo | Identificação do paciente · Identificação do profissional · Objetivo · Metodologia · Análise · Conclusão |
| Relatório de Acompanhamento | Identificação · Período de acompanhamento · Objetivos trabalhados · Evolução observada · Próximos passos |
| Relatório de Evolução | Identificação · Período · Objetivos Trabalhados · Próximos Passos |
| Parecer Técnico | Identificação · Objetivo do Parecer · Análise · Parecer Final |

Seções obrigatórias com dados insuficientes recebem linguagem clínica de pendência — nunca placeholder técnico. A regra é: **seção obrigatória sempre aparece; seção opcional só aparece se há dado.**

### 8.7 Observações complementares

Campo disponível em todos os tipos de documento. O profissional escreve o conteúdo livremente. O sistema gera o título da sub-seção com base no conteúdo avaliado. O Redator reproduz fielmente — sem interpretar ou expandir.

---

## 9. Biblioteca de Instrumentos

### 9.1 Áreas de atuação e instrumentos associados

O profissional seleciona uma ou mais áreas no perfil. A biblioteca filtra instrumentos por área.

| Área | Exemplos de instrumentos |
|---|---|
| Neuropsicopedagogia | ETDAH, CARS, TDE-2, Consciência Fonológica, Lateralidade |
| Fonoaudiologia | ABFW, PPVT, PROLEC, Perfil Fonológico, Processamento Auditivo |
| Terapia Ocupacional | Sensory Profile, PEDI, VMI, Beery |
| Psicologia | WISC, BDI, BAI, HTP, Rorschach |
| Neuropsicologia | BADS, Trail Making, Rey, Digit Span |

Profissional com múltiplas áreas vê a união dos instrumentos de todas as áreas selecionadas, com badge indicando a origem de cada instrumento.

### 9.2 Três camadas da biblioteca

```
Camada 1 — Plataforma (platform_instrument_library/{instrument_id})
  Gerenciada exclusivamente pelo Admin Sistema
  Nunca editada por clínicas ou profissionais
  Contém instrumentos validados e aprovados para uso clínico

Camada 2 — Clínica (clinics/{clinic_id}/instruments/{instrument_id})
  Gerenciada pelo Admin Clínica — ÚNICA responsável por calibrar
  os instrumentos usados por TODOS os profissionais daquela clínica
  Pode confirmar instrumentos da Camada 1 ou adicionar instrumentos próprios
  Admin Clínica calibra faixas, notas clínicas e normas regionais aplicáveis

Camada 3 — Profissional (clinics/{clinic_id}/users/{user_id}/instruments/{instrument_id})
  Gerenciada pelo próprio profissional
  Apenas para instrumentos específicos do profissional não cobertos pela clínica
  Isolado por user_id — sem acesso cruzado entre profissionais
```

### 9.3 Estrutura de dados de um instrumento

```json
{
  "nome": "ETDAH",
  "nome_completo": "Escala de Transtorno do Déficit de Atenção e Hiperatividade",
  "areas": ["neuropsicopedagogia", "neuropsicologia"],
  "faixa_etaria": { "min": 6, "max": 17 },
  "referencia": "Rueda, F.J.M. (2014). ETDAH: Manual técnico.",
  "versao_instrumento": "1.0",

  "dimensoes": [
    {
      "id": "fator_re",
      "nome": "Fator RE — Regulação Emocional",
      "tipo_metrica": "percentil",
      "escala_invertida": true,
      "nota_clinica": "Percentil baixo = mais sintomas",
      "faixas": [
        { "de": 0,  "ate": 24, "rotulo": "Inferior",      "cor": "red"   },
        { "de": 25, "ate": 74, "rotulo": "Médio",          "cor": "green" },
        { "de": 75, "ate": 94, "rotulo": "Superior",       "cor": "amber" },
        { "de": 95, "ate": 99, "rotulo": "Muito Superior", "cor": "red"   }
      ]
    }
  ],

  "alertas_eticos": [
    "Nunca usar como diagnóstico fechado — sempre como hipótese diagnóstica"
  ],

  "regras_revisor": [
    { "id": "etdah_percentil_range", "regra": "Percentil fora de 1-99 → reprovar documento" },
    { "id": "etdah_fator_valido",    "regra": "Fator deve ser RE/HI/CA/A" }
  ]
}
```

### 9.4 Tipos de métrica suportados

| Tipo | Exemplo |
|---|---|
| `percentil` | ETDAH (0–99) |
| `pontuacao` | CARS (15–60) |
| `nivel` | TDE-2 (A–H), Consciência Fonológica |
| `categoria` | Lateralidade (manual/podal/visual/auditiva) |

### 9.5 Fluxo de confirmação pelo Admin Clínica (Camada 1 → Camada 2)

1. Admin Clínica acessa a biblioteca da plataforma
2. Visualiza detalhes: dimensões, faixas, alertas éticos, regras do Revisor
3. Confirma e configura: `norma_regional`, `notas_clinicas_da_clinica` — sem alterar a base da plataforma
4. Instrumento fica disponível para todos os profissionais da clínica
5. Instrumento atualizado na plataforma: Admin Clínica recebe aviso e pode revisar e re-confirmar as calibrações

**Fluxo de instrumento privado do Profissional (Camada 3):**  
Idêntico ao fluxo da Camada 2, mas restrito ao profissional. Usado apenas para instrumentos específicos não cobertos pela clínica.

### 9.6 Fluxo de instrumento privado (upload de manual PDF)

**Passo 1 — Identificação**
- Nome, nome completo, áreas, faixa etária, referência bibliográfica

**Passo 2 — Upload de manual (opcional, recomendado)**
- PDF do manual enviado para GCS
- Claude (visão) extrai tabelas de normas e critérios de interpretação
- Cada campo extraído recebe `confianca: alta | media | baixa`

**Passo 3 — Curadoria da extração**
- Profissional revisa cada dimensão extraída
- Campos com confiança `baixa` ou `media` destacados em amarelo — atenção obrigatória
- Profissional aprova ou ajusta cada dimensão
- Instrumento só fica `ativo` após confirmação explícita

**Passo 3b — Configuração manual (se pulou upload)**
- Profissional preenche dimensões manualmente
- Interface com validação: `de < ate`, sem sobreposição de faixas, rótulo obrigatório

### 9.7 Status dos instrumentos confirmados

| Status | Significado | Entra no pipeline? |
|---|---|---|
| `pendente_validacao` | Aguarda revisão da extração | ❌ |
| `ativo` | Confirmado pelo profissional | ✅ |
| `inativo` | Desativado manualmente | ❌ |

Instrumentos da base/clínica: apenas desativados (nunca deletados).
Instrumentos privados: podem ser deletados pelo profissional.

### 9.8 Integração no pipeline

- `agentAnalytico` recebe `user_id` e `clinic_id`, carrega instrumentos ativos (Camada 2 da clínica + Camada 3 do profissional)
- Para cada conselho profissional do profissional, o módulo de agente especialista correspondente é injetado (ver seção 16)
- Instrumento desconhecido pelo sistema → modo de leitura universal (extrai o que encontrar, registra no dossiê como "fonte não reconhecida")
- Instrumento identificado mas não confirmado pela clínica → Analítico sinaliza no dossiê + sugere confirmação

### 9.9 Solicitação de novo instrumento para a biblioteca base

Quando um instrumento não existe na biblioteca da plataforma:
1. Profissional clica "Solicitar instrumento"
2. Descreve o instrumento e a necessidade
3. Admin Sistema recebe notificação
4. Admin Sistema + Claude avaliam e criam o instrumento na biblioteca base
5. Profissional recebe aviso quando disponível

Enquanto não disponível na base, profissional pode criar como instrumento privado.

---

## 10. Autoaprendizado e Curadoria

### 10.1 Ciclo completo

```
Sistema gera documento
    ↓
Profissional baixa DOCX
    ↓
Profissional edita no Word (conteúdo, seções, tom, etc.)
    ↓
Profissional importa DOCX editado no sistema
    ↓
Sistema compara original vs. editado (diff)
    ↓
Claude identifica padrões de estilo e estrutura
    ↓
Candidatos a aprendizado → Área de Curadoria
    ↓
Profissional: Aprovar ou Recusar
    ↓
Aprovados → Base de conhecimento do profissional
    ↓
Próxima geração: padrões aprovados injetados no Redator (G3)
```

### 10.2 Extração de padrões (diff)

Ao importar um DOCX editado, o sistema:
1. Compara `content_md` original com o conteúdo convertido do DOCX
2. Chama `extrairPadroesDoRelatorio` em background (não bloqueia a importação)
3. Claude analisa as diferenças e identifica padrões generalizáveis de estilo e estrutura
4. Padrões com confiança `baixa` são descartados automaticamente
5. Máximo 8 padrões por importação

**O que é extraído (exemplos):**
- "Preferência por linguagem de hipótese antes de citar o instrumento"
- "Tom mais acolhedor ao descrever dificuldades para a família"
- "Sempre citar o nome completo do instrumento na primeira menção"

**O que nunca é extraído:**
- Dados numéricos específicos do paciente
- Nomes próprios
- Pontuações de testes
- Conclusões diagnósticas específicas do caso

**Validação pós-extração de PII (camada de segurança adicional):**
Antes de salvar qualquer padrão no Firestore, o sistema aplica verificação automática:
- Regex para CPF/CNPJ, telefones BR, datas no formato BR, e-mails
- Verificação do nome do paciente (do relatório de origem) dentro do texto do padrão
- Padrões com suspeita de PII recebem `pii_risk: true` → requerem aprovação manual explícita → nunca auto-aprovados

### 10.3 Curadoria dos padrões

Interface na aba "Curadoria" em Configurações:

- Filtros: Pendente · Ativo · Rejeitado
- Cada card mostra: tipo, descrição, exemplo original vs. editado, contador de ocorrências
- Ações: **Aprovar** (entra na base) | **Recusar** (descartado)
- **Auto-aprovação:** padrão que ocorre em 3 relatórios **distintos** (3 `report_id` diferentes como origem) é auto-aprovado. O mesmo relatório importado múltiplas vezes conta como 1 ocorrência (deduplicação por `report_id` de origem). Padrões com `pii_risk: true` nunca são auto-aprovados — exigem confirmação manual.
- Padrões rejeitados são removidos automaticamente após 30 dias

### 10.4 Injeção no Redator (G3)

Ao gerar um documento, o Redator carrega todos os padrões com `status = ativo` do profissional e os injeta como seção de estilo no userMessage:

```
Padrões de estilo da profissional (aprendidos de relatórios anteriores):
1. [estilo] Iniciar descrição de dificuldades com potencialidades relacionadas
2. [estrutura] Citar instrumento pelo nome completo na primeira menção
3. [interpretacao] Contextualizar score numérico com comportamento observado
```

### 10.5 Status do documento importado

Documento importado recebe automaticamente `status: revisado`. É o único caminho para um documento ser marcado como revisado — nunca automaticamente pelo pipeline.

---

## 11. Perfil Profissional e Capa

### 11.1 Dados do profissional (configurados pelo próprio)

- Nome completo
- Título / formação
- Áreas de atuação (checkboxes — múltipla seleção)
- Registros profissionais (múltiplos, da lista da clínica)
- Assinatura digital (imagem opcional)

### 11.2 Dados da clínica (configurados pelo Admin Clínica)

- Nome da clínica
- Logo (imagem)
- Endereço e contato
- Conselhos profissionais habilitados

### 11.3 Capa gerada automaticamente

A capa é composta por dados estruturados — nunca texto livre. O profissional não formata a capa. Profissional não pode alterar dados da clínica na capa. O layout é bonito e profissional, adequado para entrega ao paciente, escola ou judiciário.

**Blocos da capa (nesta ordem):**

```
[Logo da clínica — centralizado]

[Nome do tipo de documento em destaque]
ex: RELATÓRIO DE AVALIAÇÃO NEUROPSICOPEDAGÓGICA

─────────── DADOS DO PACIENTE ───────────
Paciente:      João da Silva
Data Nasc.:    10/03/2015       Idade: 11 anos
Responsável:   Maria da Silva

─────────── DADOS DO PROFISSIONAL ───────────
Profissional:  Patrízia Santarém
Formação:      Neuropsicopedagoga Clínica
Registros:     ABPp XXXXX | CRP 04/XXXXX
Data:          15/05/2026

─────────── DADOS DA CLÍNICA ───────────
Clínica:       Instituto Nexum
Endereço:      Rua X, 123 — Uberlândia - MG
Contato:       (34) XXXXX-XXXX

[Assinatura digital — se disponível]
```

**Regras:**
- Dados do paciente: nome, data de nascimento, idade calculada, responsável (se menor)
- Dados da clínica: sempre da configuração da clínica — profissional não pode alterar
- Assinatura: imagem (validade jurídica limitada — ver seção 20 sobre dívida técnica)
- Capa é gerada no DOCX; não aparece no preview inline do sistema

---

## 12. Configurações

### 12.1 Layout do relatório

- Fonte do corpo do texto (padrão: Arial)
- Tamanho da fonte (padrão: 11pt)
- Cabeçalho personalizado
- Logo (base64, máx. 800KB)

Configurável por clínica (padrão) e por profissional (override).

### 12.2 Categorias de arquivo

- Rótulos personalizáveis por clínica e profissional
- Chaves internas imutáveis: `anamnese`, `teste`, `sessao`, `relatorio`, `intervencao`
- Categoria `externo` descontinuada (ver seção 5.3)

### 12.3 Curadoria de padrões

Ver seção 10.3.

### 12.4 Instrumentos

Ver seção 9.

### 12.5 Templates de documento

Ver seção 8.

### 12.6 Perfil de áreas de atuação

Ver seção 9.1.

---

## 13. Painel Administrativo

Acessível apenas pelo Admin Sistema.

### 13.1 System prompt da plataforma

- Visualizar versão ativa
- Editar e publicar nova versão
- Histórico de versões com rollback
- O system prompt nunca é exposto para clínicas ou profissionais

### 13.2 Motor config

Parâmetros do pipeline (limiares, modelos, timeouts). Editável somente pelo Admin Sistema.

### 13.3 Biblioteca de instrumentos base

Ver seção 9.2 (Camada 1).

### 13.4 Catálogo de sugestões do Brief

- Gerenciar chips de sugestão por campo, por público e por especialidade
- Adicionar novas sugestões com base em feedback dos profissionais

### 13.5 Activity log

- Registro imutável de todas as ações do sistema
- Filtros por clínica, profissional, tipo de ação e período

---

## 14. Modelo de Negócio e Acompanhamento de Custos

### 14.1 Estrutura de cobrança — Assinatura com quota de relatórios ✅ DECISÃO FINAL

O modelo de negócio é uma **assinatura mensal (ou anual) com quota de relatórios incluída**. O cliente paga uma vez, escolhe o plano, e pode gerar relatórios sem gerenciar créditos ou saldo.

**Custo real por relatório (sem áudio — funcionalidade descontinuada):**
- Claude API (Analítico + Redator + Revisor): ~USD 0,24 = ~R$ 1,41
- Google STT: **R$ 0,00 — descontinuado**
- **Total por relatório: ~R$ 1,53** (câmbio PTAX ~5,87)

| Plano | Valor/mês | Relatórios incluídos | Custo IA do plano | Margem bruta de IA |
|---|---|---|---|---|
| **Individual** | R$ 149 | 10 relatórios/mês | ~R$ 15 | ~R$ 134 |
| **Clínica** | R$ 299 | 40 relatórios/mês | ~R$ 61 | ~R$ 238 |
| **Clínica Pro** | R$ 599 | 150 relatórios/mês | ~R$ 230 | ~R$ 369 |

**Relatório adicional acima da quota (overage):** R$ 12,00/relatório — cobrado automaticamente no cartão ao gerar.

**Plano anual:** 10 meses pelo preço de 12 (ex: Individual anual = R$ 1.490/ano).

**Tiers, valores e quotas:** sujeitos a calibração após pesquisa de mercado. A estrutura (quota incluída + overage automático) é a decisão arquitetural.

Infraestrutura, suporte e margem da Nexum estão cobertos pela **assinatura** — não há cobrança variável separada para o cliente.

### 14.2 Trial para novas clínicas

- Clínicas novas têm trial de **14 dias corridos** com até **2 gerações de relatório gratuitas** — o que ocorrer primeiro
- Mensalidade **não está em trial** — cobrada normalmente desde o primeiro dia
- Após o trial, as gerações passam a ser contabilizadas na quota do plano normalmente
- **Anti-burla:** o trial é vinculado ao **CNPJ** (pessoa jurídica) ou **CPF** (profissional autônomo) fornecido no cadastro — não ao e-mail nem ao cartão de crédito. Sistema verifica se o documento já utilizou trial anteriormente. Se sim, trial não concedido.
- Limite de trial gerenciado em `clinics/{clinic_id}` (campos `trial_reports_remaining`, `trial_expires_at`, `document_number`)

### 14.3 Planos e precificação

| Plano | Cobrança | Valor |
|---|---|---|
| **Mensal** | R$ 89,00/mês | Cobrança recorrente no cartão |
| **Anual** | R$ 890,00/ano | Equivale a 10 meses — economia de 2 meses (~17%) |

- Pagamento via **cartão de crédito** (gateway a definir — ver seção 14.9)
- Tiers de capacidade (número de profissionais, pacientes, armazenamento): a definir conforme pesquisa de mercado
- Reajuste anual pelo **IPCA acumulado do período** com aviso prévio de 30 dias — cobre variação cambial estrutural
- Variações de preço da Anthropic API repassadas ao cliente com aviso prévio de 30 dias

### 14.4 Controle de consumo e isolamento por clínica (Anthropic Workspaces)

Internamente, a Nexum usa **Anthropic Workspaces** para isolar o rastreamento de consumo por clínica — sem que o cliente precise saber disso.

**Arquitetura:**
```
Organização Nexum (uma conta, uma fatura consolidada Anthropic)
├── Workspace: Clínica Alfa     ← API Key isolada, criada automaticamente no onboarding
├── Workspace: Clínica Beta     ← API Key isolada, criada automaticamente no onboarding
└── Workspace: Clínica Gamma   ← API Key isolada, criada automaticamente no onboarding
```

- A Nexum cria o Workspace da clínica **automaticamente no onboarding** — sem ação do cliente
- Cada geração usa a API Key do Workspace da clínica correspondente
- Nexum paga fatura consolidada mensal à Anthropic; Workspaces garantem rastreabilidade por clínica
- Cliente **nunca precisa ter conta na Anthropic**

**Controle de quota no sistema:**
- Sistema registra o número de relatórios gerados no mês corrente por clínica
- Ao atingir a quota do plano: exibe aviso ao profissional + informa custo do relatório adicional (overage R$12,00)
- Profissional decide conscientemente se gera com overage — **não bloqueia automaticamente**
- Overage acumulado no mês cobrado automaticamente no cartão no fechamento do ciclo

**Custo armazenado internamente:**
- `custo_ia_usd` por geração (fonte verdadeira para auditoria interna Nexum)
- PTAX do dia do repasse para Anthropic obtida via API BCB — cache 24h
- Custo em BRL calculado como `custo_ia_usd × ptax × 1,05` (5% cambial embutido)
- Este custo é interno — o cliente não vê breakdown de USD/PTAX — vê apenas "Relatório adicional: R$ 12,00"

### 14.5 Política de cobrança de overage e reembolso

**Overage (relatório adicional acima da quota):**
- Cobrado a R$ 12,00/relatório no fechamento do ciclo mensal
- O profissional é avisado antes de gerar que o relatório é overage e qual o custo
- Confirma conscientemente — não é cobrado por surpresa

**Reembolso de overage por falha técnica:**

| Situação | Ação |
|---|---|
| `job.status = error` — falha técnica (Cloud Run, timeout, erro de API) | ✅ Overage estornado automaticamente no próximo ciclo |
| `job.status = reprovado` — Revisor reprovou por questão clínica | ❌ Sem estorno — geração foi executada com sucesso |
| `job.status = timeout` — watchdog marcou por inatividade | ✅ Overage estornado automaticamente |

Relatórios dentro da quota do plano: falha técnica não gera cobrança adicional (a quota não é consumida em falhas).

O status é registrado automaticamente no Firestore — sem necessidade de julgamento humano.

### 14.6 Regras de quota e overage

- Quota **não acumula** entre meses — relatórios não usados em um mês não são transferidos para o próximo
- Overage não tem limite máximo — o profissional pode gerar quantos relatórios adicionais precisar, pagando R$ 12,00 cada
- Alerta quando restam **2 relatórios** da quota do mês — notificação in-app ao Admin Clínica
- Alerta quando quota é zerada — profissional recebe aviso no momento de gerar (não é bloqueado, é informado)
- Workspaces Anthropic são gratuitos — sem custo adicional para Nexum criar um por clínica
- `workspace_api_key` de cada clínica armazenada no Google Secret Manager (nunca no Firestore)

### 14.7 Painel de consumo — exclusivo Admin Sistema

**Princípio:** custos monetários (USD, BRL, PTAX, custo por agente) nunca aparecem no fluxo clínico nem para Admin Clínica, Supervisor ou Profissional. Existem apenas na área de administração da plataforma, acessível exclusivamente pelo Admin Sistema (Nexum).

| Camada | Visibilidade de custos monetários |
|---|---|
| **Admin Sistema** | ✅ Todas as clínicas · MRR/ARR · churn · custo médio por relatório · custo por agente · período configurável |
| Admin Clínica | ❌ Não vê custos — apenas consumo de quota ("X de Y relatórios usados") |
| Supervisor | ❌ Não vê custos — nunca, mesmo se Admin Clínica tentar habilitar |
| Profissional | ❌ Não vê custos — apenas quota consumida |

**Justificativa:** o custo de IA é informação operacional interna da Nexum. Expor para clientes cria expectativa de que valores possam mudar, pressão sobre margens e incompreensão do modelo de assinatura.

**O que o profissional vê (simples e direto):**
```
Relatórios este mês: 7 de 10 incluídos no plano  (3 restantes)

Histórico:
  RAN Completa — João S.    15/05/2026    [incluso no plano]
  Laudo — Maria T.          12/05/2026    [incluso no plano]
  RAN Completa — Pedro A.   10/05/2026    [overage — R$ 12,00]
```

**O que o Admin Clínica vê:** apenas quota consumida por profissional — "João: 7 relatórios / Maria: 3 relatórios este mês". Sem valores em reais ou dólares.

O cliente **não vê USD, PTAX nem taxa cambial em nenhuma tela** — esses dados são internos da Nexum. A experiência é: plano com X relatórios, adicional custa R$ 12,00.

Sem estimativa de custo antes da geração. No histórico do profissional: somente data/hora e status — sem campo de custo.

### 14.8 Armazenamento do custo e saldo

**Por geração:**
- Campos: `custo_ia_usd`, `custo_stt_usd`, `ptax_data`, `ptax_valor`, `taxa_cambial_pct` (5%), `custo_brl_total`, `creditos_descontados`
- Custo armazenado em USD (fonte verdadeira) e BRL (valor descontado dos créditos)

**Por clínica:**
- Campo `creditos_brl` em `clinics/{clinic_id}` — saldo atual em BRL
- Histórico de recargas em `clinics/{clinic_id}/recargas/{recarga_id}`: valor, data, gateway, status
- Histórico de consumo em `clinics/{clinic_id}/consumo/{consumo_id}`: por geração, valor descontado, saldo antes/depois

**Tributação da Nexum:**
- ISS, PIS, COFINS incidem sobre a **mensalidade** (receita de serviço)
- A taxa cambial de 5% é **repasse de custo** (IOF + spread bancário) — tratamento tributário a validar com contador especializado em SaaS antes do lançamento comercial

### 14.9 Gateway de pagamento

- Mensalidade e recargas de crédito (se Opção A) cobradas via **cartão de crédito**
- Gateway: **a definir** — opções avaliadas: Iugu, Pagar.me, Vindi (nativas BR com boleto, PIX e cartão)
- **Fase 1 (até ~20 clínicas):** cobrança manual via PIX + nota fiscal emitida manualmente — aceitável enquanto a base é pequena
- **Fase 2:** gateway automatizado com dunning integrado

### 14.10 Régua de inadimplência (mensalidade)

| Prazo | Ação automática |
|---|---|
| D+0 | Fatura emitida |
| D+3 | Lembrete automático por e-mail (Resend) |
| D+7 | Bloqueio de novas gerações de relatório (acesso a dados existentes mantido) |
| D+15 | Bloqueio completo de acesso à plataforma (dados preservados) |
| D+30 | Admin Clínica notificado sobre situação e prazo para regularização |
| D+60 | Encerramento do contrato + notificação de início do processo de offboarding |

**Dados preservados após inadimplência:** registros de pacientes e relatórios **nunca são excluídos** por motivo de inadimplência — são mantidos por obrigações LGPD e auditoria clínica. O acesso é suspenso, não os dados.

### 14.11 Fluxo de cancelamento e offboarding

1. Admin Clínica solicita cancelamento no painel
2. Acesso à plataforma mantido até o fim do período já pago (sem pro-rata)
3. Admin Clínica recebe link de exportação completa (relatórios DOCX + metadados JSON + lista de arquivos) — válido por 90 dias
4. Após expiração do período pago: acesso suspenso, dados preservados no Firestore e GCS
5. **Dados nunca excluídos automaticamente** — exclusão física exige decisão explícita do Admin Clínica mesmo após cancelamento, por obrigações LGPD (retenção de 7 anos para prontuário clínico)

### 14.12 KPIs financeiros (painel Admin Sistema)

| KPI | Definição |
|---|---|
| MRR | Soma das mensalidades ativas no mês |
| ARR | MRR × 12 |
| Churn mensal | Clínicas canceladas / total de clínicas ativas |
| Custo médio de IA por relatório (USD) | `total custo_ia_usd` / `total relatórios gerados` |
| Margem bruta por clínica | `receita (mensalidade + overage) - COGS proporcional (Anthropic + Cloud Run + Firestore + GCS)` |
| Trial-to-paid conversion | Clínicas que pagaram após trial / total de trials |
| Revenue por clínica | Mensalidade + taxa cambial (se Opção A) |

Exportação mensal em **CSV/Excel** para uso pelo contador: total de receita por clínica, COGS por componente, margem bruta.

### 14.13 Considerações contábeis

- **Revenue recognition:** planos anuais geram receita diferida — reconhecer proporcionalmente mês a mês
- **Taxa cambial de 5%:** é repasse de custo (IOF + spread bancário) — não constitui receita da Nexum
- **COGS (custo dos serviços — impacta margem bruta):** Anthropic API (Claude) + Cloud Run + Firestore + GCS (STT descontinuado)
- **Tributação** (ISS, PIS/COFINS, IRPJ — regime a definir com contador especializado em SaaS): incide sobre a mensalidade; tributação sobre o repasse cambial a validar
- Plano de contas completo a definir com contador antes do lançamento comercial

---

## 15. Proteções Éticas e de Qualidade

### 15.1 Proteções absolutas (invioláveis — nenhuma configuração pode sobrescrever)

Aplicam-se a todos os profissionais, clínicas e tipos de documento:

1. Nunca diagnóstico fechado CID/DSM — sempre linguagem de hipótese
2. Nunca inventar dados não presentes nos documentos analisados
3. Nunca omitir sinalizações de risco clínico identificadas
4. Nunca remover recomendações de encaminhamento quando clinicamente indicadas
5. Nunca usar placeholder técnico (`[DADO NÃO FORNECIDO]`) em documentos — usar linguagem clínica profissional
6. Nunca gerar seção vazia — seção sem dado não aparece no documento

### 15.2 Validações específicas por instrumento (Revisor)

Cada instrumento na biblioteca tem `regras_revisor`. O Revisor aplica todas as regras dos instrumentos identificados no documento. Exemplos:

- ETDAH: percentil fora de 1–99 → reprovar
- ETDAH: "Superior = bom desempenho" → reprovar (escala invertida violada)
- CARS: total fora de 15–60 → reprovar
- CARS: diagnóstico fechado de TEA → reprovar (violação ética)
- TDE-2: tipo de erro além de CFG/RC/IL/ENP → reprovar (dado fabricado)
- Qualquer instrumento: escore impossível → reprovar

### 15.3 Rastreabilidade

Todo dado no documento final é rastreável a um arquivo de origem via dossiê do Analítico. O histórico de arquivos usados em cada geração é imutável.

### 15.4 Imutabilidade histórica

Relatórios gerados ficam congelados com o perfil usado na geração (template, módulos de especialidade, versão do system prompt). Mudanças futuras de configuração não retroagem.

---

## 16. Módulo de Conselho Profissional

Este é o subsistema central de padronização clínica. Garante que documentos gerados seguem os padrões do conselho profissional do responsável — sem configuração manual pelo profissional.

### 16.1 Conceito

Cada conselho profissional possui diretrizes, estrutura de documentos e terminologia próprias. Um laudo produzido por um psicólogo deve seguir as resoluções do CFP. Um relatório fonoaudiológico deve seguir o CRFa. O sistema encapsula esse conhecimento em **módulos de agente** que são injetados automaticamente no Redator.

O profissional **não configura o módulo** — ele seleciona seu conselho no perfil e o módulo correspondente é aplicado automaticamente.

### 16.2 Estrutura de um módulo de conselho

Cada módulo contém:

```json
{
  "conselho_id": "cfp",
  "nome": "Conselho Federal de Psicologia",
  "especialidades": ["psicologia"],
  "diretrizes_eticas": [
    "Respeitar o sigilo profissional conforme art. 9º do Código de Ética Profissional do Psicólogo",
    "Nunca emitir diagnóstico além da competência da psicologia clínica"
  ],
  "estrutura_documentos": {
    "laudo": {
      "secoes_obrigatorias": ["Identificação", "Demanda", "Procedimentos utilizados", "Análise psicológica", "Conclusão"],
      "terminologia_preferencial": ["avaliação psicológica", "hipótese de trabalho", "indicadores"],
      "terminologia_proibida": ["diagnóstico definitivo", "portador de"]
    }
  },
  "versao": "2024-1",
  "fonte": "CFP Resolução 09/2018 — Elaboração de Documentos Escritos"
}
```

### 16.3 Como é injetado no pipeline

1. Ao gerar um documento, o sistema carrega os módulos dos conselhos do profissional (pode ter mais de um)
2. Os módulos são injetados como Bloco 2 no system prompt do Redator (ver seção 7.4)
3. Quando o profissional tem múltiplos conselhos (ex: CRP + CRFa), ambos os módulos são injetados — o Redator integra as diretrizes de ambos
4. O Revisor também carrega os módulos para validar se o documento respeita as diretrizes do(s) conselho(s)

### 16.4 Responsabilidade pelo conteúdo dos módulos

- Módulos são criados e mantidos pelo **Admin Sistema (Nexum)**
- O conteúdo é baseado nas resoluções e documentos públicos de cada conselho
- Admin Sistema atualiza módulos quando conselhos emitem novas resoluções
- Profissional ou Admin Clínica **não editam** os módulos

### 16.5 Módulos planejados para lançamento

| Conselho | Especialidade | Status |
|---|---|---|
| CFP (Conselho Federal de Psicologia) | Psicologia | A implementar |
| CRFa (Conselho Regional de Fonoaudiologia) | Fonoaudiologia | A implementar |
| ABPp (Associação Brasileira de Psicopedagogia) | Neuropsicopedagogia | A implementar |
| CREFITO (Conselho Regional de Fisioterapia e TO) | Terapia Ocupacional | A implementar |
| CRM (Conselho Federal de Medicina — Neurologia) | Neuropsicologia | A implementar |

### 16.6 Conselho sem módulo implementado

Se o profissional tem um conselho sem módulo na plataforma, o sistema usa apenas o Bloco 1 (competência clínica geral) e registra um aviso no dossiê: *"Módulo de conselho não disponível para [X] — usando diretrizes gerais."*

---

## 17. Conformidade LGPD

### 17.1 Papel dos agentes de dados

| Agente | Papel |
|---|---|
| Paciente | Titular dos dados |
| Profissional | Operador de dados (acessa e processa em nome do paciente) |
| Clínica | Controlador de dados (define a finalidade do tratamento) |
| Nexum | Suboperador (fornece a plataforma de processamento) |

O paciente **nunca acessa o sistema diretamente**. Toda relação de consentimento é entre paciente ↔ clínica/profissional. A Nexum não tem relação direta com o titular dos dados.

### 17.2 Consentimento

- Declaração obrigatória no cadastro de paciente (ver seção 5.1)
- Registro imutável com timestamp: campo `lgpd_consent_at` no Firestore
- Consentimento deve ser obtido pelo profissional antes do cadastro — o sistema registra a declaração do profissional
- Modelo de consentimento sugerido disponível na interface (não vinculante para a clínica)

### 17.3 Exclusão e portabilidade

**Exclusão de paciente (soft delete):**
- Dados marcados como `deleted: true` — nunca removidos fisicamente de imediato
- Processo de exclusão permanente executado por **Cloud Scheduler + Cloud Function** semanalmente
- Admin Clínica pode solicitar exclusão imediata com confirmação dupla (irreversível)

**Portabilidade:**
- Admin Clínica pode exportar todos os dados de um paciente (relatórios DOCX + metadados JSON + lista de arquivos)
- Export disponível até 90 dias após solicitação de exclusão

### 17.4 Localização de dados

- Firestore: região `us-central1` (atual — monousuário)
- GCS: migrar para `southamerica-east1` (São Paulo) na Sprint Multi-tenancy para conformidade com LGPD
- Claude API: processamento nos servidores Anthropic (EUA) — tratamento internacional permitido com cláusulas contratuais adequadas
- Google STT: **descontinuado** — funcionalidade de transcrição de áudio removida da plataforma SaaS

### 17.5 Retenção de dados — tabela de regras

**Soft delete** é o mecanismo de marcar um dado como excluído (`deleted: true`) sem removê-lo fisicamente do banco. O registro fica invisível para os usuários mas continua existindo. A exclusão física **nunca é automática para dados de pacientes** — é sempre uma decisão ativa do Admin Clínica. Benefícios: recuperação de exclusões acidentais, janela LGPD para portabilidade, audit trail íntegro.

| Dado | Visibilidade após ação | Exclusão física |
|---|---|---|
| Paciente e todos os seus dados | Ocultado imediatamente (soft delete: `deleted: true`) | **Somente por decisão explícita do Admin Clínica** — com confirmação dupla e aviso do impacto |
| Arquivos clínicos (GCS) | Inacessíveis após soft delete do paciente | **Nunca automática** — Admin Clínica decide após 7 anos; enquanto isso, arquivos migram para Coldline (custo mínimo) |
| Relatórios gerados | Inacessíveis após soft delete do paciente | **Nunca automática** — registro clínico permanente até decisão explícita |
| Relatórios reprovados / rascunhos | Visíveis apenas ao profissional e Admin Clínica | Notificar profissional após 90 dias sem alteração → se sem resposta em 7 dias → escala para Admin Clínica decidir |
| Activity logs | Sempre visíveis (auditoria) | Exclusão automática após 5 anos — são logs técnicos, não dados de paciente |
| Jobs de geração | Internos — não visíveis ao usuário | Exclusão automática após 30 dias |
| Convites de usuário | Expiram em 72h | Exclusão automática após expiração |

**Princípio:** toda exclusão permanente de dado de paciente é uma **decisão humana** do Admin Clínica, nunca um processo automático.

**Justificativa dos 7 anos para arquivos clínicos:** padrão de prontuário médico (CFM Resolução 1821/2007). Cada conselho profissional pode ter prazo próprio — adaptação conforme regulamentação específica da especialidade.

**Arquivamento GCS — ciclo de vida automático (redução de custo de armazenamento, SEM exclusão):**
```
Upload → GCS Standard (acesso frequente)
    ↓ 730 dias sem acesso (Object Lifecycle — automático)
GCS Nearline (acesso raro — custo ~50% menor)
    ↓ 1825 dias sem acesso (Object Lifecycle — automático)
GCS Coldline (arquivo longo prazo — custo ~75% menor)
    ↓ Admin Clínica decide: manter indefinidamente ou excluir após 7 anos
Exclusão permanente ou migração para BigQuery (apenas dados anonimizados)
```

### 17.6 Acesso de suporte pelo Admin Sistema (protocolo LGPD)

O Admin Sistema (Nexum) **nunca acessa dados de pacientes proativamente**. Acesso de suporte segue protocolo obrigatório:

1. Admin Clínica abre ticket de suporte no painel + **autoriza acesso explicitamente** ao escopo mínimo necessário
2. Admin Sistema acessa apenas o que foi autorizado (por clinic_id, patient_id ou report_id específico)
3. Cada acesso é registrado automaticamente: timestamp, e-mail do Admin, escopo acessado, ticket vinculado
4. Acesso expira em 48h ou com fechamento do ticket — o que ocorrer primeiro
5. Admin Clínica recebe notificação a cada acesso realizado no escopo da sua clínica

### 17.7 Logs de auditoria

- Toda ação que envolve dado de paciente é registrada em `activity_log`
- Logs são imutáveis — `add()` nunca `set()` ou `update()`
- Retenção de logs: 5 anos mínimo
- Admin Sistema pode exportar logs por clínica sob solicitação regulatória

---

## 18. Infraestrutura Técnica

### 18.1 Stack

| Componente | Tecnologia |
|---|---|
| Backend | Node.js / Express 4 |
| Frontend | React 18 via CDN + Babel standalone (arquivo único `frontend/build/index.html`) — **migração para Vite na Sprint Multi-tenancy** |
| Banco de dados | Google Cloud Firestore (`nexum-db`) |
| Storage | Google Cloud Storage (bucket `nexum-patient-files`) |
| IA | Claude API — Sonnet (Analítico, Redator, Revisor, extração de padrões, extração de manual PDF) + Haiku (descontinuado — era Compressor de áudio) |
| ~~Transcrição~~ | ~~Google Cloud Speech-to-Text v2 — Chirp 2~~ — **descontinuado** |
| Deploy backend | Google Cloud Run (`us-central1`) |
| Deploy frontend | Vercel |
| CI/CD | Cloud Build — push ao main → deploy automático |
| **E-mail transacional** | **Resend** — links de ativação, notificações de relatório pronto, alertas de inadimplência |
| **Security headers** | **`helmet`** (middleware Express) — CSP, HSTS, X-Frame-Options, X-Content-Type-Options |
| **Malware scanning** | **ClamAV** via Cloud Function — escaneamento pós-upload em background; custo ~R$ 0,08/mês |
| **CDN** | **Google Cloud CDN** na frente do GCS — reduz latência de downloads em regiões distantes do bucket |
| **Real-time frontend** | **Firestore `onSnapshot` listeners** — substitui polling HTTP para jobs de geração e notificações in-app |
| **Validação de entrada** | `validator` (backend) + `DOMPurify` (frontend) — sanitização de campos de texto livre antes de persistir e renderizar |
| **Melhoria de imagem** | **`sharp`** (Node.js) — normalização de contraste, sharpen, grayscale, deskew; aplicado em background na avaliação de elegibilidade |

### 18.2 Modelos de IA por tarefa

> Ver seção 18.4 para a estratégia multi-provider completa.

| Agente / Tarefa | Provider primário | Provider fallback | Motivo |
|---|---|---|---|
| **Avaliação de elegibilidade + pré-extração** | **Gemini 1.5 Flash** | Claude Sonnet | ~40× mais barato para extração de texto; qualidade equivalente |
| Analítico | Claude Sonnet | GPT-4o | Raciocínio clínico estruturado + JSON preciso |
| Redator | Claude Sonnet | GPT-4o | Melhor qualidade PT-BR em system prompt longo + prompt caching |
| Revisor | Claude Sonnet | GPT-4o | Validações clínicas precisas (13 regras) |
| Extração de padrões (curadoria) | Claude Sonnet | — | Precisão na identificação de PII — não usar modelo menor |
| Extração de manual PDF | Claude Sonnet | GPT-4o | Visão + precisão na extração de tabelas |

> **Nota:** O **Agente Compressor** (claude-haiku) foi descontinuado junto com a transcrição de áudio. O **Haiku não é mais utilizado** — pipeline de geração usa exclusivamente Sonnet.

> **Estado atual (monousuário):** elegibilidade ainda usa Claude Sonnet — migração para Gemini Flash está no roadmap da Sprint IA Multi-Provider.

### 18.3 Collections Firestore — Schema definitivo (multi-tenant)

**Collections de plataforma (Admin Sistema):**

| Collection | Descrição |
|---|---|
| `platform_instrument_library/{inst_id}` | Biblioteca base de instrumentos (Camada 1) |
| `platform_councils/{council_id}` | Módulos de agente por conselho profissional |
| `platform_councils/{council_id}/brief_suggestions` | Chips de sugestão do Brief por conselho |
| `motor_config` | Parâmetros do pipeline (doc `global`) |
| `system_prompts` | System prompt ativo (doc `active`) |
| `system_prompts_history` | Histórico de versões |
| `activity_log` | Auditoria imutável de toda a plataforma |
| `instrument_requests` | Solicitações de novo instrumento por profissionais |
| `support_tickets` | Tickets de suporte com autorização de acesso Admin Sistema |

**Collections de clínica:**

| Collection | Descrição |
|---|---|
| `clinics/{clinic_id}` | Dados da clínica + `trial_reports_remaining` + `workspace_api_key` |
| `clinics/{clinic_id}/users/{user_id}` | Profissionais e secretárias — inclui `role`, `valid_from`, `areas`, `conselhos` |
| `clinics/{clinic_id}/invites/{invite_id}` | Convites pendentes (expiram em 72h) |
| `clinics/{clinic_id}/instruments/{inst_id}` | Instrumentos calibrados pela clínica (Camada 2) |
| `clinics/{clinic_id}/templates/{tmpl_id}` | Templates de documento da clínica |
| `clinics/{clinic_id}/councils` | Conselhos habilitados na clínica + personalizados |

**Collections de paciente:**

| Collection | Descrição |
|---|---|
| `clinics/{clinic_id}/patients/{patient_id}` | Cadastro + contadores + `lgpd_consent_at` + `deleted` |
| `clinics/{clinic_id}/patients/{patient_id}/files/{file_id}` | Arquivos + `inferred_instrument` (campos `transcription` e `transcricao_comprimida` legados da fase monousuário — não utilizados no SaaS) |
| `clinics/{clinic_id}/patients/{patient_id}/reports/{report_id}` | Relatórios + `content_md` + `dossie_json` + `arquivos_usados` + `alertas_revisor` + `status` |
| `clinics/{clinic_id}/patients/{patient_id}/jobs/{job_id}` | Jobs de geração com progresso |

**Collections de profissional:**

| Collection | Descrição |
|---|---|
| `clinics/{clinic_id}/users/{user_id}/instruments/{inst_id}` | Instrumentos privados (Camada 3) |
| `clinics/{clinic_id}/users/{user_id}/padroes/{padrao_id}` | Padrões de aprendizado (pendente/ativo/rejeitado) |
| `clinics/{clinic_id}/users/{user_id}/report_layout` | Layout de relatório do profissional (override do layout da clínica) |
| `clinics/{clinic_id}/users/{user_id}/templates/{tmpl_id}` | Templates privados do profissional |
| `clinics/{clinic_id}/users/{user_id}/feedbacks` | Feedbacks históricos por bloco |
| `notifications/{user_id}/{notif_id}` | Notificações por usuário (geração concluída, reprovada, instrumento aprovado) |

**Nota de migração:** Durante a fase monousuário atual, as collections existentes (`patients`, `clinic_settings`, `report_layout`, `instrument_library` etc.) permanecem. A Sprint Multi-tenancy executa a migração para o schema definitivo acima.

### 18.4 Estratégia Multi-Provider de IA

**Princípio:** usar o modelo mais adequado por tarefa — não necessariamente um único provider — para otimizar custo, resiliência e qualidade simultaneamente. Nenhuma tarefa deve ter dependência exclusiva e irrecuperável de um único provider.

#### Roteamento por tarefa

| Tarefa | Provider primário | Provider fallback | Sensibilidade à qualidade |
|---|---|---|---|
| Extração de PDF/imagem (elegibilidade) | **Gemini 1.5 Flash** | Claude Sonnet | Média — extração de texto, sem raciocínio clínico |
| Agente Analítico | **Claude Sonnet** | GPT-4o | Alta — estruturação clínica em JSON |
| Agente Redator | **Claude Sonnet** | GPT-4o | Crítica — escrita clínica PT-BR com system prompt longo |
| Agente Revisor | **Claude Sonnet** | GPT-4o | Alta — 13 regras clínicas precisas |
| Extração de padrões (curadoria) | **Claude Sonnet** | — | Alta — detecção de PII; não usar modelo menor |

#### Fallback automático (resiliência)

- Provider primário retorna **429** (rate limit): aguarda retries configurados e tenta fallback
- Provider primário retorna **503** (indisponibilidade): tenta fallback imediatamente, sem retries
- Fallback registrado em `activity_log` com `provider_used`, `provider_primary`, `motivo_fallback`
- Jobs executados em fallback são marcados com `provider_used ≠ provider_primary` para rastreabilidade no painel Admin Sistema
- Custo de fallback (GPT-4o / Gemini) é interno da Nexum — não rastreável via Workspaces Anthropic; contabilizado separadamente

#### Impacto em custo

| Estratégia | Custo extração/arquivo | Custo geração/relatório |
|---|---|---|
| Atual (Claude Sonnet para tudo) | ~$0,020 | ~$0,247 |
| Pós-Sprint Multi-Provider (Gemini Flash na extração) | ~**$0,0005** | ~$0,247 |

Economia na extração: **~97%**. Em 50 clínicas com 8.000 arquivos/mês: **~$158/mês** (~R$930/mês) economizados.

#### Restrições

- Troca do Agente Redator de Claude → outro provider **requer re-validação clínica completa**: o Revisor é calibrado contra outputs do Claude; output de outro modelo pode falhar nas 13 regras mesmo sendo clinicamente correto
- Prompts específicos por provider são versionados no Firestore junto com `motor_config`
- Workspaces Anthropic por clínica não cobrem custos de GPT-4o ou Gemini — esses passam pela chave central da Nexum
- BYOK por provider (Admin Clínica traz sua própria chave OpenAI/Gemini) é funcionalidade futura — não implementar antes da Sprint Multi-Provider

#### Configuração no `motor_config`

```json
{
  "ai_providers": {
    "extraction": "gemini_flash",
    "pipeline_primary": "claude_sonnet",
    "pipeline_fallback": "gpt4o"
  }
}
```

---

## 19. Requisitos Não-Funcionais

### 19.1 Disponibilidade e Latência

| RNF | Meta | Observação |
|---|---|---|
| Disponibilidade | **99,9%** (~8,7h/ano) | Serviço **24/7** — profissionais trabalham fora do horário comercial |
| Latência leitura (listagens, navegação) | p95 < 500ms | |
| Latência escrita (upload, save, PATCH) | p95 < 2s | |
| Pipeline de geração | p80 < 5 min | Áudio descontinuado — apenas PDF/imagem/DOCX/texto |

### 19.2 Concorrência e Escala

| RNF | Meta |
|---|---|
| Gerações simultâneas por profissional | Configurável pelo Admin Clínica (padrão: sem limite definido pelo sistema) |
| Gerações simultâneas por clínica | Configurável pelo Admin Clínica (sem limite fixo imposto pela plataforma) |
| Gerações simultâneas plataforma | Máx **100** (limite técnico de infra) |
| Clínicas — ano 1 | 50 |
| Profissionais — ano 1 | 200 |
| Pacientes — ano 1 | 5.000 |
| Clínicas — ano 3 | 500 |
| Profissionais — ano 3 | 2.000 |
| Pacientes — ano 3 | 50.000 |
| Crescimento de storage por paciente/ano | ~15MB (PDFs, imagens e DOCX — áudio descontinuado) |

**Configuração de limite por profissional:**
O Admin Clínica acessa "Configurações da Clínica" → "Gerações simultâneas" e define o limite máximo por profissional (ex: 2 gerações ao mesmo tempo). Se não configurar, não há limite por profissional — apenas o limite técnico da plataforma (100 simultâneas) se aplica.

**Alerta de capacidade:**
| Recurso | Alerta |
|---|---|
| Gerações simultâneas plataforma | Alerta ao atingir **90%** (90 de 100) — notificação ao Admin Sistema com sugestão de aumento de capacidade |

### 19.3 Monitoramento e Alertas

O sistema monitora continuamente todos os recursos e **alerta proativamente o Admin Sistema** antes que um problema afete a produção.

| Recurso | Alerta |
|---|---|
| Gerações simultâneas | Alerta ao atingir **90% do limite** (45 de 100 na plataforma ou 4,5 de 5 por clínica) — sugestão de aumento de capacidade |
| Uso de CPU / Memória Cloud Run | Alerta ao ultrapassar 80% por mais de 5 min consecutivos |
| Taxa de erro de API (Claude) | Alerta se taxa de erro > 5% em janela de 10 min |
| Jobs em estado `processing` > 20 min | Alerta + ação automática: marca `timeout`, libera `pipeline_ativo` |
| Custo diário acima do baseline | Alerta se consumo do dia superar 150% da média dos últimos 7 dias |
| Firestore: operações > baseline | Alerta se volume de reads/writes superar 200% da média |
| GCS: volume de uploads | Alerta se upload/hora superar 3× a média — possível abuso |

**Canal de alerta:** painel Admin Sistema (badge em tempo real) + e-mail para o Admin Sistema.

**Comportamento esperado:** todo comportamento fora do padrão que coloque em risco o ambiente de produção gera um alerta. A Nexum não aguarda incidente para tomar ação — monitora preventivamente.

### 19.4 Recuperação

| RNF | Meta |
|---|---|
| RTO (Recovery Time Objective) | 4h |
| RPO (Recovery Point Objective) | 1h (Firestore backup automático) |
| Watchdog de jobs travados | Cloud Scheduler a cada 15min — marca `timeout` jobs com `updated_at < now - 20min`, libera `pipeline_ativo` |

---

## 20. Restrições e Decisões Arquiteturais

| Decisão | Motivo |
|---|---|
| Frontend em arquivo único `index.html` (React CDN + Babel standalone) | Build de produção Vite não utilizado — arquivo único simplifica deploy |
| JSX em event handlers sempre inline, nunca multilinha | Babel standalone quebra silenciosamente com JSX multilinha |
| Firestore como banco ativo — SQLite é legado | Migração completa — nunca usar SQLite |
| Storage no GCS (não Google Drive) | Drive OAuth2 pessoal expira — Service Account do Cloud Run nunca expira |
| `dotenv.config()` sempre com path explícito `/app/backend/.env` | Sem path explícito falha em volumes Docker montados |
| Geração assíncrona com `jobs` collection | Evita timeout Cloud Run em gerações longas |
| Relatórios históricos imutáveis (congelados com perfil da geração) | Integridade clínica e rastreabilidade |
| Custo nunca exibido no fluxo clínico | Separação entre decisão clínica e decisão financeira |
| **Custos monetários de IA (USD/BRL/por agente) visíveis APENAS para Admin Sistema** | Admin Clínica, Supervisor e Profissional veem somente consumo de quota ("X de Y relatórios") — não valores em dinheiro; evita pressão sobre margens e incompreensão do modelo de assinatura |
| System prompt nunca exposto para clínica ou profissional | Proteção da qualidade e consistência do pipeline |
| Seções emergem do conteúdo — não de catálogo fixo | Evita seções vazias que convidam alucinação |
| Documento final = importado pelo profissional | Status `revisado` só via importação de DOCX editado |
| Multi-tenancy: `clinic_id` + `user_id` + `role` no JWT | JWT 24h (reduzido) + `valid_from` por usuário para revogação imediata |
| Anthropic Workspace por clínica (não por profissional) | Granularidade suficiente para verificação independente pelo Admin Clínica — sem sobrecarga operacional |
| Consumo exibido consolidado por geração (não por agente) | Cliente não precisa conhecer arquitetura interna; Workspaces garantem rastreabilidade independente |
| Custo armazenado em USD, convertido para BRL via PTAX do dia do repasse para Anthropic (BCB) | Câmbio auditável e público; PTAX do repasse efetivo, não do dia do uso |
| Taxa cambial de 5% é repasse de custo (IOF + spread bancário) — não é receita da Nexum | Infra/suporte/margem na mensalidade fixa; tributação sobre mensalidade, não sobre repasse |
| Trial = 14 dias corridos OU 2 gerações (o que ocorrer primeiro); vinculado ao CNPJ/CPF | Anti-burla por documento — não por e-mail; mensalidade aplica-se normalmente |
| Limite de gerações simultâneas: 100 plataforma (técnico); por clínica/profissional configurável pelo Admin Clínica | Sem limite fixo imposto pela plataforma por clínica — Admin Clínica configura conforme necessidade |
| **Modelo de negócio: assinatura com quota de relatórios + overage R$ 12/relatório** | Cliente paga uma vez, nunca gerencia créditos; quota incluída absorve custo IA (~R$1,53/relatório) com margem confortável; overage automático no cartão |
| **Áudio e transcrição descontinuados** | STT (Chirp 2) custava $0,45/sessão (~60% do custo total); sem áudio o custo por relatório cai para ~R$1,53, tornando o modelo de quota viável |
| **Agente Compressor descontinuado** | Processava transcrições de áudio — sem áudio, não tem propósito |
| **Workspaces Anthropic por clínica** | Isolamento de consumo interno — cliente não vê USD nem PTAX; vê apenas "X de Y relatórios usados" |
| GCS Lifecycle: Standard → Nearline (730d) → Coldline (1825d) | Redução de custo proporcional à inatividade; retenção de 7 anos alinhada a prontuário clínico |
| BigQuery apenas com dados anonimizados | LGPD: análises históricas sem PII |
| `lgpd_consent_at` + `lgpd_consent_by` imutáveis no Firestore | Evidência e rastreabilidade do declarante; audit trail regulatório |
| Soft delete + Cloud Function semanal para exclusão física | Reversibilidade em 90 dias; portabilidade garantida |
| Supervisor: permissões configuráveis + restrições absolutas hardcoded | Flexibilidade sem brechas de segurança |
| **Gemini Flash como provider primário de extração** | ~40× mais barato que Claude Sonnet para extração de texto de PDF/imagem; qualidade equivalente para essa tarefa específica; Claude Sonnet como fallback |
| **Pipeline de geração: Claude Sonnet primário + GPT-4o fallback automático** | Resiliência contra indisponibilidade da Anthropic sem degradação perceptível; fallback só ativa após esgotamento dos retries |
| **Troca do Agente Redator para outro provider requer re-validação clínica** | Output do Redator muda sutilmente entre providers → Revisor pode reprovar com padrões diferentes → nunca promover a primário sem validação com Patrízia |
| **BYOK por provider é funcionalidade futura** | Admin Clínica poderá trazer sua própria chave OpenAI/Gemini; implementar apenas após Sprint Multi-Provider base estar estável |
| Secretária: sem acesso a conteúdo clínico (relatórios, transcrições) | Separação entre função administrativa e responsabilidade clínica |
| Paciente pertence à clínica — profissional é vinculado ao paciente | Continuidade de atendimento quando profissional sai da clínica |
| Módulo de conselho profissional injetado no Redator e Revisor | Padronização clínica automática sem configuração pelo profissional |
| Instrumentos calibrados pelo Admin Clínica (Camada 2) — aplicados a todos os profissionais | Admin Clínica é o responsável técnico pelo padrão da clínica |
| Dossiê analítico persistido no Firestore (`dossie_json`) | Rastreabilidade de fontes; permite regeneração parcial do pipeline |
| Frontend em arquivo único index.html — **dívida técnica** | Migração para Vite bundled é pré-requisito da Sprint Multi-tenancy |
| Collections migram de `clinic_settings/{email}` para `clinics/{clinic_id}/users/{user_id}` | `email` como ID é frágil; `user_id` (Google UID) é estável |
| Acesso de suporte pelo Admin Sistema só via ticket autorizado pelo Admin Clínica | Conformidade LGPD — Nexum não tem relação direta com titulares de dados |
| Watchdog de jobs: Cloud Scheduler a cada 15min | Evita `pipeline_ativo` travado indefinidamente |
| Pré-classificação de arquivo por nome (confiança: baixa) | Cobertura pré-geração informativa sem processar todos os arquivos |
| `arquivos_usados` salvo como snapshot completo (não só IDs) | Auditoria imutável mesmo após exclusão de arquivos |
| **Edição de relatório: exclusivamente via download + reimportação** — sem edição inline de blocos | Cria versionamento automático; elimina conflitos de edição concorrente; profissional tem controle total no Word |
| Edição inline (E2, Quill, P1, P2, P3) é funcionalidade da fase monousuário — removida na Sprint Multi-tenancy | Versão SaaS adota fluxo download → editar externamente → importar como padrão único |
| Rotas API versionadas `/api/v1/...` → `/api/v2/...` na Sprint Multi-tenancy | v1 mantida 30 dias após lançamento de v2 para rollback gradual |
| Feature flags em `motor_config/global` (campo `feature_flags`) | Admin Sistema habilita features por clínica ou globalmente sem novo deploy; padrão = `false` para features em rollout |
| Rotação de JWT_SECRET a cada 6 meses — documentada no Secret Manager | `valid_from` por usuário garante substituição de tokens sem logout forçado em massa |
| Prompt injection: conteúdo de arquivos encapsulado em delimitadores XML (`<document source="...">`) | Agentes instruídos a ignorar instruções dentro dos documentos; proteção transparente sem impacto na extração clínica |
| Security headers via `helmet` middleware — CSP, HSTS, X-Frame-Options, X-Content-Type-Options | CSP deve allowlist CDN do Quill e Google OAuth; configurar explicitamente no middleware |
| `search_name` (nome do paciente normalizado: minúsculas, sem acento) armazenado no cadastro | Busca eficiente no Firestore com `startAt/endAt` sem necessidade de motor full-text externo |
| **Elegibilidade substitui score de legibilidade** (boa/parcial/baixa → elegível/inelegível) | Score era heurística; elegibilidade é decisão real baseada em extração efetiva de conteúdo |
| **`pre_extracted_content`** armazenado no Firestore na avaliação de elegibilidade | Analítico reutiliza na geração — evita re-extração; garante que pipeline usa exatamente o conteúdo avaliado |
| **Elegibilidade usa Claude Sonnet** (não Haiku) — chamada dual-purpose | Haiku check ($0,005) + Sonnet na geração ($0,020) = $0,025 total. Sonnet único no upload ($0,020) + $0 na geração = $0,020 total. ~20% de economia por arquivo; geração mais rápida |
| Arquivo original substituído pela versão melhorada (Sharp) — sem duas versões | Simplicidade: uma versão por arquivo; o objetivo é que o arquivo sirva para geração |
| Arquivo inelegível: profissional exclui e faz novo upload — sem lógica de substituição especial | Upload sempre roda o ciclo de elegibilidade; sem casos especiais |
| Notificação in-app apenas para `ineligible` — `enhanced_eligible` é transparente | Melhoria automática bem-sucedida não interrompe o profissional |
| Notificações in-app via `notifications/{user_id}/{notif_id}` + Firestore `onSnapshot` | Badge numérico com bolinha vermelha no header; sem polling — listener reativo |
| Barra de progresso de geração é estado global da SPA — persiste entre navegações | O profissional não perde o progresso ao trocar de tela |
| Status page pública (Instatus ou equivalente) — alimentada automaticamente via `/api/health` | Clientes verificam incidentes sem abrir ticket de suporte; reduz volume de suporte reativo |
| Dados de pacientes preservados após cancelamento e após inadimplência — nunca excluídos automaticamente | Obrigação LGPD (prontuário clínico 7 anos) + auditoria; exclusão física sempre por decisão humana do Admin Clínica |

---

## 21. Roadmap de Implementação

### Fase atual — Monousuário (Patrízia Santarém) ✅

Funcionalidades implementadas:
- Pipeline completo de geração (Analítico → Redator → Revisor)
- Upload em lote (50 arquivos, áudio, imagem, documento)
- Transcrição automática + Compressor
- Importação de DOCX + extração de padrões conectada
- Curadoria de padrões (G3 ativo)
- Admin panel (system prompt, motor config, activity log)
- Settings (layout, categorias)
- Storage GCS (migrado de Drive OAuth2)

**Ordem obrigatória das sprints (dependências arquiteturais):**
```
Multi-tenancy (fundação)
    ↓
Módulos de Conselho Profissional + G4 Instrumentos  (paralelo)
    ↓
Templates / Brief  
    ↓
Perfil e Capa
    ↓
LGPD e Conformidade + Supervisor + Billing  (paralelo)
    ↓
Sprint G (Aprendizado Contínuo)
```

---

### Sprint Multi-tenancy ⚠️ FUNDAÇÃO — executar primeiro

- [ ] **Migração frontend para Vite bundled** (pré-requisito — Babel standalone não suporta multi-role SPA complexo)
- [ ] Schema Firestore definitivo: `clinics/{clinic_id}/...` em todas as collections
- [ ] JWT v2: `user_id` + `clinic_id` + `role` + expiração 24h
- [ ] `valid_from` por usuário para revogação imediata de tokens
- [ ] `routes/clinics.js` — CRUD de clínicas (Admin Sistema)
- [ ] `routes/users.js` — convite, ativação, gestão por Admin Clínica
- [ ] Fluxo de onboarding: cadastro → e-mail de ativação → link → Google OAuth → perfil criado
- [ ] Isolamento de dados por `clinic_id` em todas as queries
- [ ] Middleware de autorização por role (Admin Sistema / Admin Clínica / Supervisor / Secretária / Profissional)
- [ ] Migração de dados da fase monousuário para schema novo

### Sprint Módulos de Conselho Profissional

- [ ] `platform_councils/{council_id}` — schema e seed dos 5 módulos iniciais (CFP, CRFa, ABPp, CREFITO, CRM)
- [ ] `agentRedator` recebe módulo(s) do(s) conselho(s) do profissional como Bloco 2
- [ ] `agentRevisor` carrega diretrizes do conselho para validação
- [ ] Interface Admin Sistema para criar/editar módulos de conselho
- [ ] Perfil do profissional: seleção de conselho principal + conselhos secundários

### Sprint G4 — Biblioteca de Instrumentos

- [ ] `routes/instruments.js` — rotas de biblioteca (Camada 1 leitura, Camada 2 Admin Clínica, Camada 3 Profissional)
- [ ] Seed com dimensões completas dos instrumentos existentes na `platform_instrument_library`
- [ ] Tela de instrumentos para Admin Clínica (biblioteca, confirmação, calibração, upload de manual)
- [ ] Tela de instrumentos para Profissional (instrumentos privados da Camada 3)
- [ ] `agentAnalytico` carrega instrumentos por `user_id` + `clinic_id`
- [ ] `agentRevisor` carrega `regras_revisor` dos instrumentos confirmados
- [ ] Pré-classificação de arquivo por nome (campo `inferred_instrument` no upload)
- [ ] Watchdog de jobs: Cloud Scheduler a cada 15min

### Sprint Templates e Brief

- [ ] `routes/templates.js` — CRUD por profissional e clínica
- [ ] Formulário de Brief com sugestões contextuais por conselho + público
- [ ] Templates pré-configurados por especialidade (seed por módulo de conselho)
- [ ] `agentRedator` recebe brief estruturado como Bloco 3
- [ ] Seleção de arquivos com checkbox + cobertura pré-geração (baseada em `inferred_instrument`)
- [ ] Snapshot do template + versão do módulo de conselho salvos com o relatório

### Sprint Perfil e Capa

- [ ] Perfil completo: áreas múltiplas, conselhos múltiplos, assinatura digital
- [ ] Catálogo de conselhos na plataforma + personalização por Admin Clínica
- [ ] Geração automática de capa estruturada (dados paciente + profissional + clínica)
- [ ] Layout bonito da capa por tipo de documento

### Sprint LGPD, Supervisor e Billing (paralelo)

**LGPD:**
- [ ] Checkbox de consentimento obrigatório no cadastro (`lgpd_consent_at` + `lgpd_consent_by`)
- [ ] Soft delete + Cloud Function semanal de exclusão física
- [ ] Cloud Storage Object Lifecycle: Standard → Nearline (730d) → Coldline (1825d)
- [ ] Exportação de portabilidade por paciente (Admin Clínica)
- [ ] Migração de região GCS para `southamerica-east1`
- [ ] Protocolo de acesso de suporte Admin Sistema (ticket + log + expiração 48h)

**Supervisor:**
- [ ] Interface de configuração de permissões do Supervisor no Admin Clínica
- [ ] Tela do Supervisor: relatórios dos profissionais supervisionados

**Billing:**
- [ ] Anthropic Workspace por clínica — criação automática via API Anthropic no onboarding
- [ ] `workspace_api_key` por clínica no Secret Manager (nunca no Firestore)
- [ ] Labels `clinic_id` em todos os registros de consumo (Claude API via Workspaces)
- [ ] Custo armazenado em USD; conversão PTAX do dia do repasse (cache 24h)
- [ ] Campos `custo_ia_usd`, `custo_stt_usd`, `ptax_data`, `ptax_valor`, `custo_brl_equivalente` por geração
- [ ] Trial vinculado a CNPJ/CPF: validação de documento + campos `trial_reports_remaining`, `trial_expires_at`
- [ ] Régua de inadimplência: D+7 bloqueio de gerações; D+15 bloqueio de acesso
- [ ] Fluxo de cancelamento + link de exportação completa (90 dias)
- [ ] Área de acompanhamento de custos com visibilidade por camada
- [ ] Exportação CSV mensal para contabilidade

### Sprint Notificações e UX (pode ser paralela com Templates)

- [ ] Serviço de e-mail **Resend** integrado: ativação de conta, relatório pronto, reprovação, inadimplência
- [ ] Coleção `notifications/{user_id}/{notif_id}` com Firestore `onSnapshot` no frontend
- [ ] Badge numérico no header com bolinha vermelha para notificações não-lidas
- [ ] Painel de notificações (dropdown): marcação individual e "marcar todas como lidas"
- [ ] Barra de progresso de geração persistente (estado global da SPA — não some ao navegar)
- [ ] Etapas granulares no progresso: Extraindo → Analisando → Redigindo → Revisando → Pronto
- [ ] Histórico de geração por relatório: data/hora início/fim, status, custo — imutável
- [ ] **Status page pública** (Instatus) alimentada via `/api/health`

### Sprint Segurança e Infraestrutura (pode ser executada em paralelo)

- [ ] `helmet` middleware no Express (CSP, HSTS, X-Frame-Options, X-Content-Type-Options)
- [ ] Validação e sanitização de todas as entradas: `validator` no backend + `DOMPurify` no frontend
- [ ] Prompt injection: encapsular conteúdo de arquivos em `<document source="...">` antes de enviar aos agentes
- [ ] ClamAV via Cloud Function: escaneamento de malware pós-upload em background
- [ ] Google Cloud CDN na frente do bucket GCS para downloads
- [ ] API versioning: rotas `/api/v2/...` para o schema multi-tenant
- [ ] Feature flags em `motor_config/global` (`feature_flags` campo)
- [ ] `search_name` nos cadastros de paciente (nome normalizado para busca)
- [ ] Busca de paciente: debounce 300ms + filtros por status no frontend
- [ ] Progresso de upload por arquivo (barra com percentual)
- [ ] Indicador de upload para arquivos > 50MB (velocidade estimada)
- [ ] **Avaliação de elegibilidade pós-upload** (substitui score de legibilidade):
  - [ ] Extração real de conteúdo por tipo (PDF texto / PDF escaneado / DOCX / imagem / TXT)
  - [ ] Melhoria automática de imagem com `sharp` (contraste, sharpen, grayscale, deskew)
  - [ ] Retry de extração após melhoria
  - [ ] Campos `eligibility_status`, `eligibility_reason`, `eligibility_message`, `enhanced`, `pre_extracted_content` no Firestore
  - [ ] Badge ✅/❌/⏳ na lista de arquivos
  - [ ] Checkbox desabilitado para inelegíveis na tela de seleção de geração
  - [ ] Notificação in-app para arquivos inelegíveis
  - [ ] Analítico usa `pre_extracted_content` quando disponível

### Sprint IA Multi-Provider ⚡ (pode ser executada em paralelo com Templates)

**Objetivo:** eliminar dependência exclusiva da Anthropic, reduzir custo de extração em ~97% e garantir continuidade operacional em caso de instabilidade de qualquer provider.

**Fase 1 — Gemini Flash para extração (baixo risco clínico):**
- [ ] Integração Google Generative AI SDK (`@google/generative-ai`) no backend
- [ ] `GOOGLE_GEMINI_API_KEY` no Secret Manager
- [ ] Substituir `extractTextFromFile` em `eligibility.js`: Gemini 1.5 Flash como primário, Claude Sonnet como fallback
- [ ] Mesmo contrato de retorno `{ text, cost, quality }` — transparente para o restante do pipeline
- [ ] Campo `provider_used` salvo por arquivo no Firestore (rastreabilidade)
- [ ] Validação clínica obrigatória: comparar extrações Gemini vs Claude em 20 arquivos reais antes de ativar em produção

**Fase 2 — GPT-4o como fallback do pipeline de geração (resiliência):**
- [ ] Integração OpenAI SDK (`openai`) no backend
- [ ] `OPENAI_API_KEY` no Secret Manager
- [ ] Fallback automático em `claude.js`: após esgotamento de retries (429/503), tentar GPT-4o com mesmo prompt
- [ ] Adapter de parâmetros Claude → OpenAI (system/user, max_tokens, etc.)
- [ ] Campo `provider_used` salvo no job (rastreabilidade no `activity_log`)
- [ ] Alerta Admin Sistema quando fallback é ativado

**Fase 3 — Configuração e visibilidade (Admin Sistema):**
- [ ] Campo `ai_providers` no `motor_config/global`: `{ extraction, pipeline_primary, pipeline_fallback }`
- [ ] Interface Admin Sistema para configurar provider por tarefa
- [ ] Painel de uso por provider: quantas gerações usaram fallback, custo por provider
- [ ] Feature flag `multi_provider_enabled` para ativar/desativar por clínica

### Sprint Self-Service e Onboarding Automatizado

- [ ] Página pública de cadastro de clínica (dados + CNPJ/CPF + cartão de crédito)
- [ ] Validação de CNPJ (Receita Federal) + CPF (dígito verificador) no cadastro
- [ ] Verificação anti-burla: CNPJ/CPF já usaram trial → trial não concedido
- [ ] Criação automática de clínica + Admin Clínica após pagamento da primeira mensalidade
- [ ] Gateway de pagamento integrado (a definir: Iugu, Pagar.me ou Vindi)
- [ ] E-mail de boas-vindas com instruções de início + link de ativação do Admin Clínica
- [ ] Painel Admin Sistema: MRR, ARR, churn, trial-to-paid conversion

---

---

## 22. Sistema de Notificações In-App

### 22.1 Tipos de notificação

| Evento | Destinatário | Canal |
|---|---|---|
| Relatório pronto (geração concluída) | Profissional | In-app + e-mail opcional |
| Relatório reprovado pelo Revisor | Profissional | In-app + e-mail |
| Instrumento aprovado pelo Admin Sistema na biblioteca base | Admin Clínica | In-app |
| Novo instrumento disponível na biblioteca da plataforma | Admin Clínica | In-app |
| Padrão auto-aprovado na curadoria | Profissional | In-app |
| Link de ativação de usuário expirado | Admin Clínica | In-app + e-mail |
| Aviso de inadimplência (D+3, D+7, D+15) | Admin Clínica | E-mail |
| Alerta de capacidade (90% do limite de gerações) | Admin Sistema | In-app + e-mail |

### 22.2 Interface das notificações

- **Ícone de sino no header** — visível em todas as telas
- **Bolinha vermelha** sobre o ícone quando há notificações não-lidas (aparece/desaparece em tempo real via Firestore listener)
- **Badge numérico** dentro do ícone (ex: `3`) — oculto quando = 0
- **Painel dropdown** ao clicar no ícone:
  - Lista de notificações ordenada por data (mais recente primeiro)
  - Notificações não-lidas com destaque visual (fundo diferenciado)
  - Clique em uma notificação: marca como lida + navega para o recurso relacionado
  - Botão "Marcar todas como lidas"
- **Persistência:** notificações ficam no Firestore e são exibidas mesmo após recarregar a página

### 22.3 Implementação

- Collection `notifications/{user_id}/{notif_id}` com campos: `type`, `message`, `resource_id`, `resource_type`, `read`, `created_at`
- Frontend usa `onSnapshot()` do Firestore SDK para reatividade em tempo real — sem polling
- Backend cria notificação ao final de cada evento relevante (job concluído, reprovado, etc.)
- Notificações expiram automaticamente após 90 dias (Firestore TTL)

---

*Documento atualizado em 17/05/2026 (v4.2). Principais evoluções v4.1: **modelo de negócio = assinatura com quota de relatórios + overage R$12/relatório; áudio/transcrição/Agente Compressor descontinuados** (STT custava ~60% do custo por relatório; sem áudio custo cai para ~R$1,53/relatório tornando o modelo de quota viável); trial 14 dias + CNPJ/CPF anti-burla; plano anual R$890; onboarding self-service com cartão; régua de inadimplência; sem edição inline no SaaS (só download + reimportação); notificações in-app + barra de progresso persistente; segurança: helmet + DOMPurify + ClamAV + CDN; busca de paciente; API versioning; feature flags; status page; KPIs financeiros; considerações contábeis. Mantido em conjunto pelo Admin Sistema e Claude.*
