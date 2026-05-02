#!/usr/bin/env node
/**
 * Runner que executa scrape-olx-titles.mjs como processo SEPARADO para cada
 * URL de pesquisa OLX. Cada processo tem heap isolado — ao terminar, o OS
 * libera toda a memória. Não há acúmulo entre URLs.
 *
 * Fluxo:
 *   1. Aplica migrations (uma vez).
 *   2. TRUNCATE na tabela anuncios (uma vez, a menos que --no-truncate).
 *   3. Para cada URL do RESEARCH_ARRAY:
 *        → spawna processo Node separado com heap limitado
 *        → scrape-olx-titles.mjs <url> --no-truncate --skip-migrate
 *          (gravar no DB via upsert por link — duplicatas são impossíveis)
 *        → processo termina, memória devolvida ao OS
 *   4. Pronto.
 *
 * Usage:
 *   node run-scrape-all.mjs
 *   node run-scrape-all.mjs --concurrency 5 --geocode-concurrency 10
 *   node run-scrape-all.mjs --skip-geocode
 *   node run-scrape-all.mjs --pages 2             # teste: só 2 páginas por URL
 *   node run-scrape-all.mjs --no-truncate          # não apaga dados antigos
 *   node run-scrape-all.mjs --no-db                # só JSON, sem DB
 *   node run-scrape-all.mjs --heap 4096            # MB de heap por processo (default: 4096)
 */

import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { loadEnvFile } from "./loadEnv.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
loadEnvFile(join(__dirname, ".env"));
loadEnvFile(join(__dirname, "../rent_finder_front/.env.local"), { override: true });

import { runMigrations } from "./runMigrations.mjs";

const RESEARCH_ARRAY = [
  "https://www.olx.com.br/imoveis/aluguel/estado-pe?q=aluguel",
  "https://www.olx.com.br/imoveis/aluguel/casas/estado-pe",
  "https://www.olx.com.br/imoveis/aluguel/kitnet/estado-pe",
];

function parseArgs(argv) {
  const passthrough = [];
  let noDb = false;
  let noTruncate = false;
  let heapMb = 4096;

  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--no-db") {
      noDb = true;
      passthrough.push(a);
    } else if (a === "--no-truncate") {
      noTruncate = true;
    } else if (a === "--heap") {
      const n = parseInt(argv[++i], 10);
      if (Number.isFinite(n) && n > 0) heapMb = n;
    } else if (
      a === "--skip-geocode" ||
      a === "--skip-details" ||
      a === "--stdout"
    ) {
      passthrough.push(a);
    } else if (
      a === "--concurrency" || a === "-c" ||
      a === "--geocode-concurrency" ||
      a === "--batch-size" ||
      a === "--detail-max" ||
      a === "--pages" || a === "-n" ||
      a === "--out" || a === "-o"
    ) {
      passthrough.push(a, argv[++i]);
    }
  }

  return { passthrough, noDb, noTruncate, heapMb };
}

function spawnChild(nodeArgs, scriptArgs) {
  return new Promise((resolve, reject) => {
    const child = spawn("node", [...nodeArgs, "scrape-olx-titles.mjs", ...scriptArgs], {
      stdio: "inherit",
      cwd: __dirname,
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Processo filho encerrou com código ${code}`));
    });
  });
}

async function main() {
  const { passthrough, noDb, noTruncate, heapMb } = parseArgs(process.argv);
  const dbEnabled = !noDb && Boolean(process.env.DATABASE_URL);

  const nodeArgs = [`--max-old-space-size=${heapMb}`, "--expose-gc"];

  console.error(`[runner] ${RESEARCH_ARRAY.length} URLs | heap=${heapMb}MB por processo`);
  if (passthrough.length) {
    console.error(`[runner] flags repassadas: ${passthrough.join(" ")}`);
  }

  // ── Passo único de migrations + truncate (feito aqui, não nos filhos) ─────

  if (dbEnabled) {
    await runMigrations();
    if (!noTruncate) {
      const { openDbConnection, closeDbConnection, truncateAnuncios } =
        await import("./syncSupabase.mjs");
      const sql = await openDbConnection(process.env.DATABASE_URL);
      console.error("[runner] TRUNCATE anuncios…");
      await truncateAnuncios(sql);
      await closeDbConnection(sql);
      console.error("[runner] Tabela limpa.");
    }
  }

  // ── Um processo por URL ───────────────────────────────────────────────────

  const t0 = Date.now();
  let ok = 0;

  for (let i = 0; i < RESEARCH_ARRAY.length; i++) {
    const url = RESEARCH_ARRAY[i];
    const outFile = `olx-scrape-${i}.json`;

    console.error(
      `\n${"─".repeat(60)}\n[runner] URL ${i + 1}/${RESEARCH_ARRAY.length}: ${url}`
    );

    const childArgs = [
      url,
      "--no-truncate",    // truncate já foi feito acima, uma vez só
      "--skip-migrate",   // migrations já foram aplicadas acima
      "--out", outFile,
      ...passthrough,
    ];

    // Se --no-db, o filho também não toca o DB
    if (noDb) childArgs.push("--no-db");

    try {
      await spawnChild(nodeArgs, childArgs);
      ok++;
      console.error(`[runner] URL ${i + 1} concluída.`);
    } catch (e) {
      console.error(`[runner] URL ${i + 1} falhou: ${e.message}`);
      console.error("[runner] Continuando com a próxima URL…");
    }
  }

  const elapsed = ((Date.now() - t0) / 60000).toFixed(1);
  console.error(
    `\n${"─".repeat(60)}\n[runner] Concluído: ${ok}/${RESEARCH_ARRAY.length} URLs em ${elapsed} min.`
  );
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
