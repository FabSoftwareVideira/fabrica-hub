// ─── main.js ──────────────────────────────────────────────────────────────
// Comportamento do front-end: menu, alto contraste, busca e status ao vivo.

document.addEventListener('DOMContentLoaded', () => {
    // ─── Menu (celular) ──────────────────────────────────────────────────────
    const toggle = document.querySelector('.nav-toggle');
    const nav = document.querySelector('.main-nav');

    if (toggle && nav) {
        toggle.addEventListener('click', () => {
            const isOpen = nav.classList.toggle('open');
            toggle.setAttribute('aria-expanded', String(isOpen));
        });

        nav.querySelectorAll('a').forEach((link) => {
            link.addEventListener('click', () => {
                nav.classList.remove('open');
                toggle.setAttribute('aria-expanded', 'false');
            });
        });
    }

    // ─── Dropdown da conta ───────────────────────────────────────────────────
    const menuMobile = window.matchMedia('(max-width: 960px)');

    document.querySelectorAll('[data-user-menu]').forEach((menu) => {
        const botao = menu.querySelector('.nav-user-toggle');
        const dropdown = menu.querySelector('.nav-user-dropdown');
        if (!botao || !dropdown) return;

        // no celular os itens ficam sempre visíveis, como uma lista do menu
        const noMobile = () => menuMobile.matches;

        const fechar = () => {
            dropdown.hidden = true;
            botao.setAttribute('aria-expanded', 'false');
        };

        const ajustarModo = () => {
            if (noMobile()) {
                dropdown.hidden = false;
                botao.setAttribute('aria-expanded', 'true');
            } else {
                fechar();
            }
        };

        botao.addEventListener('click', (evento) => {
            evento.stopPropagation();
            if (noMobile()) return;
            const abrir = dropdown.hidden;
            dropdown.hidden = !abrir;
            botao.setAttribute('aria-expanded', String(abrir));
        });

        document.addEventListener('click', (evento) => {
            if (!noMobile() && !menu.contains(evento.target)) fechar();
        });

        document.addEventListener('keydown', (evento) => {
            if (!noMobile() && evento.key === 'Escape' && !dropdown.hidden) {
                fechar();
                botao.focus();
            }
        });

        menuMobile.addEventListener('change', ajustarModo);
        ajustarModo();
    });

    // ─── Alto contraste (lembra a escolha neste navegador) ───────────────────
    document.querySelectorAll('[data-contraste]').forEach((botao) => {
        const raiz = document.documentElement;
        botao.setAttribute('aria-pressed', String(raiz.classList.contains('alto-contraste')));
        botao.addEventListener('click', () => {
            const ligado = raiz.classList.toggle('alto-contraste');
            botao.setAttribute('aria-pressed', String(ligado));
            try { localStorage.setItem('contraste', ligado ? '1' : '0'); } catch (e) { /* sem armazenamento */ }
        });
    });

    // ─── Tabelas no celular: o título da coluna vai para cada célula ─────────
    document.querySelectorAll('.table-wrap table').forEach((tabela) => {
        const titulos = Array.from(tabela.querySelectorAll('thead th')).map((th) => th.textContent.trim());
        tabela.querySelectorAll('tbody tr').forEach((linha) => {
            Array.from(linha.children).forEach((celula, i) => {
                if (!celula.hasAttribute('data-label') && !celula.hasAttribute('colspan')) {
                    celula.setAttribute('data-label', titulos[i] === 'Ações' ? '' : (titulos[i] || ''));
                }
            });
        });
    });

    // ─── Confirmação antes de ações que não têm volta ────────────────────────
    document.addEventListener('click', (evento) => {
        const alvo = evento.target.closest('[data-confirmar]');
        if (alvo && !window.confirm(alvo.dataset.confirmar)) evento.preventDefault();
    });

    iniciarBusca();
    iniciarStatusAoVivo();
});

// Sem acentos e em minúsculas, para "estagio" encontrar "Estágio".
function normalizar(texto) {
    return String(texto || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

// ─── Busca na página inicial ─────────────────────────────────────────────────
function iniciarBusca() {
    const campo = document.querySelector('[data-busca]');
    if (!campo) return;

    const itens = Array.from(document.querySelectorAll('[data-app]')).map((el) => ({ el, texto: normalizar(el.dataset.texto) }));
    const grupos = Array.from(document.querySelectorAll('[data-grupo]'));
    const vazio = document.querySelector('[data-busca-vazio]');

    const filtrar = () => {
        const termos = normalizar(campo.value).split(/\s+/).filter(Boolean);
        let visiveis = 0;
        itens.forEach(({ el, texto }) => {
            const mostra = termos.every((termo) => texto.includes(termo));
            el.hidden = !mostra;
            if (mostra) visiveis += 1;
        });
        grupos.forEach((grupo) => {
            grupo.hidden = !grupo.querySelector('[data-app]:not([hidden])');
        });
        if (vazio) vazio.hidden = visiveis > 0;
    };

    campo.addEventListener('input', filtrar);
    // o navegador pode devolver o texto digitado ao voltar para a página
    if (campo.value) filtrar();
}

// ─── Status ao vivo: a página se atualiza sem recarregar ─────────────────────
function iniciarStatusAoVivo() {
    const chips = Array.from(document.querySelectorAll('[data-status-id]'));
    if (!chips.length) return;

    const APARENCIA = {
        online: { rotulo: 'No ar', classe: 'status-completed' },
        offline: { rotulo: 'Fora do ar', classe: 'status-invalidated' },
        desconhecido: { rotulo: 'Verificando', classe: 'status-waiting' },
    };
    const CLASSES = Object.values(APARENCIA).map((a) => a.classe);
    const porId = new Map(chips.map((chip) => [chip.dataset.statusId, chip]));
    const numero = (nome) => document.querySelector(`[data-resumo="${nome}"]`);
    const hora = document.querySelector('[data-resumo-hora]');
    const fora = document.querySelector('[data-resumo-fora]');

    const aplicar = (dados) => {
        let online = 0;
        let offline = 0;
        dados.aplicacoes.forEach(({ id, status }) => {
            const chip = porId.get(String(id));
            const aparencia = APARENCIA[status] || APARENCIA.desconhecido;
            if (status === 'online') online += 1;
            if (status === 'offline') offline += 1;
            if (!chip || chip.dataset.status === status) return;
            chip.classList.remove(...CLASSES);
            chip.classList.add(aparencia.classe);
            chip.dataset.status = status;
            chip.textContent = aparencia.rotulo;
        });
        if (numero('online')) numero('online').textContent = online;
        if (numero('offline')) numero('offline').textContent = offline;
        if (fora) fora.classList.toggle('tem-fora', offline > 0);
        if (hora && dados.verificadoEm) {
            hora.parentElement.hidden = false;
            hora.textContent = ` às ${new Date(dados.verificadoEm).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' })}`;
        }
    };

    const atualizar = async () => {
        if (document.hidden) return;
        try {
            const resposta = await fetch('/api/status', { headers: { accept: 'application/json' } });
            if (resposta.ok) aplicar(await resposta.json());
        } catch (e) { /* sem rede: mantém o que está na tela */ }
    };

    // logo ao abrir (um cadastro novo pode ainda estar "Verificando") e depois a cada minuto
    setTimeout(atualizar, 8000);
    setInterval(atualizar, 60000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) atualizar(); });
}
