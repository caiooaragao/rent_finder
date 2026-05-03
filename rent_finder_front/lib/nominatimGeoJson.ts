import type {
  Feature,
  FeatureCollection,
  GeoJsonObject,
  Geometry,
} from "geojson";

function isPolygonLikeGeometry(g: Geometry | null): boolean {
  return (
    g != null &&
    (g.type === "Polygon" || g.type === "MultiPolygon")
  );
}

/**
 * Nominatim devolve muitas vezes um `Feature` com `geometry` poligonal, não um `Polygon` raiz.
 * O Leaflet aceita Feature / Polygon / MultiPolygon / FeatureCollection.
 */
export function normalizePolygonalGeoJson(
  raw: GeoJsonObject | null | undefined,
): GeoJsonObject | null {
  if (!raw || typeof raw !== "object" || !("type" in raw)) return null;

  if (raw.type === "Polygon" || raw.type === "MultiPolygon") {
    return raw;
  }

  if (raw.type === "Feature") {
    const f = raw as Feature;
    if (isPolygonLikeGeometry(f.geometry)) return raw;
    return null;
  }

  if (raw.type === "FeatureCollection") {
    const fc = raw as FeatureCollection;
    for (const feat of fc.features) {
      if (feat && isPolygonLikeGeometry(feat.geometry)) return feat as GeoJsonObject;
    }
  }

  return null;
}
