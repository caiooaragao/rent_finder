/** Onde o texto da busca é aplicado (mapa + sugestões). */
export type ListingSearchScope = "bairro" | "cidade" | "tudo";

export const LISTING_SEARCH_SCOPE_LABELS: Record<ListingSearchScope, string> = {
  bairro: "Bairros",
  cidade: "Cidades",
  tudo: "Todos",
};

export function searchPlaceholderForScope(scope: ListingSearchScope): string {
  switch (scope) {
    case "bairro":
      return "Bairro ou trecho do endereço…";
    case "cidade":
      return "Cidade…";
    default:
      return "Buscar em tudo…";
  }
}
