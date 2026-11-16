// Só contas deste domínio podem ser autorizadas a administrar o hub.
const DOMINIO_INSTITUCIONAL = '@ifc.edu.br';

// Primeira conta com acesso: entra sem precisar ser cadastrada e não pode ser
// desativada nem removida pela tela de usuários.
const ADMIN_PRINCIPAL_EMAIL = (process.env.ADMIN_PRINCIPAL_EMAIL || 'fabricadesoftware.videira@ifc.edu.br')
    .trim()
    .toLowerCase();

module.exports = { DOMINIO_INSTITUCIONAL, ADMIN_PRINCIPAL_EMAIL };
