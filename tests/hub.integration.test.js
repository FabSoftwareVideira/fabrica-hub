// O hub de ponta a ponta, com banco em memória: página inicial, área
// administrativa, regras de acesso e sincronização com o Dokploy.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { criarBanco, criarApp, subir, fechar } = require('./ajuda');
const aplicacoes = require('../src/models/aplicacoes');
const categorias = require('../src/models/categorias');
const usuarios = require('../src/models/usuarios');
const monitor = require('../src/services/monitor');
const { autorizarLogin } = require('../src/services/acesso');
const { ADMIN_PRINCIPAL_EMAIL } = require('../src/config/constants');

let db, server, url, admin, internas, projetos;
const envOriginal = process.env.APP_ENV;

before(async () => {
    db = await criarBanco();
    // nada de rede nos testes: o status é gravado direto
    monitor.verificarUrl = async () => ({ status: 'online', http: 200, ms: 1 });
    ({ server, url } = await subir(criarApp()));
    admin = await usuarios.criar({ nome: 'Admin Teste', email: 'admin.teste@ifc.edu.br', googleId: 'g-admin' });
    const lista = await categorias.listar();
    internas = lista.find((c) => c.nome === 'Aplicações internas do IFC');
    projetos = lista.find((c) => c.nome === 'Projetos');
});
after(async () => {
    process.env.APP_ENV = envOriginal;
    await fechar(server);
    await db.close();
});

const pagina = (rota, usuarioId) => fetch(url + rota, {
    redirect: 'manual',
    headers: usuarioId ? { 'x-test-user': String(usuarioId) } : {},
});
const enviar = (rota, campos, usuarioId = admin.id) => fetch(url + rota, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-test-user': String(usuarioId) },
    body: new URLSearchParams(campos),
});

test('a instalação nova já traz as três categorias pedidas', async () => {
    const nomes = (await categorias.listar()).map((c) => c.nome);
    assert.deepEqual(nomes, ['Aplicações internas do IFC', 'Projetos', 'Diversas']);
});

test('página inicial vazia orienta o visitante e não pede login', async () => {
    const resposta = await pagina('/');
    assert.equal(resposta.status, 200);
    const html = await resposta.text();
    assert.match(html, /Nenhuma aplicação publicada ainda/);
    assert.match(html, /href="\/login"/);
});

test('área administrativa exige login', async () => {
    for (const rota of ['/admin', '/admin/aplicacoes', '/admin/categorias', '/admin/usuarios', '/admin/aplicacoes/nova']) {
        const resposta = await pagina(rota);
        assert.equal(resposta.status, 302, rota);
        assert.equal(resposta.headers.get('location'), '/login', rota);
    }
    const post = await fetch(`${url}/admin/aplicacoes`, { method: 'POST', redirect: 'manual', body: new URLSearchParams({ nome: 'x', url: 'https://x.example.test' }) });
    assert.equal(post.status, 302);
    assert.equal((await aplicacoes.listarTodas()).length, 0);
});

test('cadastro de aplicação valida os campos e só aceita endereço http(s)', async () => {
    const base = { nome: 'Controle de Estágio', descricao: 'Acompanhamento dos estágios.', icone: '🎓', categoria_id: String(internas.id), ordem: '1', publicada: 'on' };

    for (const invalido of ['javascript:alert(1)', 'ftp://arquivos.example.test', 'estagios.example.test', 'https://usuario:senha@estagios.example.test', '']) {
        const resposta = await enviar('/admin/aplicacoes', { ...base, url: invalido });
        assert.equal(resposta.status, 422, invalido);
        assert.match(await resposta.text(), /Informe o endereço completo/);
    }
    assert.equal((await enviar('/admin/aplicacoes', { ...base, nome: '', url: 'https://estagios.example.test' })).status, 422);
    assert.equal((await enviar('/admin/aplicacoes', { ...base, url: 'https://estagios.example.test', categoria_id: '9999' })).status, 422);
    assert.equal((await aplicacoes.listarTodas()).length, 0);

    const ok = await enviar('/admin/aplicacoes', { ...base, url: 'https://estagios.example.test' });
    assert.equal(ok.status, 302);
    const [criada] = await aplicacoes.listarTodas();
    assert.equal(criada.nome, 'Controle de Estágio');
    assert.equal(criada.url, 'https://estagios.example.test/');
    assert.equal(criada.situacao, 'publicada');
    assert.equal(criada.categoria_id, internas.id);
});

