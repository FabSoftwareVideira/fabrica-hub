// Área administrativa: cadastro de aplicações, categorias e usuários autorizados.
// Montada em /admin, sempre atrás de requireAuth (src/app.js).

const router = require('express').Router();
const aplicacoes = require('../models/aplicacoes');
const categorias = require('../models/categorias');
const usuarios = require('../models/usuarios');
const monitor = require('../services/monitor');
const dokploy = require('../services/dokploy');
const { setFlash } = require('../middleware/auth');
const { emailInstitucional } = require('../services/acesso');
const { ADMIN_PRINCIPAL_EMAIL, DOMINIO_INSTITUCIONAL } = require('../config/constants');

const texto = (valor) => (typeof valor === 'string' ? valor.trim() : '');

function idDe(valor) {
    return /^\d{1,9}$/.test(String(valor)) ? Number(valor) : null;
}

function lerOrdem(valor) {
    const numero = Number(texto(valor) || 0);
    return Number.isInteger(numero) && numero >= 0 && numero <= 9999 ? numero : null;
}

// Só http(s), sem usuário e senha embutidos.
function lerUrl(valor) {
    const bruto = texto(valor);
    if (!bruto || bruto.length > 500) return null;
    try {
        const url = new URL(bruto);
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
        return url.href;
    } catch {
        return null;
    }
}

router.get('/', (req, res) => res.redirect('/admin/aplicacoes'));

// ─── Aplicações ───────────────────────────────────────────────────────────────

router.get('/aplicacoes', async (req, res) => {
    const todas = await aplicacoes.listarTodas();
    res.render('admin_aplicacoes', {
        pendentes: todas.filter((app) => app.situacao === 'pendente'),
        lista: todas.filter((app) => app.situacao !== 'pendente'),
        categorias: await categorias.listar(),
        dokployConfigurado: dokploy.configurado(),
    });
});

async function lerAplicacao(body) {
    const dados = {
        nome: texto(body.nome),
        descricao: texto(body.descricao),
        url: texto(body.url),
        icone: texto(body.icone),
        categoriaId: idDe(body.categoria_id),
        ordem: lerOrdem(body.ordem),
        situacao: body.publicada === 'on' ? 'publicada' : 'oculta',
    };

    if (!dados.nome || dados.nome.length > 100) return { dados, erro: 'Informe o nome da aplicação, com até 100 caracteres.' };
    if (dados.descricao.length > 300) return { dados, erro: 'A descrição pode ter até 300 caracteres.' };
    const url = lerUrl(body.url);
    if (!url) return { dados, erro: 'Informe o endereço completo da aplicação, começando com https:// ou http://.' };
    if (Array.from(dados.icone).length > 4) return { dados, erro: 'O ícone é um único emoji (ou fique sem ícone).' };
    if (dados.ordem === null) return { dados: { ...dados, ordem: 0 }, erro: 'A ordem é um número inteiro de 0 a 9999.' };
    if (texto(body.categoria_id) && !(dados.categoriaId && await categorias.buscarPorId(dados.categoriaId))) {
        return { dados: { ...dados, categoriaId: null }, erro: 'Escolha uma categoria da lista.' };
    }
    return { dados: { ...dados, url } };
}

async function renderFormulario(res, { app, dados, erro, status = 200 }) {
    if (erro) res.locals.flash = { type: 'error', message: erro };
    res.status(status).render('admin_aplicacao_form', {
        app: app || null,
        dados,
        categorias: await categorias.listar(),
    });
}

router.get('/aplicacoes/nova', async (req, res) => {
    await renderFormulario(res, {
        dados: { nome: '', descricao: '', url: '', icone: '', categoriaId: null, ordem: 0, situacao: 'publicada' },
    });
});

router.post('/aplicacoes', async (req, res) => {
    const { dados, erro } = await lerAplicacao(req.body);
    if (erro) return renderFormulario(res, { dados, erro, status: 422 });

    const criada = await aplicacoes.criar(dados);
    // o status aparece em instantes, sem esperar a próxima rodada
    monitor.verificarUrl(criada.url).then((resultado) => aplicacoes.registrarStatus(criada.id, resultado)).catch(() => {});
    setFlash(req, 'success', `Aplicação "${criada.nome}" cadastrada.`);
    res.redirect('/admin/aplicacoes');
});

router.get('/aplicacoes/:id/editar', async (req, res, next) => {
    const app = idDe(req.params.id) && await aplicacoes.buscarPorId(idDe(req.params.id));
    if (!app) return next();
    await renderFormulario(res, {
        app,
        dados: {
            nome: app.nome,
            descricao: app.descricao || '',
            url: app.url,
            icone: app.icone || '',
            categoriaId: app.categoria_id,
            ordem: app.ordem,
            // revisar uma pendência é, em geral, para publicá-la
            situacao: app.situacao === 'oculta' ? 'oculta' : 'publicada',
        },
    });
});

