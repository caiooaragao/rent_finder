export interface OlxListing {
  titulo: string;
  preco: string;
  link: string;
  descricao: string;
  endereco: string;
  /** Scraper: true quando o endereço parece ser só bairro/localidade + cidade + UF + CEP (sem rua) */
  enderecoApenasBairro?: boolean;
  /** ArcGIS atributo District */
  bairro?: string | null;
  /** ArcGIS atributo City */
  cidade?: string | null;
  /** ArcGIS atributo Region (ex.: PE ou Pernambuco, conforme o serviço) */
  estado?: string | null;
  /** Preenchidos pelo scraper via ArcGIS (findAddressCandidates) */
  latitude: number | null;
  longitude: number | null;
}
