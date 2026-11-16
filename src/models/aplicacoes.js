const { pool } = require('../config/database');

const SELECAO = `
    SELECT a.*, c.nome AS categoria_nome, c.descricao AS categoria_descricao, c.ordem AS categoria_ordem
    FROM aplicacoes a
    LEFT JOIN categorias c ON c.id = a.categoria_id
`;
// sem categoria vai para o fim
const ORDEM = 'ORDER BY (c.id IS NULL), c.ordem, LOWER(c.nome), a.ordem, LOWER(a.nome), a.id';

// O que aparece na página inicial.
async function listarPublicadas() {
    const { rows } = await pool.query(`${SELECAO} WHERE a.situacao = 'publicada' ${ORDEM}`);
    return rows;
}

async function listarTodas() {
    const { rows } = await pool.query(`${SELECAO} ${ORDEM}`);
    return rows;
}

// Ocultas não são verificadas: ninguém as vê.
async function listarMonitoradas() {
    const { rows } = await pool.query("SELECT id, url, status FROM aplicacoes WHERE situacao <> 'oculta' ORDER BY id");
    return rows;
}

async function buscarPorId(id) {
    const { rows } = await pool.query(`${SELECAO} WHERE a.id = $1`, [id]);
    return rows[0] || null;
}

async function criar({ nome, descricao, url, icone, categoriaId, situacao, ordem }) {
    const { rows } = await pool.query(
        `INSERT INTO aplicacoes (nome, descricao, url, icone, categoria_id, situacao, ordem)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
        [nome, descricao || null, url, icone || null, categoriaId || null, situacao, ordem]
    );
    return rows[0];
}

// Mudou o endereço: o status antigo não vale mais.
async function atualizar(id, { nome, descricao, url, icone, categoriaId, situacao, ordem }) {
    const { rows } = await pool.query(
        `UPDATE aplicacoes
         SET nome = $2, descricao = $3, icone = $5, categoria_id = $6, situacao = $7, ordem = $8,
             status = CASE WHEN url = $4 THEN status ELSE 'desconhecido' END,
             status_http = CASE WHEN url = $4 THEN status_http ELSE NULL END,
             status_ms = CASE WHEN url = $4 THEN status_ms ELSE NULL END,
             status_verificado_em = CASE WHEN url = $4 THEN status_verificado_em ELSE NULL END,
             url = $4, atualizado_em = NOW()
         WHERE id = $1 RETURNING *`,
        [id, nome, descricao || null, url, icone || null, categoriaId || null, situacao, ordem]
    );
    return rows[0] || null;
}

// Publicar pela lista de pendências: define a situação e, se informada, a categoria.
async function definirSituacao(id, situacao, categoriaId) {
    const { rows } = await pool.query(
        `UPDATE aplicacoes
         SET situacao = $2, categoria_id = COALESCE($3, categoria_id), atualizado_em = NOW()
         WHERE id = $1 RETURNING *`,
        [id, situacao, categoriaId || null]
    );
    return rows[0] || null;
}

async function excluir(id) {
    await pool.query('DELETE FROM aplicacoes WHERE id = $1', [id]);
}

async function registrarStatus(id, { status, http, ms }) {
    await pool.query(
        `UPDATE aplicacoes
         SET status = $2, status_http = $3, status_ms = $4, status_verificado_em = NOW()
         WHERE id = $1`,
        [id, status, http ?? null, ms ?? null]
    );
}

// Status das publicadas, para a página inicial se atualizar sozinha.
async function statusPublicadas() {
    const { rows } = await pool.query(
        "SELECT id, status, status_verificado_em FROM aplicacoes WHERE situacao = 'publicada' ORDER BY id"
    );
    return rows;
}

// "mesmo endereço" ignora a barra no fim e maiúsculas
const mesmoEndereco = (coluna) => `LOWER(RTRIM(${coluna}, '/')) = LOWER(RTRIM($2, '/'))`;

// Recebe os domínios encontrados no Dokploy: [{ chave, nome, descricao, url, projeto }].
// - domínio já importado: nome, descrição, categoria e situação editados aqui são
//   preservados; o endereço só é trocado (e o status zerado) quando o domínio
//   muda no Dokploy, então um ajuste feito à mão também fica;
// - endereço já cadastrado à mão: passa a ser acompanhado, sem duplicar;
// - domínio novo: entra como 'pendente', fora da página inicial até alguém publicar;
// - o que não veio desta vez fica marcado como ausente no Dokploy.
async function sincronizarDokploy(itens) {
    const resultado = { novas: 0, atualizadas: 0, ausentes: 0 };

    for (const item of itens) {
        const projeto = item.projeto ? String(item.projeto).slice(0, 150) : null;

        const inalterado = mesmoEndereco('dokploy_url');
        const conhecida = await pool.query(
            `UPDATE aplicacoes
             SET url = CASE WHEN ${inalterado} THEN url ELSE $2 END,
                 status = CASE WHEN ${inalterado} THEN status ELSE 'desconhecido' END,
                 atualizado_em = CASE WHEN ${inalterado} THEN atualizado_em ELSE NOW() END,
                 dokploy_url = $2, dokploy_projeto = $3, dokploy_ausente = FALSE
             WHERE dokploy_chave = $1 RETURNING id`,
            [item.chave, item.url, projeto]
        );
        if (conhecida.rows.length) { resultado.atualizadas += 1; continue; }

        const adotada = await pool.query(
            `UPDATE aplicacoes
             SET dokploy_chave = $1, dokploy_url = $2, dokploy_projeto = $3, origem = 'dokploy', dokploy_ausente = FALSE
             WHERE id = (
                 SELECT id FROM aplicacoes
                 WHERE dokploy_chave IS NULL AND ${mesmoEndereco('url')}
                 ORDER BY id LIMIT 1
             ) RETURNING id`,
            [item.chave, item.url, projeto]
        );
        if (adotada.rows.length) { resultado.atualizadas += 1; continue; }

        await pool.query(
            `INSERT INTO aplicacoes (nome, descricao, url, situacao, origem, dokploy_chave, dokploy_url, dokploy_projeto)
             VALUES ($1, $2, $3, 'pendente', 'dokploy', $4, $3, $5)`,
            [
                String(item.nome).slice(0, 100),
                item.descricao ? String(item.descricao).slice(0, 300) : null,
                item.url,
                item.chave,
                projeto,
            ]
        );
        resultado.novas += 1;
    }

    const chaves = itens.map((item) => item.chave);
    const ausentes = await pool.query(
        `UPDATE aplicacoes SET dokploy_ausente = TRUE
         WHERE origem = 'dokploy' AND dokploy_chave IS NOT NULL AND dokploy_ausente = FALSE
           AND NOT (dokploy_chave = ANY($1::text[]))
         RETURNING id`,
        [chaves]
    );
    resultado.ausentes = ausentes.rows.length;

    return resultado;
}

module.exports = {
    listarPublicadas,
    listarTodas,
    listarMonitoradas,
    buscarPorId,
    criar,
    atualizar,
    definirSituacao,
    excluir,
    registrarStatus,
    statusPublicadas,
    sincronizarDokploy,
};
