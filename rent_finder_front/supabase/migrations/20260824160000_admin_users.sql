-- Campos de autenticação admin para users (alinhado a drizzle/schema.ts).
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "username" varchar(256);
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "password_hash" text;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "is_admin" boolean NOT NULL DEFAULT false;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "created_at" timestamptz NOT NULL DEFAULT now();

CREATE UNIQUE INDEX IF NOT EXISTS "users_username_unique" ON "users" ("username");
