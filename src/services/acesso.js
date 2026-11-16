// Quem pode entrar: conta Google @ifc.edu.br, com e-mail verificado, que esteja
// na lista de usuários autorizados e ativa. A conta principal
// (ADMIN_PRINCIPAL_EMAIL) entra sem cadastro prévio e autoriza as demais.

const usuarios = require('../models/usuarios');
const { DOMINIO_INSTITUCIONAL, ADMIN_PRINCIPAL_EMAIL } = require('../config/constants');

function emailInstitucional(email) {
    const valor = String(email || '').trim().toLowerCase();
    return /^[^\s@]+@[^\s@]+$/.test(valor) && valor.endsWith(DOMINIO_INSTITUCIONAL);
}

// perfil: resposta do userinfo do Google ({ sub, email, email_verified, name }).
// Devolve { usuario } ou { erro } com a mensagem para a pessoa.
async function autorizarLogin(perfil) {
    if (!perfil || !perfil.sub || !perfil.email || !perfil.email_verified) {
        return { erro: 'Sua conta do Google precisa ter um e-mail verificado e acessível.' };
    }

    const email = String(perfil.email).toLowerCase();
    if (!emailInstitucional(email)) {
        return { erro: `Entre com sua conta institucional ${DOMINIO_INSTITUCIONAL}.` };
    }

    const googleId = String(perfil.sub);
    const nome = String(perfil.name || email.split('@')[0]).slice(0, 150);

    let usuario = await usuarios.buscarPorGoogleId(googleId);
    if (!usuario) {
        const porEmail = await usuarios.buscarPorEmail(email);
        if (porEmail) {
            usuario = await usuarios.vincularGoogle(porEmail.id, googleId);
            if (!usuario) {
                return { erro: 'Este e-mail já está vinculado a outra conta Google. Procure a Fábrica de Software.' };
            }
        } else if (email === ADMIN_PRINCIPAL_EMAIL) {
            usuario = await usuarios.criar({ nome, email, googleId });
        }
    }

    if (!usuario) {
        return { erro: 'Sua conta não está autorizada a administrar o hub. Peça a liberação à Fábrica de Software.' };
    }
    if (!usuario.ativo) {
        return { erro: 'Esta conta foi desativada. Procure a Fábrica de Software.' };
    }

    usuario = await usuarios.registrarAcesso(usuario.id, nome);
    return { usuario };
}

module.exports = { autorizarLogin, emailInstitucional };
