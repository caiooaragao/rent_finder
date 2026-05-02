/**
 * Converte strings tipo "R$ 650", "R$ 11.000", "R$ 1.500,50" (BR) em número.
 */
export function parsePrecoToNumber(
  preco: string | null | undefined,
): number | null {
  if (!preco?.trim()) return null;
  const t = preco.trim().replace(/R\$\s*/i, "").replace(/\s/g, "");
  if (!t) return null;
  const parts = t.split(",");
  const intRaw = (parts[0] ?? "").replace(/\./g, "").replace(/\D/g, "");
  const decRaw = (parts[1] ?? "").replace(/\D/g, "");
  if (!intRaw && !decRaw) return null;
  const whole = intRaw || "0";
  const frac = decRaw.slice(0, 2).padEnd(2, "0");
  const n =
    parts.length > 1
      ? parseFloat(`${whole}.${frac}`)
      : parseInt(whole, 10);
  return Number.isFinite(n) ? n : null;
}
