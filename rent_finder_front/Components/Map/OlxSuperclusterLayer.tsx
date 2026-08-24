"use client";

/**
 * Camada de anúncios OLX no mapa: agrupa pontos com Supercluster, desenha clusters (círculo + popup)
 * e cada folha como uma **etiqueta de preço** (divIcon) ancorada na coordenada — sem pin gráfico.
 * Variantes: azul = endereço completo, âmbar = só bairro. Inclui:
 * - popup ao hover (delay ao sair para permitir mover o rato para o popup);
 * - polígono do bairro (fetch) só com o rato na etiqueta amarela; halo circular no hover;
 * - zoom ≥ 13: botão “Mostrar apenas pins” (getClusters no zoom de folhas do Supercluster);
 * - **coordenadas coincidentes**: vários anúncios na mesma lat/lng são representados por um
 *   único marcador com ícone de várias casas + contagem (`CoincidentGroupMarker`); o popup
 *   ao hover lista os anúncios (título + preço).
 *
 * Tamanho do cluster: clusterCirclePixelSize + clusterDivIcon (usa `totalAds` do reducer
 * Supercluster para somar todos os anúncios — incluindo grupos coincidentes).
 * Aspeto (cores, sombra): app/globals.css (.olx-supercluster-marker-disc, .olx-marker-price-label*,
 * .olx-coincident-group-marker) e theme/colors.css.
 */

import * as React from "react";
import { createPortal } from "react-dom";
import { RiMapPin2Fill, RiStackFill } from "react-icons/ri";
import { OpenInNewOutlined, StreetviewOutlined } from "@mui/icons-material";
import L from "leaflet";
import { Marker, Popup, useMap } from "react-leaflet";
import Supercluster from "supercluster";
import type { OlxListing } from "@/types/olx";
import type { Feature, Point, GeoJsonObject } from "geojson";
import { fetchBairroPolygon } from "@/lib/fetchBairroPolygon";
import { googleStreetViewUrl } from "@/lib/googleStreetViewUrl";
import OlxClusterPopupContent, {
  type OlxClusterPopupLeaf,
} from "./OlxClusterPopupContent";
import BairroPolygonOverlay from "./BairroPolygonOverlay";
import PinHoverCircleOverlay from "./PinHoverCircleOverlay";
import CoincidentGroupMarker from "./CoincidentGroupMarker";
import CoincidentGroupPopupContent from "./CoincidentGroupPopupContent";

/**
 * Ponto exibido no mapa: união discriminada por `type`.
 * - `single`: anúncio único na sua coordenada → renderizado como `LeafPriceMarker`.
 * - `group`:  vários anúncios na **mesma** coordenada (agrupados por
 *   `groupCoincidentOlxPoints`) → renderizado como `CoincidentGroupMarker`.
 */
export type OlxMapPoint =
  | {
      type: "single";
      lat: number;
      lng: number;
      listing: OlxListing;
      key: string;
      /** Único por linha no JSON (link pode repetir). */
      stableId: string;
    }
  | {
      type: "group";
      lat: number;
      lng: number;
      listings: OlxListing[];
      /** Identificador estável do grupo (derivado da coordenada). */
      stableId: string;
      /** stableIds dos anúncios individuais (suporta `flyTo` por anúncio). */
      listingStableIds: string[];
    };

/**
 * Properties associadas a cada **folha** do Supercluster: união discriminada por `type`.
 * Folhas `single` carregam um anúncio; `group` carrega vários anúncios coincidentes.
 */
type LeafProps =
  | {
      type: "single";
      listing: OlxListing;
      key: string;
      stableId: string;
    }
  | {
      type: "group";
      listings: OlxListing[];
      stableId: string;
      listingStableIds: string[];
    };

/**
 * Properties **agregadas** pelo reducer Supercluster em cada cluster.
 * `totalAds` = soma do número real de anúncios (groups contribuem com `listings.length`).
 * Necessário porque `point_count` do Supercluster conta apenas pontos (groups = 1 ponto).
 */
type ClusterAggregateProps = { totalAds: number };

/** Distingue agregação Supercluster de ponto singular (folha). */
function isClusterFeature(
  f: Supercluster.ClusterFeature<ClusterAggregateProps> | Supercluster.PointFeature<LeafProps>,
): f is Supercluster.ClusterFeature<ClusterAggregateProps> {
  return (
    f.properties !== null &&
    typeof f.properties === "object" &&
    "cluster" in f.properties &&
    (f.properties as { cluster?: boolean }).cluster === true
  );
}

type ScIndex = Supercluster<LeafProps, ClusterAggregateProps>;

/** Alinhado a `new Supercluster({ maxZoom })` — não alterar só um dos dois. */
const SUPERCLUSTER_MAX_ZOOM = 16;
/**
 * `getClusters(bbox, z)` com z = maxZoom+1 usa a árvore de folhas (pins individuais).
 * @see supercluster `_limitZoom` / `trees[maxZoom + 1]`
 */
const SUPERCLUSTER_LEAF_ZOOM = SUPERCLUSTER_MAX_ZOOM + 1;

/** A partir deste zoom do mapa mostra o botão “Mostrar apenas pins”. */
const ZOOM_MIN_PINS_ONLY_CONTROL = 17;

/**
 * ---------------------------------------------------------------------------
 * Controles de cluster — ajuste aqui raio, mínimo de pontos e tamanho do círculo
 * ---------------------------------------------------------------------------
 * `CLUSTER_RADIUS_PX` — Raio de agrupamento em **pixels no ecrã** (opção `radius`
 *   do Supercluster). **Maior** = junta pontos mais afastados (clusters “maiores”
 *   no mapa). **Menor** = só agrupa quem está muito perto.
 * `CLUSTER_MIN_POINTS` — Mínimo de anúncios para **existir** um cluster (≥2).
 *   Valores maiores reduzem a quantidade de agregados (ex.: 3 exige 3+ pins).
 * `CLUSTER_DISC_PX_SMALL` — **Diâmetro mínimo** (em px) do círculo no mapa quando
 *   a contagem é &lt; 100 (marcador visual, não é o raio do algoritmo).
 * `CLUSTER_DISC_PX_MID` / `CLUSTER_DISC_PX_LARGE` — Diâmetro para faixas maiores
 *   de contagem (100–999 e ≥1000), para o número caber no círculo.
 * `CLUSTER_COUNT_FONT_PX_SMALL` — Tamanho (px) do **número** dentro do círculo quando
 *   a contagem é &lt; 100 (alinhe ao diâmetro `CLUSTER_DISC_PX_SMALL`).
 * `CLUSTER_COUNT_FONT_PX_MID` — Contagem entre 100 e 999.
 * `CLUSTER_COUNT_FONT_PX_LARGE` — Contagem ≥ 1000 (mais dígitos; em geral um pouco menor).
 * ---------------------------------------------------------------------------
 */
