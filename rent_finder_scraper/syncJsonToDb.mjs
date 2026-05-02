#!/usr/bin/env node
/**
 * Lê um arquivo JSON de anúncios já scrapeados e sincroniza com o Supabase,
 * sem fazer novo scrape.
 *
 * Usage:
 *   node syncJsonToDb.mjs                          # lê olx-scrape.json no cwd
 *   node syncJsonToDb.mjs --input resultados.json  # arquivo customizado
 *   node syncJsonToDb.mjs --skip-migrate           # não aplica migrations
 *   node syncJsonToDb.mjs --batch-size 200         # anúncios por lote (default: 500)
 */

import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";

import { loadEnvFile } from "./loadEnv.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
loadEnvFile(join(__dirname, ".env"));
loadEnvFile(join(__dirname, "../rent_finder_front/.env.local"), { override: true });

import { runMigrations } from "./runMigrations.mjs";

function parseArgs(argv) {
  let inputPath = resolve(process.cwd(), "olx-scrape.json");
  let skipMigrate = false;
  let batchSize = 500;

  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--input" || a === "-i") {
      const p = argv[++i];
      if (p) inputPath = resolve(process.cwd(), p);
    } else if (a === "--skip-migrate") {
      skipMigrate = true;
    } else if (a === "--batch-size") {
      const n = parseInt(argv[++i], 10);
      if (Number.isFinite(n) && n > 0) batchSize = n;
    } else if (!a.startsWith("-")) {
      inputPath = resolve(process.cwd(), a);
    }
  }

  return { inputPath, skipMigrate, batchSize };
}

async function main() {
  const { inputPath, skipMigrate, batchSize } = parseArgs(process.argv);

  if (!process.env.DATABASE_URL) {
    console.error(
      "[DB] DATABASE_URL não definida — defina em rent_finder_front/.env.local ou rent_finder_scraper/.env."
    );
    process.exit(1);
  }

  // Lê e valida o JSON
  console.error(`[sync] Lendo ${inputPath}…`);
  let ads;
  try {
    const raw = await readFile(inputPath, "utf8");
    ads = JSON.parse(raw);
  } catch (e) {
    console.error(`[sync] Erro ao ler/parsear o arquivo: ${e.message}`);
    process.exit(1);
  }

  if (!Array.isArray(ads)) {
    console.error(`[sync] O arquivo não contém um array JSON válido.`);
    process.exit(1);
  }

  console.error(`[sync] ${ads.length} anúncio(s) encontrados.`);

  // Migrations
  if (!skipMigrate) {
    await runMigrations();
  }

  // Abre conexão uma única vez
  const { openDbConnection, closeDbConnection, syncAdsBatch } = await import("./syncSupabase.mjs");
  const sql = await openDbConnection(process.env.DATABASE_URL);

  const totalBatches = Math.ceil(ads.length / batchSize);
  let totalSynced = 0;

  try {
    for (let i = 0; i < ads.length; i += batchSize) {
      const batch = ads.slice(i, Math.min(i + batchSize, ads.length));
      const batchNum = Math.floor(i / batchSize) + 1;
      console.error(
        `[batch ${batchNum}/${totalBatches}] ${batch.length} anúncios (${i + 1}–${i + batch.length} de ${ads.length})…`
      );

      const { synced } = await syncAdsBatch(sql, batch);
      totalSynced += synced;
      console.error(`  → ${synced} gravados/atualizados. Total acumulado: ${totalSynced}`);
    }

    console.error(`\n[sync] Concluído: ${totalSynced}/${ads.length} anúncio(s) sincronizados.`);
  } finally {
    await closeDbConnection(sql);
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
