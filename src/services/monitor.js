// Verificação de status: uma requisição HTTP ao endereço de cada aplicação.
//
// "No ar" é a aplicação responder: 2xx, um redirecionamento (3xx, comum em quem
// manda para a tela de login) ou 401/403 (respondeu, mas pede acesso). Sem
// resposta, erro de certificado, 404 (o que o Traefik devolve quando o container
// está parado) e 5xx contam como fora do ar.

const aplicacoes = require('../models/aplicacoes');

const TEMPO_LIMITE_MS = 8000;
const SIMULTANEAS = 5;

function noAr(http) {
    return (http >= 200 && http < 400) || http === 401 || http === 403;
}

async function tentar(url, tempoLimiteMs) {
    const inicio = Date.now();
    const resposta = await fetch(url, {
        method: 'GET',
        // o redirecionamento já é resposta suficiente; não seguimos para outro endereço
        redirect: 'manual',
        signal: AbortSignal.timeout(tempoLimiteMs),
        headers: { 'user-agent': 'fabrica-hub-monitor/1.0', accept: 'text/html,*/*;q=0.8' },
    });
    const ms = Date.now() - inicio;
    // só o código da resposta interessa
    if (resposta.body) resposta.body.cancel().catch(() => {});
    return { http: resposta.status, ms };
}

// Uma falha isolada (rede, reinício rápido) não derruba o status: tenta de novo uma vez.
async function verificarUrl(url, { tempoLimiteMs = TEMPO_LIMITE_MS, tentativas = 2 } = {}) {
    let ultimo = { status: 'offline', http: null, ms: null };
    for (let i = 0; i < tentativas; i += 1) {
        try {
            const { http, ms } = await tentar(url, tempoLimiteMs);
            ultimo = { status: noAr(http) ? 'online' : 'offline', http, ms };
            if (ultimo.status === 'online') return ultimo;
        } catch {
            ultimo = { status: 'offline', http: null, ms: null };
        }
    }
    return ultimo;
}

let emAndamento = null;

async function executarVerificacao() {
    const fila = await aplicacoes.listarMonitoradas();
    const resumo = { total: fila.length, online: 0, offline: 0 };

    async function trabalhar() {
        while (fila.length) {
            const app = fila.shift();
            const resultado = await verificarUrl(app.url);
            await aplicacoes.registrarStatus(app.id, resultado);
            resumo[resultado.status] += 1;
        }
    }
    await Promise.all(Array.from({ length: Math.min(SIMULTANEAS, fila.length) }, trabalhar));
    return resumo;
}

// Uma rodada por vez: quem pede durante uma rodada recebe o resultado dela.
function verificarTodas() {
    if (!emAndamento) {
        emAndamento = executarVerificacao().finally(() => { emAndamento = null; });
    }
    return emAndamento;
}

module.exports = { noAr, verificarUrl, verificarTodas };