test('página inicial lista só as publicadas, por categoria, abrindo em nova aba', async () => {
    await aplicacoes.criar({ nome: 'Museu Virtual', descricao: 'Acervo do campus.', url: 'https://museu.example.test/', categoriaId: projetos.id, situacao: 'publicada', ordem: 0 });
    await aplicacoes.criar({ nome: 'Rascunho Secreto', url: 'https://rascunho.example.test/', categoriaId: projetos.id, situacao: 'oculta', ordem: 0 });
    await aplicacoes.criar({ nome: 'Sem Grupo', url: 'https://semgrupo.example.test/', categoriaId: null, situacao: 'publicada', ordem: 0 });
    const estagio = (await aplicacoes.listarTodas()).find((a) => a.nome === 'Controle de Estágio');
    const museu = (await aplicacoes.listarTodas()).find((a) => a.nome === 'Museu Virtual');
    await aplicacoes.registrarStatus(estagio.id, { status: 'online', http: 200, ms: 40 });
    await aplicacoes.registrarStatus(museu.id, { status: 'offline', http: 502, ms: 12 });

    const html = await (await pagina('/')).text();
    assert.match(html, /<a href="https:\/\/estagios\.example\.test\/" class="app-link" target="_blank" rel="noopener noreferrer">Controle de Estágio/);
    assert.doesNotMatch(html, /Rascunho Secreto/);

    // ordem das categorias e o grupo das que não têm categoria no fim
    const posicao = (trecho) => html.indexOf(trecho);
    assert.ok(posicao('id="titulo-categoria-' + internas.id) < posicao('id="titulo-categoria-' + projetos.id));
    assert.ok(posicao('id="titulo-categoria-' + projetos.id) < posicao('Outras aplicações</h2>'));
    // categoria sem aplicação publicada não aparece
    assert.doesNotMatch(html, /Diversas/);

    assert.match(html, new RegExp(`data-status-id="${estagio.id}" data-status="online">No ar<`));
    assert.match(html, new RegExp(`data-status-id="${museu.id}" data-status="offline">Fora do ar<`));
    assert.match(html, /data-status="desconhecido">Verificando</);
    assert.match(html, /data-resumo="total">3</);
    assert.match(html, /data-resumo="online">1</);
    assert.match(html, /data-resumo="offline">1</);

    const status = await (await pagina('/api/status')).json();
    assert.equal(status.aplicacoes.length, 3);
    assert.deepEqual(status.aplicacoes.find((a) => a.id === museu.id), { id: museu.id, status: 'offline' });
    assert.ok(status.verificadoEm);
});

test('texto cadastrado nunca vira HTML na página', async () => {
    const xss = await aplicacoes.criar({ nome: '<script>alert(1)</script>', descricao: '"><img src=x onerror=alert(1)>', url: 'https://xss.example.test/', categoriaId: null, situacao: 'publicada', ordem: 0 });
    const html = await (await pagina('/')).text();
    assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
    assert.doesNotMatch(html, /<img src=x/);
    assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
    const admHtml = await (await pagina('/admin/aplicacoes', admin.id)).text();
    assert.doesNotMatch(admHtml, /<script>alert\(1\)<\/script>/);
    await aplicacoes.excluir(xss.id);
});

