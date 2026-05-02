import type { ListingSearchScope } from "@/lib/listingSearchScope";

/** Mensagem do Autocomplete quando não há sugestões (`noOptionsText`). */
export const SEARCH_BAR_NO_OPTIONS = {
  bairro: "Nenhum bairro — digite outro termo",
  cidade: "Nenhuma cidade — digite outro termo",
  tudo: "Nenhum imóvel correspondente",
} as const;

export function searchBarNoOptionsText(
  scope: ListingSearchScope,
): string {
  if (scope === "bairro") return SEARCH_BAR_NO_OPTIONS.bairro;
  if (scope === "cidade") return SEARCH_BAR_NO_OPTIONS.cidade;
  return SEARCH_BAR_NO_OPTIONS.tudo;
}
