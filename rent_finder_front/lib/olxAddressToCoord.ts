import type { LatLngExpression } from "leaflet";

/**
 * O scraper não traz lat/lng. Estimativa grosseira por cidade/bairro no texto do endereço
 * (PE) + pequeno deslocamento para não sobrepor todos os pins no mesmo ponto.
 */
const REGION_BASE: { test: (s: string) => boolean; coord: LatLngExpression }[] = [
  { test: (s) => /petrolina/i.test(s), coord: [-9.3958, -40.5025] },
  { test: (s) => /garanhuns/i.test(s), coord: [-8.8902, -36.4926] },
  { test: (s) => /salgueiro/i.test(s), coord: [-8.0739, -39.1197] },
  { test: (s) => /caruaru/i.test(s), coord: [-8.2832, -35.9714] },
  {
    test: (s) =>
      /jaboat|joão pessoa|piedade|candeias|barra de jangada/i.test(s),
    coord: [-8.1632, -34.9183],
  },
  {
    test: (s) =>
      /recife|boa vista|boa viagem|campo grande|casa amarela|pina|espinheiro|derby|afogados|olinda|paulista|igarassu/i.test(
        s
      ),
    coord: [-8.0476, -34.877],
  },
];

function hashSeed(str: string, i: number): number {
  const s = `${str}\0${i}`;
  let h = 2166136261;
  for (let k = 0; k < s.length; k++) {
    h ^= s.charCodeAt(k);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function jitter(coord: LatLngExpression, seed: string, i: number): LatLngExpression {
  const h = hashSeed(seed, i);
  const dx = ((h % 401) - 200) / 6000;
  const dy = (((h >> 10) % 401) - 200) / 6000;
  const lat = Array.isArray(coord) ? coord[0] : coord.lat;
  const lng = Array.isArray(coord) ? coord[1] : coord.lng;
  return [lat + dx, lng + dy];
}

export function approxCoordForEndereco(
  endereco: string,
  index: number
): LatLngExpression | null {
  const t = endereco.trim();
  if (!t) return null;

  const lower = t.toLowerCase();
  for (const { test, coord } of REGION_BASE) {
    if (test(lower)) {
      return jitter(coord, t, index);
    }
  }

  // Fallback: estado PE (centro aproximado)
  return jitter([-8.5, -37.5], t, index);
}
