import type { SearchListingSuggestion } from "@/lib/searchListingSuggestions";
import type { BairroSearchOption, CidadeSearchOption } from "@/lib/placeSearchOptions";

export type SearchBarOption =
  | SearchListingSuggestion
  | BairroSearchOption
  | CidadeSearchOption;

export function searchBarOptionKey(o: SearchBarOption): string | number {
  if (o.kind === "listing") return o.index;
  return o.id;
}

export function isListingSearchOption(
  o: SearchBarOption,
): o is SearchListingSuggestion {
  return o.kind === "listing";
}
