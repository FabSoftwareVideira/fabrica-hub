// Tarefas periódicas do processo web: verificação de status e sincronização
// com o Dokploy. Iniciadas em src/server.js (os testes não as iniciam).

const monitor = require('./monitor');
const dokploy = require('./dokploy');

function minimo(valor, padrao, piso) {
    const numero = Number(valor);
    return Number.isFinite(numero) && numero >= piso ? numero : padrao;
}

function iniciar() {
    // status: a cada STATUS_INTERVALO_SEGUNDOS (padrão 60, mínimo 15)
    const intervaloStatus = minimo(process.env.STATUS_INTERVALO_SEGUNDOS, 60, 15) * 1000;
    const verificar = () => monitor.verificarTodas()
        .catch((erro) => console.error('[monitor] erro na verificação:', erro.message));

    // Dokploy: ao subir e a cada DOKPLOY_SINCRONIZAR_MINUTOS (padrão 30; 0 desliga
    // a sincronização automática e deixa só o botão da área administrativa)
    const minutos = minimo(process.env.DOKPLOY_SINCRONIZAR_MINUTOS, 30, 0);
    const sincronizar = () => dokploy.sincronizar()
        .then((r) => { if (r.novas || r.ausentes) console.log(`[dokploy] ${r.novas} nova(s), ${r.ausentes} ausente(s)`); })
        .catch((erro) => console.error('[dokploy] erro ao sincronizar:', erro.message));

    const sincronizarAoSubir = dokploy.configurado() && minutos > 0;
    setTimeout(async () => {
        if (sincronizarAoSubir) await sincronizar();
        await verificar();
    }, 3000).unref();

    setInterval(verificar, intervaloStatus).unref();
    if (sincronizarAoSubir) setInterval(sincronizar, minutos * 60 * 1000).unref();

    console.log(`[agendador] status a cada ${intervaloStatus / 1000}s; Dokploy: ${
        !dokploy.configurado() ? 'não configurado' : (minutos > 0 ? `a cada ${minutos} min` : 'só manual')}`);
}

module.exports = { iniciar };
