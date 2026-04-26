const express = require('express');
const cors = require('cors');
const path = require('path');
if (process.env.NODE_ENV !== 'production') { require('dotenv').config({ path: '/app/backend/.env' }); }

const app = express();
const PORT = process.env.PORT || 3001;

const { verifyAuth } = require('./middleware/verifyAuth');
const { getDb } = require('./db/firestore');
const rateLimit = require('express-rate-limit');

// CORS restrito ao domínio da aplicação
const allowedOrigins = [
  'https://nexum-api-xvxoj574uq-uc.a.run.app',
  'https://app.patriziasantarem.com',
  'http://localhost:3000',
  'http://localhost:3001'
];
app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    callback(new Error('Origem não permitida pelo CORS'));
  },
  credentials: true
}));

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static(path.join(__dirname, '..', 'frontend', 'build')));

// ── Rate limiting ──
app.use('/api/', rateLimit({ windowMs: 60000, max: 100, standardHeaders: true }));
app.use('/api/reports/generate', rateLimit({ windowMs: 300000, max: 3, message: { error: 'Máximo 3 gerações por 5 minutos' } }));

// ── Rotas públicas (sem auth) ──
app.get('/api/health', async (req, res) => {
  const checks = { firestore: false, anthropic_key: !!process.env.ANTHROPIC_API_KEY };
  try { await getDb().collection('patients').limit(1).get(); checks.firestore = true; } catch {}
  const degraded = !checks.firestore;
  res.status(degraded ? 503 : 200).json({
    status: degraded ? 'degraded' : 'ok',
    version: '2.0.0', commit: process.env.DEPLOY_SHA || 'local', checks
  });
});
app.use('/api/auth', require('./routes/auth'));
app.use('/api/drive/webhook', require('./routes/drive-webhook')); // webhook do Drive é chamado pelo Google

// ── Rotas protegidas (requerem JWT válido) ──
app.use('/api/patients', verifyAuth, require('./routes/patients'));
app.use('/api/files', verifyAuth, require('./routes/files'));
app.use('/api/reports', verifyAuth, require('./routes/reports'));
app.use('/api/import', verifyAuth, require('./routes/import'));
app.use('/api/transcribe', verifyAuth, require('./routes/transcribe'));
app.use('/api/costs', verifyAuth, require('./routes/costs'));

// Fallback para o frontend (SPA)
app.get('*', (req, res) => {
  if (!req.path.startsWith('/api')) {
    res.sendFile(path.join(__dirname, '..', 'frontend', 'build', 'index.html'));
  }
});

// Handler de erros global
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Erro interno do servidor', details: err.message });
});

app.listen(PORT, '0.0.0.0', async () => {
  console.log(`\n  Nexum API v2.0 — http://0.0.0.0:${PORT} — commit: ${process.env.DEPLOY_SHA || 'local'}\n`);

  if (process.env.APP_URL) {
    setTimeout(async () => {
      try {
        const { registrarTodosWebhooks, renovarWebhooksVencendo } = require('./services/drive-sync');
        await renovarWebhooksVencendo();
        await registrarTodosWebhooks();
        console.log('[DriveSync] Webhooks inicializados');
      } catch (err) {
        console.error('[DriveSync] Erro na inicialização:', err.message);
      }
    }, 5000);

    setInterval(async () => {
      try {
        const { renovarWebhooksVencendo } = require('./services/drive-sync');
        await renovarWebhooksVencendo();
      } catch (err) {
        console.error('[DriveSync] Erro na renovação:', err.message);
      }
    }, 12 * 60 * 60 * 1000);
  }
});