import type { OlxListing } from "@/types/olx";

/** Item de entrada — um anúncio + a sua coordenada (já resolvida). */
export type GroupableOlxPoint = {
  listing: OlxListing;
  lat: number;
  lng: number;
  key: string;
  /** Único por linha no JSON (link pode repetir). */
  stableId: string;
};

/** Anúncio único na sua coordenada. */
export type CoincidentSinglePoint = {
  type: "single";
  lat: number;
  lng: number;
  listing: OlxListing;
  key: string;
  stableId: string;
};

/**
 * Vários anúncios na **mesma coordenada** (ex.: mesmo prédio, mesmo retorno do geocoder).
 * Em vez de espalhar visualmente num anel, mantemos a coordenada original e exibimos um
 * único marcador composto (ícone de várias casas + contagem). O popup do marcador lista
 * os anúncios deste grupo (ver `CoincidentGroupMarker` / `CoincidentGroupPopupContent`).
 */
export type CoincidentGroupPoint = {
  type: "group";
  lat: number;
  lng: number;
  listings: OlxListing[];
  /** Identificador estável do grupo (derivado da coordenada arredondada). */
  stableId: string;
  /** stableIds dos anúncios individuais — usado por `flyTo` quando o utilizador escolhe um anúncio. */
  listingStableIds: string[];
};

export type GroupedOlxPoint = CoincidentSinglePoint | CoincidentGroupPoint;

export type GroupCoincidentOlxPointsResult = {
  points: GroupedOlxPoint[];
  /** True se pelo menos um grupo (≥2 anúncios partilham coordenada) foi formado. */
  hasCoincidentGroups: boolean;
};

/**
 * Agrupa anúncios com a **mesma lat/lng** (arredondamento a 5 casas decimais ≈ 1 m) num
 * único ponto composto. Anúncios solitários permanecem inalterados como `single`.
 *
 * UX intencional: em vez de espalhar visualmente os anúncios coincidentes num anel, o
 * `OlxSuperclusterLayer` exibe um marcador agregado (ícone de várias casas) e lista os
 * anúncios no popup ao passar o rato — ver `CoincidentGroupMarker`.
 */
export function groupCoincidentOlxPoints(
  points: GroupableOlxPoint[],
): GroupCoincidentOlxPointsResult {
  const groupKey = (lat: number, lng: number) =>
    `${lat.toFixed(5)},${lng.toFixed(5)}`;

  const groups = new Map<string, GroupableOlxPoint[]>();
  for (const p of points) {
    const k = groupKey(p.lat, p.lng);
    let g = groups.get(k);
    if (!g) {
      g = [];
      groups.set(k, g);
    }
    g.push(p);
  }

  const out: GroupedOlxPoint[] = [];
  let hasCoincidentGroups = false;

  for (const [key, group] of groups) {
    if (group.length === 1) {
      const p = group[0];
      out.push({
        type: "single",
        lat: p.lat,
        lng: p.lng,
        listing: p.listing,
        key: p.key,
        stableId: p.stableId,
      });
      continue;
    }

    hasCoincidentGroups = true;
    const first = group[0];
    out.push({
      type: "group",
      lat: first.lat,
      lng: first.lng,
      listings: group.map((g) => g.listing),
      stableId: `coincident-group-${key}`,
      listingStableIds: group.map((g) => g.stableId),
    });
  }

  return { points: out, hasCoincidentGroups };
}
