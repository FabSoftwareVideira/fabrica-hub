const { pool } = require('../config/database');

async function buscarPorId(id) {
    const { rows } = await pool.query('SELECT * FROM usuarios WHERE id = $1', [id]);
    return rows[0] || null;
}

async function buscarPorEmail(email) {
    const { rows } = await pool.query('SELECT * FROM usuarios WHERE LOWER(email) = LOWER($1)', [email]);
    return rows[0] || null;
}

async function buscarPorGoogleId(googleId) {
    const { rows } = await pool.query('SELECT * FROM usuarios WHERE google_id = $1', [googleId]);
    return rows[0] || null;
}

async function listar() {
    const { rows } = await pool.query('SELECT * FROM usuarios ORDER BY LOWER(nome), id');
    return rows;
}

async function criar({ nome, email, googleId = null }) {
    const { rows } = await pool.query(
        'INSERT INTO usuarios (nome, email, google_id) VALUES ($1, LOWER($2), $3) RETURNING *',
        [nome, email, googleId]
    );
    return rows[0];
}

// Liga a conta Google a um cadastro feito pelo e-mail. Só vale para cadastro
// ainda sem Google: e-mail igual não basta para assumir uma conta já vinculada.
async function vincularGoogle(id, googleId) {
    const { rows } = await pool.query(
        'UPDATE usuarios SET google_id = $2 WHERE id = $1 AND google_id IS NULL RETURNING *',
        [id, googleId]
    );
    return rows[0] || null;
}

// O nome vem da conta Google a cada login (o cadastro pelo e-mail usa um provisório).
async function registrarAcesso(id, nome) {
    const { rows } = await pool.query(
        'UPDATE usuarios SET ultimo_acesso_em = NOW(), nome = COALESCE($2, nome) WHERE id = $1 RETURNING *',
        [id, nome || null]
    );
    return rows[0] || null;
}

async function definirAtivo(id, ativo) {
    await pool.query('UPDATE usuarios SET ativo = $2 WHERE id = $1', [id, ativo]);
}

async function excluir(id) {
    await pool.query('DELETE FROM usuarios WHERE id = $1', [id]);
}

module.exports = {
    buscarPorId,
    buscarPorEmail,
    buscarPorGoogleId,
    listar,
    criar,
    vincularGoogle,
    registrarAcesso,
    definirAtivo,
    excluir,
};
