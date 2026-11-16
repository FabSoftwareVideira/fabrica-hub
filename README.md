# Hub de Aplicações · Fábrica de Software do IFC Campus Videira

Página única que reúne as aplicações publicadas na VPS da Fábrica de Software: um cartão por aplicação, agrupados por categoria, com o status (no ar / fora do ar) e o link que abre em nova aba. Feita para os professores do IFC encontrarem tudo em um só lugar.

Mesma base da aplicação [fabrica-estagiarios](https://github.com/FabSoftwareVideira/fabrica-estagiarios): Node.js + Express + EJS + PostgreSQL, visual no padrão do Design System gov.br com a identidade do campus, deploy na VPS com Dokploy e CI/CD pelo GitHub Actions.

## Como funciona

- **Página inicial (`/`), pública.** Lista as aplicações publicadas por categoria, com busca, resumo de quantas estão no ar e status que se atualiza sozinho a cada minuto. Não pede login: cada aplicação continua com o próprio controle de acesso.
- **Área administrativa (`/admin`), restrita.** Cadastro de aplicações, categorias e usuários autorizados. Entra-se com Google, só com conta `@ifc.edu.br` que esteja na lista de usuários.
- **Status.** A cada minuto o hub faz uma requisição ao endereço de cada aplicação. "No ar" é ela responder (2xx, redirecionamento ou 401/403, que é quem pede login). Sem resposta, 404 (o que o Traefik devolve com o container parado) e 5xx contam como fora do ar. Uma falha isolada é tentada de novo antes de mudar o status.
- **Listagem automática pelo Dokploy (opcional).** Com `DOKPLOY_URL` e `DOKPLOY_API_KEY`, o hub lê os projetos e domínios do Dokploy. Cada domínio novo entra em **Encontradas no Dokploy**, na área administrativa, e só aparece na página inicial depois que alguém escolhe a categoria e publica (nem tudo que está na VPS é para os professores). Sem essas variáveis, o cadastro é manual.

### Usuários

`fabricadesoftware.videira@ifc.edu.br` é a conta principal (`ADMIN_PRINCIPAL_EMAIL`): entra sem cadastro prévio e não pode ser desativada nem removida. Em **Usuários**, quem tem acesso autoriza outras contas `@ifc.edu.br` pelo e-mail; a pessoa entra depois com o Google usando esse e-mail (não há senha no hub). Todo usuário autorizado administra aplicações, categorias e usuários. Desativar ou remover alguém derruba a sessão aberta na requisição seguinte.

### Aplicações e categorias

Cada aplicação tem nome, endereço, descrição, categoria, ícone (um emoji, opcional), ordem e a situação: **publicada** (aparece na página inicial) ou **oculta**. A instalação já traz as categorias *Aplicações internas do IFC*, *Projetos* e *Diversas*; elas podem ser renomeadas, reordenadas ou excluídas (as aplicações de uma categoria excluída ficam em "Outras aplicações").

O que veio do Dokploy e ainda existe lá não pode ser excluído, só ocultado (voltaria na sincronização seguinte). Nome, descrição, categoria e endereço ajustados aqui são preservados; o endereço só é trocado quando o domínio muda no Dokploy.

## Stack

- **Runtime**: Node.js 25
- **Framework**: Express 5 + EJS
- **Banco**: PostgreSQL 16
- **Container**: Docker (multi-stage: dev + prod)
- **CI/CD**: GitHub Actions → Dokploy

## Início rápido

```bash
cp .env.sample .env
```

```bash
docker compose up -d --build
```

Abra [http://localhost:3010](http://localhost:3010) (a porta 3000 fica livre para os outros projetos da Fábrica). As migrações rodam sozinhas ao subir.

Em desenvolvimento (`APP_ENV=development` e `NODE_ENV` diferente de `production`), a tela **Área administrativa** tem um **Acesso de desenvolvimento** que entra como administrador de teste sem passar pelo Google. Em produção, esse acesso fica desativado mesmo se `APP_ENV` estiver configurado incorretamente como `development`; a rota responde 404.

## Login com Google

1. No [Google Cloud Console](https://console.cloud.google.com/), crie um cliente OAuth do tipo **Aplicativo da Web** (pode ser no mesmo projeto usado pelo fabrica-estagiarios).
2. Em **URIs de redirecionamento autorizados**, adicione `http://localhost:3010/auth/google/callback` e, para produção, `https://SEU-DOMINIO/auth/google/callback`.
3. Preencha no `.env`:

```env
GOOGLE_CLIENT_ID=seu-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=seu-client-secret
GOOGLE_CALLBACK_URL=http://localhost:3010/auth/google/callback
```

Em produção, `GOOGLE_CALLBACK_URL` é a URL HTTPS pública, exatamente como cadastrada no Google.

## Listagem automática pelo Dokploy

```env
DOKPLOY_URL=https://dokploy.exemplo.br
DOKPLOY_API_KEY=token-gerado-no-dokploy
DOKPLOY_SINCRONIZAR_MINUTOS=30
```

- O hub usa só leitura: `project.all`, `domain.byApplicationId` e `domain.byComposeId`. Entram os domínios de recursos **Application** e **Docker Compose**; domínios de preview e o do próprio hub ficam de fora.
- **Use um token com o mínimo de permissão.** O token do Dokploy vale tudo o que o usuário dono dele pode fazer. Em vez do token do administrador, crie no Dokploy um usuário membro só com acesso de leitura aos projetos que devem aparecer e gere o token nele (Settings → Profile → API/CLI).
- A sincronização roda ao subir e a cada `DOKPLOY_SINCRONIZAR_MINUTOS` (0 deixa só o botão **Sincronizar com o Dokploy** da área administrativa).
- Um endereço já cadastrado à mão é reconhecido e passa a ser acompanhado, sem duplicar.

## Variáveis de ambiente

| Variável | Para quê |
| --- | --- |
| `APP_ENV` | `development` ou `production` |
| `SESSION_SECRET` | Segredo dos cookies de sessão. Obrigatório e próprio fora de desenvolvimento |
| `APP_URL` | Endereço público do hub (confere a origem dos formulários atrás do proxy) |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_CALLBACK_URL` | Login com Google |
| `ADMIN_PRINCIPAL_EMAIL` | Conta principal (padrão `fabricadesoftware.videira@ifc.edu.br`) |
| `POSTGRES_*` | Banco de dados |
| `DOKPLOY_URL`, `DOKPLOY_API_KEY`, `DOKPLOY_SINCRONIZAR_MINUTOS` | Listagem automática (opcional) |
| `STATUS_INTERVALO_SEGUNDOS` | Intervalo da verificação de status (padrão 60) |
| `BACKUP_HOST_DIR`, `BACKUP_HORA`, `BACKUP_RETENCAO_DIAS` | Backup diário (opcionais) |

## Estrutura

```
├── db/migrations/              # Migrações SQL, aplicadas em ordem
├── deploy/backup/              # Imagem e scripts do backup diário
├── src/
│   ├── app.js, server.js
│   ├── config/                 # Banco e constantes (domínio, conta principal)
│   ├── middleware/             # Sessão/login, CSRF por origem, cabeçalhos de segurança
│   ├── models/                 # usuarios, categorias, aplicacoes
│   ├── routes/                 # index (página inicial), auth, dev-login, admin
│   ├── services/               # monitor (status), dokploy, acesso (regra do login), agendador
│   ├── views/                  # Telas EJS
│   └── public/                 # CSS (padrão gov.br), JS e imagens
├── tests/                      # node --test, com PostgreSQL em memória (PGlite)
├── docker-compose.yml          # Desenvolvimento
├── docker-compose.dokploy.yml  # Produção
└── .github/workflows/          # testes.yml e deploy-dokploy.yml
```

## Endpoints

| Método | Rota | Descrição |
| --- | --- | --- |
| GET | `/` | Página inicial com as aplicações publicadas |
| GET | `/api/status` | Status atual das aplicações publicadas (JSON) |
| GET | `/health` | Health check com o estado do banco |
| GET | `/login` | Entrada da área administrativa |
| — | `/admin/...` | Aplicações, categorias e usuários (exige login) |

## Deploy no Dokploy

A produção roda na VPS com [Dokploy](https://dokploy.com), a partir do `docker-compose.dokploy.yml`. O workflow `deploy-dokploy.yml` roda os testes, valida o compose e pede o deploy pela API do Dokploy a cada push na `main` ou tag `v*`.

O compose de produção tem:

- **`fabrica-hub-web`**: a aplicação, sem porta publicada; só ela entra na `dokploy-network`, por onde o Traefik a alcança.
- **`fabrica-hub-db`**: o PostgreSQL, apenas na rede interna do projeto.
- **`migrar`**: aplica as migrações a cada deploy; o web só sobe se terminar sem erro.
- **`backup`** e **`preparar-pasta-backup`**: backup diário do banco numa pasta da VPS.

Configuração (uma vez):

1. No Dokploy, crie um recurso **Docker Compose** apontando para este repositório, com **Compose Path** `./docker-compose.dokploy.yml`. Deixe o *Autodeploy* desligado: quem dispara o deploy é o GitHub Actions.
2. Na aba **Environment**, cole as variáveis do `.env.sample` com os valores de produção: `APP_ENV=production`, um `SESSION_SECRET` próprio (por exemplo, a saída de `openssl rand -hex 32`), `POSTGRES_PASSWORD` forte, `APP_URL` e `GOOGLE_CALLBACK_URL` com o domínio HTTPS, as credenciais do Google e, se for usar, `DOKPLOY_URL` e `DOKPLOY_API_KEY`. `POSTGRES_HOST` pode ficar como está: o compose usa sempre o serviço `fabrica-hub-db`.
3. Na aba **Domains**, adicione o domínio para o serviço `fabrica-hub-web`, porta `3000`, com HTTPS.
4. No Google Cloud, cadastre `https://SEU-DOMINIO/auth/google/callback` como URI de redirecionamento.
5. No GitHub, crie os secrets `DOKPLOY_URL`, `DOKPLOY_API_KEY` (token em Settings → Profile do Dokploy) e `DOKPLOY_COMPOSE_ID` (o id do recurso, na URL dele no painel). Sem eles, o workflow só roda os testes e valida o compose.
6. Faça o primeiro deploy e entre em `https://SEU-DOMINIO/login` com a conta principal para cadastrar as aplicações e autorizar outras pessoas.

O status é conferido de dentro da VPS, pelo endereço público de cada aplicação. Se a VPS não conseguir acessar os próprios domínios, as aplicações aparecerão como fora do ar.

## Backup e restauração

O serviço `backup` faz um `pg_dump` por dia em `/srv/fabrica-hub/backups` (configurável por `BACKUP_HOST_DIR`), a partir de `BACKUP_HORA` (Brasília, padrão `03:00`), e guarda os diários por `BACKUP_RETENCAO_DIAS` dias (padrão 14). Cada arquivo é conferido com `pg_restore --list` e ganha um `.sha256`. O container fica *unhealthy* no Dokploy se o último backup bem-sucedido tiver mais de 26 horas.

Os backups ficam na mesma VPS do banco: protegem contra erro humano, não contra a perda da VPS. Copie a pasta para outro lugar de tempos em tempos.

Descubra o nome do container de backup:

```bash
docker ps --filter "name=backup" --format "{{.Names}}"
```

Backup manual:

```bash
docker exec <container-backup> sh /opt/backup/backup.sh manual
```

Listar os backups:

```bash
docker exec <container-backup> sh /opt/backup/restaurar.sh
```

Restaurar (pede para digitar `RESTAURAR`; antes guarda um backup do estado atual):

```bash
docker exec -it <container-backup> sh /opt/backup/restaurar.sh hub_diario_2026-11-16_030000.dump
```

Depois de restaurar, faça um novo Deploy no Dokploy para o serviço `migrar` atualizar o banco.

## Testes

```bash
npm test
```

Os testes não precisam de banco instalado (usam PostgreSQL em memória, o PGlite) nem de rede. Cobrem a página inicial, o cadastro, as regras de login (`@ifc.edu.br`, lista de autorizados, conta principal), a sincronização com o Dokploy, a verificação de status e as proteções de sessão, CSRF e cabeçalhos. No GitHub Actions, `testes.yml` roda em pull requests e antes de cada deploy.

## Segurança

- Formulários só são aceitos quando partem de uma página do próprio hub (conferência de origem), e o cookie de sessão é `SameSite=Lax`, `HttpOnly` e, em produção, `Secure`.
- Content Security Policy sem script nem estilo em linha; as telas escapam todo texto cadastrado.
- O endereço de uma aplicação precisa ser `http(s)://`, sem usuário e senha embutidos.
- Em produção a aplicação não sobe sem `SESSION_SECRET` próprio, e o container roda sem root e sem capacidades extras.
