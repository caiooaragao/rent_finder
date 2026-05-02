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

- **Motor**: PostgreSQL (recomendado **Supabase** em produção).
- **ORM**: Drizzle — esquema em `rent_finder_front/lib/db/schema.ts`.
- **Migrações SQL**: cópias/alinhamento em `rent_finder_front/supabase/migrations/` e fluxos no scraper (`rent_finder_scraper/migrations/`).
- **Conexão**: `DATABASE_URL`; o cliente é criado **lazy** (`getDb()` / `getSql()` em `lib/db/drizzle.ts`) para permitir `next build` sem credenciais no ambiente de CI e para reutilizar conexão em ambientes serverless.

Relações principais (conceito): `anuncios` ligados a `bairros`, `cidades`, `estados` quando os IDs estão preenchidos; joins à esquerda quando faltam FKs.

---

## Pacote `rent_finder_scraper`

| Script | Descrição |
|--------|-----------|
| `npm run migrate` | Executa migrações (`runMigrations.mjs`). |
| `npm run scrape` | Pipeline completo de scrape (`run-scrape-all.mjs`). |
| `npm run scrape:single` | Scrape focado (`scrape-olx-titles.mjs`), com mais memória heap se necessário. |
| `npm run sync` | Sincroniza JSON gerado para Postgres (`syncJsonToDb.mjs`). |

Variáveis sensíveis e caminhos devem estar documentados nos próprios scripts ou num `.env` local no scraper — não commitar segredos.

---

## Variáveis de ambiente

### Front (`rent_finder_front`)

| Variável | Obrigatória | Descrição |
|----------|-------------|-----------|
| `DATABASE_URL` | **Sim** em runtime (produção/preview) | URI PostgreSQL (Supabase: porta sessão `5432` ou pooler `6543`; usar `prepare: false` no cliente, já configurado no código). |

Copiar `rent_finder_front/.env.example` para `.env.local` e preencher.

### Scraper

Conforme os scripts (`loadEnv.mjs`, etc.): tipicamente URL da base e credenciais — ver ficheiros no pacote.

---

## Desenvolvimento local

### Pré-requisitos

- **Node.js** ≥ 20.9 (ver `engines` em `rent_finder_front/package.json`).
- **npm** (ou equivalente) para instalar dependências.

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

### Build local

```bash
npm run build
```

Exige normalmente `DATABASE_URL` disponível quando rotas dinâmicas ou ferramentas avaliam código que importa `getListings`; em CI, configurar o segredo ou usar build com env injetado.

### Vercel (recomendado para o Next.js)

1. Importar o repositório e definir **Root Directory** = `rent_finder_front` se o deploy partir da raiz do monorepo.
2. Adicionar **`DATABASE_URL`** em *Environment Variables* (Production e Preview).
3. Opcional: `vercel.json` no front já sugere framework Next.js e região `gru1` (ajustável).

Autenticação CLI: `npx vercel login` antes de `npx vercel` / `npx vercel --prod`.

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
