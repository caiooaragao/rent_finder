import { eq, and } from "drizzle-orm";
import { getDb } from "./drizzle";
import { anuncios, bairros, cidades, estados } from "./schema";
import type { OlxListing } from "@/types/olx";

/** Todos os anúncios com bairro, cidade e estado resolvidos via JOIN. */
export async function getListings(): Promise<OlxListing[]> {
  return getDb()
    .select({
      titulo: anuncios.titulo,
      preco: anuncios.preco,
      link: anuncios.link,
      descricao: anuncios.descricao,
      endereco: anuncios.endereco,
      enderecoApenasBairro: anuncios.enderecoApenasBairro,
      latitude: anuncios.latitude,
      longitude: anuncios.longitude,
      bairro: bairros.nome,
      cidade: cidades.nome,
      estado: estados.sigla,
    })
    .from(anuncios)
    .leftJoin(bairros, eq(anuncios.bairroId, bairros.id))
    .leftJoin(cidades, eq(anuncios.cidadeId, cidades.id))
    .leftJoin(estados, eq(anuncios.estadoId, estados.id));
}

/** Anúncios filtrados por cidade (case-insensitive). */
export async function getListingsByCidade(
  nomeCidade: string,
): Promise<OlxListing[]> {
  return getDb()
    .select({
      titulo: anuncios.titulo,
      preco: anuncios.preco,
      link: anuncios.link,
      descricao: anuncios.descricao,
      endereco: anuncios.endereco,
      enderecoApenasBairro: anuncios.enderecoApenasBairro,
      latitude: anuncios.latitude,
      longitude: anuncios.longitude,
      bairro: bairros.nome,
      cidade: cidades.nome,
      estado: estados.sigla,
    })
    .from(anuncios)
    .leftJoin(bairros, eq(anuncios.bairroId, bairros.id))
    .innerJoin(
      cidades,
      eq(anuncios.cidadeId, cidades.id),
    )
    .leftJoin(estados, eq(anuncios.estadoId, estados.id))
    .where(eq(cidades.nome, nomeCidade));
}

/** Anúncios filtrados por bairro dentro de uma cidade. */
export async function getListingsByBairro(
  nomeBairro: string,
  nomeCidade: string,
): Promise<OlxListing[]> {
  return getDb()
    .select({
      titulo: anuncios.titulo,
      preco: anuncios.preco,
      link: anuncios.link,
      descricao: anuncios.descricao,
      endereco: anuncios.endereco,
      enderecoApenasBairro: anuncios.enderecoApenasBairro,
      latitude: anuncios.latitude,
      longitude: anuncios.longitude,
      bairro: bairros.nome,
      cidade: cidades.nome,
      estado: estados.sigla,
    })
    .from(anuncios)
    .innerJoin(bairros, eq(anuncios.bairroId, bairros.id))
    .innerJoin(cidades, eq(anuncios.cidadeId, cidades.id))
    .leftJoin(estados, eq(anuncios.estadoId, estados.id))
    .where(and(eq(bairros.nome, nomeBairro), eq(cidades.nome, nomeCidade)));
}
