/**
 * Sincroniza polígonos de municípios (PE) via Nominatim + bairros via Overpass,
 * grava JSON em ./output/ e faz UPSERT em cidades / bairros (boundary_geojson).
 *
 * Política Nominatim: ≥ 1 s entre pedidos. IBGE fornece a lista de municípios.
 *
 * Uso:
 *   node sync-pe-boundaries.mjs                    # cidades + bairros (Overpass)
 *   node sync-pe-boundaries.mjs --cidades-apenas   # só Nominatim → municípios
 *   node sync-pe-boundaries.mjs --sem-db           # só gera JSON (sem Postgres)
 *   node sync-pe-boundaries.mjs --sem-bairros      # não corre Overpass
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import osmtogeojson from "osmtogeojson";
import postgres from "postgres";

import { loadEnvFile } from "../loadEnv.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

const NOMINATIM_MIN_GAP_MS = 1000;
const USER_AGENT_NOMINATIM = "rent-finder-pe-sync/1.0 (educational; contact projeto local)";
const USER_AGENT_OVERPASS = "rent-finder-pe-sync/1.0";

const IBGE_MUNICIPIOS_PE =
  "https://servicodados.ibge.gov.br/api/v1/localidades/estados/26/municipios";

const OUTPUT_DIR = join(__dirname, "output");

/** @param {number} ms */
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function normKey(s) {
  return (s ?? "")
    .trim()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase();
}

/** Partes de `is_in` que não são nome de município. */
const IS_IN_SKIP = /^(brasil|brazil|pe|pernambuco|nordeste|região metropolitana.*|br|bra)$/i;

/**
 * Nomes candidatos a município (ordem de prioridade), para casar com `cidades.nome`.
 * @param {Record<string, string>} tags
 */
function cidadeCandidatesFromTags(tags) {
  /** @type {string[]} */
  const ordered = [];
  const seen = new Set();

  const push = (s) => {
    const t = (s ?? "").trim();
    if (!t) return;
    const k = normKey(t);
    if (seen.has(k)) return;
    seen.add(k);
    ordered.push(t);
  };

  push(tags["addr:city"]);
  push(tags["is_in:city"]);
  push(tags["addr:municipality"]);
  push(tags["is_in:municipality"]);
  push(tags["is_in:town"]);
  push(tags["addr:town"]);

  const isIn = tags["is_in"];
  if (typeof isIn === "string" && isIn.trim()) {
    for (const segment of isIn.split(/[,;]+/)) {
      let p = segment.trim();
      if (!p) continue;
      const beforeSlash = p.split(/\s*\/\s*/)[0]?.trim();
      if (beforeSlash && beforeSlash !== p) push(beforeSlash);
      if (IS_IN_SKIP.test(p)) continue;
      push(p);
    }
  }

  return ordered;
}

/**
 * @param {Record<string, string>} tags
 * @param {Map<string, number>} cidadeByNome
 */
function resolveCidadeIdFromTags(tags, cidadeByNome) {
  for (const name of cidadeCandidatesFromTags(tags)) {
    const id = cidadeByNome.get(normKey(name));
    if (id) return id;
  }
  return null;
}

/** @param {object|null} raw — jsonb da BD (Feature, Polygon, …) */
function geometryFromBoundaryJson(raw) {
  if (!raw || typeof raw !== "object") return null;
  if (raw.type === "Feature" && raw.geometry) return raw.geometry;
  if (raw.type === "Polygon" || raw.type === "MultiPolygon") return raw;
  return null;
}

/**
 * @param {object} geom — GeoJSON Geometry
 * @returns {{ outer: number[][], holes: number[][][] }[]}
 */
function ringsFromGeometry(geom) {
  if (!geom) return [];
  if (geom.type === "Polygon") {
    const coords = geom.coordinates;
    if (!coords?.length) return [];
    const [outer, ...holes] = coords;
    return [{ outer, holes }];
  }
  if (geom.type === "MultiPolygon") {
    const out = [];
    for (const poly of geom.coordinates || []) {
      if (!poly?.length) continue;
      const [outer, ...holes] = poly;
      out.push({ outer, holes });
    }
    return out;
  }
  return [];
}

