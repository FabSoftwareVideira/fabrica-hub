// Como as aplicações aparecem nas telas: agrupamento, status e datas.

const STATUS = {
    online: { chave: 'online', rotulo: 'No ar', classe: 'status-completed' },
    offline: { chave: 'offline', rotulo: 'Fora do ar', classe: 'status-invalidated' },
    desconhecido: { chave: 'desconhecido', rotulo: 'Verificando', classe: 'status-waiting' },
};

function statusDe(app) {
    return STATUS[app.status] || STATUS.desconhecido;
}

// Endereço sem o protocolo, como aparece no cartão.
function enderecoCurto(url) {
    try {
        const { host, pathname } = new URL(url);
        return host + (pathname && pathname !== '/' ? pathname.replace(/\/$/, '') : '');
    } catch {
        return url;
    }
}

// Sem emoji escolhido, o cartão mostra a primeira letra do nome.
function simbolo(app) {
    return app.icone || (Array.from(String(app.nome || '?').trim())[0] || '?').toUpperCase();
}

// A lista já vem ordenada por categoria; aqui só é quebrada em grupos.
function agrupar(lista) {
    const grupos = [];
    for (const app of lista) {
        const id = app.categoria_id || null;
        let grupo = grupos[grupos.length - 1];
        if (!grupo || grupo.id !== id) {
            grupo = {
                id,
                ancora: id ? `categoria-${id}` : 'categoria-outras',
                nome: id ? app.categoria_nome : 'Outras aplicações',
                descricao: id ? app.categoria_descricao : null,
                aplicacoes: [],
            };
            grupos.push(grupo);
        }
        grupo.aplicacoes.push(app);
    }
    return grupos;
}

function resumir(lista) {
    const verificacoes = lista.map((app) => app.status_verificado_em).filter(Boolean).map((data) => new Date(data).getTime());
    return {
        total: lista.length,
        online: lista.filter((app) => app.status === 'online').length,
        offline: lista.filter((app) => app.status === 'offline').length,
        verificadoEm: verificacoes.length ? new Date(Math.max(...verificacoes)) : null,
    };
}

const FORMATO_DATA_HORA = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
});
const FORMATO_HORA = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });

// Horário de Brasília.
function dataHoraBr(data) {
    return data ? FORMATO_DATA_HORA.format(new Date(data)).replace(',', ' às') : '';
}

function horaBr(data) {
    return data ? FORMATO_HORA.format(new Date(data)) : '';
}

module.exports = { statusDe, enderecoCurto, simbolo, agrupar, resumir, dataHoraBr, horaBr };
