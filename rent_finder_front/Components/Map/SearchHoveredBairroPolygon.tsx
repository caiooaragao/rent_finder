"use client";

import * as React from "react";
import L from "leaflet";
import { useMap } from "react-leaflet";
import type { GeoJsonObject } from "geojson";
import { fetchBairroPolygon } from "@/lib/fetchBairroPolygon";
import { fetchCidadePolygon } from "@/lib/fetchCidadePolygon";
import {
  fadeInGeoJsonLayer,
  fadeOutGeoJsonLayerThenRemove,
} from "@/lib/leafletGeoJsonFade";

/** Hover no dropdown: bairro (com cidade) ou só cidade */
export type SearchHoveredPlaceLocation =
  | { kind: "bairro"; bairro: string; cidade: string; estado?: string | null }
  | { kind: "cidade"; cidade: string; estado?: string | null };

/** @deprecated use SearchHoveredPlaceLocation */
export type SearchHoveredBairroLocation = Extract<
  SearchHoveredPlaceLocation,
  { kind: "bairro" }
>;

type SearchHoveredBairroPolygonProps = {
  location: SearchHoveredPlaceLocation | null;
};

/** Mesmo estilo que BairroPolygonOverlay — sem borda. */
const HOVER_STYLE: L.PathOptions = {
  stroke: false,
  fillColor: "#0f766e",
  fillOpacity: 0.32,
};

export default function SearchHoveredBairroPolygon({
  location,
}: SearchHoveredBairroPolygonProps) {
  const map = useMap();
  const [geojson, setGeojson] = React.useState<GeoJsonObject | null>(null);
  const layerRef = React.useRef<L.GeoJSON | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    if (!location) {
      setGeojson(null);
      return;
    }
    setGeojson(null);
    const req =
      location.kind === "bairro"
        ? (() => {
            const b = location.bairro?.trim();
            const c = location.cidade?.trim();
            if (!b || !c) return Promise.resolve(null);
            return fetchBairroPolygon(b, c, location.estado);
          })()
        : fetchCidadePolygon(location.cidade, location.estado);
    void req.then((g) => {
      if (!cancelled) setGeojson(g);
    });
    return () => {
      cancelled = true;
    };
  }, [location]);

  React.useEffect(() => {
    let cancelled = false;

    const run = async () => {
      const prev = layerRef.current;
      layerRef.current = null;
      if (prev) await fadeOutGeoJsonLayerThenRemove(prev, map);

      if (cancelled || !geojson) return;

      const layer = L.geoJSON(geojson, { style: () => HOVER_STYLE });
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