/**
 * @param {number} lon
 * @param {number} lat
 * @param {number[][]} ring — [lon, lat][]
 */
function pointInRing(lon, lat, ring) {
  if (!ring?.length) return false;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    const denom = yj - yi || 1e-12;
    const intersect =
      yi > lat !== yj > lat &&
      lon < ((xj - xi) * (lat - yi)) / denom + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/**
 * @param {number} lon
 * @param {number} lat
 * @param {{ outer: number[][], holes: number[][][] }[]} parts
 */
function pointInPolygonParts(lon, lat, parts) {
  for (const { outer, holes } of parts) {
    if (!pointInRing(lon, lat, outer)) continue;
    let inHole = false;
    for (const h of holes) {
      if (pointInRing(lon, lat, h)) {
        inHole = true;
        break;
      }
    }
    if (!inHole) return true;
  }
  return false;
}

/**
 * Centroide aproximado (anel exterior maior) para teste ponto-em-polígono do município.
 * @param {object|null} geom
 * @returns {{ lon: number; lat: number } | null}
 */
function centroidFromGeometry(geom) {
  if (!geom) return null;
  if (geom.type === "Point") {
    const c = geom.coordinates;
    return { lon: c[0], lat: c[1] };
  }
  if (geom.type === "LineString") {
    const c = geom.coordinates;
    if (!c?.length) return null;
    let sx = 0;
    let sy = 0;
    for (const pt of c) {
      sx += pt[0];
      sy += pt[1];
    }
    return { lon: sx / c.length, lat: sy / c.length };
  }
  const parts = ringsFromGeometry(geom);
  if (!parts.length) return null;
  let outer = parts[0].outer;
  for (const p of parts) {
    if (p.outer.length > outer.length) outer = p.outer;
  }
  const nO = outer.length;
  const closed =
    nO > 1 &&
    outer[0][0] === outer[nO - 1][0] &&
    outer[0][1] === outer[nO - 1][1];
  const len = closed ? nO - 1 : nO;
  if (len < 1) return null;
  let sx = 0;
  let sy = 0;
  for (let i = 0; i < len; i++) {
    sx += outer[i][0];
    sy += outer[i][1];
  }
  return { lon: sx / len, lat: sy / len };
}

/**
 * @param {number} lon
 * @param {number} lat
 * @param {{ id: number; parts: ReturnType<typeof ringsFromGeometry> }[]} cidades
 */
function findCidadeIdByPoint(lon, lat, cidades) {
  for (const c of cidades) {
    if (pointInPolygonParts(lon, lat, c.parts)) return c.id;
  }
  return null;
}

/**
 * Municípios com polígono já gravado (Nominatim), para fallback espacial.
 * @param {import('postgres').Sql} sql
 * @param {number} estadoId
 */
async function loadCidadesBoundaryParts(sql, estadoId) {
  const rows = await sql`
    SELECT id, nome, boundary_geojson FROM cidades
    WHERE estado_id = ${estadoId} AND boundary_geojson IS NOT NULL
  `;
  /** @type {{ id: number; nome: string; parts: ReturnType<typeof ringsFromGeometry> }[]} */
  const out = [];
  for (const r of rows) {
    const g = geometryFromBoundaryJson(r.boundary_geojson);
    if (!g) continue;
    const parts = ringsFromGeometry(g);
    if (!parts.length) continue;
    out.push({ id: r.id, nome: r.nome, parts });
  }
  return out;
}

/**
 * Igual à lógica em rent_finder_front/lib/nominatimGeoJson.ts — aceita Feature OSM.
 * @param {object|null} raw
 */
function normalizePolygonalGeoJson(raw) {
  if (!raw || typeof raw !== "object" || !("type" in raw)) return null;
  if (raw.type === "Polygon" || raw.type === "MultiPolygon") return raw;
  if (raw.type === "Feature" && raw.geometry) {
    const g = raw.geometry;
    if (
      g &&
      (g.type === "Polygon" || g.type === "MultiPolygon")
    )
      return raw;
  }
  if (raw.type === "FeatureCollection" && Array.isArray(raw.features)) {
    for (const feat of raw.features) {
      if (
        feat?.geometry?.type === "Polygon" ||
        feat?.geometry?.type === "MultiPolygon"
      )
        return feat;
    }
  }
  return null;
}

function loadEnv() {
  loadEnvFile(join(__dirname, "..", ".env"));
  loadEnvFile(join(__dirname, "..", "..", "rent_finder_front", ".env.local"), {
    override: true,
  });
}

function parseArgs(argv) {
  return {
    cidadesApenas: argv.includes("--cidades-apenas"),
    semDb: argv.includes("--sem-db"),
    semBairros: argv.includes("--sem-bairros"),
    ajuda: argv.includes("--help") || argv.includes("-h"),
  };
}

/** @returns {Promise<{ id: number; nome: string }[]>} */
async function fetchIbgeMunicipiosPe() {
  const res = await fetch(IBGE_MUNICIPIOS_PE);
  if (!res.ok) throw new Error(`IBGE HTTP ${res.status}`);
  /** @type {{ id: number; nome: string }[]} */
  const data = await res.json();
  return data.map((m) => ({ id: m.id, nome: m.nome }));
}

/**
 * @param {string} nomeMunicipio
 * @param {{ lastStart: number }} ctx
 */
async function nominatimMunicipioPolygon(nomeMunicipio, ctx) {
  const wait = Math.max(
    0,
    ctx.lastStart + NOMINATIM_MIN_GAP_MS - Date.now(),
  );
  if (wait > 0) await sleep(wait);
  ctx.lastStart = Date.now();

  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", `${nomeMunicipio}, Pernambuco, Brazil`);
  url.searchParams.set("format", "json");
  url.searchParams.set("polygon_geojson", "1");
  url.searchParams.set("limit", "8");
  url.searchParams.set("countrycodes", "br");

  const res = await fetch(url.toString(), {
    headers: { "User-Agent": USER_AGENT_NOMINATIM },
  });
  if (!res.ok) {
    return { ok: false, error: `HTTP ${res.status}`, geojson: null };
  }
  /** @type {Array<{ geojson?: object }>} */
  const rows = await res.json();
  for (const row of rows) {
    const g = normalizePolygonalGeoJson(row.geojson);
    if (g) return { ok: true, geojson: g, error: null };
  }
  return { ok: false, geojson: null, error: "sem polígono nos resultados" };
}

/**
 * Idempotente — mesmo conteúdo que migrations/20260502140000_pe_boundary_geojson.sql.
 * Evita erro se `npm run migrate` ainda não foi aplicado nesta base.
 * @param {import('postgres').Sql} sql
 */
async function ensureBoundaryGeojsonColumns(sql) {
  await sql`
    ALTER TABLE cidades ADD COLUMN IF NOT EXISTS boundary_geojson jsonb
  `;
  await sql`
    ALTER TABLE bairros ADD COLUMN IF NOT EXISTS boundary_geojson jsonb
  `;
}

/** Garante estado PE e devolve id. */
async function ensureEstadoPe(sql) {
  const rows = await sql`
    SELECT id FROM estados WHERE sigla = 'PE' LIMIT 1
  `;
  if (rows.length) return rows[0].id;

  await sql`
    INSERT INTO estados (nome, sigla)
    VALUES ('Pernambuco', 'PE')
    ON CONFLICT (nome) DO NOTHING
  `;
  const again = await sql`
    SELECT id FROM estados WHERE sigla = 'PE' LIMIT 1
  `;
  if (!again.length)
    throw new Error("não foi possível criar/usar estado PE");
  return again[0].id;
}

/**
 * @param {import('postgres').Sql} sql
 * @param {number} estadoId
 * @param {string} nome
 * @param {object} boundaryGeojson — Feature ou Geometry GeoJSON
 */
async function upsertCidade(sql, estadoId, nome, boundaryGeojson) {
  await sql`
    INSERT INTO cidades (estado_id, nome, boundary_geojson)
    VALUES (${estadoId}, ${nome}, ${sql.json(boundaryGeojson)})
    ON CONFLICT (estado_id, nome) DO UPDATE SET
      boundary_geojson = EXCLUDED.boundary_geojson
  `;
}

/**
 * @param {import('postgres').Sql} sql
 * @param {number} cidadeId
 * @param {string} nome
 * @param {object} boundaryGeojson
 */
async function upsertBairro(sql, cidadeId, nome, boundaryGeojson) {
  await sql`
    INSERT INTO bairros (cidade_id, nome, boundary_geojson)
    VALUES (${cidadeId}, ${nome}, ${sql.json(boundaryGeojson)})
    ON CONFLICT (cidade_id, nome) DO UPDATE SET
      boundary_geojson = EXCLUDED.boundary_geojson
  `;
}

/** Overpass: vias/relações place=suburb|neighbourhood dentro do estado PE. */
async function fetchOverpassBairrosPe() {
  const query = `
[out:json][timeout:900];
area["ISO3166-2"="BR-PE"]["boundary"="administrative"]->.pe;
(
  way["place"="neighbourhood"](area.pe);
  way["place"="suburb"](area.pe);
  relation["place"="neighbourhood"](area.pe);
  relation["place"="suburb"](area.pe);
);
out geom tags;
`;
  const res = await fetch("https://overpass-api.de/api/interpreter", {
    method: "POST",
    body: `data=${encodeURIComponent(query)}`,
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": USER_AGENT_OVERPASS,
    },
  });
  if (!res.ok) throw new Error(`Overpass HTTP ${res.status}`);
  return res.json();
}

