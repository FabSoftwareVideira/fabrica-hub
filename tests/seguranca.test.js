// Proteções de sessão e de origem: CSRF, sessão nova no login, cabeçalhos e
// segredo da sessão.
const { test, before, after, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const { verificarOrigem } = require('../src/middleware/origem');
const { iniciarSessao, salvarSessaoAoRedirecionar, setFlash } = require('../src/middleware/auth');
const { cabecalhosSeguranca, normalizarCorpo } = require('../src/middleware/seguranca');

let server, url, host;
const envOriginal = { APP_URL: process.env.APP_URL };

before(async () => {
    const app = express();
    app.use(cabecalhosSeguranca({ https: true }));
    app.use(verificarOrigem);
    app.all('/{*rota}', (req, res) => res.send('ok'));
    server = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    host = `127.0.0.1:${server.address().port}`;
    url = `http://${host}`;
});
afterEach(() => {
    for (const [chave, valor] of Object.entries(envOriginal)) {
        if (valor === undefined) delete process.env[chave]; else process.env[chave] = valor;
    }
});
after(async () => { await new Promise((resolve) => server.close(resolve)); });

const enviar = (headers, { method = 'POST', rota = '/admin/aplicacoes' } = {}) =>
    fetch(url + rota, { method, headers, redirect: 'manual' }).then((r) => r.status);

test('POST só é aceito quando parte de uma página da própria aplicação', async () => {
    assert.equal(await enviar({ 'sec-fetch-site': 'same-origin' }), 200);
    assert.equal(await enviar({ origin: url }), 200);
    assert.equal(await enviar({ referer: `${url}/admin/aplicacoes` }), 200);

    // outro site, outro subdomínio do mesmo domínio e requisição sem origem
    assert.equal(await enviar({ 'sec-fetch-site': 'cross-site', origin: url }), 403);
    assert.equal(await enviar({ 'sec-fetch-site': 'same-site', origin: url }), 403);
    assert.equal(await enviar({ origin: 'https://outro-projeto.example.test' }), 403);
    assert.equal(await enviar({ origin: 'null' }), 403);
    assert.equal(await enviar({ referer: `http://${host}.example.test/` }), 403);
    assert.equal(await enviar({}), 403);
});

test('atrás de proxy, o host público de APP_URL também vale como origem', async () => {
    assert.equal(await enviar({ origin: 'https://hub.example.test' }), 403);
    process.env.APP_URL = 'https://hub.example.test';
    assert.equal(await enviar({ origin: 'https://hub.example.test' }), 200);
});

test('navegação continua livre; o link de sair só é recusado vindo de outro site', async () => {
    assert.equal(await enviar({}, { method: 'GET' }), 200);
    assert.equal(await enviar({ 'sec-fetch-site': 'cross-site' }, { method: 'GET' }), 200);
    assert.equal(await enviar({ 'sec-fetch-site': 'same-origin' }, { method: 'GET', rota: '/logout' }), 200);
    assert.equal(await enviar({ 'sec-fetch-site': 'cross-site' }, { method: 'GET', rota: '/logout' }), 302);
    assert.equal(await enviar({ 'sec-fetch-site': 'same-site' }, { method: 'GET', rota: '/logout' }), 302);
});

test('cabeçalhos de segurança: nada de script ou estilo em linha', async () => {
    const resposta = await fetch(url);
    const csp = resposta.headers.get('content-security-policy');
    assert.match(csp, /script-src 'self'(;|$)/);
    assert.match(csp, /style-src 'self'(;|$)/);
    assert.match(csp, /frame-ancestors 'none'/);
    assert.doesNotMatch(csp, /unsafe/);
    assert.equal(resposta.headers.get('x-content-type-options'), 'nosniff');
    assert.match(resposta.headers.get('strict-transport-security'), /max-age=31536000/);
});

test('as telas não têm script nem estilo em linha (a CSP os bloquearia)', () => {
    const pasta = path.join(__dirname, '../src/views');
    const arquivos = fs.readdirSync(pasta, { recursive: true }).filter((nome) => String(nome).endsWith('.ejs'));
    assert.ok(arquivos.length >= 8);
    for (const nome of arquivos) {
        const conteudo = fs.readFileSync(path.join(pasta, String(nome)), 'utf8');
        assert.doesNotMatch(conteudo, /<script(?![^>]*\ssrc=)/i, `${nome}: <script> em linha`);
        assert.doesNotMatch(conteudo, /\sstyle\s*=/i, `${nome}: style em linha`);
        assert.doesNotMatch(conteudo, /<style/i, `${nome}: <style>`);
        assert.doesNotMatch(conteudo, /\son[a-z]+\s*=\s*["']/i, `${nome}: evento em linha`);
    }
});

test('o login grava o usuário em uma sessão nova', async () => {
    const eventos = [];
    const req = { session: { antigo: true, regenerate(callback) { eventos.push('regenerada'); req.session = { regenerate: this.regenerate }; callback(); } } };
    await iniciarSessao(req, { id: 7 });
    assert.deepEqual(eventos, ['regenerada']);
    assert.equal(req.session.user.id, 7);
    assert.equal(req.session.antigo, undefined);

    const falha = { session: { regenerate(callback) { callback(new Error('sem banco')); } } };
    await assert.rejects(iniciarSessao(falha, { id: 7 }), /sem banco/);
    assert.equal(falha.session.user, undefined);
});

test('o redirecionamento só sai depois de a sessão estar gravada', async () => {
    const session = require('express-session');
    // um banco de sessões que demora a gravar, como o Postgres em um dia ruim
    class LojaLenta extends session.MemoryStore {
        set(sid, dados, callback) { setTimeout(() => super.set(sid, dados, callback), 250); }
    }
    const montar = (comProtecao) => {
        const loja = new LojaLenta();
        const app = express();
        app.use(session({ store: loja, secret: 'teste', resave: false, saveUninitialized: false }));
        if (comProtecao) app.use(salvarSessaoAoRedirecionar);
        app.post('/salvar', (req, res) => { setFlash(req, 'success', 'Salvo.'); res.redirect('/lista'); });
        app.get('/visitante', (req, res) => res.redirect('/login'));
        return { loja, servidor: app.listen(0, '127.0.0.1') };
    };
    const gravadoAoChegarOCabecalho = async ({ loja, servidor }) => {
        await new Promise((resolve) => servidor.once('listening', resolve));
        const base = `http://127.0.0.1:${servidor.address().port}`;
        try {
            // o fetch devolve a resposta assim que o cabeçalho chega, como o navegador ao redirecionar
            const resposta = await fetch(`${base}/salvar`, { method: 'POST', redirect: 'manual' });
            assert.equal(resposta.status, 302);
            const gravado = /Salvo\./.test(JSON.stringify(loja.sessions));
            await resposta.arrayBuffer();

            const visitante = await fetch(`${base}/visitante`, { redirect: 'manual' });
            assert.equal(visitante.status, 302);
            assert.equal(visitante.headers.get('set-cookie'), null, 'visitante não ganha sessão por ser redirecionado');
            return gravado;
        } finally {
            servidor.closeAllConnections();
            await new Promise((resolve) => servidor.close(resolve));
        }
    };

    assert.equal(await gravadoAoChegarOCabecalho(montar(false)), false, 'sem a proteção, a página seguinte lê a sessão antiga');
    assert.equal(await gravadoAoChegarOCabecalho(montar(true)), true);
});

test('campos de formulário forjados (listas, objetos) voltam a ser texto', () => {
    const req = { body: { nome: ['a', 'b'], url: { x: 1 }, ordem: '3', vazio: [{}] } };
    normalizarCorpo(req, {}, () => {});
    assert.deepEqual(req.body, { nome: 'b', ordem: '3' });

    const semCorpo = { body: undefined };
    normalizarCorpo(semCorpo, {}, () => {});
    assert.deepEqual(semCorpo.body, {});
});

test('fora de desenvolvimento a aplicação não sobe sem SESSION_SECRET próprio', () => {
    const subir = (env) => {
        try {
            execFileSync(process.execPath, ['-e', "require('./src/app')"], {
                cwd: path.join(__dirname, '..'),
                env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, ...env },
                stdio: 'pipe',
                timeout: 20000,
            });
            return 'subiu';
        } catch (erro) {
            return String(erro.stderr);
        }
    };
    assert.match(subir({ APP_ENV: 'production' }), /Defina SESSION_SECRET/);
    assert.match(subir({ APP_ENV: 'production', SESSION_SECRET: 'dev-secret-troque-em-producao' }), /Defina SESSION_SECRET/);
    assert.match(subir({}), /Defina SESSION_SECRET/);
    assert.equal(subir({ APP_ENV: 'production', SESSION_SECRET: 'um-segredo-de-verdade' }), 'subiu');
    assert.equal(subir({ APP_ENV: 'development' }), 'subiu');
});
