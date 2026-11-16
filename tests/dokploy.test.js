// Leitura da resposta da API do Dokploy (project.all + domínios).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { extrairAplicacoes, configurado } = require('../src/services/dokploy');

const semBusca = async () => { throw new Error('não deveria buscar domínios'); };

test('versão atual do Dokploy: serviços dentro de ambientes, domínios buscados à parte', async () => {
    const projetos = [{
        name: 'Fábrica',
        environments: [{
            name: 'production',
            applications: [{ applicationId: 'app-1', name: 'fabrica-web' }],
            compose: [{ composeId: 'cmp-1', name: 'fabrica-estagiarios' }, { composeId: 'cmp-2', name: 'sem-dominio' }],
            postgres: [{ postgresId: 'pg-1', name: 'banco' }],
        }],
    }];
    const buscas = [];
    const buscar = async (servico) => {
        buscas.push(`${servico.tipo}:${servico.id}`);
        return {
            'app-1': [{ domainId: 'd1', host: 'fabrica.example.test', https: true, path: '/' }],
            'cmp-1': [
                { domainId: 'd2', host: 'Estagios.Example.Test', https: true, path: null },
                { domainId: 'd3', host: 'estagios-api.example.test', https: false, path: '/docs' },
            ],
            'cmp-2': [],
        }[servico.id];
    };

    const itens = await extrairAplicacoes(projetos, buscar);
    assert.deepEqual(buscas, ['application:app-1', 'compose:cmp-1', 'compose:cmp-2']);
    assert.deepEqual(itens, [
        { chave: 'd1', nome: 'fabrica-web', descricao: null, url: 'https://fabrica.example.test', projeto: 'Fábrica' },
        { chave: 'd2', nome: 'fabrica-estagiarios', descricao: null, url: 'https://estagios.example.test', projeto: 'Fábrica' },
        { chave: 'd3', nome: 'fabrica-estagiarios (estagios-api.example.test)', descricao: null, url: 'http://estagios-api.example.test/docs', projeto: 'Fábrica' },
    ]);
});

test('versões anteriores: serviços direto no projeto, com os domínios juntos', async () => {
    const projetos = [{
        name: 'Projetos',
        applications: [{
            applicationId: 'a1', name: 'museu', description: 'Museu virtual',
            domains: [{ host: 'museu.example.test', https: true }],
        }],
        compose: [{ composeId: 'c1', name: 'copa', domains: [] }],
    }];
    const itens = await extrairAplicacoes(projetos, semBusca);
    assert.equal(itens.length, 1);
    assert.equal(itens[0].url, 'https://museu.example.test');
    assert.equal(itens[0].descricao, 'Museu virtual');
    // sem domainId, a chave é estável entre sincronizações
    assert.equal(itens[0].chave, 'application:a1:https://museu.example.test');
});

test('ficam de fora o próprio hub, domínios de preview e hosts inválidos', async () => {
    const projetos = [{
        name: 'P',
        applications: [{
            applicationId: 'a1', name: 'servico',
            domains: [
                { domainId: 'hub', host: 'hub.example.test', https: true },
                { domainId: 'prev', host: 'pr-12.example.test', https: true, domainType: 'preview' },
                { domainId: 'vazio', host: '', https: true },
                { domainId: 'ruim', host: 'evil.example.test/@x', https: true },
                { domainId: 'ok', host: 'ok.example.test', https: true },
                { domainId: 'ok', host: 'ok.example.test', https: true },
            ],
        }],
    }];
    const itens = await extrairAplicacoes(projetos, semBusca, { ignorarHosts: ['hub.example.test', null] });
    assert.deepEqual(itens.map((i) => i.chave), ['ok']);
    assert.deepEqual(await extrairAplicacoes(null, semBusca), []);
    assert.deepEqual(await extrairAplicacoes({ erro: 'não é lista' }, semBusca), []);
});

test('sem DOKPLOY_URL e DOKPLOY_API_KEY a integração fica desligada', () => {
    const original = { url: process.env.DOKPLOY_URL, chave: process.env.DOKPLOY_API_KEY };
    try {
        delete process.env.DOKPLOY_URL; delete process.env.DOKPLOY_API_KEY;
        assert.equal(configurado(), false);
        process.env.DOKPLOY_URL = 'https://dokploy.example.test';
        assert.equal(configurado(), false);
        process.env.DOKPLOY_API_KEY = 'chave';
        assert.equal(configurado(), true);
    } finally {
        for (const [nome, valor] of [['DOKPLOY_URL', original.url], ['DOKPLOY_API_KEY', original.chave]]) {
            if (valor === undefined) delete process.env[nome]; else process.env[nome] = valor;
        }
    }
});
