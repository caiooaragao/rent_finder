"use client";

import * as React from "react";
import L from "leaflet";
import type { LatLngExpression } from "leaflet";
import { MapContainer, TileLayer, ZoomControl, useMap } from "react-leaflet";
import { approxCoordForEndereco } from "@/lib/olxAddressToCoord";
import {
  type ListingPlacePin,
  type PriceRangeFilter,
} from "@/lib/listingMatchesSearchQuery";
import { listingPassesPriceRange } from "@/lib/listingPriceRange";
import { groupCoincidentOlxPoints } from "@/lib/groupCoincidentOlxPoints";
import type { OlxListing } from "@/types/olx";
import OlxSuperclusterLayer, { type OlxMapPoint } from "./OlxSuperclusterLayer";
import SearchHoveredBairroPolygon from "./SearchHoveredBairroPolygon";
import SelectedSearchPlacePolygon from "./SelectedSearchPlacePolygon";
import type { SearchHoveredPlaceLocation } from "./SearchHoveredBairroPolygon";
import { useTheme as useNextTheme } from "next-themes";
import type { MapBasemap } from "@/lib/mapBasemap";
import "leaflet/dist/leaflet.css";

function useFixLeafletDefaultIcon() {
  React.useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- API legada do Leaflet
    delete (L.Icon.Default.prototype as any)._getIconUrl;
    L.Icon.Default.mergeOptions({
      iconRetinaUrl:
        "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
      iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
      shadowUrl:
        "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
    });
  }, []);
}

export interface LeafletMapInnerProps {
  /** [lat, lng] — padrão: Recife (PE) */
  center?: LatLngExpression;
  zoom?: number;
  /** Altura do mapa (px ou CSS, ex. `"50vh"`) */
  height?: number | string;
  className?: string;
  /** Camadas extras (polígonos, etc.) */
  children?: React.ReactNode;
  /** Anúncios a exibir no mapa */
  listings: OlxListing[];
  /** Focar pin após escolha de um anúncio no autocomplete (`token` muda a cada clique) */
  flyTo?: { stableId: string; token: number } | null;
  /** Bairro/cidade escolhidos — polígono + ajuste de zoom (fitBounds) */
  searchPlacePin?: ListingPlacePin | null;
  /** Hover no dropdown — pré-visualização do polígono (Nominatim) */
  searchHoveredBairro?: SearchHoveredPlaceLocation | null;
  /** Filtro por preço (null = sem filtro / faixa total) */
  priceRange?: PriceRangeFilter | null;
  /** Fundo do mapa (controlado pela sidebar) */
  basemap?: MapBasemap;
}

const DEFAULT_CENTER: LatLngExpression = [-8.0476, -34.877];

/**
 * Último zoom nativo CARTO (`light_all` / `dark_all`). Acima disso o Leaflet faz overzoom.
 */
const CARTO_RASTER_MAX_ZOOM = 18 as const;

/** Esri World Imagery — satélite sem chave; usa ordem de tile z/y/x do serviço ArcGIS. */
const SATELLITE_MAX_ZOOM = 19 as const;
const ESRI_WORLD_IMAGERY =
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";

function MapInvalidateOnResize({
  containerRef,
}: {
  containerRef: React.RefObject<HTMLDivElement | null>;
}) {
  const map = useMap();
  React.useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const run = () => {
      map.invalidateSize({ animate: false });
    };
    run();
    const ro = new ResizeObserver(run);
    ro.observe(el);
    window.addEventListener("resize", run);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", run);
    };
  }, [map, containerRef]);
  return null;
}

function MapZoomConsoleLog() {
  const map = useMap();
  React.useEffect(() => {
    const logZoom = () => {
      console.log("[map zoom]", map.getZoom());
    };
    logZoom();
    map.on("zoomend", logZoom);
    return () => {
      map.off("zoomend", logZoom);
    };
  }, [map]);
  return null;
}

