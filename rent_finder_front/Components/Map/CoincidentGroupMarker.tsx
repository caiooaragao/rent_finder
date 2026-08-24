"use client";

/**
 * Marcador para várias unidades na **mesma coordenada**: ícone de várias casas
 * (`RiCommunityFill`) + contagem. Os anúncios coincidentes são pré-agrupados em
 * `groupCoincidentOlxPoints` e o `OlxSuperclusterLayer` instancia este marcador
 * em vez de etiquetas de preço sobrepostas.
 *
 * Ao passar o rato, o popup mostra a lista de anúncios (título + preço) — ver
 * `CoincidentGroupPopupContent`. O comportamento de hover (delay ao sair, cancelamento
 * pelo `popupHoverHandlers`) é alinhado com `LeafPriceMarker` para evitar piscar.
 */

import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { RiCommunityFill } from "react-icons/ri";
import L from "leaflet";
import { Marker, Popup } from "react-leaflet";
import type { OlxListing } from "@/types/olx";
import CoincidentGroupPopupContent from "./CoincidentGroupPopupContent";

/**
 * Altura aproximada do marcador (padding 3 + 3 + ícone 14 + borda 1 + 1 ≈ 22 px).
 * Usado no `popupAnchor` para garantir folga até à ponta do popup (mesma lógica do
 * `PRICE_LABEL_HEIGHT_PX` em `OlxSuperclusterLayer`).
 */
const COINCIDENT_GROUP_HEIGHT_PX = 22;
/** Folga entre o topo do marcador e a ponta do popup (espelha PRICE_LABEL_TO_POPUP_GAP_PX). */
const COINCIDENT_GROUP_TO_POPUP_GAP_PX = 14;

const COINCIDENT_GROUP_ICON_CACHE = new Map<number, L.DivIcon>();

/** Renderizado uma única vez por sessão — react-icons não muda em runtime. */
const HOUSE_ICON_SVG = renderToStaticMarkup(
  <RiCommunityFill aria-hidden focusable={false} />,
);

function coincidentGroupDivIcon(count: number): L.DivIcon {
  const cached = COINCIDENT_GROUP_ICON_CACHE.get(count);
  if (cached) return cached;
  /**
   * **Estrutura âncora-invisível + corpo posicionado** (em vez de "o marcador é a etiqueta"):
   *
   * - O wrapper `.olx-coincident-group-marker` é dimensionado a 0×0 px por CSS — funciona
   *   apenas como ponto de ancoragem no lat/lng (via `transform: translate3d` do Leaflet).
   * - O conteúdo visível fica em `.olx-coincident-group-marker__body` com
   *   `position: absolute; bottom: 0; left: 50%; transform: translateX(-50%)`, o que
   *   posiciona o **centro inferior** do corpo exatamente sobre o lat/lng.
   *
   * Porquê esta indireção? A abordagem direta (`width: max-content` + `translate: -50% -100%`
   * no próprio wrapper) compunha-se com o `transform: translate3d(x, y, 0)` do Leaflet de
   * forma frágil, produzindo desalinhamentos verticais residuais nalguns marcadores. Com o
   * wrapper a 0×0 px, todo o posicionamento do corpo é local (relativo a um ponto fixo) e
   * não há composição de transformações dependente das dimensões do conteúdo.
   */
  const html =
    `<span class="olx-coincident-group-marker__body">` +
    `<span class="olx-coincident-group-icon" aria-hidden="true">${HOUSE_ICON_SVG}</span>` +
    `<span class="olx-coincident-group-count" aria-hidden="true">${count}</span>` +
    `<span class="olx-coincident-group-pulse" aria-hidden="true"></span>` +
    `</span>`;
  /**
   * `iconSize: undefined`: deixa o wrapper-âncora ser dimensionado por CSS (0×0). O Leaflet
   * não fixa width/height/margin inline, ficando o `transform: translate3d` como única
   * influência na posição do wrapper — o corpo visível posiciona-se a partir daí.
   */
  const icon = L.divIcon({
    html,
    className: "olx-coincident-group-marker",
    iconSize: undefined,
    popupAnchor: [
      0,
      -(COINCIDENT_GROUP_HEIGHT_PX + COINCIDENT_GROUP_TO_POPUP_GAP_PX),
    ],
  });
  COINCIDENT_GROUP_ICON_CACHE.set(count, icon);
  return icon;
}

export type CoincidentGroupMarkerProps = {
  lat: number;
  lng: number;
  listings: OlxListing[];
  stableId: string;
  /** Se false, não monta `Popup` — o pai pode mostrar o mesmo conteúdo noutro sítio. */
  hoverPopupsEnabled?: boolean;
  /** Handlers já memoizados pelo pai (espelha `LeafPriceMarker`). */
  popupHoverHandlers: L.LeafletEventHandlerFnMap;
  onEnter: (target: L.Marker, lat: number, lng: number) => void;
  onLeave: () => void;
  onClick: (lat: number, lng: number) => void;
};

const CoincidentGroupMarker = React.memo(function CoincidentGroupMarker({
  lat,
  lng,
  listings,
  popupHoverHandlers,
  hoverPopupsEnabled = true,
  onEnter,
  onLeave,
  onClick,
}: CoincidentGroupMarkerProps) {
  const eventHandlers = React.useMemo<L.LeafletEventHandlerFnMap>(
    () => ({
      mouseover: (e: L.LeafletMouseEvent) => {
        onEnter(e.target as L.Marker, lat, lng);
      },
      mouseout: onLeave,
      click: () => onClick(lat, lng),
    }),
    [lat, lng, onEnter, onLeave, onClick],
  );

  return (
    <Marker
      position={[lat, lng]}
      icon={coincidentGroupDivIcon(listings.length)}
      riseOnHover
      eventHandlers={eventHandlers}
    >
      {/*
        `maxHeight` deliberadamente **não** definido: o Leaflet aplicaria o seu próprio
        wrapper rolável (`.leaflet-popup-scrolled`) e teríamos dois scrollbars empilhados
        — o do Leaflet e o do `<ul>` interno (`max-h-[14rem]`). Confiamos só no scroll
        interno, que tem estilo coerente com o resto da aplicação.
      */}
      {hoverPopupsEnabled ? (
        <Popup
          maxWidth={320}
          autoPan={false}
          closeOnClick
          interactive
          eventHandlers={popupHoverHandlers}
        >
          <CoincidentGroupPopupContent listings={listings} lat={lat} lng={lng} />
        </Popup>
      ) : null}
    </Marker>
  );
});

export default CoincidentGroupMarker;
