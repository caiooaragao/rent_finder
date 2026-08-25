/** Opções partilhadas para postgres.js (Drizzle + scraper). */
export function getPostgresOptions(databaseUrl: string) {
  const isLocal = /localhost|127\.0\.0\.1/.test(databaseUrl);
  return {
    prepare: false as const,
    max: 1,
    idle_timeout: 20,
    connect_timeout: 20,
    ...(isLocal ? {} : { ssl: "require" as const }),
  };
}
