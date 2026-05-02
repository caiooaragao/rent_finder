import { existsSync, readFileSync } from "node:fs";

/**
 * Carrega variáveis de ambiente a partir de ficheiros .env (sem dependências).
 * Formato: KEY=value, linhas # comentário, valores entre " ou '.
 * @param {string[]} paths — ordem: primeiro define; o seguinte com override=true sobrescreve chaves.
 * @param {{ override?: boolean }} [opts]
 */
export function loadEnvFile(path, opts = {}) {
  const override = Boolean(opts.override);
  if (!existsSync(path)) return;
  const raw = readFileSync(path, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq <= 0) continue;
    const key = t.slice(0, eq).trim();
    if (!key) continue;
    let val = t.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!override && process.env[key] !== undefined) continue;
    process.env[key] = val;
  }
}
