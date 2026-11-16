-- Estrutura inicial do hub: quem administra, as categorias e as aplicações.

-- Pessoas autorizadas a administrar o hub. Só entra quem está nesta tabela
-- (e-mail @ifc.edu.br); o google_id é preenchido no primeiro login.
CREATE TABLE usuarios (
    id               SERIAL PRIMARY KEY,
    nome             VARCHAR(150) NOT NULL,
    email            VARCHAR(255) NOT NULL,
    google_id        VARCHAR(255) UNIQUE,
    ativo            BOOLEAN NOT NULL DEFAULT TRUE,
    criado_em        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ultimo_acesso_em TIMESTAMPTZ
);
CREATE UNIQUE INDEX usuarios_email_unico ON usuarios (LOWER(email));

CREATE TABLE categorias (
    id        SERIAL PRIMARY KEY,
    nome      VARCHAR(80) NOT NULL,
    descricao VARCHAR(255),
    ordem     INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX categorias_nome_unico ON categorias (LOWER(nome));

-- situacao: 'pendente' = veio do Dokploy e aguarda revisão; 'publicada' = aparece
-- na página inicial; 'oculta' = guardada, mas fora da página inicial.
-- dokploy_chave identifica o domínio no Dokploy e dokploy_url guarda o endereço
-- visto lá por último (o campo url pode ser ajustado à mão, por exemplo para
-- abrir direto em uma página interna); dokploy_ausente marca o que sumiu de lá
-- na última sincronização.
CREATE TABLE aplicacoes (
    id                   SERIAL PRIMARY KEY,
    nome                 VARCHAR(100) NOT NULL,
    descricao            VARCHAR(300),
    url                  TEXT NOT NULL,
    icone                VARCHAR(16),
    categoria_id         INTEGER REFERENCES categorias(id) ON DELETE SET NULL,
    situacao             VARCHAR(12) NOT NULL DEFAULT 'publicada'
                         CHECK (situacao IN ('pendente', 'publicada', 'oculta')),
    ordem                INTEGER NOT NULL DEFAULT 0,
    origem               VARCHAR(10) NOT NULL DEFAULT 'manual'
                         CHECK (origem IN ('manual', 'dokploy')),
    dokploy_chave        TEXT UNIQUE,
    dokploy_url          TEXT,
    dokploy_projeto      VARCHAR(150),
    dokploy_ausente      BOOLEAN NOT NULL DEFAULT FALSE,
    status               VARCHAR(12) NOT NULL DEFAULT 'desconhecido'
                         CHECK (status IN ('desconhecido', 'online', 'offline')),
    status_http          INTEGER,
    status_ms            INTEGER,
    status_verificado_em TIMESTAMPTZ,
    criado_em            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    atualizado_em        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX aplicacoes_situacao_idx ON aplicacoes (situacao);

INSERT INTO categorias (nome, descricao, ordem) VALUES
    ('Aplicações internas do IFC', 'Sistemas de uso dos servidores e estudantes do campus.', 10),
    ('Projetos', 'Projetos de ensino, pesquisa e extensão desenvolvidos pela Fábrica de Software.', 20),
    ('Diversas', 'Outras aplicações e ferramentas.', 30);
