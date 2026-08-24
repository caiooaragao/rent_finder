#!/usr/bin/env node
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { loadEnvFile } from "./loadEnv.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
loadEnvFile(join(__dirname, ".env"));
loadEnvFile(join(__dirname, "../rent_finder_front/.env.local"), {
  override: true,
});

/**
 * Fetches an OLX listing URL and prints JSON objects per ad:
 *   { titulo, preco, link, descricao, endereco, latitude, longitude, bairro, cidade, estado, ... }
 * — bairro/cidade/estado: atributos District/City/Region do ArcGIS (findAddressCandidates), quando há geocode
 * — latitude/longitude: ArcGIS World Geocoder (findAddressCandidates) via curl
 * — titulo / preco / link from the listing cards (same as before)
 * — descricao: each ad page, <span class="typo-body-medium" style="word-break…;white-space:break-spaces">
 * — endereco: inside <div class="ad__sc-o5hdud-1 DCCug">, street + complement spans
 *
 * OLX is often behind Cloudflare; Node's fetch may get HTTP 403. This script
 * falls back to the system `curl` when the response has no listing markup.
 *
 * Writes the ads array to a JSON file (default: olx-scrape.json in cwd).
 *
 * Pesquisas: por defeito percorre RESEARCH_ARRAY (várias URLs OLX). O mesmo anúncio
 * em pesquisas diferentes é mantido uma vez (dedupe por URL canónica do anúncio).
 * Um URL posicional substitui o array e usa só essa pesquisa.
 *
 * Usage:
 *   node scrape-olx-titles.mjs
 *   node scrape-olx-titles.mjs "https://www.olx.com.br/estado-pe?q=kitnet"
 *   node scrape-olx-titles.mjs --pages 1             # first page only
 *   node scrape-olx-titles.mjs --detail-max 5        # only fetch details for first 5 ads
 *   node scrape-olx-titles.mjs --batch-size 1000     # ads processed per batch (default: 1000)
 *   node scrape-olx-titles.mjs --concurrency 8       # requests in parallel (default: 5)
 *   node scrape-olx-titles.mjs --geocode-concurrency 10  # geocode workers (default: same as --concurrency)
 *   node scrape-olx-titles.mjs --out resultados.json
 *   node scrape-olx-titles.mjs --stdout              # also print JSON to stdout
 *   node scrape-olx-titles.mjs --skip-geocode        # não chama o ArcGIS após o scrape
 *   node scrape-olx-titles.mjs --no-db               # não grava no Supabase (só JSON)
 *   node scrape-olx-titles.mjs --skip-migrate        # não aplica migrations/*.sql (só upsert)
 *   node scrape-olx-titles.mjs --no-truncate       # não apaga anúncios antigos (só upsert por link)
 *
 * Com DATABASE_URL: por defeito executa TRUNCATE em `anuncios` antes do primeiro batch,
 * para que o banco reflita só o scrape atual. Use --no-truncate para acumular/atualizar.
 *
 * Processamento em batches com concorrência:
 * — Fase 1 (listagem): todas as URLs de pesquisa são coletadas em paralelo.
 * — Fase 2 (detalhes): --concurrency requisições simultâneas por batch.
 * — Fase 3 (geocode): --geocode-concurrency requisições simultâneas por batch.
 * — Fase 4 (regras + JSON + DB): executadas após cada batch, liberando memória.
 */

import { execFile } from "node:child_process";
import { open } from "node:fs/promises";
import { promisify } from "node:util";

import {
  createBusinessRulesState,
  runBusinessRulesPipelineWithState,
} from "./olxScraperBusinessLayer.mjs";
import { runMigrations } from "./runMigrations.mjs";

const execFileAsync = promisify(execFile);

/** URLs de pesquisa/listagem OLX a percorrer (cada uma com paginação própria). */
const RESEARCH_ARRAY = [
  
  "https://www.olx.com.br/imoveis/aluguel/estado-pe?q=aluguel",
  "https://www.olx.com.br/imoveis/aluguel/casas/estado-pe",
  "https://www.olx.com.br/imoveis/aluguel/kitnet/estado-pe",
  
];

//"https://www.olx.com.br/imoveis/venda/casas/estado-pe"
//"https://www.olx.com.br/imoveis/venda/kitnet/estado-pe"