test('ocultar tira da página inicial; publicar devolve', async () => {
    const museu = (await aplicacoes.listarTodas()).find((a) => a.nome === 'Museu Virtual');
    assert.equal((await enviar(`/admin/aplicacoes/${museu.id}/situacao`, { situacao: 'oculta' })).status, 302);
    assert.doesNotMatch(await (await pagina('/')).text(), /Museu Virtual/);
    await enviar(`/admin/aplicacoes/${museu.id}/situacao`, { situacao: 'publicada' });
    assert.match(await (await pagina('/')).text(), /Museu Virtual/);
    // situação inventada não é aceita
    assert.equal((await enviar(`/admin/aplicacoes/${museu.id}/situacao`, { situacao: 'pendente' })).status, 404);
});

test('excluir a categoria deixa as aplicações sem categoria, sem apagá-las', async () => {
    const temporaria = await categorias.criar({ nome: 'Temporária', descricao: '', ordem: 99 });
    const app = await aplicacoes.criar({ nome: 'App Temporária', url: 'https://temp.example.test/', categoriaId: temporaria.id, situacao: 'publicada', ordem: 0 });
    assert.equal((await enviar('/admin/categorias', { nome: 'temporária', ordem: '5' })).status, 302);
    assert.equal((await categorias.listar()).filter((c) => c.nome.toLowerCase() === 'temporária').length, 1, 'nome repetido não entra');

    assert.equal((await enviar(`/admin/categorias/${temporaria.id}/excluir`, {})).status, 302);
    assert.equal((await aplicacoes.buscarPorId(app.id)).categoria_id, null);
    await aplicacoes.excluir(app.id);
});

test('login: só conta @ifc.edu.br verificada e autorizada entra', async () => {
    const perfil = (email, extra = {}) => ({ sub: `g-${email}`, email, email_verified: true, name: 'Pessoa Teste', ...extra });

    assert.match((await autorizarLogin(perfil('alguem@gmail.com'))).erro, /conta institucional/);
    assert.match((await autorizarLogin(perfil('alguem@ifc.edu.br.example.test'))).erro, /conta institucional/);
    assert.match((await autorizarLogin(perfil('alguem@naoifc.edu.br'))).erro, /conta institucional/);
    assert.match((await autorizarLogin(perfil('professor@ifc.edu.br', { email_verified: false }))).erro, /verificado/);
    assert.match((await autorizarLogin(null)).erro, /verificado/);

    // institucional, mas fora da lista
    assert.match((await autorizarLogin(perfil('professor@ifc.edu.br'))).erro, /não está autorizada/);
    assert.equal(await usuarios.buscarPorEmail('professor@ifc.edu.br'), null);

    // a conta principal entra sem cadastro prévio
    const principal = await autorizarLogin(perfil(ADMIN_PRINCIPAL_EMAIL.toUpperCase()));
    assert.equal(principal.usuario.email, ADMIN_PRINCIPAL_EMAIL);
    assert.equal(ADMIN_PRINCIPAL_EMAIL, 'fabricadesoftware.videira@ifc.edu.br');

    // autorizada pelo e-mail: o primeiro login liga a conta Google e traz o nome
    assert.equal((await enviar('/admin/usuarios', { email: 'Professor@IFC.edu.br' })).status, 302);
    const entrou = await autorizarLogin(perfil('professor@ifc.edu.br'));
    assert.equal(entrou.usuario.google_id, 'g-professor@ifc.edu.br');
    assert.equal(entrou.usuario.nome, 'Pessoa Teste');
    assert.ok(entrou.usuario.ultimo_acesso_em);

    // mesmo e-mail com outra conta Google não assume o cadastro
    assert.match((await autorizarLogin(perfil('professor@ifc.edu.br', { sub: 'outro-google' }))).erro, /outra conta Google/);

    // desativada não entra
    await usuarios.definirAtivo(entrou.usuario.id, false);
    assert.match((await autorizarLogin(perfil('professor@ifc.edu.br'))).erro, /desativada/);
});

