/**
 * Persiste anúncios no Postgres (Supabase) após o scrape.
 * Usa a mesma DATABASE_URL que o Drizzle no front (prepare: false para pooler).
 *
 * O pacote `postgres` é carregado a partir de `rent_finder_front/node_modules`
 * quando não existir em `rent_finder_scraper/node_modules` (evita npm install duplicado).
 *
 * API de baixo nível (para processamento em batch):
 *   const sql = await openDbConnection(databaseUrl);
 *   await syncAdsBatch(sql, batch);   // chame N vezes
 *   await closeDbConnection(sql);
 *
 * API de alto nível (compatibilidade — carrega e fecha conexão internamente):
 *   await syncAdsToDatabase(ads);
 */

import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * @returns {Promise<typeof import("postgres").default>}
 */
async function loadPostgres() {
  const candidates = [
    join(__dirname, "../rent_finder_front/package.json"),
    join(__dirname, "package.json"),
  ];
  for (const pkgJson of candidates) {
    try {
      const require = createRequire(pkgJson);
      const resolved = require.resolve("postgres");
      const mod = await import(pathToFileURL(resolved).href);
      if (typeof mod.default === "function") return mod.default;
    } catch {
      /* tenta o seguinte */
    }
  }
  const mod = await import("postgres");
  return mod.default;
}

/** @type {Record<string, string>} */
const UF_NOME = {
  AC: "Acre",
  AL: "Alagoas",
  AP: "Amapá",
  AM: "Amazonas",
  BA: "Bahia",
  CE: "Ceará",
  DF: "Distrito Federal",
  ES: "Espírito Santo",
  GO: "Goiás",
  MA: "Maranhão",
  MT: "Mato Grosso",
  MS: "Mato Grosso do Sul",
  MG: "Minas Gerais",
  PA: "Pará",
  PB: "Paraíba",
  PR: "Paraná",
  PE: "Pernambuco",
  PI: "Piauí",
  RJ: "Rio de Janeiro",
  RN: "Rio Grande do Norte",
  RS: "Rio Grande do Sul",
  RO: "Rondônia",
  RR: "Roraima",
  SC: "Santa Catarina",
  SP: "São Paulo",
  SE: "Sergipe",
  TO: "Tocantins",
};

/**
 * @param {unknown} raw
 * @returns {{ nome: string, sigla: string | null } | null}
 */
function normalizeEstado(raw) {
  if (raw == null || raw === "") return null;
  const s = String(raw).trim();
  if (!s) return null;
  if (s.length === 2 && /^[A-Za-z]{2}$/.test(s)) {
    const uf = s.toUpperCase();
    return { nome: UF_NOME[uf] ?? uf, sigla: uf };
  }
  const entry = Object.entries(UF_NOME).find(
    ([, nome]) => nome.toLowerCase() === s.toLowerCase()
  );
  if (entry) return { nome: entry[1], sigla: entry[0] };
  return { nome: s, sigla: null };
}

/**
 * @param {unknown} ad
 */
function pickLatLng(ad) {
  const lat = ad.latitude;
  const lng = ad.longitude;
  if (typeof lat !== "number" || typeof lng !== "number" || Number.isNaN(lat) || Number.isNaN(lng)) {
    return { lat: null, lng: null };
  }
  if (lat === 0 && lng === 0) return { lat: null, lng: null };
  return { lat, lng };
}

/**
 * @param {import('postgres').Sql} sql
 * @param {string} nome
 * @param {string | null} sigla
 */
async function getOrCreateEstado(sql, nome, sigla) {
  if (sigla) {
    const bySigla = await sql`
      SELECT id FROM estados WHERE sigla = ${sigla} LIMIT 1
    `;
    if (bySigla.length) return bySigla[0].id;
  }
  const byNome = await sql`
    SELECT id FROM estados WHERE nome = ${nome} LIMIT 1
  `;
  if (byNome.length) return byNome[0].id;
  const ins = await sql`
    INSERT INTO estados (nome, sigla) VALUES (${nome}, ${sigla}) RETURNING id
  `;
  return ins[0].id;
}

