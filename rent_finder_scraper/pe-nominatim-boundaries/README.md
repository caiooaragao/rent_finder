# Sincronização de polígonos (Pernambuco) — Nominatim + Overpass

Script autónomo que:

1. Lista municípios de PE via **IBGE**.
2. Consulta o **Nominatim** (um pedido por segundo) e obtém, quando existir, `geojson` poligonal por município; grava `output/nominatim-cidades-pe.json`.
3. Opcionalmente chama o **Overpass** para vias/relações `place=suburb|neighbourhood` dentro do estado; converte com `osmtogeojson` e faz correspondência a municípios pela tag `addr:city` (ou equivalentes); grava `output/overpass-bairros-pe.geojson` e atualiza bairros na base.

**Política de uso:** respeite os limites públicos do Nominatim (~1 req/s; User-Agent identificável). Overpass também deve ser usado com moderação; consultas grandes podem falhar por timeout — volte a executar se necessário.

## Passos na base de dados (antes do primeiro insert)

1. A partir da pasta `rent_finder_scraper`, aplicar migrações (inclui `boundary_geojson` em `cidades` e `bairros`):

   ```bash
   npm run migrate
   ```

   O ficheiro relevante é `migrations/20260502140000_pe_boundary_geojson.sql`. No projeto Next/Supabase existe cópia em `rent_finder_front/supabase/migrations/` para manter o histórico alinhado.

2. Definir `DATABASE_URL` com permissões de `INSERT`/`UPDATE` nas tabelas `estados`, `cidades`, `bairros` (ou carregar `.env` na raiz do scraper e `rent_finder_front/.env.local` — o script usa o mesmo carregador que o resto do scraper).

## Dependências

Na pasta `rent_finder_scraper`:

```bash
npm install
```

## Execução

```bash
npm run pe:sync-boundaries
```

Ou diretamente:

```bash
node pe-nominatim-boundaries/sync-pe-boundaries.mjs
```

Opções:

| Flag | Efeito |
|------|--------|
| `--cidades-apenas` | Só Nominatim → municípios (~185 pedidos, ≥ ~3 min só de espera entre pedidos). |
| `--sem-db` | Só gera JSON em `pe-nominatim-boundaries/output/`; não conecta ao Postgres. |
| `--sem-bairros` | Não executa o Overpass nem atualiza bairros. |
| `-h` / `--help` | Ajuda. |

## Saídas em `output/`

- `ibge-municipios-pe.json` — lista IBGE.
- `nominatim-cidades-pe.json` — resultado por município (`ok`, `error`, `geojson`).
- `overpass-bairros-pe-raw.json` — resposta Overpass (se não usar `--sem-bairros` nem `--cidades-apenas`).
- `overpass-bairros-pe.geojson` — FeatureCollection após `osmtogeojson`.

## Limitações

- **Nem todos os municípios** têm polígono útil no primeiro resultado do Nominatim; entradas com `ok: false` ficam registadas no JSON.
- **Bairros:** cobertura depende do mapeamento OSM em PE e da presença de `addr:city` (ou equivalente) compatível com o nome do município na tabela `cidades`. Objetos sem cidade reconhecível são contados como ignorados no log.