const CLUSTER_RADIUS_PX = 100;
const CLUSTER_MIN_POINTS = 4;
const CLUSTER_DISC_PX_SMALL = 24;
const CLUSTER_DISC_PX_MID = 35;
const CLUSTER_DISC_PX_LARGE = 47;

const CLUSTER_COUNT_FONT_PX_SMALL = 11;
const CLUSTER_COUNT_FONT_PX_MID = 13;
const CLUSTER_COUNT_FONT_PX_LARGE = 12;

/**
 * ---------------------------------------------------------------------------
 * Pulso ao redor do cluster
 * ---------------------------------------------------------------------------
 * `CLUSTER_PULSE_INSET_PX` — quanto o anel **ultrapassa** o disco (mais negativo = halo maior).
 * `CLUSTER_PULSE_OPACITY` — no `style` do span (CSS em `globals.css`).
 * `CLUSTER_PULSE_BLUR_*` / `CLUSTER_PULSE_SPREAD_*` — `@keyframes` injetados
 *   (`injectClusterPulseKeyframes`); valores em **px literais** (sem `var()` no blur/spread).
 * Para **aumentar o raio do pulso**: torne o inset mais negativo e/ou suba blur e spread.
 * Cores: `theme/colors.css` (`--rf-cluster-marker-pulse-*`).
 * ---------------------------------------------------------------------------
 */
const CLUSTER_PULSE_INSET_PX = -1;
const CLUSTER_PULSE_OPACITY = 0.65;
const CLUSTER_PULSE_BLUR_REST_PX = 10;
const CLUSTER_PULSE_BLUR_MID_PX = 10;
const CLUSTER_PULSE_BLUR_MAX_PX = 0;
const CLUSTER_PULSE_SPREAD_REST_PX = 11;
const CLUSTER_PULSE_SPREAD_MID_PX = 4;
const CLUSTER_PULSE_SPREAD_MAX_PX = 0;

const CLUSTER_PULSE_KEYFRAMES_STYLE_ID = "olx-cluster-pulse-keyframes";

/** Gera `@keyframes olx-cluster-marker-pulse` com blur/spread em px (constantes TS). */
function injectClusterPulseKeyframes(): void {
  if (typeof document === "undefined") return;
  const rest = CLUSTER_PULSE_BLUR_REST_PX;
  const mid = CLUSTER_PULSE_BLUR_MID_PX;
  const max = CLUSTER_PULSE_BLUR_MAX_PX;
  const s0 = CLUSTER_PULSE_SPREAD_REST_PX;
  const s1 = CLUSTER_PULSE_SPREAD_MID_PX;
  const s2 = CLUSTER_PULSE_SPREAD_MAX_PX;
  const css = `
@keyframes olx-cluster-marker-pulse {
  0%, 100% {
    box-shadow:
      0 0 0 1px var(--rf-cluster-marker-pulse-ring-min),
      0 0 ${rest}px ${s0}px var(--rf-cluster-marker-pulse-spread-min);
  }
  50% {
    box-shadow:
      0 0 0 2px var(--rf-cluster-marker-pulse-ring-max),
      0 0 ${mid}px ${s1}px var(--rf-cluster-marker-pulse-spread-mid),
      0 0 ${max}px ${s2}px var(--rf-cluster-marker-pulse-spread-max);
  }
}
`;
  let el = document.getElementById(CLUSTER_PULSE_KEYFRAMES_STYLE_ID) as HTMLStyleElement | null;
  if (!el) {
    el = document.createElement("style");
    el.id = CLUSTER_PULSE_KEYFRAMES_STYLE_ID;
    document.head.appendChild(el);
  }
  el.textContent = css;
}

injectClusterPulseKeyframes();

type MapHoverDetailState =
  | {
      kind: "cluster";
      pointCount: number;
      leaves: OlxClusterPopupLeaf[];
      lat: number;
      lng: number;
      expansionZoom: number;
    }
  | {
      kind: "group";
      listings: OlxListing[];
      lat: number;
      lng: number;
      stableId: string;
    }
  | {
      kind: "single";
      listing: OlxListing;
      stableId: string;
      lat: number;
      lng: number;
      isBairro: boolean;
    };

function SingleListingMapPopupContent({
  listing,
  lat,
  lng,
  isBairro,
  bairroIsLoading,
}: {
  listing: OlxListing;
  lat: number;
  lng: number;
  isBairro: boolean;
  bairroIsLoading: boolean;
}) {
  return (
    <div className="space-y-1 text-sm text-foreground">
      <p className="m-0 font-semibold leading-snug">{listing.titulo}</p>
      <p className="m-0 text-listing-price">{listing.preco}</p>
      {listing.endereco ? (
        <p className="m-0 text-xs text-listing-muted">{listing.endereco}</p>
      ) : null}
      {isBairro && listing.bairro ? (
        <p className="m-0 text-xs text-listing-amber">
          Localização aproximada: {listing.bairro}
          {bairroIsLoading ? " (carregando contorno…)" : ""}
        </p>
      ) : null}
      {listing.link || !isBairro ? (
        <footer className="mt-1.5 flex flex-wrap items-center justify-end gap-x-2 gap-y-1 border-t border-[var(--rf-cluster-popup-footer-border)] pt-1.5">
          {listing.link ? (
            <a
              href={listing.link}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Abrir este anúncio no OLX"
              className="inline-flex shrink-0 items-center gap-1 rounded-md border border-[var(--rf-cluster-popup-btn-border)] bg-[var(--rf-cluster-popup-btn-bg)] px-2 py-0.5 text-[0.6875rem] font-semibold text-[var(--rf-cluster-popup-btn-fg)] no-underline shadow-none transition-colors duration-150 hover:border-[var(--rf-cluster-popup-btn-hover-border)] hover:bg-[var(--rf-cluster-popup-btn-hover-bg)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--rf-cluster-popup-btn-fg)]"
            >
              <OpenInNewOutlined sx={{ fontSize: 14 }} aria-hidden />
              Ver no OLX
            </a>
          ) : null}
          {!isBairro ? (
            <a
              href={googleStreetViewUrl(lat, lng)}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Abrir esta localização no Google Street View"
              className="inline-flex shrink-0 items-center gap-1 rounded-md border border-[var(--rf-cluster-popup-btn-border)] bg-[var(--rf-cluster-popup-btn-bg)] px-2 py-0.5 text-[0.6875rem] font-semibold text-[var(--rf-cluster-popup-btn-fg)] no-underline shadow-none transition-colors duration-150 hover:border-[var(--rf-cluster-popup-btn-hover-border)] hover:bg-[var(--rf-cluster-popup-btn-hover-bg)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--rf-cluster-popup-btn-fg)]"
            >
              <StreetviewOutlined sx={{ fontSize: 14 }} aria-hidden />
              Abrir no Street View
            </a>
          ) : null}
        </footer>
      ) : null}
    </div>
  );
}

