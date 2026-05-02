import L from "leaflet";

/** Duração padrão — ease-in-out via CSS transition */
export const GEOJSON_FADE_MS = 340;

function forEachPathElement(
  layer: L.GeoJSON,
  fn: (el: HTMLElement) => void,
): void {
  layer.eachLayer((ly) => {
    const path = ly as L.Path;
    const el = path.getElement?.();
    if (el) fn(el as HTMLElement);
  });
}

export function fadeInGeoJsonLayer(
  layer: L.GeoJSON,
  durationMs = GEOJSON_FADE_MS,
): void {
  forEachPathElement(layer, (el) => {
    el.style.willChange = "opacity";
    el.style.transition = `opacity ${durationMs}ms ease-in-out`;
    el.style.opacity = "0";
  });
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      forEachPathElement(layer, (el) => {
        el.style.opacity = "1";
      });
    });
  });
}

export function fadeOutGeoJsonLayerThenRemove(
  layer: L.GeoJSON,
  map: L.Map,
  durationMs = GEOJSON_FADE_MS,
): Promise<void> {
  return new Promise((resolve) => {
    forEachPathElement(layer, (el) => {
      el.style.willChange = "opacity";
      el.style.transition = `opacity ${durationMs}ms ease-in-out`;
      el.style.opacity = "0";
    });
    window.setTimeout(() => {
      try {
        if (map.hasLayer(layer)) map.removeLayer(layer);
      } catch {
        /* ignore */
      }
      resolve();
    }, durationMs);
  });
}