test('usuários: só e-mail institucional; conta principal e a própria são protegidas', async () => {
    for (const email of ['fulano@gmail.com', 'fulano@ifc.edu.br.example.test', 'sem-arroba', '']) {
        await enviar('/admin/usuarios', { email });
        assert.equal(await usuarios.buscarPorEmail(email || 'x'), null, email);
    }

    const principal = await usuarios.buscarPorEmail(ADMIN_PRINCIPAL_EMAIL);
    await enviar(`/admin/usuarios/${principal.id}/ativo`, { ativo: '0' });
    await enviar(`/admin/usuarios/${principal.id}/excluir`, {});
    assert.equal((await usuarios.buscarPorId(principal.id)).ativo, true);

    await enviar(`/admin/usuarios/${admin.id}/excluir`, {});
    assert.ok(await usuarios.buscarPorId(admin.id));

    const professor = await usuarios.buscarPorEmail('professor@ifc.edu.br');
    await enviar(`/admin/usuarios/${professor.id}/ativo`, { ativo: '1' });
    assert.equal((await usuarios.buscarPorId(professor.id)).ativo, true);
});

test('quem foi desativado ou removido perde a sessão aberta na requisição seguinte', async () => {
    const professor = await usuarios.buscarPorEmail('professor@ifc.edu.br');
    assert.equal((await pagina('/admin/aplicacoes', professor.id)).status, 200);

    await usuarios.definirAtivo(professor.id, false);
    const negado = await pagina('/admin/aplicacoes', professor.id);
    assert.equal(negado.status, 403);
    assert.match(await negado.text(), /Acesso desativado/);

    await usuarios.excluir(professor.id);
    assert.equal((await pagina('/admin/aplicacoes', professor.id)).status, 403);
});

test('sincronização com o Dokploy: novas ficam pendentes e as edições são preservadas', async () => {
    const dominios = [
        { chave: 'dom-1', nome: 'fabrica-planos', descricao: null, url: 'https://planos.example.test', projeto: 'Fábrica' },
        { chave: 'dom-2', nome: 'fabrica-copa', descricao: 'Bolão', url: 'https://copa.example.test', projeto: 'Fábrica' },
        // já cadastrada à mão (mesmo endereço, com a barra no fim): não duplica
        { chave: 'dom-3', nome: 'fabrica-museu', descricao: null, url: 'https://museu.example.test', projeto: 'Fábrica' },
    ];
    const total = (await aplicacoes.listarTodas()).length;

    assert.deepEqual(await aplicacoes.sincronizarDokploy(dominios), { novas: 2, atualizadas: 1, ausentes: 0 });
    let todas = await aplicacoes.listarTodas();
    assert.equal(todas.length, total + 2);
    const planos = todas.find((a) => a.dokploy_chave === 'dom-1');
    assert.equal(planos.situacao, 'pendente');
    assert.equal(planos.origem, 'dokploy');
    const museu = todas.find((a) => a.dokploy_chave === 'dom-3');
    assert.equal(museu.nome, 'Museu Virtual');
    assert.equal(museu.situacao, 'publicada');

    // pendente não aparece na página inicial, mas aparece na revisão
    assert.doesNotMatch(await (await pagina('/')).text(), /fabrica-planos/);
    const adm = await (await pagina('/admin/aplicacoes', admin.id)).text();
    assert.match(adm, /Encontradas no Dokploy/);
    assert.match(adm, /fabrica-planos/);

    // revisão: publica com categoria, renomeia e aponta para uma página interna
    await enviar(`/admin/aplicacoes/${planos.id}/situacao`, { situacao: 'publicada', categoria_id: String(internas.id) });
    await enviar(`/admin/aplicacoes/${planos.id}`, { nome: 'Planos de Ensino', url: 'https://planos.example.test/entrar', categoria_id: String(internas.id), ordem: '0', publicada: 'on' });
    await aplicacoes.registrarStatus(planos.id, { status: 'online', http: 200, ms: 30 });

    // o domínio continua o mesmo no Dokploy: o ajuste feito à mão e o status ficam
    assert.deepEqual(await aplicacoes.sincronizarDokploy(dominios), { novas: 0, atualizadas: 3, ausentes: 0 });
    const ajustada = await aplicacoes.buscarPorId(planos.id);
    assert.equal(ajustada.url, 'https://planos.example.test/entrar');
    assert.equal(ajustada.status, 'online');

    // nova rodada: o domínio mudou no Dokploy e a copa saiu de lá
    const depois = [{ ...dominios[0], nome: 'fabrica-planos', url: 'https://planos-novo.example.test' }, dominios[2]];
    assert.deepEqual(await aplicacoes.sincronizarDokploy(depois), { novas: 0, atualizadas: 2, ausentes: 1 });
    todas = await aplicacoes.listarTodas();
    const planosDepois = todas.find((a) => a.dokploy_chave === 'dom-1');
    assert.equal(planosDepois.nome, 'Planos de Ensino');
    assert.equal(planosDepois.url, 'https://planos-novo.example.test');
    assert.equal(planosDepois.situacao, 'publicada');
    assert.equal(planosDepois.categoria_id, internas.id);
    assert.equal(planosDepois.status, 'desconhecido');
    const copa = todas.find((a) => a.dokploy_chave === 'dom-2');
    assert.equal(copa.dokploy_ausente, true);
    // mesmo endereço (só muda a barra no fim): nada é trocado e o status fica
    const museuDepois = todas.find((a) => a.dokploy_chave === 'dom-3');
    assert.equal(museuDepois.url, 'https://museu.example.test/');
    assert.equal(museuDepois.status, 'offline');

    // repetir não muda nada
    assert.deepEqual(await aplicacoes.sincronizarDokploy(depois), { novas: 0, atualizadas: 2, ausentes: 0 });
    assert.equal((await aplicacoes.listarTodas()).length, total + 2);
});