/**
 * Após mudar `points`, o estado `clusters` pode ainda vir do índice anterior;
 * `getClusterExpansionZoom` / `getLeaves` aí lançam "No cluster with the specified id".
 */
function tryReadClusterDetail(
  index: ScIndex,
  clusterId: number,
  mapMaxZoom: number,
): {
  expansionZoom: number;
  leaves: Supercluster.PointFeature<LeafProps>[];
} | null {
  try {
    const expansionZoom = Math.min(
      index.getClusterExpansionZoom(clusterId),
      mapMaxZoom,
    );
    const leaves = index.getLeaves(clusterId, 50);
    return { expansionZoom, leaves };
  } catch {
    return null;
  }
}

/**
 * Altura estimada da etiqueta de preço (`.olx-marker-price-label`) — usada no `popupAnchor`.
 * Aproximação: padding 2+2 + line-height (~15) + border 1+1 ≈ 21 px → arredondado.
 */
const PRICE_LABEL_HEIGHT_PX = 22;

/**
 * Folga vertical entre o topo da etiqueta e a ponta do popup. Inclui margem para a `offset`
 * default do `L.Popup` ([0, 7]) — sem isto, a ponta do popup sobreporia a etiqueta e o cursor
 * "saltava" para o popup ao abri-lo, fechando-o de imediato.
 */
const PRICE_LABEL_TO_POPUP_GAP_PX = 14;

/** Cache de DivIcon por `${variant}|${preço}` — evita recriar para cada render. */
const PRICE_LABEL_ICON_CACHE = new Map<string, L.DivIcon>();

/** Escapa caracteres HTML do preço antes de injetar no `divIcon.html`. */
function escapePriceForHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Etiqueta de preço como **marcador** (substitui o antigo pin RiMapPin2Fill).
 *
 * O próprio wrapper do `divIcon` é a etiqueta visível (sem filhos absolutamente posicionados):
 * isto dá ao marcador um *bounding box* real, alinhado com o conteúdo, o que torna o
 * `mouseover/mouseout` do Leaflet e o `:hover` (`isPointerOverPopupMarkerOrTooltip`) fiáveis.
 *
 * Ancoragem: o Leaflet posiciona o wrapper com `transform: translate3d(x, y, 0)`. A propriedade
 * CSS `translate: -50% -100%` (independente de `transform`) compõe-se por cima e desloca a
 * **base centrada** da etiqueta para o lat/lng — equivalente à ponta do antigo pin.
 */
function priceLabelDivIcon(
  price: string,
  variant: "default" | "bairro",
): L.DivIcon {
  const key = `${variant}|${price}`;
  const cached = PRICE_LABEL_ICON_CACHE.get(key);
  if (cached) return cached;
  const variantClass =
    variant === "bairro"
      ? "olx-marker-price-label--bairro"
      : "olx-marker-price-label--default";
  const safe = escapePriceForHtml(price);
  /**
   * `iconSize: undefined` é intencional: o default do `L.DivIcon` é `[12, 12]`, que setaria
   * inline `width: 12px; height: 12px` no wrapper. Passamos undefined para que o Leaflet
   * NÃO defina inline width/height — o tamanho fica controlado por CSS (`width: max-content`),
   * acompanhando o conteúdo do preço.
   */
  const icon = L.divIcon({
    html: safe,
    className: `olx-marker-price-label ${variantClass}`,
    iconSize: undefined,
    popupAnchor: [0, -(PRICE_LABEL_HEIGHT_PX + PRICE_LABEL_TO_POPUP_GAP_PX)],
  });
  PRICE_LABEL_ICON_CACHE.set(key, icon);
  return icon;
}

/**
 * Antes de fechar o popup: o cursor pode estar no popup, no tooltip de preço ou no pin —
 * `mouseout` no pin dispara antes de entrar no popup (gap no DOM).
 */
function isPointerOverPopupMarkerOrTooltip(map: L.Map): boolean {
  const root = map.getContainer();
  const selectors = [
    ".leaflet-popup",
    ".leaflet-tooltip",
    ".leaflet-marker-icon",
    ".leaflet-div-icon",
  ];
  for (const sel of selectors) {
    for (const el of root.querySelectorAll(sel)) {
      if (el instanceof Element && el.matches(":hover")) return true;
    }
  }
  return false;
}

/**
 * `isPopupOpen()` existe em `L.Layer` (marcador), não em `L.Map`.
 * Verifica se ainda há um `.leaflet-popup` no painel (ex.: após trocar de pin).
 */
function mapHasVisiblePopupLayer(map: L.Map): boolean {
  const pane = map.getPane("popupPane");
  if (!pane) return false;
  return pane.querySelector(".leaflet-popup") !== null;
}

/**
 * Abreviatura de contagem para o disco do cluster — espelha o formato `point_count_abbreviated`
 * do Supercluster (ex.: `999`, `1.2k`, `1.5M`). Útil para garantir que números muito grandes
 * (`totalAds`) cabem no círculo.
 */
function abbreviateAdCount(n: number): string {
  if (n >= 1_000_000) return `${(Math.floor(n / 100_000) / 10).toFixed(1)}M`;
  if (n >= 1_000) return `${(Math.floor(n / 100) / 10).toFixed(1)}k`;
  return String(n);
}

