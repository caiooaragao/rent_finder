import type { GeoJsonObject } from "geojson";

const NOMINATIM_SEARCH = "https://nominatim.openstreetmap.org/search";

const cache = new Map<string, GeoJsonObject | null>();

function buildCacheKey(cidade: string, estado: string) {
  return `city|${cidade}|${estado}`.toLowerCase();
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
  url.searchParams.set("limit", "1");

  try {
    const res = await fetch(url.toString(), {
      headers: { "User-Agent": "rent-finder/1.0" },
    });
    if (!res.ok) {
      cache.set(key, null);
      return null;
    }
    const data: Array<{ geojson?: GeoJsonObject }> = await res.json();
    const geojson = data[0]?.geojson ?? null;

    if (
      geojson &&
      "type" in geojson &&
      (geojson.type === "Polygon" || geojson.type === "MultiPolygon")
    ) {
      cache.set(key, geojson);
      return geojson;
    }

    cache.set(key, null);
    return null;
  } catch {
    cache.set(key, null);
    return null;
  }
}
