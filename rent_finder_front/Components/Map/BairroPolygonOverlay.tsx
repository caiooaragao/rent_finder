"use client";

import * as React from "react";
import L from "leaflet";
import { useMap } from "react-leaflet";
import type { GeoJsonObject } from "geojson";
import {
  fadeInGeoJsonLayer,
  fadeOutGeoJsonLayerThenRemove,
} from "@/lib/leafletGeoJsonFade";

interface BairroPolygonOverlayProps {
  /** GeoJSON do contorno do bairro (Polygon ou MultiPolygon) */
  geojson: GeoJsonObject | null;
  /** Mantém o polígono visível ao mover o rato do pin para o contorno */
  onMouseEnter?: () => void;
  /** Inicia fecho em conjunto com o pin/popup (usa delay no pai) */
  onMouseLeave?: () => void;
}

/** Só preenchimento — sem borda. Alinhado a theme/colors.css --rf-primary-dark */
const POLYGON_STYLE: L.PathOptions = {
  stroke: false,
  fillColor: "#0f766e",
  fillOpacity: 0.32,
};

export default function BairroPolygonOverlay({
  geojson,
  onMouseEnter,
  onMouseLeave,
}: BairroPolygonOverlayProps) {
  const map = useMap();
  const layerRef = React.useRef<L.GeoJSON | null>(null);
  const enterRef = React.useRef(onMouseEnter);
  const leaveRef = React.useRef(onMouseLeave);
  enterRef.current = onMouseEnter;
  leaveRef.current = onMouseLeave;

  React.useEffect(() => {
    let cancelled = false;

    const run = async () => {
      const prev = layerRef.current;
      layerRef.current = null;
      if (prev) await fadeOutGeoJsonLayerThenRemove(prev, map);

      if (cancelled || !geojson) return;

      const layer = L.geoJSON(geojson, {
        style: () => POLYGON_STYLE,
        onEachFeature: (_feature, featureLayer) => {
          featureLayer.on("mouseover", () => enterRef.current?.());
          featureLayer.on("mouseout", () => leaveRef.current?.());
        },
      });

      layer.addTo(map);
      layerRef.current = layer;
      fadeInGeoJsonLayer(layer);
    };

    void run();

    return () => {
      cancelled = true;
      const cur = layerRef.current;
      if (cur) {
        layerRef.current = null;
        void fadeOutGeoJsonLayerThenRemove(cur, map);
      }
    };
  }, [geojson, map]);

  return null;
}
