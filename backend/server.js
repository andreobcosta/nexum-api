const express = require('express');
const cors = require('cors');
const path = require('path');
if (process.env.NODE_ENV !== 'production') { require('dotenv').config({ path: '/app/backend/.env' }); }

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static(path.join(__dirname, '..', 'frontend', 'build')));

app.use('/api/patients', require('./routes/patients'));
app.use('/api/files', require('./routes/files'));
app.use('/api/reports', require('./routes/reports'));
app.use('/api/import', require('./routes/import'));
app.use('/api/transcribe', require('./routes/transcribe'));
app.use('/api/costs', require('./routes/costs'));

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    app: 'Nexum API',
    version: '2.0.0',
    commit: process.env.DEPLOY_SHA || 'local',
    timestamp: new Date().toISOString()
  });
});

app.get('*', (req, res) => {
  if (!req.path.startsWith('/api')) {
    res.sendFile(path.join(__dirname, '..', 'frontend', 'build', 'index.html'));
  }
});

app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Erro interno do servidor', details: err.message });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n  Nexum API v2.0 — http://0.0.0.0:${PORT} — commit: ${process.env.DEPLOY_SHA || 'local'}\n`);
});