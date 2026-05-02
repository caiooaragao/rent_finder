import type { OlxListing } from "@/types/olx";
import { parsePrecoToNumber } from "@/lib/parseListingPreco";

export type PriceRangeFilter = { min: number; max: number };

export function listingPassesPriceRange(
  listing: OlxListing,
  range: PriceRangeFilter | null,
): boolean {
  if (!range) return true;
  const v = parsePrecoToNumber(listing.preco);
  if (v == null) return false;
  return v >= range.min && v <= range.max;
}

export type ListingPriceBounds = { min: number; max: number };

/** Teto do intervalo de preço no filtro (R$). */
export const LISTING_PRICE_MAX_CAP = 2_000_000;

/** Min a partir do dataset; máximo fixo em `LISTING_PRICE_MAX_CAP` (R$ 2 milhões). */
export function computeListingPriceBounds(
  listings: OlxListing[],
): ListingPriceBounds {
  let minP = Infinity;
  let maxP = -Infinity;
  for (const l of listings) {
    const v = parsePrecoToNumber(l.preco);
    if (v == null) continue;
    minP = Math.min(minP, v);
    maxP = Math.max(maxP, v);
  }
  if (!Number.isFinite(minP) || !Number.isFinite(maxP)) {
    return { min: 0, max: LISTING_PRICE_MAX_CAP };
  }
  const lo = Math.floor(minP);
  const maxCap = LISTING_PRICE_MAX_CAP;
  if (lo >= maxCap) {
    return { min: Math.max(0, maxCap - 1), max: maxCap };
  }
  return { min: lo, max: maxCap };
}

/** `null` quando o intervalo cobre todo o dataset (sem filtro efetivo). */
export function effectivePriceFilter(
  range: [number, number],
  bounds: ListingPriceBounds,
): PriceRangeFilter | null {
  const [a, b] = range;
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  if (lo <= bounds.min && hi >= bounds.max) return null;
  return { min: lo, max: hi };
}
