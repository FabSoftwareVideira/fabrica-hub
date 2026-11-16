const router = require('express').Router();
const aplicacoes = require('../models/aplicacoes');
const { agrupar, resumir } = require('../utils/apresentacao');

// Página única e pública: as aplicações publicadas, por categoria.
router.get('/', async (req, res) => {
    const lista = await aplicacoes.listarPublicadas();
    res.render('inicio', { grupos: agrupar(lista), resumo: resumir(lista) });
});

// Status atuais, para a página inicial se atualizar sem recarregar.
router.get('/api/status', async (req, res) => {
    const lista = await aplicacoes.statusPublicadas();
    const { verificadoEm } = resumir(lista);
    res.set('Cache-Control', 'no-store');
    res.json({
        verificadoEm,
        aplicacoes: lista.map((app) => ({ id: app.id, status: app.status })),
    });
});

module.exports = router;
