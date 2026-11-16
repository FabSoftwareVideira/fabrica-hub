// Autenticação por sessão. req.session.user = { id, nome, email } é gravado
// após o login com Google (src/routes/auth.js). Todo usuário autorizado
// administra o hub; a página inicial é pública.

const usuariosModel = require('../models/usuarios');
const { ADMIN_PRINCIPAL_EMAIL } = require('../config/constants');

// A cada requisição confere se a conta continua autorizada: desativar ou
// remover alguém derruba a sessão aberta na requisição seguinte.
async function attachUser(req, res, next) {
    if (req.session.user) {
        try {
            const usuario = await usuariosModel.buscarPorId(req.session.user.id);
            if (!usuario || !usuario.ativo) {
                return req.session.destroy((erro) => {
                    if (erro) return next(erro);
                    res.locals.user = null;
                    res.locals.flash = null;
                    res.locals.currentPath = req.path;
                    res.status(403).render('acesso_desativado');
                });
            }
            req.session.user.nome = usuario.nome;
            req.session.user.email = usuario.email;
            req.session.user.principal = usuario.email.toLowerCase() === ADMIN_PRINCIPAL_EMAIL;
        } catch (erro) {
            return next(erro);
        }
    }

    res.locals.user = req.session.user || null;
    res.locals.flash = req.session.flash || null;
    res.locals.currentPath = req.path;
    delete req.session.flash;
    next();
}

// O navegador segue um redirecionamento assim que recebe o cabeçalho da
// resposta, enquanto o express-session ainda grava a sessão no banco. A página
// seguinte chegava a ler a sessão antiga: o aviso de "salvo com sucesso" sumia
// e o primeiro acesso depois do login caía de volta na tela de entrada. Aqui o
// redirecionamento só sai depois de a sessão estar gravada.
function salvarSessaoAoRedirecionar(req, res, next) {
    const redirecionar = res.redirect.bind(res);
    res.redirect = (...args) => {
        const sessao = req.session;
        // visitante sem nada na sessão: não há o que gravar (nem cookie a criar)
        const temDados = sessao && Object.keys(sessao).some((chave) => chave !== 'cookie');
        if (!temDados || typeof sessao.save !== 'function') return redirecionar(...args);
        sessao.save((erro) => {
            if (erro) return next(erro);
            redirecionar(...args);
        });
    };
    next();
}

function requireAuth(req, res, next) {
    if (!req.session.user) {
        return res.redirect('/login');
    }
    next();
}

// Login: troca o identificador da sessão antes de gravar o usuário, para que
// um identificador conhecido antes da autenticação não passe a valer depois.
function iniciarSessao(req, user) {
    return new Promise((resolve, reject) => {
        req.session.regenerate((erro) => {
            if (erro) return reject(erro);
            req.session.user = user;
            resolve();
        });
    });
}

function setFlash(req, type, message) {
    req.session.flash = { type, message };
}

module.exports = { attachUser, requireAuth, iniciarSessao, setFlash, salvarSessaoAoRedirecionar };
