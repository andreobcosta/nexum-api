const express = require('express');
const router = express.Router();
const { google } = require('googleapis');
const jwt = require('jsonwebtoken');

const ALLOWED_EMAIL = process.env.ALLOWED_EMAIL;
const JWT_SECRET = process.env.JWT_SECRET;
const APP_URL = process.env.APP_URL;

function getOAuthClient() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_LOGIN_CLIENT_ID,
    process.env.GOOGLE_LOGIN_CLIENT_SECRET,
    APP_URL + '/api/auth/callback'
  );
}

// GET /api/auth/google — redireciona para tela de login do Google
router.get('/google', (req, res) => {
  const oauth2Client = getOAuthClient();
  const url = oauth2Client.generateAuthUrl({
    access_type: 'online',
    scope: ['openid', 'email', 'profile'],
    prompt: 'select_account'
  });
  res.redirect(url);
});

// GET /api/auth/callback — Google redireciona aqui após login
router.get('/callback', async (req, res) => {
  const { code, error } = req.query;

  if (error) {
    console.error('[Auth] Erro OAuth:', error);
    return res.redirect('/?auth_error=acesso_negado');
  }

  try {
    const oauth2Client = getOAuthClient();
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    // Busca dados do usuário
    const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
    const { data: userInfo } = await oauth2.userinfo.get();

    // Verifica se o email está autorizado
    if (userInfo.email !== ALLOWED_EMAIL) {
      console.warn('[Auth] Tentativa de acesso não autorizado:', userInfo.email);
      return res.redirect('/?auth_error=nao_autorizado');
    }

    // Gera JWT com validade de 30 dias
    const token = jwt.sign(
      {
        email: userInfo.email,
        name: userInfo.name,
        picture: userInfo.picture
      },
      JWT_SECRET,
      { expiresIn: '30d' }
    );

    console.log('[Auth] Login bem-sucedido:', userInfo.email);

    // Redireciona para o app com o token na URL (frontend armazena em memória)
    res.redirect(`/#token=${token}`);
  } catch (err) {
    console.error('[Auth] Erro no callback:', err.message);
    res.redirect('/?auth_error=erro_interno');
  }
});

// GET /api/auth/google/callback — callback OAuth2 para regeneração do token de Drive
router.get('/google/callback', async (req, res) => {
  const { code, state, error } = req.query;
  if (error) return res.status(400).send('<h2>Erro Google: ' + error + '</h2>');
  if (state !== 'drive_setup') return res.redirect('/');
  try {
    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    );
    const { tokens } = await oauth2Client.getToken(code);
    if (!tokens.refresh_token) {
      return res.status(400).send('<h2>Nenhum refresh_token retornado.</h2><p>Revogue o acesso do app em <a href="https://myaccount.google.com/permissions">myaccount.google.com/permissions</a> e tente novamente.</p>');
    }
    console.log('[Drive] Novo refresh_token gerado com sucesso');
    res.send(`<!DOCTYPE html><html><body style="font-family:system-ui,sans-serif;max-width:700px;margin:40px auto;padding:0 20px"><h2 style="color:#2d6a4f">&#10003; Novo GOOGLE_REFRESH_TOKEN gerado</h2><p>Copie o token e execute os comandos abaixo no terminal:</p><label style="font-weight:600">Token:</label><textarea rows="3" style="width:100%;font-family:monospace;font-size:12px;margin:8px 0 16px;padding:8px;border:1px solid #ccc" onclick="this.select()">${tokens.refresh_token}</textarea><label style="font-weight:600">Comandos (execute em ordem):</label><pre style="background:#f5f5f5;padding:16px;border-radius:8px;font-size:12px;overflow-x:auto">echo -n '${tokens.refresh_token}' | gcloud secrets versions add nexum-google-refresh-token --data-file=-\n\ngcloud run deploy nexum-api --region us-central1 --update-secrets=GOOGLE_REFRESH_TOKEN=nexum-google-refresh-token:latest</pre><p style="color:#666;font-size:13px">Após executar, o Cloud Run usara o novo token automaticamente.</p></body></html>`);
  } catch (err) {
    console.error('[Drive] Erro ao gerar token:', err.message);
    res.status(500).send('<h2>Erro: ' + err.message + '</h2>');
  }
});

// POST /api/auth/verify — verifica se o token ainda é válido
router.post('/verify', (req, res) => {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    return res.status(401).json({ valid: false });
  }
  try {
    const token = auth.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET);
    res.json({ valid: true, user: { email: decoded.email, name: decoded.name, picture: decoded.picture } });
  } catch (err) {
    res.status(401).json({ valid: false });
  }
});

// POST /api/auth/logout — invalida sessão no frontend
router.post('/logout', (req, res) => {
  res.json({ message: 'Logout realizado' });
});

module.exports = router;