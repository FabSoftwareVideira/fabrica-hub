function acessoDesenvolvimentoAtivo() {
    return process.env.APP_ENV === 'development' && process.env.NODE_ENV !== 'production';
}

module.exports = { acessoDesenvolvimentoAtivo };
