# Rent Finder

Monorepo único: interface web (Next.js), scraper e dados relacionados.

## Estrutura

| Pasta | Descrição |
|--------|------------|
| `rent_finder_front/` | App Next.js — mapa, busca, Drizzle/Supabase |
| `rent_finder_scraper/` | Scripts Node para migrações e scraping OLX → Postgres |

Instala dependências em cada pasta antes do primeiro uso:

```bash
cd rent_finder_front && npm install
cd ../rent_finder_scraper && npm install
```

Na raiz, `npm run dev` / `npm run scrape` delegam para essas pastas (`--prefix`).

## Variáveis de ambiente

Crie `.env` ou `.env.local` onde cada projeto indicar (ver `rent_finder_front/.env.example` e o scraper).

## Licença

Conforme cada subpacote.
