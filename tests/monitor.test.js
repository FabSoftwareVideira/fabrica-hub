// Verificação de status: o que conta como "no ar".
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { noAr, verificarUrl } = require('../src/services/monitor');

let server, url, pedidos;

before(async () => {
    server = http.createServer((req, res) => {
        pedidos.push(req.url);
        const codigo = Number(req.url.slice(1));
        if (req.url === '/lento') return; // nunca responde
        if (req.url === '/instavel') {
            // falha na primeira tentativa, responde na segunda
            const tentativas = pedidos.filter((p) => p === '/instavel').length;
            res.writeHead(tentativas === 1 ? 503 : 200).end();
            return;
        }
        res.writeHead(codigo, codigo >= 300 && codigo < 400 ? { location: 'https://outro-lugar.example.test/login' } : {}).end('ok');
    });
    server.listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    url = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
});

test('no ar: respondeu, redirecionou ou pediu acesso; fora do ar: 404 e erros do servidor', () => {
    for (const codigo of [200, 204, 301, 302, 307, 401, 403]) assert.equal(noAr(codigo), true, String(codigo));
    for (const codigo of [404, 410, 429, 500, 502, 503, 504]) assert.equal(noAr(codigo), false, String(codigo));
});

test('verificarUrl classifica a resposta e não segue o redirecionamento', async () => {
    pedidos = [];
    assert.equal((await verificarUrl(`${url}/200`)).status, 'online');
    const redirecionou = await verificarUrl(`${url}/302`);
    assert.deepEqual([redirecionou.status, redirecionou.http], ['online', 302]);
    assert.equal((await verificarUrl(`${url}/401`)).status, 'online');

    const quebrada = await verificarUrl(`${url}/502`);
    assert.deepEqual([quebrada.status, quebrada.http], ['offline', 502]);
    assert.equal((await verificarUrl(`${url}/404`)).status, 'offline');
    assert.equal(pedidos.filter((p) => p === '/502').length, 2, 'uma segunda tentativa antes de dar como fora do ar');
    assert.equal(pedidos.filter((p) => p === '/200').length, 1);
});

test('uma falha isolada não derruba o status', async () => {
    pedidos = [];
    assert.equal((await verificarUrl(`${url}/instavel`)).status, 'online');
});

test('sem resposta (porta fechada ou demora demais) é fora do ar', async () => {
    pedidos = [];
    const lenta = await verificarUrl(`${url}/lento`, { tempoLimiteMs: 150, tentativas: 1 });
    assert.deepEqual(lenta, { status: 'offline', http: null, ms: null });

    const fechado = http.createServer();
    fechado.listen(0, '127.0.0.1');
    await new Promise((resolve) => fechado.once('listening', resolve));
    const porta = fechado.address().port;
    await new Promise((resolve) => fechado.close(resolve));
    assert.equal((await verificarUrl(`http://127.0.0.1:${porta}/`, { tempoLimiteMs: 1000 })).status, 'offline');
});
