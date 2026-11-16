// Apoio aos testes: um PostgreSQL em memória (PGlite) no lugar do pool e uma
// aplicação Express com as rotas reais e uma sessão simulada por cabeçalho.
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const { PGlite } = require('@electric-sql/pglite');
const { pool } = require('../src/config/database');

const raiz = path.join(__dirname, '..');

async function criarBanco() {
    const db = new PGlite();
    const pasta = path.join(raiz, 'db/migrations');
    for (const nome of fs.readdirSync(pasta).sort()) {
        await db.exec(fs.readFileSync(path.join(pasta, nome), 'utf8'));
    }
    pool.query = async (sql, params) => {
        const r = await db.query(sql, params);
        return { ...r, rowCount: r.affectedRows ?? r.rows.length };
    };
    return db;
}

// x-test-user: id do usuário logado (sem o cabeçalho, visitante).
function criarApp() {
    const app = express();
    app.set('view engine', 'ejs');
    app.set('views', path.join(raiz, 'src/views'));
    app.locals.icone = require('../src/utils/icones').icone;
    Object.assign(app.locals, require('../src/utils/apresentacao'));
    app.use(express.urlencoded({ extended: true }));
    app.use(require('../src/middleware/seguranca').normalizarCorpo);
    app.use((req, res, next) => {
        const id = Number(req.headers['x-test-user'] || 0);
        req.session = {
            user: id ? { id } : undefined,
            destroy(callback) { delete this.user; callback(); },
            regenerate(callback) { delete this.user; callback(); },
            save(callback) { callback(); },
        };
        next();
    });
    const { attachUser, requireAuth } = require('../src/middleware/auth');
    app.use(attachUser);
    app.use('/', require('../src/routes/index'));
    app.use('/', require('../src/routes/auth'));
    app.use('/auth/dev', require('../src/routes/dev-login'));
    app.use('/admin', requireAuth, require('../src/routes/admin'));
    app.use((req, res) => res.status(404).render('404'));
    return app;
}

async function subir(app) {
    const server = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    return { server, url: `http://127.0.0.1:${server.address().port}` };
}

const fechar = (server) => new Promise((resolve) => server.close(resolve));

module.exports = { criarBanco, criarApp, subir, fechar };
