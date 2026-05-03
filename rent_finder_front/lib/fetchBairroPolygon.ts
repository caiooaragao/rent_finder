import type { GeoJsonObject, Polygon } from "geojson";
import { normalizePolygonalGeoJson } from "@/lib/nominatimGeoJson";

const NOMINATIM_SEARCH = "https://nominatim.openstreetmap.org/search";

const cache = new Map<string, GeoJsonObject | null>();

function buildCacheKey(bairro: string, cidade: string, estado: string) {
  /** `v2`: aceitar geojson tipo Feature do Nominatim — invalida cache antigo null. */
  return `v2|${bairro}|${cidade}|${estado}`.toLowerCase();
}

function isPointGeoJson(g: GeoJsonObject): boolean {
  return "type" in g && g.type === "Point";
}

/** Nominatim devolve muitos bairros só como node (Point); `boundingbox` vira retângulo aproximado. */
function boundingBoxToPolygon(south: number, north: number, west: number, east: number): Polygon {
  return {
    type: "Polygon",
    coordinates: [
      [
        [west, south],
        [east, south],
        [east, north],
        [west, north],
        [west, south],
      ],
    ],
  };
}

type NominatimRow = {
  geojson?: GeoJsonObject;
  boundingbox?: string[];
};

/** Política Nominatim (uso público): ~1 pedido por segundo — espaço entre inícios de tentativas. */
const NOMINATIM_MIN_GAP_MS = 1000;

/**
 * Ordem otimizada para escolha no autocomplete: nome do bairro primeiro (costuma acertar já na 1.ª request).
 * Depois plural/singular; por último variantes do endereço (casos em que o texto OLX difere do OSM).
 */
function bairroQueryVariants(
  bairro: string,
  enderecoFallback?: string | null,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();

  const push = (s: string | null | undefined) => {
    const t = s?.trim();
    if (t && t.length >= 2) {
      const k = t.toLowerCase();
      if (!seen.has(k)) {
        seen.add(k);
        out.push(t);
      }
    }
  };

  const bNorm = bairro.trim().toLowerCase();
  push(bairro);
  const b = bairro.trim();
  if (b.length > 3 && b.endsWith("s")) push(b.slice(0, -1));

  if (enderecoFallback) {
    const first = enderecoFallback.split(",")[0]?.trim();
    if (first && first.toLowerCase() !== bNorm) {
      push(first);
      if (first.length > 3 && first.endsWith("s")) push(first.slice(0, -1));
    }
  }

  return out.slice(0, 3);
}

async function nominatimSearchFirstPolygon(
  bairro: string,
  cidade: string,
  estado: string,
): Promise<GeoJsonObject | null> {
  const q = [bairro, cidade, estado, "Brazil"].filter(Boolean).join(", ");
  const url = new URL(NOMINATIM_SEARCH);
  url.searchParams.set("q", q);
  url.searchParams.set("format", "json");
  url.searchParams.set("polygon_geojson", "1");
  url.searchParams.set("limit", "10");
  url.searchParams.set("countrycodes", "br");

  const res = await fetch(url.toString(), {
    headers: { "User-Agent": "rent-finder/1.0 (bairro polygon)" },
  });
  if (!res.ok) return null;

  const data: NominatimRow[] = await res.json();

  for (const row of data) {
    const g = row.geojson;
    const normalized = normalizePolygonalGeoJson(g);
    if (normalized) return normalized;
  }

  for (const row of data) {
    const g = row.geojson;
    const bb = row.boundingbox;
    if (g && isPointGeoJson(g) && bb?.length === 4) {
      const [s, n, w, e] = bb.map(Number);
      if ([s, n, w, e].every((x) => Number.isFinite(x))) {
        return boundingBoxToPolygon(s, n, w, e);
      }
    }
  }

  return null;
}

/**
 * Busca o polígono de um bairro via Nominatim (OpenStreetMap).
 * Tenta variantes de nome e vários resultados — o 1.º hit costuma vir sem polígono.
 *
 * @param enderecoFallback — ex. `listing.endereco`: 1.º trecho antes da vírgula ajuda quando o campo `bairro` difere do OSM.
 */
export async function fetchBairroPolygon(
  bairro: string | null | undefined,
  cidade: string | null | undefined,
  estado: string | null | undefined,
  enderecoFallback?: string | null,
): Promise<GeoJsonObject | null> {
  const b = bairro?.trim();
  const c = cidade?.trim();
  if (!b || !c) return null;

  const e = estado?.trim() ?? "";
  const key = buildCacheKey(b, c, e);
  if (cache.has(key)) return cache.get(key) ?? null;

  const variants = bairroQueryVariants(b, enderecoFallback);

  try {
    let lastAttemptStart = 0;
    for (let i = 0; i < variants.length; i++) {
      if (i > 0) {
        const wait = Math.max(
          0,
          lastAttemptStart + NOMINATIM_MIN_GAP_MS - Date.now(),
        );
        if (wait > 0)
          await new Promise((r) => setTimeout(r, wait));
      }
      lastAttemptStart = Date.now();
      const geojson = await nominatimSearchFirstPolygon(variants[i], c, e);
      if (geojson) {
        cache.set(key, geojson);
        return geojson;
      }
    }
  } catch {
    /* ignore */
  }

  cache.set(key, null);
  return null;
}
