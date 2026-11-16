const express = require('express');
const path = require('path');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const { pool } = require('./config/database');
const { attachUser, requireAuth, salvarSessaoAoRedirecionar } = require('./middleware/auth');
const { verificarOrigem } = require('./middleware/origem');
const { cabecalhosSeguranca, normalizarCorpo } = require('./middleware/seguranca');
const { icone } = require('./utils/icones');
const apresentacao = require('./utils/apresentacao');

const app = express();

const isProd = process.env.APP_ENV === 'production';

// Fora de desenvolvimento o segredo da sessão é obrigatório: subir com o
// valor de exemplo do repositório deixaria os cookies assinados com um
// segredo público.
const SEGREDO_DEV = 'dev-secret-troque-em-producao';
if (process.env.APP_ENV !== 'development'
    && (!process.env.SESSION_SECRET || process.env.SESSION_SECRET === SEGREDO_DEV)) {
    throw new Error('Defina SESSION_SECRET com um valor próprio (ou APP_ENV=development para rodar localmente).');
}

// necessário pra cookie "secure" funcionar atrás do proxy (Traefik do Dokploy),
// que termina o TLS em produção
if (isProd) {
    app.set('trust proxy', 1);
}

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.locals.icone = icone;
Object.assign(app.locals, apresentacao);

app.disable('x-powered-by');
app.use(cabecalhosSeguranca({ https: isProd }));

app.use(express.urlencoded({ extended: true }));
// cada campo de formulário volta a ser texto simples
app.use(normalizarCorpo);

// Arquivos estáticos
app.use(express.static(path.join(__dirname, 'public')));

// Health check: o app e a conexão com o banco (sem versão nem ambiente: é público).
// Fica antes da sessão para não gravar nada a cada verificação do Docker.
app.get('/health', async (req, res) => {
    try {
        await pool.query('SELECT 1');
        res.json({ status: 'ok', db: 'connected' });
    } catch {
        res.status(503).json({ status: 'error', db: 'disconnected' });
    }
});

// Sessão persistida no Postgres em vez do MemoryStore: o login com Google
// depende de a sessão sobreviver entre "/auth/google" (onde o "state" é salvo)
// e "/auth/google/callback" (onde ele é conferido), mesmo com um deploy no meio.
app.use(session({
    store: new pgSession({ pool, tableName: 'session', createTableIfMissing: true }),
    secret: process.env.SESSION_SECRET || SEGREDO_DEV,
    resave: false,
    saveUninitialized: false,
    cookie: {
        maxAge: 1000 * 60 * 60 * 8, // 8h
        sameSite: 'lax',
        secure: isProd,
    },
}));

// a sessão é gravada antes de qualquer redirecionamento
app.use(salvarSessaoAoRedirecionar);

// toda requisição que altera estado precisa partir da própria aplicação
app.use(verificarOrigem);

app.use(attachUser);

// Rotas
app.use('/', require('./routes/index'));
app.use('/', require('./routes/auth'));
app.use('/auth/dev', require('./routes/dev-login'));
app.use('/admin', requireAuth, require('./routes/admin'));

// 404 - sempre por último
app.use((req, res) => {
    res.status(404).render('404');
});

// Evita que o processo caia e registra o problema no log
app.use((err, req, res, next) => {
    console.error('[app] erro não tratado:', err);
    res.status(500).send('Ocorreu um erro inesperado. Tente novamente.');
});

module.exports = app;