/**
 * Constrói mapa nomeLower → cidadeId a partir da BD.
 * @param {import('postgres').Sql} sql
 * @param {number} estadoId
 */
async function loadCidadesIndex(sql, estadoId) {
  const rows = await sql`
    SELECT id, nome FROM cidades WHERE estado_id = ${estadoId}
  `;
  /** @type {Map<string, number>} */
  const m = new Map();
  for (const r of rows) {
    m.set(normKey(r.nome), r.id);
  }
  return m;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.ajuda) {
    console.log(`
sync-pe-boundaries.mjs — PE (Nominatim + Overpass)

  --cidades-apenas   Só municípios via Nominatim (~185 pedidos, ~3–4 min)
  --sem-db           Só grava JSON em pe-nominatim-boundaries/output/
  --sem-bairros      Não corre Overpass (bairros)

Requer DATABASE_URL (exceto --sem-db). Migração SQL aplicada antes (na pasta rent_finder_scraper):
  npm run migrate
`);
    process.exit(0);
  }

  loadEnv();
  mkdirSync(OUTPUT_DIR, { recursive: true });

  console.error("[pe-sync] IBGE: municípios de PE…");
  const municipios = await fetchIbgeMunicipiosPe();
  writeFileSync(
    join(OUTPUT_DIR, "ibge-municipios-pe.json"),
    JSON.stringify(municipios, null, 2),
    "utf8",
  );
  console.error(`[pe-sync] IBGE: ${municipios.length} municípios.`);

  const ctx = { lastStart: 0 };
  /** @type {{ nome: string; ok: boolean; error?: string|null; tipo?: string }[]} */
  const cidadesResultados = [];

  for (const m of municipios) {
    process.stderr.write(`\r[pe-sync] Nominatim: ${m.nome.padEnd(28)}`);
    const r = await nominatimMunicipioPolygon(m.nome, ctx);
    cidadesResultados.push({
      nome: m.nome,
      ibgeId: m.id,
      ok: r.ok,
      error: r.error,
      geojson: r.geojson,
    });
  }
  console.error("\n[pe-sync] Nominatim cidades concluído.");

  writeFileSync(
    join(OUTPUT_DIR, "nominatim-cidades-pe.json"),
    JSON.stringify(cidadesResultados, null, 2),
    "utf8",
  );

  if (!opts.semDb && process.env.DATABASE_URL) {
    const sql = postgres(process.env.DATABASE_URL, {
      prepare: false,
      max: 1,
    });
    try {
      await ensureBoundaryGeojsonColumns(sql);
      const estadoId = await ensureEstadoPe(sql);
      let okC = 0;
      for (const row of cidadesResultados) {
        if (!row.ok || !row.geojson) continue;
        await upsertCidade(sql, estadoId, row.nome, row.geojson);
        okC++;
      }
      console.error(`[pe-sync] BD: ${okC} cidades atualizadas com polígono.`);

      if (!opts.cidadesApenas && !opts.semBairros) {
        console.error("[pe-sync] Overpass: bairros/subúrbios em PE (demorado)…");
        const osmJson = await fetchOverpassBairrosPe();
        writeFileSync(
          join(OUTPUT_DIR, "overpass-bairros-pe-raw.json"),
          JSON.stringify(osmJson, null, 2),
          "utf8",
        );

        const gj = osmtogeojson(osmJson);
        writeFileSync(
          join(OUTPUT_DIR, "overpass-bairros-pe.geojson"),
          JSON.stringify(gj, null, 2),
          "utf8",
        );

        const cidadeByNome = await loadCidadesIndex(sql, estadoId);
        const cidadesBoundaryParts = await loadCidadesBoundaryParts(
          sql,
          estadoId,
        );
        let okB = 0;
        let bairrosViaTags = 0;
        let bairrosViaMapa = 0;
        let skipNoName = 0;
        let skipNoGeom = 0;
        let skipNoMunicipio = 0;

        if (gj.type === "FeatureCollection" && Array.isArray(gj.features)) {
          for (const feat of gj.features) {
            const tags = feat.properties || {};
            const nomeBairro =
              tags.name || tags["name:pt"] || tags["official_name"];
            if (!nomeBairro || typeof nomeBairro !== "string") {
              skipNoName++;
              continue;
            }
            if (!feat.geometry) {
              skipNoGeom++;
              continue;
            }

            let cid = resolveCidadeIdFromTags(tags, cidadeByNome);
            if (cid) bairrosViaTags++;
            else if (cidadesBoundaryParts.length) {
              const cen = centroidFromGeometry(feat.geometry);
              if (cen) {
                const id = findCidadeIdByPoint(
                  cen.lon,
                  cen.lat,
                  cidadesBoundaryParts,
                );
                if (id) {
                  cid = id;
                  bairrosViaMapa++;
                }
              }
            }

            if (!cid) {
              skipNoMunicipio++;
              continue;
            }

            const boundary =
              feat.geometry.type === "Polygon" ||
              feat.geometry.type === "MultiPolygon"
                ? feat
                : {
                    type: "Feature",
                    geometry: feat.geometry,
                    properties: {},
                  };
            await upsertBairro(sql, cid, nomeBairro.trim(), boundary);
            okB++;
          }
        }
        console.error(
          `[pe-sync] BD: ${okB} bairros com polígono (${bairrosViaTags} por tags OSM, ${bairrosViaMapa} por polígono do município). Ignorados: ${skipNoMunicipio} sem município, ${skipNoName} sem nome, ${skipNoGeom} sem geometria.`,
        );
      }
    } finally {
      await sql.end({ timeout: 5 });
    }
  } else if (!opts.semDb && !process.env.DATABASE_URL) {
    console.error("[pe-sync] DATABASE_URL ausente — só JSON gravado. Use --sem-db explicitamente.");
  }

  console.error("[pe-sync] Ficheiros em:", OUTPUT_DIR);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