function MapFlyToStableId({
  target,
  points,
}: {
  target: { stableId: string; token: number } | null;
  points: OlxMapPoint[];
}) {
  const map = useMap();
  const lastFlownTokenRef = React.useRef<number>(0);

  React.useEffect(() => {
    if (!target) return;
    /**
     * O `stableId` chega da SearchBar (sempre o de um anúncio individual). Em pontos
     * `group` (vários anúncios na mesma coord), procuramos pelo stableId dentro de
     * `listingStableIds`; em ambos os casos voamos para a coord do ponto no mapa.
     */
    const p = points.find((x) =>
      x.type === "single"
        ? x.stableId === target.stableId
        : x.listingStableIds.includes(target.stableId),
    );
    if (!p) return;
    if (lastFlownTokenRef.current === target.token) return;
    lastFlownTokenRef.current = target.token;
    map.flyTo([p.lat, p.lng], 17, { duration: 0.55 });
  }, [map, target, points]);
  return null;
}

export default function LeafletMapInner({
  center = DEFAULT_CENTER,
  zoom = 12,
  height = 420,
  className,
  children,
  listings,
  searchPlacePin = null,
  flyTo = null,
  searchHoveredBairro = null,
  priceRange = null,
  basemap = "streets",
}: LeafletMapInnerProps) {
  useFixLeafletDefaultIcon();
  const mapWrapRef = React.useRef<HTMLDivElement>(null);

  const { resolvedTheme } = useNextTheme();
  const colorModeResolved: "light" | "dark" =
    resolvedTheme === "dark" ? "dark" : "light";

  const cartoTileUrl =
    colorModeResolved === "dark"
      ? "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
      : "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png";

  /** Pins do mapa: só filtro de preço; texto/lugar na busca não escondem outros anúncios. */
  const olxPoints = React.useMemo<OlxMapPoint[]>(() => {
    const out: {
      listing: OlxListing;
      lat: number;
      lng: number;
      key: string;
      stableId: string;
    }[] = [];
    for (let i = 0; i < listings.length; i++) {
      const listing = listings[i];
      if (!listingPassesPriceRange(listing, priceRange)) continue;
      const lat = listing.latitude;
      const lng = listing.longitude;
      const fromGeocode: [number, number] | null =
        typeof lat === "number" &&
        typeof lng === "number" &&
        !Number.isNaN(lat) &&
        !Number.isNaN(lng)
          ? [lat, lng]
          : null;
      const fallback = approxCoordForEndereco(listing.endereco, i);
      const coord = fromGeocode ?? fallback;
      if (!coord) continue;
      const plat = Array.isArray(coord) ? coord[0] : coord.lat;
      const plng = Array.isArray(coord) ? coord[1] : coord.lng;
      out.push({
        listing,
        lat: plat,
        lng: plng,
        key: listing.link || `olx-${i}`,
        stableId: `olx-${i}`,
      });
    }
    return groupCoincidentOlxPoints(out).points;
  }, [listings, priceRange]);

  const fillsViewport =
    height === "100%" || height === "100vh" || height === "100dvh";

  const style: React.CSSProperties = {
    width: "100%",
    height: typeof height === "number" ? `${height}px` : height,
    borderRadius: fillsViewport ? 0 : 8,
    zIndex: 0,
  };

  return (
    <div
      ref={mapWrapRef}
      className={`h-full w-full min-h-0 ${className ?? ""}`}
    >
      <MapContainer
        center={center}
        zoom={zoom}
        maxZoom={SATELLITE_MAX_ZOOM}
        scrollWheelZoom
        style={style}
        className="z-0 h-full w-full min-h-0"
        zoomControl={false}
      >
        <MapInvalidateOnResize containerRef={mapWrapRef} />
        <MapZoomConsoleLog />
        <MapFlyToStableId target={flyTo} points={olxPoints} />
        {basemap === "streets" ? (
          <TileLayer
            key={colorModeResolved}
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'
            url={cartoTileUrl}
            maxZoom={SATELLITE_MAX_ZOOM}
            maxNativeZoom={CARTO_RASTER_MAX_ZOOM}
          />
        ) : (
          <TileLayer
            key="satellite"
            attribution='&copy; <a href="https://www.esri.com/">Esri</a> (World Imagery)'
            url={ESRI_WORLD_IMAGERY}
            maxZoom={SATELLITE_MAX_ZOOM}
            maxNativeZoom={SATELLITE_MAX_ZOOM}
          />
        )}
        <ZoomControl position="bottomright" />

        <OlxSuperclusterLayer points={olxPoints} />

        <SearchHoveredBairroPolygon location={searchHoveredBairro} />
        <SelectedSearchPlacePolygon
          selection={searchPlacePin}
          listings={listings}
        />

        {children}
      </MapContainer>
    </div>
  );
}