router.post('/aplicacoes/:id', async (req, res, next) => {
    const app = idDe(req.params.id) && await aplicacoes.buscarPorId(idDe(req.params.id));
    if (!app) return next();

    const { dados, erro } = await lerAplicacao(req.body);
    if (erro) return renderFormulario(res, { app, dados, erro, status: 422 });

    const atualizada = await aplicacoes.atualizar(app.id, dados);
    if (atualizada.url !== app.url) {
        monitor.verificarUrl(atualizada.url).then((resultado) => aplicacoes.registrarStatus(app.id, resultado)).catch(() => {});
    }
    setFlash(req, 'success', `Aplicação "${atualizada.nome}" atualizada.`);
    res.redirect('/admin/aplicacoes');
});

// Publicar ou ocultar direto da lista (ao publicar uma pendência, a categoria vai junto).
router.post('/aplicacoes/:id/situacao', async (req, res, next) => {
    const id = idDe(req.params.id);
    const situacao = texto(req.body.situacao);
    if (!id || !['publicada', 'oculta'].includes(situacao)) return next();

    let categoriaId = idDe(req.body.categoria_id);
    if (categoriaId && !(await categorias.buscarPorId(categoriaId))) categoriaId = null;

    const app = await aplicacoes.definirSituacao(id, situacao, categoriaId);
    if (!app) return next();
    setFlash(req, 'success', situacao === 'publicada'
        ? `"${app.nome}" agora aparece na página inicial.`
        : `"${app.nome}" foi ocultada da página inicial.`);
    res.redirect('/admin/aplicacoes');
});

router.post('/aplicacoes/:id/excluir', async (req, res, next) => {
    const app = idDe(req.params.id) && await aplicacoes.buscarPorId(idDe(req.params.id));
    if (!app) return next();

    // o que ainda existe no Dokploy voltaria na próxima sincronização: para tirar da página, oculte
    if (app.origem === 'dokploy' && !app.dokploy_ausente && dokploy.configurado()) {
        setFlash(req, 'error', `"${app.nome}" vem do Dokploy e voltaria na próxima sincronização. Use "Ocultar".`);
        return res.redirect('/admin/aplicacoes');
    }
    await aplicacoes.excluir(app.id);
    setFlash(req, 'success', `Aplicação "${app.nome}" excluída.`);
    res.redirect('/admin/aplicacoes');
});

router.post('/status/verificar', async (req, res) => {
    // a verificação segue em segundo plano se passar de alguns segundos
    const limite = new Promise((resolve) => { setTimeout(() => resolve(null), 10000).unref(); });
    const resumo = await Promise.race([monitor.verificarTodas().catch(() => null), limite]);
    setFlash(req, 'success', resumo
        ? `Status verificado: ${resumo.online} no ar e ${resumo.offline} fora do ar.`
        : 'Verificação em andamento. Atualize a página em instantes.');
    res.redirect('/admin/aplicacoes');
});

router.post('/dokploy/sincronizar', async (req, res) => {
    try {
        const r = await dokploy.sincronizar();
        monitor.verificarTodas().catch(() => {});
        setFlash(req, 'success', `Sincronização com o Dokploy concluída: ${r.novas} nova(s) para revisar, ${r.atualizadas} já conhecida(s)${r.ausentes ? ` e ${r.ausentes} que não está(ão) mais no Dokploy` : ''}.`);
    } catch (erro) {
        console.error('[dokploy] erro ao sincronizar:', erro.message);
        setFlash(req, 'error', `Não foi possível sincronizar com o Dokploy: ${/Dokploy/.test(erro.message) ? erro.message : 'sem resposta do painel'}.`);
    }
    res.redirect('/admin/aplicacoes');
});

// ─── Categorias ───────────────────────────────────────────────────────────────

router.get('/categorias', async (req, res) => {
    const lista = await categorias.listar();
    const editando = idDe(req.query.editar) ? lista.find((c) => c.id === idDe(req.query.editar)) : null;
    res.render('admin_categorias', { lista, editando: editando || null });
});

function lerCategoria(body) {
    const dados = { nome: texto(body.nome), descricao: texto(body.descricao), ordem: lerOrdem(body.ordem) };
    if (!dados.nome || dados.nome.length > 80) return { erro: 'Informe o nome da categoria, com até 80 caracteres.' };
    if (dados.descricao.length > 255) return { erro: 'A descrição pode ter até 255 caracteres.' };
    if (dados.ordem === null) return { erro: 'A ordem é um número inteiro de 0 a 9999.' };
    return { dados };
}

