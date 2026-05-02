-- Schema geo + anúncios (alinhado a drizzle/schema.ts).
-- Se já existia olx_listings de uma versão anterior, remove antes de recriar.
DROP TABLE IF EXISTS "olx_listings" CASCADE;

CREATE TABLE IF NOT EXISTS "users" (
  "id" serial PRIMARY KEY NOT NULL,
  "full_name" text,
  "phone" varchar(256)
);

CREATE TABLE IF NOT EXISTS "estados" (
  "id" serial PRIMARY KEY NOT NULL,
  "nome" text NOT NULL,
  "sigla" varchar(2),
  CONSTRAINT "estados_nome_unique" UNIQUE ("nome")
);

CREATE TABLE IF NOT EXISTS "cidades" (
  "id" serial PRIMARY KEY NOT NULL,
  "estado_id" integer NOT NULL REFERENCES "estados" ("id") ON DELETE RESTRICT,
  "nome" text NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "cidades_estado_nome_unique" ON "cidades" ("estado_id", "nome");

CREATE TABLE IF NOT EXISTS "bairros" (
  "id" serial PRIMARY KEY NOT NULL,
  "cidade_id" integer NOT NULL REFERENCES "cidades" ("id") ON DELETE RESTRICT,
  "nome" text NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "bairros_cidade_nome_unique" ON "bairros" ("cidade_id", "nome");

CREATE TABLE IF NOT EXISTS "anuncios" (
  "id" serial PRIMARY KEY NOT NULL,
  "titulo" text NOT NULL,
  "preco" text NOT NULL,
  "link" text NOT NULL,
  "descricao" text NOT NULL DEFAULT '',
  "endereco" text NOT NULL DEFAULT '',
  "endereco_apenas_bairro" boolean NOT NULL DEFAULT false,
  "latitude" double precision,
  "longitude" double precision,
  "estado_id" integer REFERENCES "estados" ("id") ON DELETE SET NULL,
  "cidade_id" integer REFERENCES "cidades" ("id") ON DELETE SET NULL,
  "bairro_id" integer REFERENCES "bairros" ("id") ON DELETE SET NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "anuncios_link_unique" UNIQUE ("link")
);

CREATE INDEX IF NOT EXISTS "anuncios_estado_id_idx" ON "anuncios" ("estado_id");
CREATE INDEX IF NOT EXISTS "anuncios_cidade_id_idx" ON "anuncios" ("cidade_id");
CREATE INDEX IF NOT EXISTS "anuncios_bairro_id_idx" ON "anuncios" ("bairro_id");
