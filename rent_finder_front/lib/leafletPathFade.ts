import L from "leaflet";
import { GEOJSON_FADE_MS } from "@/lib/leafletGeoJsonFade";

export function fadeInPath(
  path: L.Path,
  durationMs = GEOJSON_FADE_MS,
): void {
  const el = path.getElement?.() as HTMLElement | SVGElement | undefined;
  if (!el) return;
  el.style.willChange = "opacity";
  el.style.transition = `opacity ${durationMs}ms ease-in-out`;
  el.style.opacity = "0";
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      el.style.opacity = "1";
    });
  });
}

export function fadeOutPathThenRemove(
  path: L.Path,
  map: L.Map,
  durationMs = GEOJSON_FADE_MS,
): Promise<void> {
  return new Promise((resolve) => {
    const el = path.getElement?.() as HTMLElement | SVGElement | undefined;
    if (el) {
      el.style.willChange = "opacity";
      el.style.transition = `opacity ${durationMs}ms ease-in-out`;
      el.style.opacity = "0";
    }
    window.setTimeout(() => {
      try {
        if (map.hasLayer(path)) map.removeLayer(path);
      } catch {
        /* ignore */
      }
      resolve();
    }, durationMs);
  });
}