const DEFAULT_OUT = "olx-scrape.json";
const DEFAULT_BATCH_SIZE = 1000;
const DEFAULT_CONCURRENCY = 5;

const CURL_MAX_BUFFER = 15 * 1024 * 1024;

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

/** @param {number} ms */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Utilitário de concorrência — sem dependências externas
// ---------------------------------------------------------------------------

/**
 * Executa `fn` sobre cada item com no máximo `concurrency` chamadas em voo
 * simultaneamente. Os resultados são retornados na mesma ordem de `items`.
 *
 * @template T, R
 * @param {T[]} items
 * @param {(item: T, index: number) => Promise<R>} fn
 * @param {number} concurrency
 * @returns {Promise<R[]>}
 */
async function runConcurrent(items, fn, concurrency) {
  if (items.length === 0) return [];
  const results = new Array(items.length);
  let nextIdx = 0;

  async function worker() {
    while (true) {
      const i = nextIdx++;
      if (i >= items.length) break;
      results[i] = await fn(items[i], i);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, worker)
  );
  return results;
}

// ---------------------------------------------------------------------------
// HTML helpers
// ---------------------------------------------------------------------------

function decodeHtmlEntities(s) {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) =>
      String.fromCharCode(parseInt(h, 16))
    );
}

/** Strip tags; keep line breaks from <br> / block ends. */
function stripHtmlToText(html) {
  if (!html) return "";
  return decodeHtmlEntities(
    html
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>/gi, "\n")
      .replace(/<[^>]+>/g, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
}

/** Content inside an outer <span>, supporting nested <span>. */
function extractInnerUntilMatchingSpanClose(html, start) {
  let depth = 1;
  let i = start;
  while (i < html.length && depth > 0) {
    const nextOpen = html.indexOf("<span", i);
    const nextClose = html.indexOf("</span>", i);
    if (nextClose === -1) break;
    if (nextOpen !== -1 && nextOpen < nextClose) {
      depth++;
      i = nextOpen + 5;
    } else {
      depth--;
      if (depth === 0) {
        return html.slice(start, nextClose);
      }
      i = nextClose + 7;
    }
  }
  return "";
}

function findDescricaoOpenTag(html) {
  const patterns = [
    /<span[^>]*class="[^"]*typo-body-medium[^"]*"[^>]*style="[^"]*word-break:\s*break-word[^"]*white-space:\s*break-spaces[^"]*"[^>]*>/i,
    /<span[^>]*style="[^"]*word-break:\s*break-word[^"]*white-space:\s*break-spaces[^"]*"[^>]*class="[^"]*typo-body-medium[^"]*"[^>]*>/i,
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m && m.index !== undefined) {
      return { tag: m[0], startInner: m.index + m[0].length };
    }
  }
  return null;
}

/** @param {string} html */
function extractDescricao(html) {
  const found = findDescricaoOpenTag(html);
  if (!found) return "";
  const inner = extractInnerUntilMatchingSpanClose(html, found.startInner);
  return stripHtmlToText(inner);
}

/** @param {string} html */
function extractEndereco(html) {
  const marker = "ad__sc-o5hdud-1 DCCug";
  const divIdx = html.indexOf(marker);
  if (divIdx === -1) return "";
  const afterSvg = html.indexOf("</svg>", divIdx);
  if (afterSvg === -1) return "";
  const chunk = html.slice(afterSvg, afterSvg + 4000);
  const street = chunk.match(
    /<span[^>]*class="[^"]*typo-body-medium[^"]*font-semibold[^"]*"[^>]*>([^<]*)<\/span>/i
  );
  const rest = chunk.match(
    /<span[^>]*class="[^"]*typo-body-small[^"]*font-semibold[^"]*text-neutral-110[^"]*"[^>]*>([^<]*)<\/span>/i
  );
  const s = street && street[1] ? street[1].trim() : "";
  const r = rest && rest[1] ? rest[1].trim() : "";
  const parts = [s, r].filter(Boolean);
  return parts.length ? parts.join(", ") : "";
}

/** @param {string} html */
function extractTitles(html) {
  const out = [];
  const re = /<h2[^>]*\bclass\s*=\s*["']([^"']*)["'][^>]*>([^<]*)<\/h2>/gi;
  let m;
  while ((m = re.exec(html))) {
    const cls = m[1];
    if (
      /\bolx-adcard__title\b/.test(cls) &&
      /\btypo-body-large\b/.test(cls) &&
      /\bfont-semibold\b/.test(cls)
    ) {
      out.push(decodeHtmlEntities(m[2].trim()));
    }
  }
  return out;
}

