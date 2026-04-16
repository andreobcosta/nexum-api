# RAN Clinic — App de Relatórios Neuropsicopedagógicos

App PWA para a neuropsicopedagoga Patrízia Santarém. Permite capturar dados clínicos (áudio, fotos, PDFs, notas), organizar automaticamente no Google Drive e gerar relatórios RAN via Claude API.

## Arquitetura

```
Celular (PWA) → Backend Node.js → Google Drive + Claude API
                     ↓
                  SQLite (metadados)
```

## Pré-requisitos

- VPS com Docker instalado (já tem: Hostinger 187.127.14.54)
- Conta Google com Drive API habilitada
- API key do Claude (console.anthropic.com)

## Deploy na VPS

### 1. Copiar o projeto para a VPS

```bash
scp -r ran-clinic/ root@187.127.14.54:/opt/ran-clinic/
```

### 2. Configurar credenciais

```bash
cd /opt/ran-clinic/backend
cp .env.example .env
nano .env  # preencher todas as variáveis
```

### 3. Subir com Docker

```bash
cd /opt/ran-clinic
docker-compose up -d --build
```

### 4. Verificar se está rodando

```bash
curl http://localhost:3001/api/health
```

## Configuração do Google Drive

### Criar projeto no Google Cloud Console

1. Acesse console.cloud.google.com
2. Crie um novo projeto: "RAN Clinic"
3. Ative a API: Google Drive API
4. Em Credenciais, crie "OAuth 2.0 Client ID" (tipo: Web Application)
5. Adicione URI de redirecionamento: `http://187.127.14.54:3001/api/auth/google/callback`
6. Copie Client ID e Client Secret para o .env

### Obter Refresh Token

1. Acesse: `https://developers.google.com/oauthplayground`
2. Configure com seu Client ID/Secret
3. Autorize o escopo: `https://www.googleapis.com/auth/drive`
4. Troque o authorization code por tokens
5. Copie o refresh_token para o .env

### Criar pasta raiz no Drive

1. No Google Drive, crie: `Clínica Patrízia > Pacientes`
2. Copie o ID da pasta "Pacientes" (da URL do Drive)
3. Cole no .env como GOOGLE_DRIVE_ROOT_FOLDER_ID

## API Endpoints

### Pacientes

| Método | Rota | Descrição |
|--------|------|-----------|
| GET | /api/patients | Lista todos os pacientes |
| GET | /api/patients/:id | Detalhes de um paciente |
| POST | /api/patients | Cria paciente (+ pastas no Drive) |
| PATCH | /api/patients/:id | Atualiza dados do paciente |
| DELETE | /api/patients/:id | Remove paciente do banco |

### Arquivos

| Método | Rota | Descrição |
|--------|------|-----------|
| POST | /api/files/upload | Upload de arquivo (áudio/foto/PDF) |
| POST | /api/files/note | Salva nota de texto |
| GET | /api/files/patient/:id | Lista arquivos do paciente |

### Relatórios

| Método | Rota | Descrição |
|--------|------|-----------|
| POST | /api/reports/generate/:id | Gera relatório RAN |
| GET | /api/reports/:id | Lê um relatório |
| GET | /api/reports/patient/:id | Lista relatórios do paciente |

## Estrutura do projeto

```
ran-clinic/
├── docker-compose.yml
├── Dockerfile
├── backend/
│   ├── server.js              # Entry point
│   ├── package.json
│   ├── .env.example
│   ├── db/
│   │   ├── init.js            # Cria tabelas
│   │   └── connection.js      # Helper de conexão
│   ├── routes/
│   │   ├── patients.js        # CRUD de pacientes
│   │   ├── files.js           # Upload e processamento
│   │   └── reports.js         # Geração de relatórios
│   ├── services/
│   │   ├── drive.js           # Google Drive API
│   │   └── claude.js          # Claude API (transcrição + RAN)
│   ├── prompts/
│   │   └── system_prompt_ran.md  # System prompt do agente
│   ├── data/                  # SQLite database (auto-criado)
│   └── temp/                  # Arquivos temporários de upload
└── frontend/                  # PWA React (próxima fase)
    ├── public/
    └── src/
```

## Custos

| Item | Custo |
|------|-------|
| Hospedagem (VPS Hostinger) | R$29,99/mês (já contratada) |
| Claude API | ~$2-5/mês |
| Google Drive | Gratuito |
| Google Cloud (Drive API) | Gratuito |
| Publicação Play Store (futuro) | R$125 uma vez |
| **Total adicional** | **$0 (só Claude API que já estava planejado)** |
