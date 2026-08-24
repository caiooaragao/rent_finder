# Rent Finder (HomeSpread)

Aplicação para explorar anúncios de imóveis (fonte OLX) num **mapa interativo**, com **busca por texto**, **filtro por faixa de preço** e **escopo geográfico** (tudo, bairro ou cidade). O monorepo reúne o **front-end Next.js**, **scripts de scraping/sync** e migrações SQL para **PostgreSQL** (ex.: Supabase).

---

## Índice

1. [Visão geral](#visão-geral)
2. [Arquitetura do repositório](#arquitetura-do-repositório)
3. [Stack técnico](#stack-técnico)
4. [Funcionalidades — `rent_finder_front`](#funcionalidades--rent_finder_front)
5. [Base de dados](#base-de-dados)
6. [Pacote `rent_finder_scraper`](#pacote-rent_finder_scraper)
7. [Variáveis de ambiente](#variáveis-de-ambiente)
8. [Desenvolvimento local](#desenvolvimento-local)
9. [Build e deploy](#build-e-deploy)
10. [Serviços externos e limites](#serviços-externos-e-limites)
11. [Estrutura de pastas (front)](#estrutura-de-pastas-front)

---

## Visão geral

| Camada | Função |
|--------|--------|
| **Web** | Interface React/Next: sidebar com busca e filtros, mapa Leaflet com clusters (Supercluster), destaque de bairro/cidade selecionados. |
| **Dados** | Anúncios normalizados em Postgres (bairro, cidade, estado, preço, coordenadas ou endereço para geocodificação aproximada). |
| **Scraper** | Scripts Node para extrair dados OLX, gerar JSON e sincronizar com a base (fora do fluxo HTTP do Next em produção). |

O nome comercial exibido na UI é **HomeSpread**; o repositório mantém o identificador técnico **rent_finder**.

---

## Arquitetura do repositório

```
rent_finder/
├── rent_finder_front/     # App Next.js (App Router) — produto principal
├── rent_finder_scraper/   # Migrações + scraping OLX + sync JSON → Postgres
├── package.json           # Scripts de conveniência na raiz (--prefix)
└── README.md              # Esta documentação
```

- **Uma única árvore Git** — não há submódulos; o front e o scraper versionam-se no mesmo repositório.
- Na raiz, `npm run dev` / `npm run build` delegam para `rent_finder_front`; `npm run scrape` e `npm run db:migrate` delegam para `rent_finder_scraper`.

---

## Stack técnico

### Front-end (`rent_finder_front`)

| Tecnologia | Uso |
|------------|-----|
| **Next.js** (App Router) | Rotas, RSC na home, API Route `/api/listings`. |
| **React** | Componentes cliente (`"use client"`) para mapa e UI interativa. |
| **MUI (Material UI)** | Sidebar, filtros, tema claro/escuro (`next-themes`). |
| **Tailwind CSS** | Utilitários onde faz sentido (layout do mapa, SearchBar). |
| **Leaflet + react-leaflet** | Mapa, tiles (CARTO + satélite Esri), camadas GeoJSON. |
| **supercluster** | Agregação de pins por zoom. |
| **Drizzle ORM** | Queries tipadas para Postgres. |
| **postgres.js** | Cliente SQL com `prepare: false` (compatível com pooler Supabase). |

### Scraper (`rent_finder_scraper`)

| Tecnologia | Uso |
|------------|-----|
| **Node.js** (ESM) | Scripts `.mjs`. |
| **postgres** | Execução de migrações e sync. |
| **mongodb** | Dependência quando scripts interagem com fluxos legados/auxiliares (conforme scripts presentes). |

---

## Funcionalidades — `rent_finder_front`

### Mapa

- Pins dos anúncios com **tooltip de preço**; clusters ao afastar o zoom.
- **Marcadores especiais** quando várias unidades partilham a mesma coordenada (popup agrupado).
- **Camada base**: mapa de ruas (CARTO claro/escuro conforme tema) ou **satélite** (Esri World Imagery), escolha na sidebar.
- Ao selecionar **bairro** ou **cidade** na busca, o mapa tenta mostrar o **polígono** (OpenStreetMap via **Nominatim**) e ajustar o zoom; se não houver polígono, faz **fitBounds** nos pins dos anúncios dessa área.

### Busca e filtros

- **Escopo**: *Tudo* (listings que casam com o texto em vários campos), *Bairro* ou *Cidade* (autocomplete construído a partir dos dados carregados; correspondência com normalização de acentos/abreviações onde aplicável).
- **Faixa de preço**: slider + inputs; afeta sugestões de lugar e pins no mapa conforme implementação atual.
- **Limpar filtros**: repõe estado da UI e intervalo de preço.

### Dados na página inicial

- A rota `/` é **`dynamic = force-dynamic`**: em cada pedido lê os anúncios via `getListings()` (Drizzle).
- Existe também **`GET /api/listings`** que devolve JSON com a mesma lista (útil para integrações ou debug).

### Temas

- CSS variables em `theme/colors.css` + tema MUI em `theme/muiTheme.ts`; modo claro/escuro persistido com `next-themes`.

---

## Base de dados

- **Motor**: PostgreSQL via **Supabase self-hosted em Docker** no servidor de deploy (recomendado) ou Supabase Cloud.
- **ORM**: Drizzle — esquema em `rent_finder_front/lib/db/schema.ts`.
- **Migrações SQL**: cópias/alinhamento em `rent_finder_front/supabase/migrations/` e fluxos no scraper (`rent_finder_scraper/migrations/`).
- **Conexão**: `DATABASE_URL`; o cliente é criado **lazy** (`getDb()` / `getSql()` em `lib/db/drizzle.ts`) para permitir `next build` sem credenciais no ambiente de CI e para reutilizar conexão em ambientes serverless.

Relações principais (conceito): `anuncios` ligados a `bairros`, `cidades`, `estados` quando os IDs estão preenchidos; joins à esquerda quando faltam FKs.

### Supabase self-hosted (Docker)

O banco corre no **mesmo servidor** que a aplicação, com dados persistentes em disco (`docker/supabase/project/volumes/db/data`). Sobrevive a reinícios do Docker e do SO.

```bash
# No servidor (Linux + Docker)
cd docker/supabase && chmod +x *.sh && ./setup.sh

# Na raiz do monorepo
cp docker/supabase/.env.generated rent_finder_front/.env.local
npm run db:migrate
```

Documentação completa: [`docker/supabase/README.md`](docker/supabase/README.md).

Scripts na raiz: `npm run db:setup`, `db:up`, `db:down`, `db:status`, `db:backup`.

---

## Pacote `rent_finder_scraper`

| Script | Descrição |
|--------|-----------|
| `npm run migrate` | Executa migrações (`runMigrations.mjs`). |
| `npm run scrape` | Pipeline completo de scrape (`run-scrape-all.mjs`). |
| `npm run scrape:single` | Scrape focado (`scrape-olx-titles.mjs`), com mais memória heap se necessário. |
| `npm run sync` | Sincroniza JSON gerado para Postgres (`syncJsonToDb.mjs`). |

### Como passar argumentos

Os scripts são chamados por `npm` na raiz. Para repassar flags ao script Node, use:

```bash
npm run <script> -- <flags>
```

Exemplo:

```bash
npm run scrape -- --pages 2 --no-db
```

### Pré-requisitos do scraper

- Instalar dependências em `rent_finder_scraper`: `npm install`.
- Para escrita em banco: definir `DATABASE_URL` (carregado de `rent_finder_scraper/.env` e/ou `rent_finder_front/.env.local`).
- Ferramenta `curl` disponível no sistema (usada para páginas OLX e geocode ArcGIS).

### Comando `npm run scrape` (pipeline completo)

Executa `run-scrape-all.mjs`:

1. (Se DB ativo) aplica migrations uma vez.
2. (Se DB ativo e sem `--no-truncate`) limpa `anuncios` uma vez.
3. Roda o scraper em processo separado para cada URL de pesquisa OLX predefinida.
4. Gera JSON por execução e faz upsert no banco por link.

Uso base:

```bash
npm run scrape
```

Flags aceitas:

- `--pages <n>` ou `-n <n>`: limita páginas por URL de pesquisa (bom para testes rápidos).
- `--concurrency <n>` ou `-c <n>`: concorrência da fase de detalhes por lote.
- `--geocode-concurrency <n>`: concorrência da fase de geocode por lote.
- `--batch-size <n>`: tamanho de lote para processamento.
- `--detail-max <n>`: busca detalhes apenas para os primeiros `n` anúncios.
- `--skip-geocode`: não chama ArcGIS; campos de localização ficam `null`.
- `--skip-details`: pula coleta de detalhes de anúncio (descrição/endereço).
- `--stdout`: imprime o JSON final também no stdout.
- `--no-db`: não grava no banco, só gera JSON.
- `--no-truncate`: não limpa dados antigos antes de inserir/atualizar.
- `--heap <mb>`: heap em MB para cada processo filho (default `4096`).

Exemplos:

```bash
npm run scrape -- --pages 2 --no-db
npm run scrape -- --concurrency 5 --geocode-concurrency 10
npm run scrape -- --skip-geocode --batch-size 300
npm run scrape -- --heap 6144
```

Saídas esperadas:

- Arquivos JSON no diretório `rent_finder_scraper` (ex.: `olx-scrape-0.json`, `olx-scrape-1.json`).
- Logs por fase: listagem, detalhes, geocode, regras de negócio e sync DB.
- Se DB ativo: registros inseridos/atualizados na tabela `anuncios`.

### Comando `npm run scrape:single` (scraper direto/focado)

Executa `scrape-olx-titles.mjs` com heap maior:

```bash
npm run scrape:single
```

Pode receber URL posicional para substituir o array interno de pesquisas:

```bash
npm run scrape:single -- "https://www.olx.com.br/imoveis/aluguel/estado-pe?q=kitnet"
```

Flags aceitas:

- `--pages <n>` ou `-n <n>`: limite de páginas por pesquisa.
- `--detail-max <n>`: limita quantos anúncios terão página de detalhe processada.
- `--batch-size <n>`: anúncios por lote (default `1000`).
- `--concurrency <n>` ou `-c <n>`: concorrência de detalhes (default `5`).
- `--geocode-concurrency <n>`: concorrência de geocode (default = `--concurrency`).
- `--out <arquivo>` ou `-o <arquivo>`: caminho do JSON de saída (default `olx-scrape.json`).
- `--stdout`: imprime JSON também no terminal.
- `--skip-geocode`: não geocodifica endereços.
- `--no-db`: não toca no banco.
- `--skip-migrate`: não aplica migrations antes de gravar.
- `--no-truncate`: mantém dados já existentes no banco.

Dados por anúncio no JSON (quando disponíveis):

- `titulo`, `preco`, `link`
- `descricao`, `endereco`
- `latitude`, `longitude`
- `bairro`, `cidade`, `estado`
- Campos adicionais do pipeline de regras de negócio (normalização/dedupe), se aplicável.

### Comando `npm run sync` (JSON -> banco, sem novo scrape)

Executa `syncJsonToDb.mjs`, lendo um JSON existente e fazendo upsert em lotes:

```bash
npm run sync
```

Flags úteis:

- `--input <arquivo>` ou `-i <arquivo>`: JSON de entrada (default `olx-scrape.json`).
- `--skip-migrate`: pula aplicação de migrations.
- `--batch-size <n>`: tamanho dos lotes de sync (default `500`).

Exemplo:

```bash
npm run sync -- --input rent_finder_scraper/olx-scrape-0.json --batch-size 200
```

### Comando `npm run migrate`

Executa apenas as migrações SQL:

```bash
npm run migrate
```

Use este comando quando quiser preparar o esquema do banco antes de rodar scrape/sync.

### Presets de execução (copiar e colar)

| Perfil | Objetivo | Comando |
|--------|----------|---------|
| **Rápido (teste)** | Validar pipeline ponta a ponta com baixo volume, mantendo detalhes + geocode. | `npm run scrape -- --pages 1 --detail-max 20 --batch-size 50 --concurrency 3 --geocode-concurrency 3` |
| **Médio (homologação)** | Coletar mais dados com tempo controlado e boa cobertura. | `npm run scrape -- --pages 3 --batch-size 300 --concurrency 5 --geocode-concurrency 5` |
| **Full (produção, mais rápido possível)** | Popular o banco com o máximo de dados, sem limitar páginas/detalhes, com maior paralelismo seguro. | `npm run scrape -- --batch-size 600 --concurrency 10 --geocode-concurrency 10 --heap 6144` |

### Preset full para popular o banco rápido

Use este comando para preencher o banco com todos os dados possíveis no menor tempo prático:

```bash
npm run scrape -- --batch-size 600 --concurrency 10 --geocode-concurrency 10 --heap 6144
```

Por que esse preset é o mais rápido para full scrape:

- não usa `--pages` nem `--detail-max`, então percorre todo o volume disponível;
- mantém gravação em DB ativa (sem `--no-db`);
- aumenta paralelismo de detalhes e geocode para reduzir tempo total;
- aumenta heap por processo para reduzir risco de gargalo/morte por memória.

Notas operacionais para velocidade máxima:

- se o host tiver poucos recursos, comece em `--concurrency 8 --geocode-concurrency 8`;
- se notar estabilidade e folga de CPU/RAM/rede, teste `12/12`;
- não use `--skip-geocode` se você precisa de bairro/cidade/estado completos no banco;
- mantenha sem `--no-truncate` para substituir dados antigos por um snapshot novo completo.

Variáveis sensíveis e caminhos devem estar documentados nos próprios scripts ou num `.env` local no scraper — não commitar segredos.

---

## Variáveis de ambiente

### Front (`rent_finder_front`)

| Variável | Obrigatória | Descrição |
|----------|-------------|-----------|
| `DATABASE_URL` | **Sim** em runtime | URI PostgreSQL. Self-hosted: `postgresql://postgres.rentfinder:[PASSWORD]@127.0.0.1:6543/postgres` (pooler transaction). Cloud: pooler `6543` ou direto `5432`. O cliente usa `prepare: false` (já configurado). |

Copiar `rent_finder_front/.env.example` para `.env.local`. Após `npm run db:setup`, use `docker/supabase/.env.generated`.

### Scraper

Conforme os scripts (`loadEnv.mjs`, etc.): tipicamente URL da base e credenciais — ver ficheiros no pacote.

---

## Desenvolvimento local

### Pré-requisitos

- **Node.js** ≥ 20.9 (ver `engines` em `rent_finder_front/package.json`).
- **npm** (ou equivalente) para instalar dependências.
- **Docker** (opcional, para Supabase local): ver [`docker/supabase/README.md`](docker/supabase/README.md).

### Base de dados local (Supabase Docker)

```bash
npm run db:setup          # primeira vez — instala e inicia Supabase
cp docker/supabase/.env.generated rent_finder_front/.env.local
npm run db:migrate
```

### Instalar dependências

```bash
cd rent_finder_front && npm install
cd ../rent_finder_scraper && npm install
```

### Arrancar o front

Na raiz do monorepo:

```bash
npm run dev
```

Equivale a `npm run dev` dentro de `rent_finder_front`. O servidor de desenvolvimento usa a porta **5000** (definida no `package.json` do front): abrir **http://localhost:5000**.

### Lint / build

```bash
npm run lint    # na raiz → ESLint no front
npm run build   # build de produção Next.js
```

---

## Build e deploy

### Deploy no servidor (recomendado com Supabase Docker)

1. No servidor Linux, instale Docker e execute `docker/supabase/setup.sh` (ou `npm run db:setup`).
2. Configure `DATABASE_URL` no ambiente da app (`.env.local` ou variáveis do process manager).
3. `npm run db:migrate` e `npm run build` / `npm run dev` (ou PM2/systemd para produção).
4. Agende `npm run db:backup` via cron para cópias de segurança extra.

Os dados persistem em `docker/supabase/project/volumes/db/data` (ou `/opt/rent-finder/supabase/volumes/` se instalou nesse caminho).

### Deploy completo (um comando)

```bash
chmod +x build.sh
./build.sh --start          # deps + Supabase + migrate + build + next start
./build.sh --dev              # idem, mas em modo desenvolvimento (porta 5000)
./build.sh --scrape           # inclui scrape OLX após migrate
./build.sh --skip-db          # se o banco já estiver a correr
```

Equivalente via npm: `npm run deploy` (produção) ou `npm run deploy:dev`.

### Build local

```bash
npm run build
```

Exige normalmente `DATABASE_URL` disponível quando rotas dinâmicas ou ferramentas avaliam código que importa `getListings`; em CI, configurar o segredo ou usar build com env injetado.

### Vercel (alternativa — requer Supabase Cloud ou Postgres acessível na rede)

1. Importar o repositório e definir **Root Directory** = `rent_finder_front` se o deploy partir da raiz do monorepo.
2. Adicionar **`DATABASE_URL`** em *Environment Variables* (Production e Preview).
3. Opcional: `vercel.json` no front já sugere framework Next.js e região `gru1` (ajustável).

Autenticação CLI: `npx vercel login` antes de `npx vercel` / `npx vercel --prod`.

> Para self-hosted, o deploy na Vercel só funciona se o Postgres no seu servidor estiver exposto na internet (não recomendado). Prefira correr a app no mesmo servidor que o Docker.

---

## Serviços externos e limites

| Serviço | Uso |
|---------|-----|
| **Nominatim (OpenStreetMap)** | Polígonos e bounding boxes para bairros/cidades. Uso público: ~**1 pedido por segundo**; o código espaça tentativas e usa cache em memória quando aplicável. |
| **Tiles de mapa** | CARTO (ruas) e Esri (satélite) — respeitar termos e atribuições exibidas no mapa. |

---

## Estrutura de pastas (front)

| Caminho | Conteúdo |
|---------|----------|
| `app/` | Rotas App Router, `globals.css`, layout. |
| `Components/` | UI reutilizável: `Map/` (Leaflet, clusters, popups), `SearchBar/`, `Sidebar/`, `PriceRangeFilter/`, etc. |
| `Screens/` / `Views/` | Composição de ecrãs (ex.: `HomeScreen`). |
| `lib/` | Lógica: BD (`db/`), matching de busca, polígonos Nominatim, helpers de mapa. |
| `theme/` | Tokens e tema MUI. |
| `supabase/migrations/` | Migrações SQL versionadas. |
| `types/` | Tipos partilhados (ex.: `OlxListing`). |

---

## Licença

Conforme indicado nos subpacotes ou ficheiros `LICENSE` presentes no repositório.

---

## Histórico de documentação

Este README substitui o texto reduzido anterior e descreve o estado atual do software no monorepo **rent_finder**.
