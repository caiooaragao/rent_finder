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
import type { SearchHoveredPlaceLocation } from "./SearchHoveredBairroPolygon";

function norm(s: string) {
  return s.trim().toLowerCase();
}

export type SearchPlaceLocation =
  | SearchHoveredPlaceLocation
  | ListingPlacePin;

function placeLocationKey(place: SearchPlaceLocation | null): string | null {
  if (!place) return null;
  if (place.kind === "bairro") {
    return `bairro|${norm(place.bairro)}|${norm(place.cidade)}|${norm(place.estado ?? "")}`;
  }
  return `cidade|${norm(place.cidade)}|${norm(place.estado ?? "")}`;
}

function fetchPlacePolygon(place: SearchPlaceLocation): Promise<GeoJsonObject | null> {
  if (place.kind === "bairro") {
    const b = place.bairro?.trim();
    const c = place.cidade?.trim();
    if (!b || !c) return Promise.resolve(null);
    return fetchBairroPolygon(b, c, place.estado ?? undefined);
  }
  return fetchCidadePolygon(place.cidade, place.estado ?? undefined);
}

function estadoPairCompat(
  listingEstado: string | null | undefined,
  pinEstado: string | null,
): boolean {
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

const POLYGON_STYLE: L.PathOptions = {
  stroke: false,
  fillColor: "#0f766e",
  fillOpacity: 0.32,
};

type Props = {
  /** Bairro/cidade escolhidos no autocomplete — têm prioridade sobre hover. */
  selected: ListingPlacePin | null;
  /** Pré-visualização ao passar o rato nas sugestões. */
  hovered: SearchHoveredPlaceLocation | null;
  listings?: OlxListing[];
};

/**
 * Uma única camada para hover + seleção — evita apagar o polígono ao escolher
 * bairro/cidade (antes eram dois componentes com fade independente).
 */
export default function SearchPlacePolygonLayer({
  selected,
  hovered,
  listings = [],
}: Props) {
  const map = useMap();
  const [geojson, setGeojson] = React.useState<GeoJsonObject | null>(null);
  const [osmFetchSettled, setOsmFetchSettled] = React.useState(false);
  const layerRef = React.useRef<L.GeoJSON | null>(null);
  const loadedKeyRef = React.useRef<string | null>(null);

  const effectivePlace: SearchPlaceLocation | null = selected ?? hovered;
  const placeKey = placeLocationKey(effectivePlace);
  const selectedKey = placeLocationKey(selected);

  React.useEffect(() => {
    let cancelled = false;
    const place = selected ?? hovered;
    const key = placeLocationKey(place);

    if (!key || !place) {
      loadedKeyRef.current = null;
      setGeojson(null);
      setOsmFetchSettled(false);
      return;
    }

    if (loadedKeyRef.current === key) {
      setOsmFetchSettled(true);
      return;
    }

    setGeojson(null);
    setOsmFetchSettled(false);
    void fetchPlacePolygon(place)
      .then((g) => {
        if (cancelled) return;
        loadedKeyRef.current = key;
        setGeojson(g);
      })
      .finally(() => {
        if (!cancelled) setOsmFetchSettled(true);
      });

    return () => {
      cancelled = true;
    };
  }, [placeKey, selected, hovered]);

  React.useEffect(() => {
    let cancelled = false;

    const run = async () => {
      const prev = layerRef.current;
      layerRef.current = null;
      if (prev) await fadeOutGeoJsonLayerThenRemove(prev, map);

      if (cancelled || !geojson || !placeKey || loadedKeyRef.current !== placeKey)
        return;

      const layer = L.geoJSON(geojson, { style: () => POLYGON_STYLE });
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
  }, [geojson, map, placeKey]);

  const fitMapToBounds = React.useCallback(
    (bounds: L.LatLngBounds) => {
      if (!bounds.isValid()) return;
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
    },
    [map],
  );

  /** fitBounds só quando há seleção explícita (não no hover). */
  React.useEffect(() => {
    if (!placeKey || !geojson || loadedKeyRef.current !== placeKey) return;
    const layer = layerRef.current;
    if (!layer) return;
    try {
      const bounds = layer.getBounds();
      if (bounds.isValid()) fitMapToBounds(bounds);
    } catch {
      /* ignore */
    }
  }, [selected, selectedKey, geojson, placeKey, fitMapToBounds]);

  /** Sem polígono OSM: centrar nos anúncios da área escolhida. */
  React.useEffect(() => {
    if (
      !selected ||
      !selectedKey ||
      !osmFetchSettled ||
      geojson != null ||
      listings.length === 0
    )
      return;
    const bounds = boundsFromListingsForPin(listings, selected);
    if (bounds) fitMapToBounds(bounds);
  }, [
    geojson,
    listings,
    osmFetchSettled,
    selected,
    selectedKey,
    fitMapToBounds,
  ]);

  return null;
}