async function salvarCategoria(req, res, gravar, sucesso, voltar) {
    const { dados, erro } = lerCategoria(req.body);
    if (erro) {
        setFlash(req, 'error', erro);
        return res.redirect(voltar);
    }
    try {
        await gravar(dados);
        setFlash(req, 'success', sucesso(dados));
        res.redirect('/admin/categorias');
    } catch (err) {
        if (err.code !== '23505') throw err;
        setFlash(req, 'error', 'Já existe uma categoria com esse nome.');
        res.redirect(voltar);
    }
}

router.post('/categorias', (req, res) => salvarCategoria(
    req, res,
    (dados) => categorias.criar(dados),
    (dados) => `Categoria "${dados.nome}" criada.`,
    '/admin/categorias'
));

router.post('/categorias/:id', async (req, res, next) => {
    const categoria = idDe(req.params.id) && await categorias.buscarPorId(idDe(req.params.id));
    if (!categoria) return next();
    await salvarCategoria(
        req, res,
        (dados) => categorias.atualizar(categoria.id, dados),
        (dados) => `Categoria "${dados.nome}" atualizada.`,
        `/admin/categorias?editar=${categoria.id}`
    );
});

router.post('/categorias/:id/excluir', async (req, res, next) => {
    const categoria = idDe(req.params.id) && await categorias.buscarPorId(idDe(req.params.id));
    if (!categoria) return next();
    await categorias.excluir(categoria.id);
    setFlash(req, 'success', `Categoria "${categoria.nome}" excluída. As aplicações dela ficaram sem categoria.`);
    res.redirect('/admin/categorias');
});

// ─── Usuários autorizados ─────────────────────────────────────────────────────

router.get('/usuarios', async (req, res) => {
    res.render('admin_usuarios', {
        lista: await usuarios.listar(),
        principalEmail: ADMIN_PRINCIPAL_EMAIL,
        dominio: DOMINIO_INSTITUCIONAL,
    });
});

router.post('/usuarios', async (req, res) => {
    const email = texto(req.body.email).toLowerCase();
    if (!emailInstitucional(email) || email.length > 255) {
        setFlash(req, 'error', `Informe um e-mail ${DOMINIO_INSTITUCIONAL}.`);
        return res.redirect('/admin/usuarios');
    }
    if (await usuarios.buscarPorEmail(email)) {
        setFlash(req, 'error', 'Esse e-mail já está na lista.');
        return res.redirect('/admin/usuarios');
    }
    // nome provisório: o da conta Google substitui no primeiro login
    const nome = (texto(req.body.nome) || email.split('@')[0]).slice(0, 150);
    await usuarios.criar({ nome, email });
    setFlash(req, 'success', `${email} agora pode entrar com a conta Google e administrar o hub.`);
    res.redirect('/admin/usuarios');
});

// A conta principal e a própria conta não podem ser desativadas nem removidas.
async function usuarioAlteravel(req, res) {
    const usuario = idDe(req.params.id) && await usuarios.buscarPorId(idDe(req.params.id));
    if (!usuario) return null;
    if (usuario.email.toLowerCase() === ADMIN_PRINCIPAL_EMAIL) {
        setFlash(req, 'error', 'A conta principal não pode ser desativada nem removida.');
        res.redirect('/admin/usuarios');
        return false;
    }
    if (usuario.id === req.session.user.id) {
        setFlash(req, 'error', 'Você não pode desativar nem remover a própria conta.');
        res.redirect('/admin/usuarios');
        return false;
    }
    return usuario;
}

router.post('/usuarios/:id/ativo', async (req, res, next) => {
    const usuario = await usuarioAlteravel(req, res);
    if (usuario === null) return next();
    if (!usuario) return;
    const ativo = req.body.ativo === '1';
    await usuarios.definirAtivo(usuario.id, ativo);
    setFlash(req, 'success', ativo ? `${usuario.email} voltou a ter acesso.` : `${usuario.email} não tem mais acesso.`);
    res.redirect('/admin/usuarios');
});

router.post('/usuarios/:id/excluir', async (req, res, next) => {
    const usuario = await usuarioAlteravel(req, res);
    if (usuario === null) return next();
    if (!usuario) return;
    await usuarios.excluir(usuario.id);
    setFlash(req, 'success', `${usuario.email} foi removido da lista.`);
    res.redirect('/admin/usuarios');
});

module.exports = router;
