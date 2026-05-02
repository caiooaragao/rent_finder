import type { OlxListing } from "@/types/olx";
import type { ListingSearchScope } from "@/lib/listingSearchScope";

export type SearchListingSuggestion = {
  kind: "listing";
  /** Índice no JSON original — estável para `stableId` olx-${index} */
  index: number;
  listing: OlxListing;
  primaryLabel: string;
  secondaryLabel: string;
  score: number;
};

function scoreForQuery(
  listing: OlxListing,
  raw: string,
  scope: ListingSearchScope,
): number {
  const q = raw.trim().toLowerCase();
  if (!q) return 0;

  if (scope === "bairro") {
    let s = 0;
    const b = (listing.bairro ?? "").toLowerCase();
    const e = (listing.endereco ?? "").toLowerCase();
    if (b && b === q) s += 110;
    else if (b && b.startsWith(q)) s += 80;
    else if (b && b.includes(q)) s += 50;
    if (e.includes(q)) s += 28;
    return s;
  }

  if (scope === "cidade") {
    const c = (listing.cidade ?? "").toLowerCase();
    if (!c) return 0;
    if (c === q) return 120;
    if (c.startsWith(q)) return 85;
    if (c.includes(q)) return 55;
    return 0;
  }

  let s = 0;
  const c = (listing.cidade ?? "").toLowerCase();
  const b = (listing.bairro ?? "").toLowerCase();
  const e = (listing.endereco ?? "").toLowerCase();
  const p = (listing.preco ?? "").toLowerCase();

  if (c && c === q) s += 120;
  else if (c && c.startsWith(q)) s += 85;
  else if (c && c.includes(q)) s += 55;

  if (b && b === q) s += 110;
  else if (b && b.startsWith(q)) s += 80;
  else if (b && b.includes(q)) s += 50;
  if (e.includes(q)) s += 28;

  if (p.includes(q)) s += 45;
  const qd = q.replace(/\D/g, "");
  if (qd.length >= 2) {
    const pd = p.replace(/\D/g, "");
    if (pd.includes(qd)) s += 60;
  }

  return s;
}

/**
 * Sugestões ordenadas por proximidade ao texto conforme `scope`.
 * Só entradas com score &gt; 0.
 * `predicate` opcional: restringe aos anúncios já filtrados no mapa (mesma query + escopo).
 */
export function buildSearchSuggestions(
  listings: OlxListing[],
  rawQuery: string,
  limit = 12,
  predicate?: (listing: OlxListing, index: number) => boolean,
  scope: ListingSearchScope = "tudo",
): SearchListingSuggestion[] {
  const q = rawQuery.trim();
  if (!q) return [];

  const rows: SearchListingSuggestion[] = [];
  for (let i = 0; i < listings.length; i++) {
    const listing = listings[i];
    if (predicate && !predicate(listing, i)) continue;
    const score = scoreForQuery(listing, q, scope);
    if (score <= 0) continue;

    const bairro = listing.bairro?.trim() || listing.endereco?.slice(0, 48) || "—";
    const cidade = listing.cidade?.trim() || "—";
    const preco = listing.preco?.trim() || "—";
    const titulo =
      listing.titulo.length > 56 ? `${listing.titulo.slice(0, 56)}…` : listing.titulo;

    rows.push({
      kind: "listing",
      index: i,
      listing,
      primaryLabel: titulo,
      secondaryLabel: `${bairro} · ${cidade} · ${preco}`,
      score,
    });
  }

  rows.sort((a, b) => b.score - a.score || a.primaryLabel.localeCompare(b.primaryLabel));
  return rows.slice(0, limit);
}
