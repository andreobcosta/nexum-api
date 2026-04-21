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
    res.redirect(`/?token=${token}`);
  } catch (err) {
    console.error('[Auth] Erro no callback:', err.message);
    res.redirect('/?auth_error=erro_interno');
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