/** Diâmetro em px do círculo no mapa — ver `CLUSTER_DISC_PX_*` no bloco de controles. */
function clusterCirclePixelSize(pointCount: number) {
  return pointCount >= 1000
    ? CLUSTER_DISC_PX_LARGE
    : pointCount >= 100
      ? CLUSTER_DISC_PX_MID
      : CLUSTER_DISC_PX_SMALL;
}

/** Tamanho da fonte do número — mesmas faixas que `clusterCirclePixelSize`. */
function clusterCountFontSizePx(pointCount: number): number {
  if (pointCount >= 1000) return CLUSTER_COUNT_FONT_PX_LARGE;
  if (pointCount >= 100) return CLUSTER_COUNT_FONT_PX_MID;
  return CLUSTER_COUNT_FONT_PX_SMALL;
}

/** L.divIcon com contagem; wrapper em globals.css (.leaflet-marker-icon.olx-supercluster-icon). */
function clusterDivIcon(count: number | string) {
  const n = typeof count === "number" ? count : parseInt(String(count), 10);
  const size = clusterCirclePixelSize(n);
  const fontPx = clusterCountFontSizePx(n);
  const pulseVars = [
    `--olx-cluster-pulse-inset:${CLUSTER_PULSE_INSET_PX}px`,
    `--olx-cluster-pulse-opacity:${CLUSTER_PULSE_OPACITY}`,
  ].join(";");
  const html = `<div class="olx-supercluster-marker-root" style="width:${size}px;height:${size}px"><span class="olx-supercluster-marker-pulse" style="${pulseVars}" aria-hidden="true"></span><div class="olx-supercluster-marker-disc" style="width:${size}px;height:${size}px;font-size:${fontPx}px">${count}</div></div>`;
  return L.divIcon({
    html,
    className: "olx-supercluster-icon",
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

/** Atraso antes de fechar popup / limpar halo: tempo para o rato entrar no popup ou no polígono. */
const HOVER_LEAVE_MS = 350;

/**
 * Folha (anúncio singular) memoizada.
 *
 * **Porquê memoizar?** O `react-leaflet` chama `L.Popup.prototype.update()` num efeito que
 * inclui `props.children` nas dependências. Como JSX cria elementos novos a cada render,
 * `props.children` muda referência sempre que o componente pai re-renderiza, e
 * `update()` faz `visibility: hidden` → recalcula → `visibility: ''` (ver
 * `node_modules/leaflet/src/layer/DivOverlay.js`). Vários `update()` em sequência produzem
 * o **piscar** que o utilizador observa. Ao isolar a folha num componente memoizado, os
 * elementos JSX só são recriados quando os dados *desta* folha mudam — outros re-renders
 * do `OlxSuperclusterLayer` (ex.: hover, fetch do bairro vizinho) não tocam neste popup.
 *
 * **Props deliberadamente granulares:** `bairroIsLoading` é booleano por folha em vez de
 * passar `loadingBairro + activeBairroStableId`, para que a folha *não-ativa* mantenha a
 * mesma prop entre renders e o `React.memo` salte o trabalho.
 */
type LeafPriceMarkerProps = {
  listing: OlxListing;
  stableId: string;
  lat: number;
  lng: number;
  isBairro: boolean;
  /** True só na folha cujo bairro está a ser carregado (mostra "carregando contorno…"). */
  bairroIsLoading: boolean;
  hoverPopupsEnabled: boolean;
  /** Estes callbacks vêm do pai memoizados (`useCallback`); o `useMemo` interno depende deles. */
  popupHoverHandlers: L.LeafletEventHandlerFnMap;
  onPriceMarkerHover: (
    marker: L.Marker,
    lat: number,
    lng: number,
    listing: OlxListing,
    stableId: string,
    isBairro: boolean,
  ) => void;
  onLeafLeave: () => void;
  onLeafClick: (lat: number, lng: number) => void;
  onBairroLeafLeave: () => void;
};

const LeafPriceMarker = React.memo(function LeafPriceMarker({
  listing,
  stableId,
  lat,
  lng,
  isBairro,
  bairroIsLoading,
  hoverPopupsEnabled,
  popupHoverHandlers,
  onPriceMarkerHover,
  onLeafLeave,
  onLeafClick,
  onBairroLeafLeave,
}: LeafPriceMarkerProps) {
  const precoLabel = listing.preco?.trim() ? listing.preco : "—";

  const eventHandlers = React.useMemo<L.LeafletEventHandlerFnMap>(() => {
    const hover = (e: L.LeafletMouseEvent) => {
      onPriceMarkerHover(
        e.target as L.Marker,
        lat,
        lng,
        listing,
        stableId,
        isBairro,
      );
    };
    return {
      mouseover: hover,
      mouseout: isBairro ? onBairroLeafLeave : onLeafLeave,
      click: () => onLeafClick(lat, lng),
    };
  }, [
    isBairro,
    listing,
    stableId,
    lat,
    lng,
    onPriceMarkerHover,
    onLeafLeave,
    onLeafClick,
    onBairroLeafLeave,
  ]);

  return (
    <Marker
      position={[lat, lng]}
      icon={priceLabelDivIcon(precoLabel, isBairro ? "bairro" : "default")}
      riseOnHover
      eventHandlers={eventHandlers}
    >
      {hoverPopupsEnabled ? (
        /*
          `interactive` no Popup é essencial: sem isto, o `L.DivOverlay._initInteraction`
          não regista listeners e os `popupHoverHandlers` (mouseover/mouseout) NUNCA disparam
          no popup. Resultado: ao mover o cursor da etiqueta para o popup, só o `:hover`
          fallback (`isPointerOverPopupMarkerOrTooltip`) impede o fecho — e só após 350 ms.
        */
        <Popup
          maxWidth={280}
          autoPan={false}
          closeOnClick
          interactive
          eventHandlers={popupHoverHandlers}
        >
          <SingleListingMapPopupContent
            listing={listing}
            lat={lat}
            lng={lng}
            isBairro={isBairro}
            bairroIsLoading={bairroIsLoading}
          />
        </Popup>
      ) : null}
    </Marker>
  );
});

export default function OlxSuperclusterLayer({
  points,
  hoverPopupsEnabled = true,
}: {
  points: OlxMapPoint[];
  hoverPopupsEnabled?: boolean;
}) {
  const map = useMap();
  /** Quando true, `getClusters` usa zoom de folhas → sem círculos de agregação. */
  const [pinsOnly, setPinsOnly] = React.useState(false);
  const [mapZoom, setMapZoom] = React.useState(() => Math.round(map.getZoom()));

  const [clusters, setClusters] = React.useState<
    Array<
      | Supercluster.ClusterFeature<ClusterAggregateProps>
      | Supercluster.PointFeature<LeafProps>
    >
  >([]);
  const [bairroGeoJson, setBairroGeoJson] = React.useState<GeoJsonObject | null>(null);
  const [loadingBairro, setLoadingBairro] = React.useState(false);
  /** Pin amarelo sobre o qual o polígono / loading se aplicam (para o texto no popup) */
  const [activeBairroStableId, setActiveBairroStableId] = React.useState<string | null>(null);
  /** Halo circular ao passar o rato no pin (ver PinHoverCircleOverlay + globals.css) */
  const [hoverPinCircle, setHoverPinCircle] = React.useState<{
    lat: number;
    lng: number;
  } | null>(null);

  /** Detalhe ao hover quando `hoverPopupsEnabled` é false — mesmo conteúdo que os popups Leaflet. */
  const [hoverPanel, setHoverPanel] = React.useState<MapHoverDetailState | null>(null);
  /** Permite mover o rato do pin para o painel sem fechar (espelha o fluxo do popup). */
  const pointerOverDetailPanelRef = React.useRef(false);

  /** Conteúdo do painel direito + estado visível para animar slide sem desmontar no primeiro frame. */
  const [panelBody, setPanelBody] = React.useState<MapHoverDetailState | null>(null);
  const [panelOpen, setPanelOpen] = React.useState(false);
  const panelEverOpenedRef = React.useRef(false);

  React.useLayoutEffect(() => {
    if (hoverPopupsEnabled) {
      setPanelOpen(false);
      return;
    }
    if (hoverPanel) {
      setPanelBody(hoverPanel);
      if (!panelEverOpenedRef.current) {
        setPanelOpen(false);
        const id = requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            setPanelOpen(true);
            panelEverOpenedRef.current = true;
          }),
        );
        return () => cancelAnimationFrame(id);
      }
      setPanelOpen(true);
      return;
    }
    if (panelBody) {
      setPanelOpen(false);
    }
  }, [hoverPopupsEnabled, hoverPanel, panelBody]);

  const onPanelTransitionEnd = React.useCallback(
    (e: React.TransitionEvent<HTMLDivElement>) => {
      if (e.propertyName !== "transform") return;
      const open = e.currentTarget.getAttribute("data-open") === "true";
      if (open) return;
      if (hoverPopupsEnabled) {
        setPanelBody(null);
        panelEverOpenedRef.current = false;
        return;
      }
      if (hoverPanel === null) {
        setPanelBody(null);
        panelEverOpenedRef.current = false;
      }
    },
    [hoverPopupsEnabled, hoverPanel],
  );

  /** Timer do scheduleMarkerHoverLeave (fechar popup ou painel + limpar halo). */
  const leaveTimerRef = React.useRef<number | null>(null);
  /** stableId do pin amarelo em hover; fetch só aplica se ainda for o mesmo alvo. */
  const bairroHoverTargetRef = React.useRef<string | null>(null);

  /** Esconde contorno do bairro ao sair do pin (não permanece ao passar para o popup). */
  const clearBairroHoverState = React.useCallback(() => {
    setBairroGeoJson(null);
    setLoadingBairro(false);
    bairroHoverTargetRef.current = null;
    setActiveBairroStableId(null);
  }, []);

  /** Cancela o fecho adiado (ex.: rato voltou ao pin ou popup). */
  const cancelPinLeave = React.useCallback(() => {
    if (leaveTimerRef.current) {
      clearTimeout(leaveTimerRef.current);
      leaveTimerRef.current = null;
    }
  }, []);

  /**
   * Agenda fecho do popup ou do painel lateral se, após HOVER_LEAVE_MS, o rato não estiver
   * sobre marcador, popup Leaflet ou painel (`pointerOverDetailPanelRef`).
   */
  const shouldDeferHoverLeave = React.useCallback(() => {
    if (isPointerOverPopupMarkerOrTooltip(map)) return true;
    if (!hoverPopupsEnabled && pointerOverDetailPanelRef.current) return true;
    return false;
  }, [map, hoverPopupsEnabled]);

  const scheduleMarkerHoverLeave = React.useCallback(() => {
    if (leaveTimerRef.current) clearTimeout(leaveTimerRef.current);
    leaveTimerRef.current = window.setTimeout(() => {
      if (shouldDeferHoverLeave()) {
        leaveTimerRef.current = null;
        return;
      }
      leaveTimerRef.current = window.setTimeout(() => {
        leaveTimerRef.current = null;
        if (shouldDeferHoverLeave()) return;
        if (hoverPopupsEnabled) {
          map.closePopup();
        } else {
          setHoverPanel(null);
        }
        setHoverPinCircle(null);
      }, 120);
    }, HOVER_LEAVE_MS);
  }, [map, hoverPopupsEnabled, shouldDeferHoverLeave]);

  React.useEffect(() => {
    map.closePopup();
    setHoverPanel(null);
    pointerOverDetailPanelRef.current = false;
  }, [hoverPopupsEnabled, map]);

  React.useEffect(
    () => () => {
      cancelPinLeave();
    },
    [cancelPinLeave],
  );

  /**
   * Ao trocar de pin, o Leaflet fecha o popup anterior e dispara `popupclose` antes
   * de abrir o próximo — limpar o polígono aqui apagava o fetch do pin novo.
   * Só limpamos se, após o ciclo atual, não houver outro popup aberto.
   */
  React.useEffect(() => {
    let deferredClear: number | null = null;
    const onPopupClose = () => {
      cancelPinLeave();
      if (deferredClear !== null) clearTimeout(deferredClear);
      deferredClear = window.setTimeout(() => {
        deferredClear = null;
        if (mapHasVisiblePopupLayer(map)) return;
        setHoverPanel(null);
        setBairroGeoJson(null);
        bairroHoverTargetRef.current = null;
        setActiveBairroStableId(null);
        setLoadingBairro(false);
        setHoverPinCircle(null);
      }, 0);
    };
    map.on("popupclose", onPopupClose);
    return () => {
      map.off("popupclose", onPopupClose);
      if (deferredClear !== null) clearTimeout(deferredClear);
    };
  }, [map, cancelPinLeave]);

  const popupHoverHandlers = React.useMemo(
    () => ({
      mouseover: cancelPinLeave,
      mouseout: scheduleMarkerHoverLeave,
    }),
    [cancelPinLeave, scheduleMarkerHoverLeave],
  );

  /**
   * Click num ponto: voa o mapa para centrar **e aumentar zoom em 1 nível** numa única
   * animação. Usa `flyTo` (combina pan + zoom suavemente). O zoom alvo é
   * `currentZoom + 1`, limitado por `maxZoom` — se já estiver no máximo, só faz pan.
   */
  const panMapToPin = React.useCallback(
    (lat: number, lng: number) => {
      const targetZoom = Math.min(map.getZoom() + 1, map.getMaxZoom());
      map.flyTo([lat, lng], targetZoom, {
        duration: 0.4,
        easeLinearity: 0.25,
      });
    },
    [map],
  );

  const handlePriceMarkerHover = React.useCallback(
    (
      marker: L.Marker,
      lat: number,
      lng: number,
      listing: OlxListing,
      stableId: string,
      isBairro: boolean,
    ) => {
      cancelPinLeave();
      setHoverPinCircle({ lat, lng });
      if (isBairro) {
        bairroHoverTargetRef.current = stableId;
        setActiveBairroStableId(stableId);
        setBairroGeoJson(null);
        setLoadingBairro(true);
        void fetchBairroPolygon(
          listing.bairro,
          listing.cidade,
          listing.estado,
          listing.endereco,
        )
          .then((geojson) => {
            if (bairroHoverTargetRef.current !== stableId) return;
            setBairroGeoJson(geojson);
            setLoadingBairro(false);
          })
          .catch(() => {
            if (bairroHoverTargetRef.current !== stableId) return;
            setBairroGeoJson(null);
            setLoadingBairro(false);
          });
        if (hoverPopupsEnabled) {
          if (!marker.isPopupOpen()) marker.openPopup();
        } else {
          setHoverPanel({
            kind: "single",
            listing,
            stableId,
            lat,
            lng,
            isBairro: true,
          });
        }
      } else {
        clearBairroHoverState();
        if (hoverPopupsEnabled) {
          if (!marker.isPopupOpen()) marker.openPopup();
        } else {
          setHoverPanel({
            kind: "single",
            listing,
            stableId,
            lat,
            lng,
            isBairro: false,
          });
        }
      }
    },
    [cancelPinLeave, clearBairroHoverState, hoverPopupsEnabled],
  );

  const onLeafLeave = React.useCallback(() => {
    scheduleMarkerHoverLeave();
  }, [scheduleMarkerHoverLeave]);

  const onLeafClick = React.useCallback(
    (lat: number, lng: number) => {
      panMapToPin(lat, lng);
    },
    [panMapToPin],
  );

  const onBairroLeafLeave = React.useCallback(() => {
    clearBairroHoverState();
    scheduleMarkerHoverLeave();
  }, [clearBairroHoverState, scheduleMarkerHoverLeave]);

  /**
   * Índice espacial dos pontos; recalcula quando `points` muda (filtros, dados).
   *
   * `map`/`reduce`: cada ponto contribui com `totalAds` (1 para `single`, N para `group`).
   * O reducer soma os contributos para que o cluster apresente o **número real** de
   * anúncios (não o número de pontos do Supercluster, que conta groups como 1).
   */
  const index = React.useMemo(() => {
    const sc = new Supercluster<LeafProps, ClusterAggregateProps>({
      radius: CLUSTER_RADIUS_PX,
      maxZoom: SUPERCLUSTER_MAX_ZOOM,
      minZoom: 0,
      minPoints: CLUSTER_MIN_POINTS,
      map: (props) => ({
        totalAds: props.type === "group" ? props.listings.length : 1,
      }),
      reduce: (acc, props) => {
        acc.totalAds += props.totalAds;
      },
    });
    const geojson: Feature<Point, LeafProps>[] = points.map((p) =>
      p.type === "group"
        ? {
            type: "Feature",
            properties: {
              type: "group",
              listings: p.listings,
              stableId: p.stableId,
              listingStableIds: p.listingStableIds,
            },
            geometry: {
              type: "Point",
              coordinates: [p.lng, p.lat],
            },
          }
        : {
            type: "Feature",
            properties: {
              type: "single",
              listing: p.listing,
              key: p.key,
              stableId: p.stableId,
            },
            geometry: {
              type: "Point",
              coordinates: [p.lng, p.lat],
            },
          },
    );
    sc.load(geojson);
    return sc;
  }, [points]);

  /** Ref ao índice atual para handlers do mapa sem re-registar listeners a cada render. */
  const indexRef = React.useRef(index);
  indexRef.current = index;

  /**
   * Assinatura zoom+bbox da última leitura de clusters.
   * Evita setClusters em loop quando o Leaflet dispara moveend ao montar marcadores.
   */
  const lastViewSigRef = React.useRef<string | null>(null);

  /** Atualiza lista de features visíveis (clusters ou folhas) para o bbox e zoom atuais. */
  const runClusterRefresh = React.useCallback(() => {
    const b = map.getBounds();
    const bbox: [number, number, number, number] = [
      b.getWest(),
      b.getSouth(),
      b.getEast(),
      b.getNorth(),
    ];
    const mapZ = Math.round(map.getZoom());
    /** Só força folhas se o botão estiver ativo e o zoom do mapa ainda for ≥ limiar. */
    const pinsMode = pinsOnly && mapZ >= ZOOM_MIN_PINS_ONLY_CONTROL;
    const clusterZ = pinsMode ? SUPERCLUSTER_LEAF_ZOOM : mapZ;
    const sig = `${pinsMode ? 1 : 0}|${clusterZ}|${bbox[0].toFixed(4)},${bbox[1].toFixed(4)},${bbox[2].toFixed(4)},${bbox[3].toFixed(4)}`;
    if (lastViewSigRef.current === sig) return;
    lastViewSigRef.current = sig;
    setClusters(indexRef.current.getClusters(bbox, clusterZ));
  }, [map, pinsOnly]);

  /** Sincroniza clusters com o novo índice antes do paint (ex.: filtro na SearchBar). */
  React.useLayoutEffect(() => {
    lastViewSigRef.current = null;
    runClusterRefresh();
  }, [index, runClusterRefresh]);

  React.useEffect(() => {
    map.on("moveend", runClusterRefresh);
    map.on("zoomend", runClusterRefresh);
    return () => {
      map.off("moveend", runClusterRefresh);
      map.off("zoomend", runClusterRefresh);
    };
  }, [map, runClusterRefresh]);

  /** Zoom do mapa: botão só em zoom alto; abaixo de 13 volta ao modo clusters. */
  React.useEffect(() => {
    const onZoom = () => {
      const z = Math.round(map.getZoom());
      setMapZoom(z);
      if (z < ZOOM_MIN_PINS_ONLY_CONTROL) setPinsOnly(false);
    };
    map.on("zoomend", onZoom);
    return () => {
      map.off("zoomend", onZoom);
    };
  }, [map]);

  const showPinsOnlyButton = mapZoom >= ZOOM_MIN_PINS_ONLY_CONTROL;

  const [mapPinsBtnMode, setMapPinsBtnMode] = React.useState<
    "hidden" | "entering" | "shown" | "exiting"
  >("hidden");

  React.useEffect(() => {
    if (showPinsOnlyButton) {
      setMapPinsBtnMode((m) =>
        m === "hidden" || m === "exiting" ? "entering" : m,
      );
    } else {
      setMapPinsBtnMode((m) =>
        m === "hidden" || m === "exiting" ? "hidden" : "exiting",
      );
    }
  }, [showPinsOnlyButton]);

  const onMapPinsBtnShellAnimationEnd = (
    e: React.AnimationEvent<HTMLDivElement>,
  ) => {
    if (e.target !== e.currentTarget) return;
    const name = e.animationName;
    if (name !== "olx-pins-only-enter" && name !== "olx-pins-only-exit") return;
    setMapPinsBtnMode((m) => {
      if (m === "entering" && name === "olx-pins-only-enter") return "shown";
      if (m === "exiting" && name === "olx-pins-only-exit") return "hidden";
      return m;
    });
  };

  const mapEl = map.getContainer();

  return (
    <>
      {typeof document !== "undefined" &&
        createPortal(
          mapPinsBtnMode !== "hidden" ? (
            <div className="pointer-events-none absolute left-3 top-3 z-[1100]">
              <div
                className="olx-map-pins-only-btn-shell"
                data-mode={mapPinsBtnMode}
                onAnimationEnd={onMapPinsBtnShellAnimationEnd}
              >
                <span
                  className="olx-map-pins-only-btn-aura"
                  aria-hidden
                />
                <button
                  type="button"
                  onClick={() => setPinsOnly((v) => !v)}
                  className="olx-map-pins-only-btn-face pointer-events-auto relative z-[1] inline-flex w-full min-w-0 max-w-[min(100%,14rem)] cursor-pointer items-center gap-2 rounded-lg border border-[var(--rf-search-dropdown-border)] bg-[var(--rf-popup-bg)] px-3 py-1.5 text-left text-[0.75rem] font-semibold text-foreground shadow-[var(--rf-shadow-dropdown)] transition-[border-color,background-color,box-shadow] duration-150 hover:border-[var(--rf-search-scope-hover-border)] hover:bg-[var(--rf-sidebar-hover)]"
                >
                  <span className="min-w-0 flex-1 leading-snug">
                    {pinsOnly ? "Mostrar agrupamentos" : "Mostrar apenas pins"}
                  </span>
                  <span
                    className="flex size-[18px] shrink-0 items-center justify-center text-[var(--rf-primary-main)]"
                    aria-hidden
                  >
                    {pinsOnly ? (
                      <RiStackFill className="size-[15px]" />
                    ) : (
                      <RiMapPin2Fill className="size-[15px]" />
                    )}
                  </span>
                </button>
              </div>
            </div>
          ) : null,
          mapEl,
        )}
      {clusters.map((feature, i) => {
        const coords = feature.geometry.coordinates;
        const lng = coords[0];
        const lat = coords[1];
        const pos: L.LatLngExpression = [lat, lng];

        /* ─── Agregação: um marcador por cluster, popup com lista + “Ampliar mapa” ─── */
        if (isClusterFeature(feature)) {
          const { cluster_id, totalAds } = feature.properties;
          /**
           * Usamos `totalAds` (do reducer) em vez de `point_count` para que o número
           * exibido reflita anúncios reais — caso contrário, um cluster com 1 grupo de
           * 5 anúncios mostraria "1" porque o Supercluster conta o grupo como 1 ponto.
           */
          const label = abbreviateAdCount(totalAds);
          const detail = tryReadClusterDetail(
            index,
            cluster_id,
            map.getMaxZoom(),
          );
          if (!detail) return null;
          const { expansionZoom, leaves } = detail;
          /**
           * Achata folhas `group` em múltiplas linhas no popup (uma por anúncio do grupo).
           * Caso contrário, o utilizador veria "1 grupo coincidente" sem detalhes — mas
           * o objetivo aqui é mostrar a lista de anúncios reais.
           */
          const popupLeaves: {
            stableId: string;
            listing: OlxListing;
            lat: number;
            lng: number;
          }[] = [];
          for (const leaf of leaves) {
            const [leafLng, leafLat] = leaf.geometry.coordinates;
            const props = leaf.properties;
            if (props.type === "single") {
              popupLeaves.push({
                stableId: props.stableId,
                listing: props.listing,
                lat: leafLat,
                lng: leafLng,
              });
            } else {
              props.listings.forEach((listing, idx) => {
                popupLeaves.push({
                  stableId:
                    props.listingStableIds[idx] ??
                    `${props.stableId}-${idx}`,
                  listing,
                  lat: leafLat,
                  lng: leafLng,
                });
              });
            }
          }

          return (
            <Marker
              key={`c-${cluster_id}-${i}`}
              position={pos}
              icon={clusterDivIcon(label)}
              eventHandlers={{
                mouseover: (e) => {
                  cancelPinLeave();
                  setHoverPinCircle({ lat, lng });
                  clearBairroHoverState();
                  if (hoverPopupsEnabled) {
                    e.target.openPopup();
                  } else {
                    setHoverPanel({
                      kind: "cluster",
                      pointCount: totalAds,
                      leaves: popupLeaves,
                      lat,
                      lng,
                      expansionZoom,
                    });
                  }
                },
                mouseout: () => {
                  scheduleMarkerHoverLeave();
                },
                click: () => {
                  panMapToPin(lat, lng);
                },
              }}
            >
              {/*
                `maxHeight` deliberadamente **não** definido: confiamos no scroll interno
                do `<ul>` (`max-h-[14rem]`) em `OlxClusterPopupContent`. Caso contrário,
                o Leaflet adicionaria o seu próprio wrapper rolável e ficariam dois
                scrollbars empilhados (ver mesma estratégia em `CoincidentGroupMarker`).
              */}
              {hoverPopupsEnabled ? (
                <Popup
                  maxWidth={320}
                  autoPan={false}
                  closeOnClick
                  eventHandlers={popupHoverHandlers}
                >
                  <OlxClusterPopupContent
                    pointCount={totalAds}
                    leaves={popupLeaves}
                    onAmpliarMapa={() => {
                      cancelPinLeave();
                      setHoverPinCircle(null);
                      map.setView([lat, lng], expansionZoom);
                    }}
                    onZoomParaAnuncio={(leafLat, leafLng) => {
                      cancelPinLeave();
                      setHoverPinCircle(null);
                      map.closePopup();
                      const z = Math.min(
                        SUPERCLUSTER_LEAF_ZOOM,
                        map.getMaxZoom(),
                      );
                      map.flyTo([leafLat, leafLng], z, { duration: 0.55 });
                    }}
                  />
                </Popup>
              ) : null}
            </Marker>
          );
        }

        /* ─── Folha "group": vários anúncios na MESMA coordenada → ícone de várias casas ─── */
        const props = feature.properties;
        if (props.type === "group") {
          return (
            <CoincidentGroupMarker
              key={props.stableId}
              lat={lat}
              lng={lng}
              listings={props.listings}
              stableId={props.stableId}
              hoverPopupsEnabled={hoverPopupsEnabled}
              popupHoverHandlers={popupHoverHandlers}
              onEnter={(target, enterLat, enterLng) => {
                cancelPinLeave();
                setHoverPinCircle({ lat: enterLat, lng: enterLng });
                clearBairroHoverState();
                if (hoverPopupsEnabled) {
                  if (!target.isPopupOpen()) target.openPopup();
                } else {
                  setHoverPanel({
                    kind: "group",
                    listings: props.listings,
                    lat: enterLat,
                    lng: enterLng,
                    stableId: props.stableId,
                  });
                }
              }}
              onLeave={onLeafLeave}
              onClick={onLeafClick}
            />
          );
        }

        /* ─── Folha "single": delegada ao `LeafPriceMarker` memoizado (estabiliza o popup) ─── */
        const { listing, stableId } = props;
        const isBairro = listing.enderecoApenasBairro === true;
        return (
          <LeafPriceMarker
            key={stableId}
            listing={listing}
            stableId={stableId}
            lat={lat}
            lng={lng}
            isBairro={isBairro}
            hoverPopupsEnabled={hoverPopupsEnabled}
            bairroIsLoading={
              isBairro && loadingBairro && activeBairroStableId === stableId
            }
            popupHoverHandlers={popupHoverHandlers}
            onPriceMarkerHover={handlePriceMarkerHover}
            onLeafLeave={onLeafLeave}
            onLeafClick={onLeafClick}
            onBairroLeafLeave={onBairroLeafLeave}
          />
        );
      })}

      {/* Halo no hover (todos os pins); contorno do bairro só quando bairroGeoJson !== null */}
      <PinHoverCircleOverlay center={hoverPinCircle} />

      <BairroPolygonOverlay geojson={bairroGeoJson} />

      {typeof document !== "undefined" &&
        createPortal(
          panelBody ? (
            <div
              id="rf-map-hover-detail"
              role="complementary"
              aria-label="Detalhe do elemento no mapa"
              aria-hidden={!panelOpen}
              data-open={panelOpen ? "true" : "false"}
              className="rf-map-hover-detail-panel fixed top-0 right-0 z-[2000] flex h-full w-[min(100vw,320px)] flex-col border-l border-[var(--rf-search-dropdown-border)] bg-[var(--rf-popup-bg)] shadow-[var(--rf-shadow-dropdown)]"
              onMouseEnter={() => {
                pointerOverDetailPanelRef.current = true;
                cancelPinLeave();
              }}
              onMouseLeave={() => {
                pointerOverDetailPanelRef.current = false;
                scheduleMarkerHoverLeave();
              }}
              onTransitionEnd={onPanelTransitionEnd}
            >
              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3 [scrollbar-width:thin]">
                {panelBody.kind === "cluster" ? (
                  <OlxClusterPopupContent
                    pointCount={panelBody.pointCount}
                    leaves={panelBody.leaves}
                    onAmpliarMapa={() => {
                      cancelPinLeave();
                      setHoverPinCircle(null);
                      setHoverPanel(null);
                      map.setView(
                        [panelBody.lat, panelBody.lng],
                        panelBody.expansionZoom,
                      );
                    }}
                    onZoomParaAnuncio={(leafLat, leafLng) => {
                      cancelPinLeave();
                      setHoverPinCircle(null);
                      setHoverPanel(null);
                      const z = Math.min(
                        SUPERCLUSTER_LEAF_ZOOM,
                        map.getMaxZoom(),
                      );
                      map.flyTo([leafLat, leafLng], z, { duration: 0.55 });
                    }}
                  />
                ) : panelBody.kind === "group" ? (
                  <CoincidentGroupPopupContent
                    listings={panelBody.listings}
                    lat={panelBody.lat}
                    lng={panelBody.lng}
                  />
                ) : (
                  <SingleListingMapPopupContent
                    listing={panelBody.listing}
                    lat={panelBody.lat}
                    lng={panelBody.lng}
                    isBairro={panelBody.isBairro}
                    bairroIsLoading={
                      panelBody.isBairro &&
                      loadingBairro &&
                      activeBairroStableId === panelBody.stableId
                    }
                  />
                )}
              </div>
            </div>
          ) : null,
          document.body,
        )}
    </>
  );
}
