import type { OlxListing } from "@/types/olx";
import type { ListingSearchScope } from "@/lib/listingSearchScope";
import {
  listingPassesPriceRange,
  type PriceRangeFilter,
} from "@/lib/listingPriceRange";

function norm(s: string) {
  return s.trim().toLowerCase();
}

/** Após escolher um bairro/cidade no autocomplete (desambigua homônimos). */
export type ListingPlacePin =
  | { kind: "bairro"; bairro: string; cidade: string; estado: string | null }
  | { kind: "cidade"; cidade: string; estado: string | null };

function estadoCompat(listingEstado: string, pinEstado: string): boolean {
  const le = norm(listingEstado);
  const pe = norm(pinEstado);
  if (!pe) return true;
  if (!le) return true;
  return le.includes(pe) || pe.includes(le);
}

export type { PriceRangeFilter };

/** Filtro do mapa conforme o escopo escolhido na SearchBar. */
export function listingMatchesSearchQuery(
  listing: OlxListing,
  rawQuery: string,
  scope: ListingSearchScope = "tudo",
  placePin: ListingPlacePin | null = null,
  priceRange: PriceRangeFilter | null = null,
): boolean {
  if (!listingPassesPriceRange(listing, priceRange)) return false;

  const q = rawQuery.trim().toLowerCase();

  if (placePin?.kind === "bairro") {
    const lb = norm(listing.bairro ?? "");
    const lc = norm(listing.cidade ?? "");
    if (lb !== norm(placePin.bairro) || lc !== norm(placePin.cidade))
      return false;
    if (placePin.estado && !estadoCompat(listing.estado ?? "", placePin.estado))
      return false;
    if (!q) return true;
    const bairroHay = [listing.bairro, listing.endereco]
      .map((s) => (s ?? "").toLowerCase())
      .join(" ");
    return bairroHay.includes(q);
  }

  if (placePin?.kind === "cidade") {
    const lc = norm(listing.cidade ?? "");
    if (lc !== norm(placePin.cidade)) return false;
    if (
      placePin.estado &&
      !estadoCompat(listing.estado ?? "", placePin.estado)
    )
      return false;
    if (!q) return true;
    return (listing.cidade ?? "").toLowerCase().includes(q);
  }

  if (!q) return true;

  if (scope === "bairro") {
    const bairroHay = [listing.bairro, listing.endereco]
      .map((s) => (s ?? "").toLowerCase())
      .join(" ");
    return bairroHay.includes(q);
  }

  if (scope === "cidade") {
    const cidade = (listing.cidade ?? "").toLowerCase();
    return cidade.includes(q);
  }

  const bairroHay = [listing.bairro, listing.endereco]
    .map((s) => (s ?? "").toLowerCase())
    .join(" ");
  if (bairroHay.includes(q)) return true;

  const cidade = (listing.cidade ?? "").toLowerCase();
  if (cidade.includes(q)) return true;

  const precoHay = (listing.preco ?? "").toLowerCase();
  if (precoHay.includes(q)) return true;
  const qDigits = q.replace(/\D/g, "");
  if (qDigits.length >= 2) {
    const precoDigits = precoHay.replace(/\D/g, "");
    if (precoDigits.includes(qDigits)) return true;
  }

  return false;
}
