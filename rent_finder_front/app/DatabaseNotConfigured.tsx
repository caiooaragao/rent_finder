/**
 * Mostrado quando `DATABASE_URL` não está definida no runtime (ex.: Vercel sem env).
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
        No projeto Vercel, adiciona a variável de ambiente{" "}
        <code style={{ fontSize: "0.9em" }}>DATABASE_URL</code> (Production e,
        se quiseres, Preview) com a connection string do Supabase Postgres.
      </p>
      <p style={{ marginBottom: "1rem", color: "var(--foreground-muted, #666)" }}>
        Para serverless, usa normalmente o{" "}
        <strong>connection pooling</strong> (porta <code>6543</code>, modo
        transaction), não a ligação direta à porta <code>5432</code>, se a
        região/Vercel tiver problemas de rede.
      </p>
      <p style={{ fontSize: "0.9rem" }}>
        Settings → Environment Variables → <code>DATABASE_URL</code> →
        Redeploy.
      </p>
    </main>
  );
}