/**
 * @param {import('postgres').Sql} sql
 * @param {number} estadoId
 * @param {string} nome
 */
async function getOrCreateCidade(sql, estadoId, nome) {
  const trimmed = nome.trim();
  if (!trimmed) return null;
  const found = await sql`
    SELECT id FROM cidades WHERE estado_id = ${estadoId} AND nome = ${trimmed} LIMIT 1
  `;
  if (found.length) return found[0].id;
  const ins = await sql`
    INSERT INTO cidades (estado_id, nome) VALUES (${estadoId}, ${trimmed}) RETURNING id
  `;
  return ins[0].id;
}

/**
 * @param {import('postgres').Sql} sql
 * @param {number} cidadeId
 * @param {string} nome
 */
async function getOrCreateBairro(sql, cidadeId, nome) {
  const trimmed = nome.trim();
  if (!trimmed) return null;
  const found = await sql`
    SELECT id FROM bairros WHERE cidade_id = ${cidadeId} AND nome = ${trimmed} LIMIT 1
  `;
  if (found.length) return found[0].id;
  const ins = await sql`
    INSERT INTO bairros (cidade_id, nome) VALUES (${cidadeId}, ${trimmed}) RETURNING id
  `;
  return ins[0].id;
}

/**
 * @param {import('postgres').Sql} sql
 * @param {Record<string, unknown>} ad
 * @returns {Promise<{ estadoId: number | null, cidadeId: number | null, bairroId: number | null }>}
 */
async function resolveGeoIds(sql, ad) {
  let estadoId = null;
  let cidadeId = null;
  let bairroId = null;

  const estadoNorm = normalizeEstado(ad.estado);
  if (estadoNorm) {
    estadoId = await getOrCreateEstado(sql, estadoNorm.nome, estadoNorm.sigla);
  }

  const cidadeStr =
    typeof ad.cidade === "string" && ad.cidade.trim() ? ad.cidade.trim() : "";
  if (cidadeStr && estadoId != null) {
    cidadeId = await getOrCreateCidade(sql, estadoId, cidadeStr);
  }

  const bairroStr =
    typeof ad.bairro === "string" && ad.bairro.trim() ? ad.bairro.trim() : "";
  if (bairroStr && cidadeId != null) {
    bairroId = await getOrCreateBairro(sql, cidadeId, bairroStr);
  }

  return { estadoId, cidadeId, bairroId };
}

/**
 * Remove null bytes (U+0000) que o PostgreSQL rejeita em colunas text/UTF-8.
 * Podem aparecer ocasionalmente no HTML scrapeado.
 * @param {string} s
 */
function stripNullBytes(s) {
  return s.replace(/\0/g, "");
}

/**
 * @param {import('postgres').Sql} sql
 * @param {Record<string, unknown>} ad
 * @param {{ estadoId: number | null, cidadeId: number | null, bairroId: number | null }} geo
 */
async function upsertAnuncio(sql, ad, geo) {
  const titulo = stripNullBytes(String(ad.titulo ?? ""));
  const preco = stripNullBytes(String(ad.preco ?? ""));
  const link = stripNullBytes(String(ad.link ?? ""));
  if (!link) return;

  const descricao = stripNullBytes(typeof ad.descricao === "string" ? ad.descricao : "");
  const endereco = stripNullBytes(typeof ad.endereco === "string" ? ad.endereco : "");
  const enderecoApenasBairro = Boolean(ad.enderecoApenasBairro);
  const { lat, lng } = pickLatLng(ad);

  await sql`
    INSERT INTO anuncios (
      titulo,
      preco,
      link,
      descricao,
      endereco,
      endereco_apenas_bairro,
      latitude,
      longitude,
      estado_id,
      cidade_id,
      bairro_id,
      updated_at
    )
    VALUES (
      ${titulo},
      ${preco},
      ${link},
      ${descricao},
      ${endereco},
      ${enderecoApenasBairro},
      ${lat},
      ${lng},
      ${geo.estadoId},
      ${geo.cidadeId},
      ${geo.bairroId},
      now()
    )
    ON CONFLICT (link) DO UPDATE SET
      titulo = EXCLUDED.titulo,
      preco = EXCLUDED.preco,
      descricao = EXCLUDED.descricao,
      endereco = EXCLUDED.endereco,
      endereco_apenas_bairro = EXCLUDED.endereco_apenas_bairro,
      latitude = EXCLUDED.latitude,
      longitude = EXCLUDED.longitude,
      estado_id = EXCLUDED.estado_id,
      cidade_id = EXCLUDED.cidade_id,
      bairro_id = EXCLUDED.bairro_id,
      updated_at = now()
  `;
}

