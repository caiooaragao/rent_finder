import type { OlxListing } from "@/types/olx";
import {
  listingPassesPriceRange,
  type PriceRangeFilter,
} from "@/lib/listingPriceRange";

function norm(s: string) {
  return s.trim().toLowerCase();
}

function stripAccents(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

/**
 * Expande abreviações comuns em nomes de bairro (PT-BR) para alinhar com a forma falada.
 * Ex.: "Sto. Amaro" → "santo amaro" (comparação com query sem pontuação).
 */
function expandBairroAbbreviations(s: string): string {
  let t = stripAccents(s.trim().toLowerCase());
  t = t.replace(/\bsto\.?\b/g, "santo ");
  t = t.replace(/\bsta\.?\b/g, "santa ");
  t = t.replace(/\bsão\b/g, "sao ");
  return t.replace(/\s+/g, " ").trim();
}

/**
 * Correspondência flexível: frase completa como substring OU cada palavra da query
 * aparece no nome (útil para "santo amaro" vs "Sto. Amaro").
 */
function placeNameMatchesQuery(placeName: string, rawQuery: string): boolean {
  const q = expandBairroAbbreviations(rawQuery);
  const p = expandBairroAbbreviations(placeName);
  if (!q) return false;
  if (p.includes(q)) return true;
  const words = q.split(/\s+/).filter((w) => w.length > 0);
  if (words.length === 0) return false;
  return words.every((w) => p.includes(w));
}

export type BairroSearchOption = {
  kind: "bairro";
  id: string;
  bairro: string;
  cidade: string;
  estado: string | null;
  primaryLabel: string;
  secondaryLabel: string;
  listingCount: number;
};

export type CidadeSearchOption = {
  kind: "cidade";
  id: string;
  cidade: string;
  estado: string | null;
  primaryLabel: string;
  secondaryLabel: string;
  listingCount: number;
};

/** Bairros distintos (bairro + cidade + estado) presentes nos anúncios. */
export function buildBairroSearchOptions(
  listings: OlxListing[],
  rawQuery: string,
  limit = 24,
  priceRange: PriceRangeFilter | null = null,
): BairroSearchOption[] {
  const q = rawQuery.trim().toLowerCase();

  const agg = new Map<
    string,
    { bairro: string; cidade: string; estado: string | null; count: number }
  >();

  for (const l of listings) {
    if (!listingPassesPriceRange(l, priceRange)) continue;
    const b = l.bairro?.trim();
    const c = l.cidade?.trim();
    if (!b || !c) continue;
    const e = l.estado?.trim() ?? null;
    const id = `${norm(b)}|${norm(c)}|${norm(e ?? "")}`;
    const cur = agg.get(id);
    if (cur) cur.count += 1;
    else agg.set(id, { bairro: b, cidade: c, estado: e, count: 1 });
  }

  const rows: BairroSearchOption[] = [...agg.values()].map((v) => ({
    kind: "bairro" as const,
    id: `${v.bairro}|${v.cidade}|${v.estado ?? ""}`,
    bairro: v.bairro,
    cidade: v.cidade,
    estado: v.estado,
    primaryLabel: v.bairro,
    secondaryLabel: `${v.cidade}${v.estado ? ` · ${v.estado}` : ""} · ${v.count} imóvel${v.count === 1 ? "" : "es"}`,
    listingCount: v.count,
  }));

  const filtered = q
    ? rows.filter(
        (r) =>
          placeNameMatchesQuery(r.bairro, rawQuery) ||
          placeNameMatchesQuery(r.cidade, rawQuery) ||
          (r.estado != null && placeNameMatchesQuery(r.estado, rawQuery)),
      )
    : rows;

  filtered.sort(
    (a, b) =>
      a.primaryLabel.localeCompare(b.primaryLabel, "pt-BR") ||
      a.secondaryLabel.localeCompare(b.secondaryLabel, "pt-BR"),
  );
  return filtered.slice(0, limit);
}

/** Cidades distintas presentes nos anúncios. */
export function buildCidadeSearchOptions(
  listings: OlxListing[],
  rawQuery: string,
  limit = 24,
  priceRange: PriceRangeFilter | null = null,
): CidadeSearchOption[] {
  const hasQuery = rawQuery.trim().length > 0;

  const agg = new Map<
    string,
    { cidade: string; estado: string | null; count: number }
  >();

  for (const l of listings) {
    if (!listingPassesPriceRange(l, priceRange)) continue;
    const c = l.cidade?.trim();
    if (!c) continue;
    const e = l.estado?.trim() ?? null;
    const id = `${norm(c)}|${norm(e ?? "")}`;
    const cur = agg.get(id);
    if (cur) cur.count += 1;
    else agg.set(id, { cidade: c, estado: e, count: 1 });
  }

  const rows: CidadeSearchOption[] = [...agg.values()].map((v) => ({
    kind: "cidade" as const,
    id: `${v.cidade}|${v.estado ?? ""}`,
    cidade: v.cidade,
    estado: v.estado,
    primaryLabel: v.cidade,
    secondaryLabel: `${v.estado ? `${v.estado} · ` : ""}${v.count} imóvel${v.count === 1 ? "" : "es"}`,
    listingCount: v.count,
  }));

  const filtered = hasQuery
    ? rows.filter(
        (r) =>
          placeNameMatchesQuery(r.cidade, rawQuery) ||
          (r.estado != null && placeNameMatchesQuery(r.estado, rawQuery)),
      )
    : rows;

  filtered.sort((a, b) =>
    a.primaryLabel.localeCompare(b.primaryLabel, "pt-BR"),
  );
  return filtered.slice(0, limit);
}
