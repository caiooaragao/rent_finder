"use client";

/**
 * Popup do marcador de "várias casas na mesma coordenada" (ver `CoincidentGroupMarker`).
 * Mostra **título** e **preço** de cada anúncio do grupo, com link opcional para o OLX.
 *
 * Quando pelo menos um anúncio tem coordenada exata (`!enderecoApenasBairro`) é também
 * exibido um botão no rodapé que abre a coordenada no Google Street View — útil para
 * inspecionar o prédio/rua sem abrir cada anúncio individualmente.
 */

import { OpenInNewOutlined, StreetviewOutlined } from "@mui/icons-material";
import type { OlxListing } from "@/types/olx";
import { googleStreetViewUrl } from "@/lib/googleStreetViewUrl";

const DEFAULT_MAX_TITLE_LENGTH = 64;

export type CoincidentGroupPopupContentProps = {
  listings: OlxListing[];
  /** Coordenada partilhada por todos os anúncios do grupo — alvo do Street View. */
  lat: number;
  lng: number;
  /** Quantidade de caracteres antes de truncar o título. */
  maxTitleLength?: number;
};

export default function CoincidentGroupPopupContent({
  listings,
  lat,
  lng,
  maxTitleLength = DEFAULT_MAX_TITLE_LENGTH,
}: CoincidentGroupPopupContentProps) {
  /**
   * Só mostramos Street View se pelo menos um dos anúncios tiver endereço completo
   * (i.e. coordenada exata). Em grupos onde *todos* os anúncios têm `enderecoApenasBairro`,
   * a coordenada é o centróide do bairro e o Street View seria pouco útil.
   */
  const hasExactCoordListing = listings.some((l) => !l.enderecoApenasBairro);
  const truncate = (titulo: string) =>
    titulo.length > maxTitleLength ? `${titulo.slice(0, maxTitleLength)}…` : titulo;

  return (
    <div className="olx-coincident-group-popup flex w-full max-w-[min(100%,20rem)] flex-col text-foreground">
      <header className="mb-1.5 border-b border-[var(--rf-cluster-popup-footer-border)] pb-1.5">
        <p className="m-0 text-[0.955rem] font-semibold leading-tight tracking-tight text-[var(--rf-cluster-popup-footer-fg)]">
          {listings.length} anúncios nesta coordenada
        </p>
        <p className="m-0 mt-0.5 text-[0.825rem] leading-tight text-[var(--rf-cluster-popup-caption)]">
          Vários anúncios partilham a mesma localização (prédio ou endereço impreciso).
        </p>
      </header>

      <ul className="m-0 max-h-[14rem] list-none space-y-0 overflow-y-auto overscroll-contain p-0 [scrollbar-width:thin]">
        {listings.map((listing, i) => {
          const titulo = listing.titulo?.trim() ? listing.titulo : "(sem título)";
          const preco = listing.preco?.trim() ? listing.preco : "—";
          const rowKey = listing.link || `coincident-row-${i}`;
          return (
            <li
              key={rowKey}
              /*
               * `items-baseline` alinha o título (primeira linha do `<div>`) com o texto
               * "OLX" do botão pela mesma baseline tipográfica — sem este modo, o botão
               * (que tem `leading-none` + ícone) flutuaria visualmente acima do título.
               * `py-px` (1 px) reduz a altura das linhas mantendo o hover destacável.
               */
              className="group flex min-w-0 items-baseline rounded  transition-colors hover:bg-[var(--rf-cluster-popup-row-hover)]"
            >
              <div className="min-w-0 flex-1">
                <p
                  className="m-0  text-[0.75rem] font-medium  text-foreground"
                  title={listing.titulo}
                >
                  {truncate(titulo)}
                </p>
                <p className="m-0 text-[0.75rem] font-semibold  text-listing-price">
                  {preco}
                </p>
              </div>
              {listing.link ? (
                /*
                 * Hover próprio do botão (independente do `hover:bg-...` da linha):
                 * `border-transparent` reserva espaço para a borda — assim o hover não
                 * causa shift de layout. Reutilizamos os tokens `--rf-cluster-popup-btn-*`
                 * para coerência com o botão "Ampliar" do popup do cluster.
                 */
                <a
                  href={listing.link}
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

      {hasExactCoordListing ? (
        /*
         * Mesmo estilo visual do botão "Ampliar" em `OlxClusterPopupContent` (tokens
         * `--rf-cluster-popup-btn-*`) — mantém coerência entre os dois popups.
         */
        <footer className="mt-1.5 flex items-center justify-end border-t border-[var(--rf-cluster-popup-footer-border)] pt-1.5">
          <a
            href={googleStreetViewUrl(lat, lng)}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Abrir esta coordenada no Google Street View"
            className="inline-flex shrink-0 items-center gap-1 rounded-md border border-[var(--rf-cluster-popup-btn-border)] bg-[var(--rf-cluster-popup-btn-bg)] px-2 py-0.5 text-[0.6875rem] font-semibold text-[var(--rf-cluster-popup-btn-fg)] no-underline shadow-none transition-colors duration-150 hover:border-[var(--rf-cluster-popup-btn-hover-border)] hover:bg-[var(--rf-cluster-popup-btn-hover-bg)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--rf-cluster-popup-btn-fg)]"
          >
            <StreetviewOutlined sx={{ fontSize: 14 }} aria-hidden />
            Abrir no Street View
          </a>
        </footer>
      ) : null}
    </div>
  );
}
