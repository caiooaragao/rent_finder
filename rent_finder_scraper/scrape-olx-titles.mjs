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
const OLX_COOKIE_JAR = join(__dirname, ".olx-curl-cookies.txt");
const NULL_DEVICE = process.platform === "win32" ? "NUL" : "/dev/null";
const SCRAPE_PROXY = process.env.OLX_SCRAPE_PROXY?.trim() || "";
const JINA_FALLBACK = process.env.OLX_SCRAPE_DISABLE_JINA !== "1";
const JINA_LISTING_PREFIX = "<!--OLX_JINA_LISTING:";
const JINA_MAX_CONCURRENT = Math.max(
  1,
  parseInt(process.env.OLX_SCRAPE_JINA_CONCURRENCY ?? "2", 10) || 2
);
const JINA_MAX_RETRIES = Math.max(
  1,
  parseInt(process.env.OLX_SCRAPE_JINA_RETRIES ?? "3", 10) || 3
);

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

let olxSessionWarmed = false;
let jinaInFlight = 0;
/** @type {Array<() => void>} */
const jinaWaitQueue = [];

/** @param {number} ms */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Limita chamadas simultâneas à Jina (evita rate limit no tier gratuito).
 * @template T
 * @param {() => Promise<T>} fn
 */
async function withJinaSlot(fn) {
  if (jinaInFlight >= JINA_MAX_CONCURRENT) {
    await new Promise((resolve) => jinaWaitQueue.push(resolve));
  }
  jinaInFlight++;
  try {
    return await fn();
  } finally {
    jinaInFlight--;
    const next = jinaWaitQueue.shift();
    if (next) next();
  }
}

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
  const jina = unwrapJinaListingResult(html);
  if (jina?.ads?.length) return jina.ads;

  const fromNext = extractAdsFromNextData(html);
  if (fromNext.length) return fromNext;

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
  const jina = unwrapJinaListingResult(html);
  if (jina) {
    return {
      totalOfAds: Number(jina.totalOfAds) || jina.ads.length,
      pageSize: Number(jina.pageSize) || jina.ads.length || 50,
    };
  }

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

/** @param {string} html */
function parseNextData(html) {
  const block = html.match(
    /<script id="__NEXT_DATA__"[^>]*>([^<]+)<\/script>/
  );
  if (!block) return null;
  try {
    return JSON.parse(block[1]);
  } catch {
    return null;
  }
}

/** @param {Record<string, unknown>} ad */
function formatOlxPrice(ad) {
  const raw = ad.priceValue ?? ad.price;
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return `R$ ${raw.toLocaleString("pt-BR")}`;
  }
  if (typeof raw === "string" && raw.trim()) return raw.trim();
  return "";
}

/** @param {Record<string, unknown>} ad */
function adUrlFromNext(ad) {
  const raw = ad.friendlyUrl ?? ad.url ?? "";
  if (typeof raw !== "string" || !raw.trim()) return "";
  const s = raw.trim();
  if (s.startsWith("http")) return s;
  return `${OLX_ORIGIN}${s.startsWith("/") ? s : `/${s}`}`;
}

/** @param {string} html */
function extractAdsFromNextData(html) {
  const data = parseNextData(html);
  const ads = data?.props?.pageProps?.ads;
  if (!Array.isArray(ads) || ads.length === 0) return [];

  const out = [];
  for (const ad of ads) {
    if (!ad || typeof ad !== "object") continue;
    if (!ad.listId) continue;
    const titulo = String(ad.subject ?? ad.title ?? "").trim();
    const link = adUrlFromNext(ad);
    if (!titulo || !link) continue;
    out.push({ titulo, preco: formatOlxPrice(ad), link });
  }
  return out;
}

function hasListingData(html) {
  if (typeof html !== "string" || html.length < 500) return false;
  if (html.startsWith(JINA_LISTING_PREFIX)) return true;
  if (hasListingMarkup(html)) return true;
  return extractAdsFromNextData(html).length > 0;
}

