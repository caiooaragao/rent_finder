"use client";

import { useEffect } from "react";

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  const msg = error.message ?? "";
  const likelyDb =
    /DATABASE_URL|postgres|password authentication|ECONNREFUSED|timeout|SSL/i.test(
      msg,
    );

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
        Erro ao carregar a página
      </h1>
      {likelyDb ? (
        <p style={{ marginBottom: "1rem" }}>
          Falha ao ligar à base de dados. Confirma{" "}
          <code>DATABASE_URL</code> na Vercel e usa pooler (porta 6543) se
          necessário. Mensagem:{" "}
          <code style={{ fontSize: "0.85em", wordBreak: "break-all" }}>
            {msg}
          </code>
        </p>
      ) : (
        <p style={{ marginBottom: "1rem", wordBreak: "break-word" }}>{msg}</p>
      )}
      <button
        type="button"
        onClick={() => reset()}
        style={{
          padding: "0.5rem 1rem",
          cursor: "pointer",
          borderRadius: "6px",
          border: "1px solid #ccc",
        }}
      >
        Tentar outra vez
      </button>
    </main>
  );
}
