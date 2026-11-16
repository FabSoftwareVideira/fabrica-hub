const { pool } = require('../config/database');

// Com a quantidade de aplicações de cada categoria (todas as situações).
async function listar() {
    const { rows } = await pool.query(`
        SELECT c.*, COUNT(a.id)::int AS total_aplicacoes
        FROM categorias c
        LEFT JOIN aplicacoes a ON a.categoria_id = c.id
        GROUP BY c.id
        ORDER BY c.ordem, LOWER(c.nome)
    `);
    return rows;
}

async function buscarPorId(id) {
    const { rows } = await pool.query('SELECT * FROM categorias WHERE id = $1', [id]);
    return rows[0] || null;
}

async function criar({ nome, descricao, ordem }) {
    const { rows } = await pool.query(
        'INSERT INTO categorias (nome, descricao, ordem) VALUES ($1, $2, $3) RETURNING *',
        [nome, descricao || null, ordem]
    );
    return rows[0];
}

async function atualizar(id, { nome, descricao, ordem }) {
    const { rows } = await pool.query(
        'UPDATE categorias SET nome = $2, descricao = $3, ordem = $4 WHERE id = $1 RETURNING *',
        [id, nome, descricao || null, ordem]
    );
    return rows[0] || null;
}

// As aplicações da categoria ficam sem categoria (ON DELETE SET NULL).
async function excluir(id) {
    await pool.query('DELETE FROM categorias WHERE id = $1', [id]);
}

module.exports = { listar, buscarPorId, criar, atualizar, excluir };
