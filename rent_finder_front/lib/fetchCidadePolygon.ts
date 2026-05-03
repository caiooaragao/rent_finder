import type { GeoJsonObject } from "geojson";
import { normalizePolygonalGeoJson } from "@/lib/nominatimGeoJson";

const NOMINATIM_SEARCH = "https://nominatim.openstreetmap.org/search";

const cache = new Map<string, GeoJsonObject | null>();

function buildCacheKey(cidade: string, estado: string) {
  return `v2|city|${cidade}|${estado}`.toLowerCase();
}

/**
 * Polígono administrativo da cidade (Nominatim). `estado` melhora a precisão (ex.: PE).
 */
export async function fetchCidadePolygon(
  cidade: string | null | undefined,
  estado: string | null | undefined,
): Promise<GeoJsonObject | null> {
  const c = cidade?.trim();
  if (!c) return null;

  const e = estado?.trim() ?? "";
  const key = buildCacheKey(c, e);
  if (cache.has(key)) return cache.get(key) ?? null;

  const q = [c, e, "Brazil"].filter(Boolean).join(", ");
  const url = new URL(NOMINATIM_SEARCH);
  url.searchParams.set("q", q);
  url.searchParams.set("format", "json");
  url.searchParams.set("polygon_geojson", "1");
  /** Vários hits — o primeiro pode vir só como place ou sem polígono detalhado. */
  url.searchParams.set("limit", "10");

  try {
    const res = await fetch(url.toString(), {
      headers: { "User-Agent": "rent-finder/1.0 (cidade polygon)" },
    });
    if (!res.ok) {
      cache.set(key, null);
      return null;
    }
    const data: Array<{ geojson?: GeoJsonObject }> = await res.json();

    for (const row of data) {
      const normalized = normalizePolygonalGeoJson(row.geojson);
      if (normalized) {
        cache.set(key, normalized);
        return normalized;
      }
    }

    cache.set(key, null);
    return null;
  } catch {
    cache.set(key, null);
    return null;
  }
}
