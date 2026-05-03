/**
 * Seed de desenvolvimento — popula o banco com os dados do scrape local.
 *
 * Uso:
 *   npx tsx lib/db/seed.ts
 *
 * O arquivo data/olx-scrape.json é gerado pelo rent_finder_scraper.
 * Para sincronizar com o Supabase em produção use o syncSupabase.mjs
 * no pacote rent_finder_scraper.
 */

import { readFileSync } from "fs";
import { resolve } from "path";
import { eq } from "drizzle-orm";
import { getDb, getSql } from "./drizzle";
import { estados, cidades, bairros, anuncios } from "./schema";
import type { NewAnuncio } from "./schema";

type RawListing = {
  titulo: string;
  preco: string;
  link: string;
  descricao?: string;
  endereco?: string;
  enderecoApenasBairro?: boolean;
  bairro?: string | null;
  cidade?: string | null;
  estado?: string | null;
  latitude: number | null;
  longitude: number | null;
};

async function resolveOrCreateEstado(
  sigla: string,
): Promise<number> {
  const existing = await getDb()
    .select({ id: estados.id })
    .from(estados)
    .where(eq(estados.sigla, sigla))
    .limit(1);

  if (existing.length > 0) return existing[0].id;

  const [row] = await getDb()
    .insert(estados)
    .values({ nome: sigla, sigla })
    .onConflictDoNothing()
    .returning({ id: estados.id });

  if (row) return row.id;

  const [found] = await getDb()
    .select({ id: estados.id })
    .from(estados)
    .where(eq(estados.sigla, sigla))
    .limit(1);
  return found.id;
}

async function resolveOrCreateCidade(
  nome: string,
  estadoId: number,
): Promise<number> {
  const existing = await getDb()
    .select({ id: cidades.id })
    .from(cidades)
    .where(eq(cidades.nome, nome))
    .limit(1);

  if (existing.length > 0) return existing[0].id;

  const [row] = await getDb()
    .insert(cidades)
    .values({ nome, estadoId })
    .onConflictDoNothing()
    .returning({ id: cidades.id });

  if (row) return row.id;

  const [found] = await getDb()
    .select({ id: cidades.id })
    .from(cidades)
    .where(eq(cidades.nome, nome))
    .limit(1);
  return found.id;
}

async function resolveOrCreateBairro(
  nome: string,
  cidadeId: number,
): Promise<number> {
  const existing = await getDb()
    .select({ id: bairros.id })
    .from(bairros)
    .where(eq(bairros.nome, nome))
    .limit(1);

  if (existing.length > 0) return existing[0].id;

  const [row] = await getDb()
    .insert(bairros)
    .values({ nome, cidadeId })
    .onConflictDoNothing()
    .returning({ id: bairros.id });

  if (row) return row.id;

  const [found] = await getDb()
    .select({ id: bairros.id })
    .from(bairros)
    .where(eq(bairros.nome, nome))
    .limit(1);
  return found.id;
}

async function seed() {
  const jsonPath = resolve(process.cwd(), "data/olx-scrape.json");
  const raw: RawListing[] = JSON.parse(readFileSync(jsonPath, "utf-8"));

  console.log(`Seeding ${raw.length} listings…`);

  let inserted = 0;
  let skipped = 0;

  for (const listing of raw) {
    let estadoId: number | null = null;
    let cidadeId: number | null = null;
    let bairroId: number | null = null;

    if (listing.estado) {
      estadoId = await resolveOrCreateEstado(listing.estado.trim());
    }

    if (listing.cidade && estadoId !== null) {
      cidadeId = await resolveOrCreateCidade(listing.cidade.trim(), estadoId);
    }

    if (listing.bairro && cidadeId !== null) {
      bairroId = await resolveOrCreateBairro(listing.bairro.trim(), cidadeId);
    }

    const row: NewAnuncio = {
      titulo: listing.titulo,
      preco: listing.preco,
      link: listing.link,
      descricao: listing.descricao ?? "",
      endereco: listing.endereco ?? "",
      enderecoApenasBairro: listing.enderecoApenasBairro ?? false,
      latitude: listing.latitude ?? null,
      longitude: listing.longitude ?? null,
      estadoId,
      cidadeId,
      bairroId,
    };

    const result = await getDb()
      .insert(anuncios)
      .values(row)
      .onConflictDoNothing()
      .returning({ id: anuncios.id });

    if (result.length > 0) {
      inserted++;
    } else {
      skipped++;
    }
  }

  console.log(`Done. Inserted: ${inserted} | Skipped (duplicate): ${skipped}`);
}

seed()
  .catch((err) => {
    console.error("Seed failed:", err);
    process.exit(1);
  })
  .finally(async () => {
    await getSql().end({ timeout: 5 });
    process.exit(0);
  });
