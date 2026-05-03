import { relations } from "drizzle-orm";
import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  fullName: text("full_name"),
  phone: varchar("phone", { length: 256 }),
});

export const estados = pgTable("estados", {
  id: serial("id").primaryKey(),
  nome: text("nome").notNull().unique(),
  /** UF, ex.: PE */
  sigla: varchar("sigla", { length: 2 }),
});

export const cidades = pgTable(
  "cidades",
  {
    id: serial("id").primaryKey(),
    estadoId: integer("estado_id")
      .notNull()
      .references(() => estados.id, { onDelete: "restrict" }),
    nome: text("nome").notNull(),
    /** GeoJSON Polygon/MultiPolygon ou Feature (EPSG:4326). Migração: pe_boundary_geojson. */
    boundaryGeojson: jsonb("boundary_geojson"),
  },
  (t) => [uniqueIndex("cidades_estado_nome_unique").on(t.estadoId, t.nome)],
);

export const bairros = pgTable(
  "bairros",
  {
    id: serial("id").primaryKey(),
    cidadeId: integer("cidade_id")
      .notNull()
      .references(() => cidades.id, { onDelete: "restrict" }),
    nome: text("nome").notNull(),
    boundaryGeojson: jsonb("boundary_geojson"),
  },
  (t) => [uniqueIndex("bairros_cidade_nome_unique").on(t.cidadeId, t.nome)],
);

/** Anúncios (ex-OLX). Localização: preencha o nível mais específico possível (bairro > cidade > estado). */
export const anuncios = pgTable(
  "anuncios",
  {
    id: serial("id").primaryKey(),
    titulo: text("titulo").notNull(),
    preco: text("preco").notNull(),
    link: text("link").notNull().unique(),
    descricao: text("descricao").notNull().default(""),
    endereco: text("endereco").notNull().default(""),
    enderecoApenasBairro: boolean("endereco_apenas_bairro").notNull().default(false),
    latitude: doublePrecision("latitude"),
    longitude: doublePrecision("longitude"),
    estadoId: integer("estado_id").references(() => estados.id, {
      onDelete: "set null",
    }),
    cidadeId: integer("cidade_id").references(() => cidades.id, {
      onDelete: "set null",
    }),
    bairroId: integer("bairro_id").references(() => bairros.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("anuncios_estado_id_idx").on(t.estadoId),
    index("anuncios_cidade_id_idx").on(t.cidadeId),
    index("anuncios_bairro_id_idx").on(t.bairroId),
  ],
);

export const estadosRelations = relations(estados, ({ many }) => ({
  cidades: many(cidades),
  anuncios: many(anuncios),
}));

export const cidadesRelations = relations(cidades, ({ one, many }) => ({
  estado: one(estados, {
    fields: [cidades.estadoId],
    references: [estados.id],
  }),
  bairros: many(bairros),
  anuncios: many(anuncios),
}));

export const bairrosRelations = relations(bairros, ({ one, many }) => ({
  cidade: one(cidades, {
    fields: [bairros.cidadeId],
    references: [cidades.id],
  }),
  anuncios: many(anuncios),
}));

export const anunciosRelations = relations(anuncios, ({ one }) => ({
  estado: one(estados, {
    fields: [anuncios.estadoId],
    references: [estados.id],
  }),
  cidade: one(cidades, {
    fields: [anuncios.cidadeId],
    references: [cidades.id],
  }),
  bairro: one(bairros, {
    fields: [anuncios.bairroId],
    references: [bairros.id],
  }),
}));

// ─── Inferred types ────────────────────────────────────────────────────────────

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;

export type Estado = typeof estados.$inferSelect;
export type NewEstado = typeof estados.$inferInsert;

export type Cidade = typeof cidades.$inferSelect;
export type NewCidade = typeof cidades.$inferInsert;

export type Bairro = typeof bairros.$inferSelect;
export type NewBairro = typeof bairros.$inferInsert;

export type Anuncio = typeof anuncios.$inferSelect;
export type NewAnuncio = typeof anuncios.$inferInsert;
