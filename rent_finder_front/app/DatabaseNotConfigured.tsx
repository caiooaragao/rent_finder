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
        string do Postgres no Supabase Cloud.
      </p>
      <p style={{ marginBottom: "1rem", color: "var(--foreground-muted, #666)" }}>
        No dashboard do Supabase, abra <strong>Connect</strong> →{" "}
        <strong>Transaction pooler</strong> (porta <code>6543</code>) e copie a
        URI para <code>rent_finder_front/.env.local</code>.
      </p>
      <p style={{ fontSize: "0.9rem" }}>
        Ver <code>rent_finder_front/.env.example</code> e o projeto em{" "}
        <a
          href="https://supabase.com/dashboard/project/gcdgjonmuyhbklbgdetx"
          target="_blank"
          rel="noopener noreferrer"
        >
          Supabase Dashboard
        </a>
        .
      </p>
    </main>
  );
}
