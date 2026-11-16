// Listagem automática: lê na API do Dokploy os projetos, seus serviços
// (Applications e Docker Compose) e os domínios de cada um. Cada domínio vira
// uma aplicação candidata no hub.
//
// Só leitura: usa project.all, domain.byApplicationId e domain.byComposeId.
// Configure DOKPLOY_URL e DOKPLOY_API_KEY; sem os dois, a sincronização fica
// desligada e o hub funciona só com o cadastro manual.

const aplicacoes = require('../models/aplicacoes');

const TEMPO_LIMITE_MS = 15000;

function configuracao() {
    const url = (process.env.DOKPLOY_URL || '').trim().replace(/\/+$/, '');
    const chave = (process.env.DOKPLOY_API_KEY || '').trim();
    return { url, chave };
}

function configurado() {
    const { url, chave } = configuracao();
    return Boolean(url && chave);
}

async function chamar(procedimento, parametros = {}) {
    const { url, chave } = configuracao();
    const consulta = new URLSearchParams(parametros).toString();
    const resposta = await fetch(`${url}/api/${procedimento}${consulta ? `?${consulta}` : ''}`, {
        headers: { 'x-api-key': chave, accept: 'application/json' },
        signal: AbortSignal.timeout(TEMPO_LIMITE_MS),
    });
    if (!resposta.ok) {
        throw new Error(`o Dokploy respondeu HTTP ${resposta.status} em ${procedimento}`);
    }
    return resposta.json();
}

// As versões recentes do Dokploy agrupam os serviços em ambientes
// (projeto.environments[]); as anteriores os traziam direto no projeto.
function servicosDoProjeto(projeto) {
    const fontes = [projeto, ...(Array.isArray(projeto.environments) ? projeto.environments : [])];
    const servicos = [];
    for (const fonte of fontes) {
        for (const app of fonte.applications || []) {
            servicos.push({ tipo: 'application', id: app.applicationId, nome: app.name, descricao: app.description, dominios: app.domains });
        }
        for (const compose of fonte.compose || []) {
            servicos.push({ tipo: 'compose', id: compose.composeId, nome: compose.name, descricao: compose.description, dominios: compose.domains });
        }
    }
    return servicos.filter((servico) => servico.id);
}

function urlDoDominio(dominio) {
    const host = String(dominio.host || '').trim().toLowerCase();
    if (!host || /[\s/]/.test(host)) return null;
    const caminho = dominio.path && dominio.path !== '/' ? String(dominio.path) : '';
    return `${dominio.https ? 'https' : 'http'}://${host}${caminho.startsWith('/') || !caminho ? caminho : `/${caminho}`}`;
}

function hostDe(valor) {
    try { return new URL(valor).host.toLowerCase(); } catch { return null; }
}

// Monta a lista de candidatas a partir da resposta de project.all.
// buscarDominios(servico) é usado quando o projeto não traz os domínios junto.
async function extrairAplicacoes(projetos, buscarDominios, { ignorarHosts = [] } = {}) {
    const ignorados = new Set(ignorarHosts.filter(Boolean).map((host) => host.toLowerCase()));
    const itens = [];
    const vistos = new Set();

    for (const projeto of Array.isArray(projetos) ? projetos : []) {
        for (const servico of servicosDoProjeto(projeto)) {
            const dominios = Array.isArray(servico.dominios) ? servico.dominios : await buscarDominios(servico);
            const validos = (Array.isArray(dominios) ? dominios : [])
                // domínios de preview de pull request são temporários
                .filter((dominio) => dominio && dominio.domainType !== 'preview' && !dominio.previewDeploymentId)
                .map((dominio) => ({ dominio, url: urlDoDominio(dominio) }))
                .filter(({ url }) => url && !ignorados.has(hostDe(url)));

            validos.forEach(({ dominio, url }, indice) => {
                const chave = dominio.domainId ? String(dominio.domainId) : `${servico.tipo}:${servico.id}:${url}`;
                if (vistos.has(chave)) return;
                vistos.add(chave);
                const base = servico.nome || hostDe(url);
                itens.push({
                    chave,
                    // um serviço com mais de um domínio: os demais levam o endereço no nome
                    nome: indice === 0 ? base : `${base} (${hostDe(url)})`,
                    descricao: servico.descricao || null,
                    url,
                    projeto: projeto.name || null,
                });
            });
        }
    }
    return itens;
}

async function listarAplicacoes() {
    const projetos = await chamar('project.all');
    const buscarDominios = (servico) => (servico.tipo === 'application'
        ? chamar('domain.byApplicationId', { applicationId: servico.id })
        : chamar('domain.byComposeId', { composeId: servico.id }));
    // o próprio hub não entra na lista
    return extrairAplicacoes(projetos, buscarDominios, { ignorarHosts: [hostDe(process.env.APP_URL || '')] });
}

let emAndamento = null;

// Uma sincronização por vez.
function sincronizar() {
    if (!configurado()) {
        return Promise.reject(new Error('Integração com o Dokploy não configurada (DOKPLOY_URL e DOKPLOY_API_KEY).'));
    }
    if (!emAndamento) {
        emAndamento = listarAplicacoes()
            .then((itens) => aplicacoes.sincronizarDokploy(itens))
            .finally(() => { emAndamento = null; });
    }
    return emAndamento;
}

module.exports = { configurado, extrairAplicacoes, sincronizar };