test('excluir: o que ainda está no Dokploy só pode ser ocultado', async () => {
    const dokployEnv = { url: process.env.DOKPLOY_URL, chave: process.env.DOKPLOY_API_KEY };
    process.env.DOKPLOY_URL = 'https://dokploy.example.test';
    process.env.DOKPLOY_API_KEY = 'chave-de-teste';
    try {
        const todas = await aplicacoes.listarTodas();
        const planos = todas.find((a) => a.dokploy_chave === 'dom-1');
        const copa = todas.find((a) => a.dokploy_chave === 'dom-2');

        await enviar(`/admin/aplicacoes/${planos.id}/excluir`, {});
        assert.ok(await aplicacoes.buscarPorId(planos.id), 'continua no Dokploy: não exclui');

        await enviar(`/admin/aplicacoes/${copa.id}/excluir`, {});
        assert.equal(await aplicacoes.buscarPorId(copa.id), null, 'saiu do Dokploy: pode excluir');
    } finally {
        for (const [nome, valor] of [['DOKPLOY_URL', dokployEnv.url], ['DOKPLOY_API_KEY', dokployEnv.chave]]) {
            if (valor === undefined) delete process.env[nome]; else process.env[nome] = valor;
        }
    }
});

test('login de desenvolvimento só existe com APP_ENV=development', async () => {
    for (const ambiente of ['production', 'staging', '']) {
        process.env.APP_ENV = ambiente;
        assert.equal((await pagina('/auth/dev/admin')).status, 404, ambiente || '(vazio)');
        assert.doesNotMatch(await (await pagina('/login')).text(), /auth\/dev/);
    }
    assert.equal(await usuarios.buscarPorEmail('admin.dev@ifc.edu.br'), null);

    process.env.APP_ENV = 'development';
    assert.match(await (await pagina('/login')).text(), /href="\/auth\/dev\/admin"/);
    const resposta = await pagina('/auth/dev/admin');
    assert.equal(resposta.status, 302);
    assert.equal(resposta.headers.get('location'), '/admin/aplicacoes');
});
