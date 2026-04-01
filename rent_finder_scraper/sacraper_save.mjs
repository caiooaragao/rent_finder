#!/usr/bin/env node
/**
 * Fetches an OLX listing URL and prints JSON objects per ad:
 *   { titulo, preco, link, descricao, endereco, latitude, longitude }
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
 * Usage:
 *   node scrape-olx-titles.mjs
 *   node scrape-olx-titles.mjs "https://www.olx.com.br/estado-pe?q=kitnet"
 *   node scrape-olx-titles.mjs --pages 1   # first page only
 *   node scrape-olx-titles.mjs --detail-max 5   # only fetch details for first 5 ads
 *   node scrape-olx-titles.mjs --out resultados.json
 *   node scrape-olx-titles.mjs --stdout   # also print JSON to stdout
 *   node scrape-olx-titles.mjs --skip-geocode   # não chama o ArcGIS após o scrape
 */

import { execFile } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const DEFAULT_URL = "https://www.olx.com.br/estado-pe?q=kitnet";

const DEFAULT_OUT = "olx-scrape.json";

const CURL_MAX_BUFFER = 15 * 1024 * 1024;

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

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
  const re =
    /<h2[^>]*\bclass\s*=\s*["']([^"']*)["'][^>]*>([^<]*)<\/h2>/gi;
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
  const re =
    /<h3[^>]*\bclass\s*=\s*["']([^"']*)["'][^>]*>([^<]*)<\/h3>/gi;
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
  if (
    titulos.length !== precos.length ||
    titulos.length !== links.length
  ) {
    console.error(
      `Warning: ${titulos.length} titles, ${precos.length} prices, ${links.length} links; pairing first ${n}.`
    );
  }
  const ads = [];
  for (let i = 0; i < n; i++) {
    ads.push({
      titulo: titulos[i],
      preco: precos[i],
      link: links[i],
    });
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

const GEOCODE_DELAY_MS = 350;

/**
 * Geocodifica um endereço com ArcGIS REST (findAddressCandidates) usando curl.
 * @returns {{ latitude: number | null, longitude: number | null }}
 */
async function geocodeEnderecoViaCurl(singleLine) {
  const line = typeof singleLine === "string" ? singleLine.trim() : "";
  if (!line) {
    return { latitude: null, longitude: null };
  }

  const u = new URL(ARCGIS_GEOCODE);
  u.searchParams.set("f", "json");
  u.searchParams.set("singleLine", line);

  const url = u.toString();

  let stdout;
  try {
    const out = await execFileAsync(
      "curl",
      ["-sS", "-L", "-A", UA, "--max-time", "45", url],
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
    return { latitude: null, longitude: null };
  }

  const loc = candidates[0].location;
  if (!loc || typeof loc.x !== "number" || typeof loc.y !== "number") {
    return { latitude: 0, longitude: 0 };
  }

  // ArcGIS WGS84: x = longitude, y = latitude
  return { latitude: loc.y, longitude: loc.x };
}

/**
 * @param {string} url
 * @param {(html: string) => boolean} isValid
 */
async function fetchHtml(url, isValid) {
  const headers = {
    "user-agent": UA,
    "accept-language": "pt-BR,pt;q=0.9",
    accept:
      "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  };

  let text = "";
  try {
    const res = await fetch(url, { headers });
    text = await res.text();
    if (res.ok && isValid(text)) return text;
  } catch {
    // try curl
  }

  try {
    text = await fetchHtmlViaCurl(url);
    if (isValid(text)) return text;
  } catch (e) {
    const hint = e && e.message ? `: ${e.message}` : "";
    throw new Error(`curl failed for ${url}${hint}`);
  }

  throw new Error(
    `Could not load valid HTML for ${url} (blocked or layout changed). Try again or install curl.`
  );
}

function parseArgs(argv) {
  let url = DEFAULT_URL;
  let maxPages = null;
  /** @type {number | null} */
  let detailMax = null;
  let outPath = resolve(process.cwd(), DEFAULT_OUT);
  let stdout = false;
  let skipGeocode = false;

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
    } else if (!a.startsWith("-")) {
      url = a;
    }
  }

  return { url, maxPages, detailMax, outPath, stdout, skipGeocode };
}

async function main() {
  const { url, maxPages, detailMax, outPath, stdout, skipGeocode } = parseArgs(
    process.argv
  );

  const firstHtml = await fetchHtml(url, hasListingMarkup);
  const { totalOfAds, pageSize } = readListingMeta(firstHtml);
  const estimatedPages =
    totalOfAds > 0 && pageSize > 0
      ? Math.ceil(totalOfAds / pageSize)
      : 1;

  const pageLimit = maxPages != null ? maxPages : estimatedPages;

  const allAds = [];

  for (let page = 1; page <= pageLimit; page++) {
    const pageUrl = page === 1 ? url : buildPageUrl(url, page);
    const html =
      page === 1 ? firstHtml : await fetchHtml(pageUrl, hasListingMarkup);
    const ads = extractAds(html);
    if (page > 1 && ads.length === 0) break;
    allAds.push(...ads);

    if (page < pageLimit) {
      await new Promise((r) => setTimeout(r, 400));
    }
  }

  for (let i = 0; i < allAds.length; i++) {
    const ad = allAds[i];
    if (detailMax != null && i >= detailMax) {
      ad.descricao = "";
      ad.endereco = "";
      continue;
    }
    try {
      const detailHtml = await fetchHtml(ad.link, hasAdMarkup);
      ad.descricao = extractDescricao(detailHtml);
      ad.endereco = extractEndereco(detailHtml);
    } catch (e) {
      ad.descricao = "";
      ad.endereco = "";
      console.error(`Ad detail failed (${ad.link}): ${e.message || e}`);
    }
    if (i < allAds.length - 1) {
      await new Promise((r) => setTimeout(r, 450));
    }
  }

  if (!skipGeocode) {
    console.error(
      `Geocoding ${allAds.length} addresses (ArcGIS, ~${GEOCODE_DELAY_MS}ms between requests)...`
    );
    let geocodeOk = 0;
    for (let i = 0; i < allAds.length; i++) {
      const ad = allAds[i];
      const addr = ad.endereco && String(ad.endereco).trim();
      if (!addr) {
        ad.latitude = null;
        ad.longitude = null;
        continue;
      }
      try {
        const { latitude, longitude } = await geocodeEnderecoViaCurl(addr);
        ad.latitude = latitude;
        ad.longitude = longitude;
        if (latitude != null && longitude != null) geocodeOk++;
      } catch (e) {
        ad.latitude = null;
        ad.longitude = null;
        console.error(
          `  [${i + 1}/${allAds.length}] geocode falhou (${addr.slice(0, 48)}…): ${e.message || e}`
        );
      }
      if (i < allAds.length - 1) {
        await new Promise((r) => setTimeout(r, GEOCODE_DELAY_MS));
      }
    }
    console.error(`Geocoding concluído: ${geocodeOk}/${allAds.length} com latitude/longitude.`);
  } else {
    for (const ad of allAds) {
      ad.latitude = null;
      ad.longitude = null;
    }
    console.error("Geocoding skipped (--skip-geocode); latitude/longitude set to null.");
  }

  const payload = JSON.stringify(allAds, null, 2);
  await writeFile(outPath, payload, "utf8");
  console.error(`Wrote ${allAds.length} ads to ${outPath}`);
  if (stdout) {
    console.log(payload);
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
