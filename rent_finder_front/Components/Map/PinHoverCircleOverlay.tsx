"use client";

/**
 * Círculo (halo) no mapa ao passar o rato sobre um pin.
 *
 * ## Personalizar aparência (CSS)
 *
 * 1. **Variáveis** — em `theme/colors.css`: `--rf-pin-hover-circle-fill`,
 *    `--rf-pin-hover-circle-stroke`, `--rf-pin-hover-circle-stroke-width` (e fallbacks Leaflet).
 *    O **tamanho no mapa** (raio real no terreno) é a prop `radiusMeters` deste componente.
 *
 * 2. **Seletor do path SVG** — o Leaflet desenha o círculo como `<path class="…">`
 *    no painel de overlay. O seletor padrão é:
 *    `.leaflet-overlay-pane path.pin-hover-circle`
 *    Use `className` neste componente para um modificador, ex.:
 *    `className="pin-hover-circle pin-hover-circle--destaque"` e estilize
 *    `.pin-hover-circle--destaque { … }`.
 *
 * 3. **Propriedades úteis no path** (SVG):
 *    - `fill` — preenchimento (use `fill-opacity` separado se quiser)
 *    - `stroke` / `stroke-width` / `stroke-dasharray` — contorno tracejado, etc.
 *    - `opacity` — transparência global (o fade-in/out também anima `opacity` inline;
 *      evite conflitos deixando transições só no nosso efeito ou use `fill-opacity`)
 *
 * 4. **Raio geográfico** — prop `radiusMeters` (não CSS): tamanho real do círculo
 *    no terreno em metros.
 */

import * as React from "react";
import L from "leaflet";
import { useMap } from "react-leaflet";
import { fadeInPath, fadeOutPathThenRemove } from "@/lib/leafletPathFade";

export interface PinHoverCircleOverlayProps {
  /** Centro do círculo; `null` esconde e remove a camada */
  center: { lat: number; lng: number } | null;
  /** Raio em metros no solo (padrão ~120 m — visível em zoom urbano) */
  radiusMeters?: number;
  /**
   * Classe no elemento `<path>` do Leaflet (além da base `pin-hover-circle`).
   * Útil para temas ou BEM.
   */
  className?: string;
}

const BASE_CLASS = "pin-hover-circle";

/** Opções Leaflet — cores aqui são fallback; o visual principal vem do globals.css */
const PATH_FALLBACK: L.PathOptions = {
  color: "var(--rf-map-pin-hover-stroke)",
  weight: 2,
  opacity: 1,
  fillColor: "var(--rf-map-pin-hover-fill)",
  fillOpacity: 0.18,
  lineCap: "round",
  lineJoin: "round",
};

export default function PinHoverCircleOverlay({
  center,
  radiusMeters = 120,
  className,
}: PinHoverCircleOverlayProps) {
  const map = useMap();
  const layerRef = React.useRef<L.Circle | null>(null);

  React.useEffect(() => {
    let cancelled = false;

    const run = async () => {
      const prev = layerRef.current;
      layerRef.current = null;
      if (prev) await fadeOutPathThenRemove(prev, map);

      if (cancelled || !center) return;

      const mergedClass = [BASE_CLASS, className].filter(Boolean).join(" ");
      const circle = L.circle([center.lat, center.lng], {
        radius: radiusMeters,
        ...PATH_FALLBACK,
        className: mergedClass,
      });
      circle.addTo(map);
      layerRef.current = circle;
      fadeInPath(circle);
    };

    void run();

    return () => {
      cancelled = true;
      const cur = layerRef.current;
      if (cur) {
        layerRef.current = null;
        void fadeOutPathThenRemove(cur, map);
      }
    };
  }, [center?.lat, center?.lng, radiusMeters, className, map]);

  return null;
}