/** @param {string} html */
function extractPrices(html) {
  const out = [];
  const re = /<h3[^>]*\bclass\s*=\s*["']([^"']*)["'][^>]*>([^<]*)<\/h3>/gi;
  let m;
  while ((m = re.exec(html))) {
    const cls = m[1];
    if (
      /\bolx-adcard__price\b/.test(cls) &&
      /\btypo-body-large\b/.test(cls) &&
      /\bfont-semibold\b/.test(cls)
    ) {
      out.push(decodeHtmlEntities(m[2].trim()));
    }
  }
  return out;
}

/** @param {string} html */
function extractLinks(html) {
  const out = [];
  const re = /<a[^>]*>/gi;
  let m;
  while ((m = re.exec(html))) {
    const tag = m[0];
    if (!/\bolx-adcard__link\b/.test(tag)) continue;
    const hm = tag.match(/\bhref\s*=\s*["']([^"']+)["']/i);
    if (hm) {
      out.push(decodeHtmlEntities(hm[1].trim()));
    }
  }
  return out;
}

/** @param {string} html */
function extractAds(html) {
  const titulos = extractTitles(html);
  const precos = extractPrices(html);
  const links = extractLinks(html);
  const n = Math.min(titulos.length, precos.length, links.length);
  if (titulos.length !== precos.length || titulos.length !== links.length) {
    console.error(
      `Warning: ${titulos.length} titles, ${precos.length} prices, ${links.length} links; pairing first ${n}.`
    );
  }
  const ads = [];
  for (let i = 0; i < n; i++) {
    ads.push({ titulo: titulos[i], preco: precos[i], link: links[i] });
  }
  return ads;
}

/** @param {string} html */
function readListingMeta(html) {
  const block = html.match(
    /<script id="__NEXT_DATA__"[^>]*>([^<]+)<\/script>/
  );
  if (!block) return { totalOfAds: 0, pageSize: 50 };
  try {
    const j = JSON.parse(block[1]);
    const pp = j?.props?.pageProps;
    return {
      totalOfAds: Number(pp?.totalOfAds) || 0,
      pageSize: Number(pp?.pageSize) || 50,
    };
  } catch {
    return { totalOfAds: 0, pageSize: 50 };
  }
}

function buildPageUrl(base, page) {
  const u = new URL(base);
  if (page <= 1) u.searchParams.delete("o");
  else u.searchParams.set("o", String(page));
  return u.toString();
}

const OLX_ORIGIN = "https://www.olx.com.br";

/**
 * Mesmo anúncio em pesquisas diferentes costuma ter o mesmo path; query/hash variam.
 * @param {unknown} raw
 */
function canonicalAdLink(raw) {
  const s = typeof raw === "string" ? raw.trim() : "";
  if (!s) return "";
  try {
    const u = new URL(s, OLX_ORIGIN);
    u.hash = "";
    u.search = "";
    const path = u.pathname.replace(/\/+$/, "") || "/";
    let host = u.hostname.toLowerCase();
    if (host === "olx.com.br" || host === "www.olx.com.br") {
      host = "www.olx.com.br";
    }
    return `${u.protocol}//${host}${path}`;
  } catch {
    return s;
  }
}

function hasListingMarkup(html) {
  return (
    typeof html === "string" &&
    html.includes("olx-adcard__title") &&
    html.includes("olx-adcard__price") &&
    html.includes("olx-adcard__link") &&
    html.includes("__NEXT_DATA__")
  );
}

/** Ad detail pages do not ship __NEXT_DATA__; rely on HTML marker. */
function hasAdMarkup(html) {
  return (
    typeof html === "string" &&
    html.length > 5000 &&
    html.includes('data-page-name="ad_detail"')
  );
}

async function fetchHtmlViaCurl(url) {
  const { stdout } = await execFileAsync(
    "curl",
    ["-sL", "-A", UA, "--max-time", "90", url],
    { maxBuffer: CURL_MAX_BUFFER, encoding: "utf8" }
  );
  return stdout;
}

const ARCGIS_GEOCODE =
  "https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/findAddressCandidates";

/**
 * Lê atributo de texto do candidato ArcGIS (World Geocoder).
 * @param {Record<string, unknown> | null | undefined} attrs
 * @param {string} key
 * @returns {string | null}
 */
