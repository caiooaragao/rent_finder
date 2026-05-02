/**
 * Aplica migrações SQL em migrations/*.sql (ordenadas por nome).
 * Estado em rent_finder_scraper_migrations. prepare: false para pooler Supabase.
 * Alterações de schema: manter em sync com rent_finder_front/supabase/migrations/.
 */

import { readdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { loadEnvFile } from "./loadEnv.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

const DEFAULT_MIGRATIONS_DIR = join(__dirname, "migrations");

/**
 * @returns {Promise<typeof import("postgres").default>}
 */
async function loadPostgres() {
  const candidates = [
    join(__dirname, "../rent_finder_front/package.json"),
    join(__dirname, "package.json"),
  ];
  for (const pkgJson of candidates) {
    try {
      const require = createRequire(pkgJson);
      const resolved = require.resolve("postgres");
      const mod = await import(pathToFileURL(resolved).href);
      if (typeof mod.default === "function") return mod.default;
    } catch {
      /* tenta o seguinte */
    }
  }
  const mod = await import("postgres");
  return mod.default;
}

/**
 * @param {import('postgres').Sql} sql
 */
async function ensureMigrationsTable(sql) {
  await sql`
    CREATE TABLE IF NOT EXISTS rent_finder_scraper_migrations (
      name text PRIMARY KEY NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `;
}

/**
 * @param {{ databaseUrl?: string, migrationsDir?: string }} [options]
 * @returns {Promise<{ applied: string[] }>}
 */
export async function runMigrations(options = {}) {
  const databaseUrl = options.databaseUrl ?? process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL não está definida");
  }

  const migrationsDir = options.migrationsDir ?? DEFAULT_MIGRATIONS_DIR;

  const postgres = await loadPostgres();
  const sql = postgres(databaseUrl, { prepare: false, max: 1 });

  const appliedNames = [];

  try {
    await ensureMigrationsTable(sql);

    const names = (await readdir(migrationsDir))
      .filter((f) => f.endsWith(".sql"))
      .sort();

    for (const name of names) {
      const existing = await sql`
        SELECT 1 FROM rent_finder_scraper_migrations WHERE name = ${name} LIMIT 1
      `;
      if (existing.length) continue;

      const fullPath = join(migrationsDir, name);
      const body = await readFile(fullPath, "utf8");

      await sql.begin(async (tx) => {
        await tx.unsafe(body);
        await tx`
          INSERT INTO rent_finder_scraper_migrations (name) VALUES (${name})
        `;
      });

      appliedNames.push(name);
      console.error(`[migrate] aplicado: ${name}`);
    }

    if (appliedNames.length === 0) {
      console.error("[migrate] nada pendente.");
    } else {
      console.error(`[migrate] ${appliedNames.length} ficheiro(s) novo(s).`);
    }

    return { applied: appliedNames };
  } finally {
    await sql.end({ timeout: 5 });
  }
}

const entry = process.argv[1];
const isMain =
  Boolean(entry) &&
  resolve(fileURLToPath(import.meta.url)) === resolve(entry);

if (isMain) {
  loadEnvFile(join(__dirname, ".env"));
  loadEnvFile(join(__dirname, "../rent_finder_front/.env.local"), {
    override: true,
  });

  runMigrations().catch((err) => {
    console.error(err.message || err);
    process.exit(1);
  });
}
