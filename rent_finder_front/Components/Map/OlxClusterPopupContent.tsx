"use client";

/**
 * Popup do círculo do Supercluster: lista os anúncios agregados (título + preço + link OLX)
 * com hover próprio em cada botão "OLX" e botão "Ampliar mapa" no rodapé.
 *
 * Visualmente espelha `CoincidentGroupPopupContent` (mesmo header, padding, alinhamento por
 * baseline e estilo do hover do botão OLX) — mantém porém duas afordâncias específicas do
 * cluster: o título é clicável (`onZoomParaAnuncio` centra o mapa nesse anúncio) e o rodapé
 * traz um botão para ampliar o mapa até ao zoom em que o cluster se expande.
 */

import { OpenInNewOutlined, ZoomInMapOutlined } from "@mui/icons-material";
import type { OlxListing } from "@/types/olx";

const DEFAULT_MAX_TITLE_LENGTH = 64;

export type OlxClusterPopupLeaf = {
  stableId: string;
  listing: OlxListing;
  /** Coordenadas do ponto no mapa (GeoJSON do Supercluster). */
  lat: number;
  lng: number;
};

type OlxClusterPopupContentProps = {
  pointCount: number;
  leaves: OlxClusterPopupLeaf[];
  /** Quantidade de caracteres antes de truncar o título. */
  maxTitleLength?: number;
  onAmpliarMapa: () => void;
  /** Centra e amplia o mapa no anúncio (em vez de abrir o link OLX). */
  onZoomParaAnuncio: (lat: number, lng: number) => void;
};

export default function OlxClusterPopupContent({
  pointCount,
  leaves,
  maxTitleLength = DEFAULT_MAX_TITLE_LENGTH,
  onAmpliarMapa,
  onZoomParaAnuncio,
}: OlxClusterPopupContentProps) {
  const truncate = (titulo: string) =>
    titulo.length > maxTitleLength ? `${titulo.slice(0, maxTitleLength)}…` : titulo;

  const overflow = pointCount > leaves.length ? pointCount - leaves.length : 0;

  return (
    <div className="olx-cluster-popup flex w-full max-w-[min(100%,20rem)] flex-col text-foreground">
      <header className="mb-1.5 border-b border-[var(--rf-cluster-popup-footer-border)] pb-1.5">
        <p className="m-0 text-[0.955rem] font-semibold leading-tight tracking-tight text-[var(--rf-cluster-popup-footer-fg)]">
          {pointCount === 1 ? "1 anúncio" : `${pointCount} anúncios`} neste agrupamento
        </p>
        <p className="m-0 mt-0.5 text-[0.825rem] leading-tight text-[var(--rf-cluster-popup-caption)]">
          Clique num título para centrar o mapa nesse anúncio.
        </p>
      </header>

      <ul className="m-0 max-h-[14rem] list-none space-y-0 overflow-y-auto overscroll-contain p-0 [scrollbar-width:thin]">
        {leaves.map(({ stableId, listing: l, lat, lng }) => {
          const titulo = l.titulo?.trim() ? l.titulo : "(sem título)";
          const preco = l.preco?.trim() ? l.preco : "—";
          return (
            <li
              key={stableId}
              /*
               * Mesma estratégia do `CoincidentGroupPopupContent`:
               * `items-baseline` alinha a baseline do título (botão) com a do "OLX";
               * `py-px` mantém as linhas compactas sem perder a área de hover.
               */
              className="group flex min-w-0 items-baseline rounded transition-colors hover:bg-[var(--rf-cluster-popup-row-hover)]"
            >
              <div className="min-w-0 flex-1">
                <button
                  type="button"
                  onClick={() => onZoomParaAnuncio(lat, lng)}
                  aria-label="Centrar o mapa neste anúncio"
                  title={l.titulo}
                  /*
                   * Botão renderizado como um título clicável (block + truncate) — mantém
                   * a tipografia da linha (`text-foreground`) mas sublinha no hover para
                   * sinalizar a afordância de clique sem ruído visual extra.
                   */
                  className="m-0 block w-full cursor-pointer truncate border-0 bg-transparent p-0 text-left text-[0.75rem] font-medium text-foreground underline-offset-2 transition-colors hover:text-[var(--rf-cluster-popup-link-hover)] hover:underline focus-visible:outline-none focus-visible:underline focus-visible:text-[var(--rf-cluster-popup-link-hover)]"
                >
                  {truncate(titulo)}
                </button>
                <p className="m-0 text-[0.75rem] font-semibold text-listing-price">
                  {preco}
                </p>
              </div>
              {l.link ? (
                /*
                 * Hover próprio do botão (independente do `hover:bg-...` da linha):
                 * `border-transparent` reserva o espaço da borda para evitar layout shift.
                 * Reutiliza os tokens `--rf-cluster-popup-btn-*` para coerência com o botão
                 * "Ampliar" do rodapé.
                 */
                <a
                  href={l.link}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`Abrir "${titulo}" no OLX`}
                  className="relative inline-flex shrink-0 items-center gap-0.5 whitespace-nowrap rounded-md border border-transparent px-1.5 py-0.5 text-[0.625rem] font-medium leading-none text-[var(--rf-cluster-popup-icon-fg)] no-underline transition-[color,background-color,border-color,box-shadow] duration-150 hover:border-[var(--rf-cluster-popup-btn-hover-border)] hover:bg-[var(--rf-cluster-popup-btn-hover-bg)] hover:text-[var(--rf-cluster-popup-btn-fg)] hover:shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--rf-cluster-popup-btn-fg)]"
                >
                  <OpenInNewOutlined sx={{ fontSize: 12 }} />
                  OLX
                </a>
              ) : null}
            </li>
          );
        })}
      </ul>

      {overflow > 0 ? (
        <p className="m-0 mt-1 text-[0.625rem] leading-tight text-[var(--rf-cluster-popup-caption)]">
          …e mais {overflow}
        </p>
      ) : null}

      <footer className="mt-1.5 flex items-center justify-end border-t border-[var(--rf-cluster-popup-footer-border)] pt-1.5">
        <button
          type="button"
          onClick={onAmpliarMapa}
          aria-label="Ampliar mapa neste ponto"
          className="inline-flex shrink-0 cursor-pointer items-center gap-0.5 rounded-md border border-[var(--rf-cluster-popup-btn-border)] bg-[var(--rf-cluster-popup-btn-bg)] px-2 py-0.5 text-[0.6875rem] font-semibold text-[var(--rf-cluster-popup-btn-fg)] shadow-none transition-colors duration-150 hover:border-[var(--rf-cluster-popup-btn-hover-border)] hover:bg-[var(--rf-cluster-popup-btn-hover-bg)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--rf-cluster-popup-btn-fg)]"
        >
          <ZoomInMapOutlined sx={{ fontSize: 14 }} aria-hidden />
          Ampliar
        </button>
      </footer>
    </div>
  );
}