function geocodeAttributeString(attrs, key) {
  if (!attrs || typeof attrs !== "object") return null;
  const v = attrs[key];
  if (v == null || v === "") return null;
  const s = String(v).trim();
  return s || null;
}

/**
 * Geocodifica um endereço com ArcGIS REST (findAddressCandidates) usando curl.
 */
async function geocodeEnderecoViaCurl(singleLine) {
  const line = typeof singleLine === "string" ? singleLine.trim() : "";
  if (!line) {
    return { latitude: null, longitude: null, bairro: null, cidade: null, estado: null };
  }

  const u = new URL(ARCGIS_GEOCODE);
  u.searchParams.set("f", "json");
  u.searchParams.set("singleLine", line);
  u.searchParams.set("outFields", "District,City,Region");

  let stdout;
  try {
    const out = await execFileAsync(
      "curl",
      ["-sS", "-L", "-A", UA, "--max-time", "45", u.toString()],
      { maxBuffer: 2 * 1024 * 1024, encoding: "utf8" }
    );
    stdout = out.stdout;
  } catch (e) {
    throw new Error(e && e.message ? e.message : String(e));
  }

  let data;
  try {
    data = JSON.parse(stdout);
  } catch {
    throw new Error("Resposta ArcGIS não é JSON válido");
  }

  if (data.error) {
    const msg =
      data.error.message ||
      data.error.details?.join?.("; ") ||
      JSON.stringify(data.error);
    throw new Error(`ArcGIS error: ${msg}`);
  }

  const candidates = data.candidates;
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return { latitude: null, longitude: null, bairro: null, cidade: null, estado: null };
  }

  const first = candidates[0];
  const attrs = first.attributes;
  const bairro = geocodeAttributeString(attrs, "District");
  const cidade = geocodeAttributeString(attrs, "City");
  const estado = geocodeAttributeString(attrs, "Region");

  const loc = first.location;
  if (!loc || typeof loc.x !== "number" || typeof loc.y !== "number") {
    return { latitude: 0, longitude: 0, bairro, cidade, estado };
  }

  // ArcGIS WGS84: x = longitude, y = latitude
  return { latitude: loc.y, longitude: loc.x, bairro, cidade, estado };
}

/**
 * Busca HTML via curl diretamente, sem passar pelo fetch() do Node.
 * Preferido para páginas de anúncio OLX (Cloudflare sempre bloqueia fetch nativo).
 *
 * @param {string} url
 * @param {(html: string) => boolean} isValid
 */
async function fetchHtmlCurlOnly(url, isValid) {
  let text;
  try {
    text = await fetchHtmlViaCurl(url);
  } catch (e) {
    const hint = e && e.message ? `: ${e.message}` : "";
    throw new Error(`curl failed for ${url}${hint}`);
  }
  if (isValid(text)) return text;
  throw new Error(
    `Could not load valid HTML for ${url} (blocked or layout changed).`
  );
}

/**
 * Busca HTML tentando fetch() nativo primeiro e curl como fallback.
 * Usado nas páginas de listagem onde fetch pode funcionar.
 *
 * @param {string} url
 * @param {(html: string) => boolean} isValid
 */
async function fetchHtml(url, isValid) {
  const headers = {
    "user-agent": UA,
    "accept-language": "pt-BR,pt;q=0.9",
    accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  };

  // Tenta fetch nativo (mais leve se funcionar); OLX de listagem às vezes passa.
  try {
    const res = await fetch(url, { headers });
    // Consome o body e descarta imediatamente — evita retenção no pool do undici.
    const text = await res.text();
    if (res.ok && isValid(text)) return text;
  } catch {
    // cai no curl
  }

  return fetchHtmlCurlOnly(url, isValid);
}

/**
 * Todas as páginas de listagem de uma pesquisa OLX (cartões: titulo, preco, link).
 * As páginas dentro de uma URL são coletadas sequencialmente (dependência de página 1
 * para saber o total). Diferentes URLs são chamadas em paralelo pelo chamador.
 *
 * @param {string} url
 * @param {number | null} maxPages
 * @param {number} searchIndex label para o log
 * @param {number} searchTotal label para o log
 */
