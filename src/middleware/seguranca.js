// Cabeçalhos de segurança e saneamento do corpo das requisições.

// Scripts, estilos, imagens e formulários só da própria aplicação; as páginas
// não usam <script> nem style="" em linha.
const CSP = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' data:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
].join('; ');

function cabecalhosSeguranca({ https = false } = {}) {
    return (req, res, next) => {
        res.setHeader('Content-Security-Policy', CSP);
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('X-Frame-Options', 'DENY');
        res.setHeader('Referrer-Policy', 'same-origin');
        res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
        if (https) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
        next();
    };
}

// Os formulários só enviam textos. Um corpo forjado com campo repetido ou
// aninhado (nome[]=a, nome[x]=b) chegaria como lista ou objeto e derrubaria a
// rota com erro 500; aqui cada campo volta a ser um texto simples.
function normalizarCorpo(req, res, next) {
    const corpo = req.body;
    if (!corpo || typeof corpo !== 'object' || Array.isArray(corpo)) {
        req.body = {};
        return next();
    }
    for (const [campo, valor] of Object.entries(corpo)) {
        if (typeof valor === 'string') continue;
        if (Array.isArray(valor)) {
            const textos = valor.filter((item) => typeof item === 'string');
            if (textos.length) corpo[campo] = textos[textos.length - 1];
            else delete corpo[campo];
        } else {
            delete corpo[campo];
        }
    }
    next();
}

module.exports = { cabecalhosSeguranca, normalizarCorpo, CSP };
