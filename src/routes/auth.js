const router = require('express').Router();
const crypto = require('crypto');
const { setFlash, iniciarSessao } = require('../middleware/auth');
const { autorizarLogin } = require('../services/acesso');

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const GOOGLE_CALLBACK_URL = process.env.GOOGLE_CALLBACK_URL;

router.get('/login', (req, res) => {
    if (req.session.user) return res.redirect('/admin/aplicacoes');
    res.render('login', { devLogin: process.env.APP_ENV === 'development' });
});

router.get('/auth/google', (req, res) => {
    if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_CALLBACK_URL) {
        setFlash(req, 'error', 'Login com Google ainda não foi configurado.');
        return res.redirect('/login');
    }

    const state = crypto.randomBytes(16).toString('hex');
    req.session.googleOauthState = state;

    const params = new URLSearchParams({
        client_id: GOOGLE_CLIENT_ID,
        redirect_uri: GOOGLE_CALLBACK_URL,
        response_type: 'code',
        scope: 'openid email profile',
        state,
        access_type: 'online',
        // sugere a conta institucional na tela do Google; a regra de verdade é
        // conferida no retorno (src/services/acesso.js)
        hd: 'ifc.edu.br',
    });

    // o "state" já está gravado quando o navegador sai para o Google
    // (salvarSessaoAoRedirecionar, em src/middleware/auth.js)
    res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
});

router.get('/auth/google/callback', async (req, res) => {
    const { code, state } = req.query;

    if (typeof code !== 'string' || typeof state !== 'string' || !code || state !== req.session.googleOauthState) {
        delete req.session.googleOauthState;
        setFlash(req, 'error', 'Falha na autenticação com o Google. Tente novamente.');
        return res.redirect('/login');
    }
    delete req.session.googleOauthState;

    try {
        const tokenResp = await fetch('https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                client_id: GOOGLE_CLIENT_ID,
                client_secret: GOOGLE_CLIENT_SECRET,
                code,
                grant_type: 'authorization_code',
                redirect_uri: GOOGLE_CALLBACK_URL,
            }),
        });
        const tokenData = await tokenResp.json();

        if (!tokenResp.ok || !tokenData.access_token) {
            console.error('[auth/google/callback] sem access_token:', tokenData.error || tokenResp.status);
            setFlash(req, 'error', 'Não foi possível concluir o login com o Google.');
            return res.redirect('/login');
        }

        const perfilResp = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
            headers: { Authorization: `Bearer ${tokenData.access_token}` },
        });
        const perfil = perfilResp.ok ? await perfilResp.json() : null;

        const { usuario, erro } = await autorizarLogin(perfil);
        if (erro) {
            setFlash(req, 'error', erro);
            return res.redirect('/login');
        }

        await iniciarSessao(req, { id: usuario.id, nome: usuario.nome, email: usuario.email });
        res.redirect('/admin/aplicacoes');
    } catch (err) {
        console.error('[auth/google/callback] erro:', err.message);
        setFlash(req, 'error', 'Erro ao autenticar com o Google. Tente novamente.');
        res.redirect('/login');
    }
});

router.get('/logout', (req, res) => {
    req.session.destroy(() => res.redirect('/'));
});

module.exports = router;
