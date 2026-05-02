"use client";

import * as React from "react";
import L from "leaflet";
import { useMap } from "react-leaflet";
import type { GeoJsonObject } from "geojson";
import { fetchBairroPolygon } from "@/lib/fetchBairroPolygon";
import { fetchCidadePolygon } from "@/lib/fetchCidadePolygon";
import type { ListingPlacePin } from "@/lib/listingMatchesSearchQuery";
import {
  fadeInGeoJsonLayer,
  fadeOutGeoJsonLayerThenRemove,
} from "@/lib/leafletGeoJsonFade";

/** Bairro/cidade escolhidos — sem borda. */
const SELECTED_STYLE: L.PathOptions = {
  stroke: false,
  fillColor: "#0f766e",
  fillOpacity: 0.32,
};

type Props = {
  selection: ListingPlacePin | null;
};

export default function SelectedSearchPlacePolygon({ selection }: Props) {
  const map = useMap();
  const [geojson, setGeojson] = React.useState<GeoJsonObject | null>(null);
  const layerRef = React.useRef<L.GeoJSON | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    if (!selection) {
      setGeojson(null);
      return;
    }
    setGeojson(null);
    const req =
      selection.kind === "bairro"
        ? fetchBairroPolygon(
            selection.bairro,
            selection.cidade,
            selection.estado ?? undefined,
          )
        : fetchCidadePolygon(selection.cidade, selection.estado);
    void req.then((g) => {
      if (!cancelled) setGeojson(g);
    });
    return () => {
      cancelled = true;
    };
  }, [selection]);

  React.useEffect(() => {
    let cancelled = false;

    const run = async () => {
      const prev = layerRef.current;
      layerRef.current = null;
      if (prev) await fadeOutGeoJsonLayerThenRemove(prev, map);

      if (cancelled || !geojson || !selection) return;

      const layer = L.geoJSON(geojson, { style: () => SELECTED_STYLE });
      layer.addTo(map);
      layerRef.current = layer;
      fadeInGeoJsonLayer(layer);

      try {
        const bounds = layer.getBounds();
        if (bounds.isValid()) {
          map.invalidateSize();
          map.fitBounds(bounds, {
            padding: [48, 48],
            maxZoom: 17,
            animate: true,
            duration: 0.45,
          });
        }
      } catch {
        /* ignore */
      }
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
  }, [geojson, map, selection]);

  return null;
}