/** @param {string | undefined} html */
function describeBlockedHtml(html) {
  if (typeof html !== "string" || html.length === 0) return "resposta vazia";
  const title = html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]?.trim() ?? "";
  if (
    /cloudflare|attention required|just a moment/i.test(html) ||
    /cf-browser-verification/i.test(html)
  ) {
    return "bloqueio Cloudflare (VPS/datacenter costuma ser barrado — use OLX_SCRAPE_PROXY ou Jina)";
  }
  if (/access denied|forbidden/i.test(html)) return "acesso negado pela OLX";
  if (title) return `sem listagem (title: ${title.slice(0, 80)})`;
  return `sem __NEXT_DATA__ (${html.length} bytes)`;
}

/**
 * @param {{ ads: Array<{ titulo: string; preco: string; link: string }>; totalOfAds: number; pageSize: number }} parsed
 */
function wrapJinaListingResult(parsed) {
  return `${JINA_LISTING_PREFIX}${JSON.stringify(parsed)}-->`;
}

/** @param {string} html */
function unwrapJinaListingResult(html) {
  if (!html.startsWith(JINA_LISTING_PREFIX)) return null;
  const end = html.indexOf("-->", JINA_LISTING_PREFIX.length);
  if (end === -1) return null;
  try {
    return JSON.parse(html.slice(JINA_LISTING_PREFIX.length, end));
  } catch {
    return null;
  }
}