async function collectListingAdsForSearchUrl(url, maxPages, searchIndex, searchTotal) {
  const firstHtml = await fetchHtml(url, hasListingMarkup);
  const { totalOfAds, pageSize } = readListingMeta(firstHtml);
  const estimatedPages =
    totalOfAds > 0 && pageSize > 0 ? Math.ceil(totalOfAds / pageSize) : 1;

  const pageLimit = maxPages != null ? maxPages : estimatedPages;
  console.error(
    `[listagem] pesquisa ${searchIndex}/${searchTotal}: ${url} (~${pageLimit} pág.)`
  );

  const ads = [];

  for (let page = 1; page <= pageLimit; page++) {
    const pageUrl = page === 1 ? url : buildPageUrl(url, page);
    let html;
    if (page === 1) {
      html = firstHtml;
    } else {
      try {
        html = await fetchHtml(pageUrl, hasListingMarkup);
      } catch (e) {
        const msg = e && e.message ? e.message : String(e);
        console.error(
          `  [listagem] página ${page} abortada (${ads.length} coletados): ${msg}`
        );
        break;
      }
    }
    const pageAds = extractAds(html);
    if (page > 1 && pageAds.length === 0) break;
    ads.push(...pageAds);

    // Pequeno delay entre páginas da mesma URL (polidez com o servidor OLX).
    if (page < pageLimit) await sleep(300);
  }

  console.error(
    `[listagem] pesquisa ${searchIndex}/${searchTotal}: ${ads.length} cartões coletados.`
  );
  return ads;
}

// ---------------------------------------------------------------------------
// Parseamento de argumentos
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  /** @type {string | null} */
  let cliSearchUrl = null;
  let maxPages = null;
  /** @type {number | null} */
  let detailMax = null;
  let outPath = resolve(process.cwd(), DEFAULT_OUT);
  let stdout = false;
  let skipGeocode = false;
  let noDb = false;
  let skipMigrate = false;
  /** Por defeito limpa `anuncios` antes de inserir (reflete só o scrape atual). */
  let truncate = true;
  let batchSize = DEFAULT_BATCH_SIZE;
  let concurrency = DEFAULT_CONCURRENCY;
  /** @type {number | null} null = mesma que concurrency */
  let geocodeConcurrency = null;

  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--pages" || a === "-n") {
      maxPages = Math.max(1, parseInt(argv[++i], 10) || 1);
    } else if (a === "--detail-max") {
      const n = parseInt(argv[++i], 10);
      detailMax = Number.isFinite(n) ? Math.max(0, n) : null;
    } else if (a === "--out" || a === "-o") {
      const p = argv[++i];
      if (p) outPath = resolve(process.cwd(), p);
    } else if (a === "--stdout") {
      stdout = true;
    } else if (a === "--skip-geocode") {
      skipGeocode = true;
    } else if (a === "--no-db") {
      noDb = true;
    } else if (a === "--skip-migrate") {
      skipMigrate = true;
    } else if (a === "--no-truncate") {
      truncate = false;
    } else if (a === "--batch-size") {
      const n = parseInt(argv[++i], 10);
      if (Number.isFinite(n) && n > 0) batchSize = n;
    } else if (a === "--concurrency" || a === "-c") {
      const n = parseInt(argv[++i], 10);
      if (Number.isFinite(n) && n > 0) concurrency = n;
    } else if (a === "--geocode-concurrency") {
      const n = parseInt(argv[++i], 10);
      if (Number.isFinite(n) && n > 0) geocodeConcurrency = n;
    } else if (!a.startsWith("-")) {
      cliSearchUrl = a;
    }
  }

  return {
    cliSearchUrl,
    maxPages,
    detailMax,
    outPath,
    stdout,
    skipGeocode,
    noDb,
    skipMigrate,
    truncate,
    batchSize,
    concurrency,
    geocodeConcurrency: geocodeConcurrency ?? concurrency,
  };
}

// ---------------------------------------------------------------------------
// Enriquecimento por batch com concorrência
// ---------------------------------------------------------------------------

/**
 * Busca detalhes (descrição + endereço) de um batch de anúncios, in-place,
 * com `concurrency` requisições simultâneas.
 *
 * @param {Array<Record<string, unknown>>} batch
 * @param {number} globalOffset índice do primeiro elemento no array total
 * @param {number | null} detailMax
 * @param {number} concurrency
 */
