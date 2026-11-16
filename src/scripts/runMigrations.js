// Aplica, em ordem, as migrações de db/migrations que ainda não rodaram neste
// banco. O histórico fica na tabela schema_migrations.

const fs = require('fs');
const path = require('path');
const { pool } = require('../config/database');

const MIGRATIONS_DIR = path.join(__dirname, '../../db/migrations');

function listarMigracoes() {
    return fs.readdirSync(MIGRATIONS_DIR)
        .filter((arquivo) => /^\d{3}_.+\.sql$/.test(arquivo))
        .sort((a, b) => a.localeCompare(b));
}

async function executarMigracoes() {
    const client = await pool.connect();
    let lockAdquirido = false;

    try {
        // duas instâncias subindo juntas não aplicam a mesma migração
        await client.query('SELECT pg_advisory_lock(728342, 1)');
        lockAdquirido = true;

        await client.query(`
            CREATE TABLE IF NOT EXISTS schema_migrations (
                filename   TEXT PRIMARY KEY,
                applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        `);

        for (const filename of listarMigracoes()) {
            const { rowCount } = await client.query(
                'SELECT 1 FROM schema_migrations WHERE filename = $1',
                [filename]
            );
            if (rowCount > 0) continue;

            const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, filename), 'utf8');
            await client.query('BEGIN');
            try {
                await client.query(sql);
                await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [filename]);
                await client.query('COMMIT');
                console.log(`[migrations] aplicada ${filename}`);
            } catch (erro) {
                await client.query('ROLLBACK');
                throw new Error(`Falha ao aplicar ${filename}: ${erro.message}`, { cause: erro });
            }
        }

        console.log('[migrations] banco atualizado.');
    } finally {
        if (lockAdquirido) {
            try {
                await client.query('SELECT pg_advisory_unlock(728342, 1)');
            } catch (erro) {
                console.error('[migrations] não foi possível liberar o lock:', erro.message);
            }
        }
        client.release();
    }
}

if (require.main === module) {
    executarMigracoes()
        .catch((erro) => {
            console.error('[migrations] erro:', erro.message);
            process.exitCode = 1;
        })
        .finally(() => pool.end());
}

module.exports = { executarMigracoes };
