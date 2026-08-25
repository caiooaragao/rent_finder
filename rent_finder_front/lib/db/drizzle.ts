import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { getPostgresOptions } from "./postgresOptions";
import * as schema from "./schema";

const globalForDb = globalThis as unknown as {
  postgresClient?: ReturnType<typeof postgres>;
  drizzleDb?: PostgresJsDatabase<typeof schema>;
};

/**
 * Uma instância por cold start (serverless) / reutilização em dev.
 * Lazy: só conecta quando há query — permite `next build` sem DATABASE_URL.
 */
export function getSql(): ReturnType<typeof postgres> {
  if (globalForDb.postgresClient) return globalForDb.postgresClient;
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL environment variable is not set");
  }
  const sql = postgres(url, getPostgresOptions(url));
  globalForDb.postgresClient = sql;
  return sql;
}

export function getDb(): PostgresJsDatabase<typeof schema> {
  if (!globalForDb.drizzleDb) {
    globalForDb.drizzleDb = drizzle(getSql(), { schema });
  }
  return globalForDb.drizzleDb;
}