async function enrichBatchWithDetails(batch, globalOffset, detailMax, concurrency) {
  await runConcurrent(batch, async (ad, j) => {
    const globalIdx = globalOffset + j;

    if (detailMax != null && globalIdx >= detailMax) {
      ad.descricao = "";
      ad.endereco = "";
      return;
    }

    try {
      // curl diretamente — evita o pool de conexões do fetch/undici que acumula
      // memória sob alta concorrência (OLX bloqueia fetch via Cloudflare de qualquer forma).
      const detailHtml = await fetchHtmlCurlOnly(ad.link, hasAdMarkup);
      ad.descricao = extractDescricao(detailHtml);
      ad.endereco = extractEndereco(detailHtml);
      // detailHtml sai de escopo — elegível para GC
    } catch (e) {
      ad.descricao = "";
      ad.endereco = "";
      console.error(`  [detalhe] falhou (${ad.link}): ${e.message || e}`);
    }
  }, concurrency);
}

/**
 * Geocodifica um batch de anúncios, in-place,
 * com `concurrency` requisições simultâneas ao ArcGIS.
 *
 * @param {Array<Record<string, unknown>>} batch
 * @param {number} globalOffset
 * @param {number} total
 * @param {number} concurrency
 */
async function enrichBatchWithGeocode(batch, globalOffset, total, concurrency) {
  await runConcurrent(batch, async (ad, j) => {
    const addr = ad.endereco && String(ad.endereco).trim();

    if (!addr) {
      ad.latitude = null;
      ad.longitude = null;
      ad.bairro = null;
      ad.cidade = null;
      ad.estado = null;
      return;
    }

    try {
      const geo = await geocodeEnderecoViaCurl(addr);
      ad.latitude = geo.latitude;
      ad.longitude = geo.longitude;
      ad.bairro = geo.bairro;
      ad.cidade = geo.cidade;
      ad.estado = geo.estado;
    } catch (e) {
      ad.latitude = null;
      ad.longitude = null;
      ad.bairro = null;
      ad.cidade = null;
      ad.estado = null;
      const gi = globalOffset + j + 1;
      console.error(
        `  [geocode] falhou [${gi}/${total}] (${addr.slice(0, 48)}…): ${e.message || e}`
      );
    }
  }, concurrency);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const {
    cliSearchUrl,
    maxPages,
    detailMax,
    outPath,
    stdout: printStdout,
    skipGeocode,
    noDb,
    skipMigrate,
    truncate,
    batchSize,
    concurrency,
    geocodeConcurrency,
  } = parseArgs(process.argv);

  const searchBases =
    cliSearchUrl != null && cliSearchUrl !== ""
      ? [cliSearchUrl]
      : [...RESEARCH_ARRAY];

  if (searchBases.length === 0) {
    console.error(
      "Nenhuma pesquisa: RESEARCH_ARRAY está vazio ou defina um URL posicional."
    );
    process.exit(1);
  }

  console.error(
    `[config] concurrency detalhes=${concurrency} | geocode=${geocodeConcurrency} | batch=${batchSize} | truncate=${truncate}`
  );

  // ── Fase 1: coleta de cartões em paralelo por URL de pesquisa ─────────────
  // Cada URL é coletada de forma independente; as páginas dentro de cada URL
  // permanecem sequenciais (é necessário a pág. 1 para saber o total de páginas).

  const chunks = await Promise.all(
    searchBases.map((base, si) =>
      collectListingAdsForSearchUrl(base, maxPages, si + 1, searchBases.length)
    )
  );

  const byCanonicalLink = new Map();
  let duplicateAcrossSearches = 0;

  for (const chunk of chunks) {
    for (const ad of chunk) {
      const key = canonicalAdLink(ad.link);
      if (!key) continue;
      if (byCanonicalLink.has(key)) {
        duplicateAcrossSearches++;
        continue;
      }
      byCanonicalLink.set(key, ad);
    }
  }

  if (duplicateAcrossSearches > 0) {
    console.error(
      `[dedupe link] ${duplicateAcrossSearches} cartão(ões) repetido(s) entre pesquisas.`
    );
  }

  const allAds = [...byCanonicalLink.values()];
  byCanonicalLink.clear();
  console.error(
    `[listagem] total ${allAds.length} anúncio(s) único(s) (${searchBases.length} pesquisa(s)).`
  );
  console.error(
    `[batch] ${Math.ceil(allAds.length / batchSize)} lote(s) de até ${batchSize} anúncios.`
  );

  // ── Fases 2-5: detalhes + geocode + regras + JSON/DB em batches ────────────

  const rulesState = createBusinessRulesState();

  // Conexão DB aberta uma única vez para todos os batches.
  let sql = null;
  const dbEnabled = !noDb && Boolean(process.env.DATABASE_URL);

  if (dbEnabled) {
    try {
      if (!skipMigrate) {
        await runMigrations();
      }
      const { openDbConnection, truncateAnuncios } = await import("./syncSupabase.mjs");
      sql = await openDbConnection(process.env.DATABASE_URL);
      if (truncate) {
        console.error("[DB] TRUNCATE anuncios (dados antigos removidos antes do sync)…");
        await truncateAnuncios(sql);
        console.error("[DB] Tabela anuncios vazia; a seguir inserção por batch.");
      }
    } catch (e) {
      if (e && e.code === "ERR_MODULE_NOT_FOUND") {
        console.error(
          '[DB] Pacote "postgres" em falta. Corre: cd rent_finder_scraper && npm install'
        );
      }
      throw e;
    }
  } else if (!noDb && !process.env.DATABASE_URL) {
    console.error(
      "[DB] DATABASE_URL não definida — use --no-db ou defina em rent_finder_front/.env.local."
    );
  }

  // JSON streaming: escreve incrementalmente para não acumular 20k objetos.
  const fh = await open(outPath, "w");
  await fh.write("[\n");
  let firstWritten = false;
  let totalFinalAds = 0;

  try {
    const totalBatches = Math.ceil(allAds.length / batchSize);

    for (let i = 0; i < allAds.length; i += batchSize) {
      const batchEnd = Math.min(i + batchSize, allAds.length);
      const batch = allAds.slice(i, batchEnd);
      const batchNum = Math.floor(i / batchSize) + 1;

      const t0 = Date.now();
      console.error(
        `\n[batch ${batchNum}/${totalBatches}] ${batch.length} anúncios (${i + 1}–${batchEnd} de ${allAds.length})`
      );

      // Detalhes — N requisições em paralelo
      console.error(`  → detalhes (concorrência: ${concurrency})…`);
      const t1 = Date.now();
      await enrichBatchWithDetails(batch, i, detailMax, concurrency);
      console.error(`     concluído em ${((Date.now() - t1) / 1000).toFixed(1)}s`);

      // Geocode — N requisições em paralelo
      if (!skipGeocode) {
        console.error(`  → geocode (concorrência: ${geocodeConcurrency})…`);
        const t2 = Date.now();
        await enrichBatchWithGeocode(batch, i, allAds.length, geocodeConcurrency);
        console.error(`     concluído em ${((Date.now() - t2) / 1000).toFixed(1)}s`);
      } else {
        for (const ad of batch) {
          ad.latitude = null;
          ad.longitude = null;
          ad.bairro = null;
          ad.cidade = null;
          ad.estado = null;
        }
      }

      // Regras de negócio (dedupe + flags) — estado persiste entre batches
      const finalBatch = runBusinessRulesPipelineWithState(batch, rulesState);
      totalFinalAds += finalBatch.length;

      // Escrita incremental no JSON
      for (const ad of finalBatch) {
        if (firstWritten) await fh.write(",\n");
        await fh.write(JSON.stringify(ad, null, 2));
        firstWritten = true;
      }

      // Upsert DB
      if (sql) {
        const { syncAdsBatch } = await import("./syncSupabase.mjs");
        const { synced } = await syncAdsBatch(sql, finalBatch);
        console.error(`  → DB: ${synced} anúncio(s) gravados/atualizados.`);
      }

      // Libera referências — permite GC nos objetos já processados
      for (let j = i; j < batchEnd; j++) {
        allAds[j] = null;
      }

      console.error(
        `  → batch concluído em ${((Date.now() - t0) / 1000).toFixed(1)}s`
      );
    }

    await fh.write("\n]");
    console.error(`\nWrote ${totalFinalAds} ads to ${outPath}`);

    if (printStdout) {
      const { readFile } = await import("node:fs/promises");
      console.log(await readFile(outPath, "utf8"));
    }

    if (sql) {
      console.error(`[DB] Supabase: sync concluído.`);
    }
  } finally {
    await fh.close();
    if (sql) {
      const { closeDbConnection } = await import("./syncSupabase.mjs");
      await closeDbConnection(sql);
    }
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