/** @param {string} md */
function parseSearchMarkdown(md) {
  const cut = md.search(/##\s*Você pode gostar/i);
  const mdBusca = cut >= 0 ? md.slice(0, cut) : md;

  let totalOfAds = 0;
  const mt = mdBusca.match(/de\s+(\d+)\s+resultados?/i);
  if (mt) totalOfAds = parseInt(mt[1], 10);

  const pattern =
    /## \[([^\]]+)\]\((https?:\/\/[^\s)"]+)[^)]*\)\s*([\s\S]*?)Adicionar aos favoritos/g;
  const ads = [];
  const seen = new Set();

  let m;
  while ((m = pattern.exec(mdBusca))) {
    const titulo = m[1].trim();
    const link = m[2].trim();
    if (link.includes("top_ads")) continue;
    const idm = link.match(/\/(\d{8,})(?:\?|$|-)/);
    const id = idm ? idm[1] : link;
    if (seen.has(id)) continue;
    seen.add(id);
    const bloco = m[3];
    const precoM = bloco.match(/R\$\s*([\d.,]+)/);
    const preco = precoM ? `R$ ${precoM[1]}` : "";
    ads.push({ titulo, preco, link });
  }

  return {
    ads,
    totalOfAds: totalOfAds || ads.length,
    pageSize: ads.length || 50,
  };
}

function buildCurlBaseArgs(referer = `${OLX_ORIGIN}/`) {
  /** @type {string[]} */
  const args = [
    "-sSL",
    "--compressed",
    "-A",
    UA,
    "--max-time",
    "90",
    "-b",
    OLX_COOKIE_JAR,
    "-c",
    OLX_COOKIE_JAR,
    "-H",
    "Accept: text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "-H",
    "Accept-Language: pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
    "-H",
    `Referer: ${referer}`,
    "-H",
    "Upgrade-Insecure-Requests: 1",
    "-H",
    "Sec-Fetch-Dest: document",
    "-H",
    "Sec-Fetch-Mode: navigate",
    "-H",
    "Sec-Fetch-Site: same-origin",
    "-H",
    "Sec-Fetch-User: ?1",
  ];
  if (SCRAPE_PROXY) args.push("--proxy", SCRAPE_PROXY);
  return args;
}

async function ensureOlxSession() {
  if (olxSessionWarmed) return;
  const args = [
    ...buildCurlBaseArgs("https://www.google.com/"),
    "-o",
    NULL_DEVICE,
    `${OLX_ORIGIN}/`,
  ];
  try {
    await execFileAsync("curl", args, {
      maxBuffer: CURL_MAX_BUFFER,
      encoding: "utf8",
    });
    olxSessionWarmed = true;
  } catch {
    // warm-up opcional
  }
}

/** @param {string} line */
function looksLikeOlxAddress(line) {
  const s = line.trim();
  if (!s || s.length < 8) return false;
  if (/^fechar|exibir no mapa|publicidade/i.test(s)) return false;
  return /,/.test(s) || /\b[A-Z]{2}\b/.test(s) || /\d{5}-?\d{3}/.test(s);
}

/** @param {string} md */
function jinaDetailScope(md) {
  const footer = md.search(/\nC[oó]digo do an[uú]ncio:\s*\d+\s*\n+Apartamentos Casas/i);
  if (footer > 0) return md.slice(0, footer);
  const denuncia = md.search(/\nDenunciar an[uú]ncio/i);
  if (denuncia > 0) return md.slice(0, denuncia);
  return md;
}

/** @param {string} scope */
function extractDescriptionFromJinaScope(scope) {
  const descHeading = scope.match(
    /##\s*Descri[çc][ãa]o\s*([\s\S]*?)(?:##|\n\* \* \*|\nLocaliza[cç][aã]o)/i
  );
  if (descHeading) {
    const text = stripMarkdownPlainText(descHeading[1]);
    if (text.length >= 20) return text;
  }

  const mapBlock = scope.match(/Mapa\s*\n+([\s\S]*?)Ver descri[cç][aã]o completa/i);
  if (mapBlock) {
    const lines = mapBlock[1]
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !/^\*\s+/.test(l));
    let start = 0;
    if (
      lines[0] &&
      lines[0].length < 100 &&
      lines[0] === lines[0].toUpperCase() &&
      !lines[0].includes(".")
    ) {
      start = 1;
    }
    const text = stripMarkdownPlainText(lines.slice(start).join("\n"));
    if (text.length >= 20) return text;
  }

  const inlineCodigo = scope.match(
    /C[oó]digo do an[uú]ncio:\s*[^\n]+\s*([\s\S]*?)(?:Ver descri[cç][aã]o completa|(?:^|\n)Localiza[cç][aã]o)/im
  );
  if (inlineCodigo) {
    const text = stripMarkdownPlainText(inlineCodigo[1]);
    if (text.length >= 20) return text;
  }

  const bulletTail = scope.match(
    /(?:\*[^\n]*\n)+([^\n*#][\s\S]*?)(?:\n\* \* \*|\nLocaliza[cç][aã]o)/i
  );
  if (bulletTail) {
    const text = stripMarkdownPlainText(bulletTail[1]);
    if (text.length >= 10) return text;
  }

  return "";
}

/** @param {string} md */
function parseAdDetailMarkdown(md) {
  if (!md || md.length < 200) return { descricao: "", endereco: "" };

  const scope = jinaDetailScope(md);
  const descricao = extractDescriptionFromJinaScope(scope);

  let endereco = "";
  const locHeading = scope.match(/##\s*Localiza[çc][ãa]o\s*([\s\S]*?)(?:##|\n\* \* \*)/i);
  if (locHeading) {
    endereco =
      stripMarkdownPlainText(locHeading[1])
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean)[0] ?? "";
  }
  if (!endereco) {
    const locPlain = /(?:^|\n)Localiza[cç][aã]o\s*\n+([^\n]+)/gim;
    let m;
    while ((m = locPlain.exec(scope))) {
      const candidate = stripMarkdownPlainText(m[1]);
      if (looksLikeOlxAddress(candidate)) {
        endereco = candidate;
        break;
      }
    }
  }

  return { descricao, endereco };
}

/** @param {string} text */
function stripMarkdownPlainText(text) {
  return text
    .replace(/!\[[^\]]*\]\([^)]+\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/^#+\s*/gm, "")
    .replace(/[*_`>-]/g, "")
    .trim();
}

/** @param {string} url */
async function fetchAdDetail(url) {
  try {
    const detailHtml = await fetchHtmlCurlOnly(url, hasAdMarkup);
    return {
      descricao: extractDescricao(detailHtml),
      endereco: extractEndereco(detailHtml),
    };
  } catch (e) {
    if (!JINA_FALLBACK) throw e;
    const md = await fetchMarkdownViaJina(url);
    const parsed = parseAdDetailMarkdown(md);
    if (!parsed.descricao && !parsed.endereco) {
      throw new Error(`Jina não retornou detalhes do anúncio (${md.length} bytes)`);
    }
    return parsed;
  }
}

/** Ad detail pages do not ship __NEXT_DATA__; rely on HTML marker. */
function hasAdMarkup(html) {
  return (
    typeof html === "string" &&
    html.length > 5000 &&
    html.includes('data-page-name="ad_detail"')
  );
}

async function fetchHtmlViaCurl(url, referer = `${OLX_ORIGIN}/`) {
  await ensureOlxSession();
  const { stdout } = await execFileAsync(
    "curl",
    [...buildCurlBaseArgs(referer), url],
    { maxBuffer: CURL_MAX_BUFFER, encoding: "utf8" }
  );
  return stdout;
}

/** @param {string | undefined} md */
function jinaMarkdownLooksValid(md) {
  if (!md || md.length < 500) return false;
  const head = md.slice(0, 800).toLowerCase();
  if (/rate limit|too many requests|unauthorized|error 4\d\d|error 5\d\d/.test(head)) {
    return false;
  }
  return /olx\.com\.br|localiza/i.test(md);
}

/** @param {string} url */
async function fetchMarkdownViaJinaOnce(url) {
  const jinaUrl = `https://r.jina.ai/${url}`;
  /** @type {string[]} */
  const headers = ["Accept: text/markdown", "X-Return-Format: markdown"];
  const jinaKey = process.env.JINA_API_KEY?.trim();
  if (jinaKey) headers.push(`Authorization: Bearer ${jinaKey}`);

  const args = ["-sSL", "--max-time", "120"];
  for (const h of headers) args.push("-H", h);
  args.push(jinaUrl);

  const { stdout } = await execFileAsync("curl", args, {
    maxBuffer: CURL_MAX_BUFFER,
    encoding: "utf8",
  });
  return stdout;
}

/** @param {string} url */
async function fetchMarkdownViaJina(url) {
  return withJinaSlot(async () => {
    /** @type {unknown} */
    let lastErr;
    for (let attempt = 1; attempt <= JINA_MAX_RETRIES; attempt++) {
      try {
        const md = await fetchMarkdownViaJinaOnce(url);
        if (!jinaMarkdownLooksValid(md)) {
          throw new Error(`resposta inválida (${md?.length ?? 0} bytes)`);
        }
        return md;
      } catch (e) {
        lastErr = e;
        if (attempt < JINA_MAX_RETRIES) await sleep(800 * attempt);
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error("Jina falhou após tentativas");
  });
}

/** @param {string} url */
async function fetchListingViaJina(url) {
  const md = await fetchMarkdownViaJina(url);
  const parsed = parseSearchMarkdown(md);
  if (!parsed.ads.length) {
    throw new Error("Jina não retornou anúncios na listagem");
  }
  return parsed;
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
    `Could not load valid HTML for ${url} (${describeBlockedHtml(text)}).`
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
    "accept-language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
    accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    referer: `${OLX_ORIGIN}/`,
  };

  /** @type {string | undefined} */
  let lastText;

  try {
    const res = await fetch(url, { headers });
    const text = await res.text();
    lastText = text;
    if (res.ok && isValid(text)) return text;
  } catch {
    // cai no curl
  }

  try {
    const text = await fetchHtmlViaCurl(url);
    lastText = text;
    if (isValid(text)) return text;
  } catch {
    // tenta Jina abaixo
  }

  if (JINA_FALLBACK && isValid === hasListingData) {
    console.error(`[fetch] OLX direto falhou para ${url}; tentando via Jina…`);
    try {
      const parsed = await fetchListingViaJina(url);
      return wrapJinaListingResult(parsed);
    } catch (e) {
      const hint = e && e.message ? ` | Jina: ${e.message}` : "";
      throw new Error(
        `Could not load valid HTML for ${url} (${describeBlockedHtml(lastText)}).${hint}`
      );
    }
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
  const firstHtml = await fetchHtml(url, hasListingData);
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
        html = await fetchHtml(pageUrl, hasListingData);
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
      const detail = await fetchAdDetail(ad.link);
      ad.descricao = detail.descricao;
      ad.endereco = detail.endereco;
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
    `[config] concurrency detalhes=${concurrency} | geocode=${geocodeConcurrency} | jina=${JINA_MAX_CONCURRENT} | batch=${batchSize} | truncate=${truncate}`
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
