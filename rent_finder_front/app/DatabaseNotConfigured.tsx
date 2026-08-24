/**
 * Mostrado quando `DATABASE_URL` não está definida no runtime.
 */
export default function DatabaseNotConfigured() {
  return (
    <main
      style={{
        padding: "2.5rem 1.5rem",
        maxWidth: "36rem",
        margin: "0 auto",
        lineHeight: 1.6,
      }}
    >
      <h1 style={{ fontSize: "1.35rem", marginBottom: "1rem" }}>
        Base de dados não configurada
      </h1>
      <p style={{ marginBottom: "1rem", color: "var(--foreground-muted, #666)" }}>
        Defina a variável de ambiente{" "}
        <code style={{ fontSize: "0.9em" }}>DATABASE_URL</code> com a connection
        string do Postgres (Supabase self-hosted ou cloud).
      </p>
      <p style={{ marginBottom: "1rem", color: "var(--foreground-muted, #666)" }}>
        Self-hosted: após <code>npm run db:setup</code>, copie{" "}
        <code>docker/supabase/.env.generated</code> para{" "}
        <code>rent_finder_front/.env.local</code>. Use o pooler na porta{" "}
        <code>6543</code> (modo transaction).
      </p>
      <p style={{ fontSize: "0.9rem" }}>
        Ver <code>docker/supabase/README.md</code> e{" "}
        <code>rent_finder_front/.env.example</code>.
      </p>
    </main>
  );
}
