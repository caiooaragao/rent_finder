"use client";

import * as React from "react";
import L from "leaflet";
import { useMap } from "react-leaflet";
import type { GeoJsonObject } from "geojson";
import { fetchBairroPolygon } from "@/lib/fetchBairroPolygon";
import { fetchCidadePolygon } from "@/lib/fetchCidadePolygon";
import type { ListingPlacePin } from "@/lib/listingMatchesSearchQuery";
import { approxCoordForEndereco } from "@/lib/olxAddressToCoord";
import type { OlxListing } from "@/types/olx";
import {
  fadeInGeoJsonLayer,
  fadeOutGeoJsonLayerThenRemove,
} from "@/lib/leafletGeoJsonFade";

function norm(s: string) {
  return s.trim().toLowerCase();
}

function estadoPairCompat(listingEstado: string | null | undefined, pinEstado: string | null): boolean {
  const le = (listingEstado ?? "").trim().toLowerCase();
  const pe = (pinEstado ?? "").trim().toLowerCase();
  if (!pe) return true;
  if (!le) return true;
  return le.includes(pe) || pe.includes(le);
}

/** Quando o Nominatim não devolve polígono, aproxima o mapa aos pins dos anúncios da área. */
function boundsFromListingsForPin(
  listings: OlxListing[],
  selection: ListingPlacePin,
): L.LatLngBounds | null {
  const pts: L.LatLngTuple[] = [];
  for (let i = 0; i < listings.length; i++) {
    const l = listings[i];
    let lat = l.latitude;
    let lng = l.longitude;
    if (
      typeof lat !== "number" ||
      typeof lng !== "number" ||
      Number.isNaN(lat) ||
      Number.isNaN(lng)
    ) {
      const fb = approxCoordForEndereco(l.endereco, i);
      if (!fb) continue;
      lat = Array.isArray(fb) ? fb[0] : fb.lat;
      lng = Array.isArray(fb) ? fb[1] : fb.lng;
    }
    if (selection.kind === "bairro") {
      if (norm(l.bairro ?? "") !== norm(selection.bairro)) continue;
      if (norm(l.cidade ?? "") !== norm(selection.cidade)) continue;
      if (!estadoPairCompat(l.estado, selection.estado)) continue;
    } else {
      if (norm(l.cidade ?? "") !== norm(selection.cidade)) continue;
      if (!estadoPairCompat(l.estado, selection.estado)) continue;
    }
    pts.push([lat, lng]);
  }
  if (pts.length === 0) return null;
  const b = L.latLngBounds(pts);
  return b.isValid() ? b : null;
}

/** Bairro/cidade escolhidos — sem borda. */
const SELECTED_STYLE: L.PathOptions = {
  stroke: false,
  fillColor: "#0f766e",
  fillOpacity: 0.32,
};

type Props = {
  selection: ListingPlacePin | null;
  listings?: OlxListing[];
};

export default function SelectedSearchPlacePolygon({
  selection,
  listings = [],
}: Props) {
  const map = useMap();
  const [geojson, setGeojson] = React.useState<GeoJsonObject | null>(null);
  const [osmFetchSettled, setOsmFetchSettled] = React.useState(false);
  const layerRef = React.useRef<L.GeoJSON | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    if (!selection) {
      setGeojson(null);
      setOsmFetchSettled(false);
      return;
    }
    setGeojson(null);
    setOsmFetchSettled(false);
    const req =
      selection.kind === "bairro"
        ? fetchBairroPolygon(
            selection.bairro,
            selection.cidade,
            selection.estado ?? undefined,
          )
        : fetchCidadePolygon(selection.cidade, selection.estado);
    void req
      .then((g) => {
        if (!cancelled) setGeojson(g);
      })
      .finally(() => {
        if (!cancelled) setOsmFetchSettled(true);
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

  /** Sem polígono OSM (ou fetch falhou): centrar nos anúncios da área. */
  React.useEffect(() => {
    if (
      !selection ||
      !osmFetchSettled ||
      geojson != null ||
      listings.length === 0
    )
      return;
    const bounds = boundsFromListingsForPin(listings, selection);
    if (!bounds?.isValid()) return;
    try {
      map.invalidateSize();
      map.fitBounds(bounds, {
        padding: [48, 48],
        maxZoom: 17,
        animate: true,
        duration: 0.45,
      });
    } catch {
      /* ignore */
    }
  }, [geojson, listings, map, osmFetchSettled, selection]);

  return null;
}