// ---------------------------------------------------------------------------
// Truncate
// ---------------------------------------------------------------------------

/**
 * Apaga todos os registros de `anuncios` antes de um sync completo.
 * Tabelas geo (estados, cidades, bairros) são preservadas.
 *
 * @param {import('postgres').Sql} sql
 */
export async function truncateAnuncios(sql) {
  await sql`TRUNCATE TABLE anuncios RESTART IDENTITY`;
}

// ---------------------------------------------------------------------------
// API de baixo nível (conexão gerenciada externamente — ideal para batches)
// ---------------------------------------------------------------------------

/**
 * @param {string} databaseUrl
 * @returns {import('postgres').Options<{}>}
 */
function getPostgresOptions(databaseUrl) {
  const isLocal = /localhost|127\.0\.0\.1/.test(databaseUrl);
  return {
    prepare: false,
    max: 1,
    ...(isLocal ? {} : { ssl: "require" }),
  };
}

/**
 * Abre uma conexão Postgres reutilizável.
 * Feche com `closeDbConnection(sql)` ao final.
 *
 * @param {string} databaseUrl
 * @returns {Promise<import('postgres').Sql>}
 */
export async function openDbConnection(databaseUrl) {
  const postgres = await loadPostgres();
  return postgres(databaseUrl, getPostgresOptions(databaseUrl));
}

/**
 * @param {import('postgres').Sql} sql
 */
export async function closeDbConnection(sql) {
  await sql.end({ timeout: 5 });
}

/**
 * Persiste um batch de anúncios usando uma conexão já aberta.
 * Não abre nem fecha a conexão — responsabilidade do chamador.
 *
 * @param {import('postgres').Sql} sql
 * @param {Array<Record<string, unknown>>} ads
 * @returns {Promise<{ synced: number }>}
 */
export async function syncAdsBatch(sql, ads) {
  let ok = 0;
  for (const ad of ads) {
    const geo = await resolveGeoIds(sql, ad);
    await upsertAnuncio(sql, ad, geo);
    ok++;
  }
  return { synced: ok };
}

// ---------------------------------------------------------------------------
// API de alto nível (compatibilidade — abre e fecha conexão internamente)
// ---------------------------------------------------------------------------

/**
 * @param {Array<Record<string, unknown>>} ads
 * @param {{ databaseUrl?: string }} [options]
 */
export async function syncAdsToDatabase(ads, options = {}) {
  const databaseUrl = options.databaseUrl ?? process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL não está definida");
  }

  const sql = await openDbConnection(databaseUrl);

  try {
    let ok = 0;
    let i = 0;
    for (const ad of ads) {
      i++;
      const geo = await resolveGeoIds(sql, ad);
      await upsertAnuncio(sql, ad, geo);
      ok++;
      if (i % 50 === 0) {
        console.error(`  [DB] ${i}/${ads.length} anúncios sincronizados…`);
      }
    }
    console.error(`[DB] Supabase: ${ok} anúncio(s) gravados/atualizados (upsert por link).`);
    return { synced: ok };
  } finally {
    await closeDbConnection(sql);
  }
}
