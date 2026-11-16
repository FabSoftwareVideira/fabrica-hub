const router = require('express').Router();
const usuarios = require('../models/usuarios');
const { iniciarSessao } = require('../middleware/auth');
const { DOMINIO_INSTITUCIONAL } = require('../config/constants');

// Só funciona com APP_ENV=development declarado. Em qualquer outro ambiente,
// inclusive com a variável ausente, a rota responde 404 e NÃO autentica ninguém.
function apenasDev(req, res, next) {
    if (process.env.APP_ENV !== 'development') {
        return res.status(404).send('Not Found');
    }
    next();
}

const EMAIL_DEV = `admin.dev${DOMINIO_INSTITUCIONAL}`;

// Entra como um administrador de teste, sem passar pelo Google.
router.get('/admin', apenasDev, async (req, res) => {
    let usuario = await usuarios.buscarPorEmail(EMAIL_DEV);
    if (!usuario) {
        usuario = await usuarios.criar({ nome: 'Administrador de Teste', email: EMAIL_DEV, googleId: 'dev-google-admin' });
    }
    if (!usuario.ativo) await usuarios.definirAtivo(usuario.id, true);
    await usuarios.registrarAcesso(usuario.id, null);
    await iniciarSessao(req, { id: usuario.id, nome: usuario.nome, email: usuario.email });
    res.redirect('/admin/aplicacoes');
});

module.exports = router;
