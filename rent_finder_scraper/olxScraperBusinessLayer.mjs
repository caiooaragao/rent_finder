/**
 * Camadas de regras de negócio aplicadas ao array de anúncios antes da
 * serialização para JSON (após scrape, detalhes e geocode).
 */

/**
 * @param {unknown} s
 */
function normalizeForDedupe(s) {
  if (typeof s !== "string") return "";
  return s.trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * Remove duplicados: mantém a primeira ocorrência na ordem do array.
 * — Se o título normalizado já existir, o anúncio não entra no resultado.
 * — Se a descrição normalizada for não vazia e já existir, idem.
 * Título ou descrição vazios não participam da deduplicação desse campo.
 *
 * @param {Array<Record<string, unknown>>} ads
 * @returns {Array<Record<string, unknown>>}
 */
export function layerDedupeByTitleOrDescription(ads) {
  const seenTitles = new Set();
  /** Título em texto original do anúncio que foi mantido (primeira ocorrência), por chave normalizada */
  const tituloMantidoPorChave = new Map();
  const seenDescriptions = new Set();
  const out = [];
  let skippedByTitle = 0;
  let skippedByDesc = 0;

  for (const ad of ads) {
    const t = normalizeForDedupe(ad.titulo);
    const d = normalizeForDedupe(ad.descricao);

    if (t.length > 0 && seenTitles.has(t)) {
      skippedByTitle++;
      const mantido = tituloMantidoPorChave.get(t) ?? "";
      const removido =
        typeof ad.titulo === "string" ? ad.titulo : String(ad.titulo ?? "");
      console.log(
        `[dedupe título] Mantido: "${mantido}" | Removido: "${removido} | Link: "${ad.link}"`
      );
      continue;
    }
    if (d.length > 0 && seenDescriptions.has(d)) {
      skippedByDesc++;
      continue;
    }

    if (t.length > 0) {
      seenTitles.add(t);
      tituloMantidoPorChave.set(
        t,
        typeof ad.titulo === "string" ? ad.titulo : String(ad.titulo ?? "")
      );
    }
    if (d.length > 0) seenDescriptions.add(d);
    out.push(ad);
  }

  const removed = skippedByTitle + skippedByDesc;
  if (removed > 0) {
    console.error(
      `[camada regras de negócio] Removidos ${removed} duplicados (${skippedByTitle} por título, ${skippedByDesc} por descrição). Saída: ${out.length} anúncios.`
    );
  }

  return out;
}

/** CEP brasileiro: 12345-678 ou oito dígitos seguidos (ex.: 50750510). */
const CEP_RE = /\d{5}-?\d{3}/;

/**
 * Indícios de logradouro (evita marcar "Rua X, bairro…" como só bairro).
 * Ex.: "Ilha do Retiro, Recife, PE, 50750510" não casa — geocode tende ao centróide do bairro.
 */
const LOGRADOURO_RE =
  /\b(rua|r\.|avenida|av\.|travessa|trav\.|alameda|al\.|pra[cç]a|rodovia|estrada|beco|viaduto|quadra|conjunto|loteamento|residencial|condom[ií]nio|edif[ií]cio|pr[eé]dio)\b/i;

/**
 * @param {unknown} endereco
 */
function isEnderecoProvavelmenteSoBairro(endereco) {
  const s = typeof endereco === "string" ? endereco.trim() : "";
  if (!s) return false;
  if (LOGRADOURO_RE.test(s)) return false;
  if (!CEP_RE.test(s)) return false;
  return true;
}

/**
 * Define `enderecoApenasBairro: true` quando o texto do endereço tem CEP mas não indica
 * logradouro típico (caso comum: "Bairro, Cidade, UF, CEP" → vários anúncios na mesma coordenada).
 * Não remove o campo nos outros casos (JSON fica só com `true` onde aplicável).
 *
 * @param {Array<Record<string, unknown>>} ads
 * @returns {Array<Record<string, unknown>>}
 */
export function layerFlagEnderecoApenasBairro(ads) {
  let n = 0;
  for (const ad of ads) {
    if (isEnderecoProvavelmenteSoBairro(ad.endereco)) {
      ad.enderecoApenasBairro = true;
      n++;
    }
  }
  if (n > 0) {
    console.error(
      `[camada regras de negócio] ${n} anúncio(s) com enderecoApenasBairro: true (endereço com CEP sem indício de rua/logradouro).`
    );
  }
  return ads;
}

/**
 * Orquestra todas as camadas de negócio na ordem definida.
 * Adicionar aqui novas funções `layer…` à medida que forem necessárias.
 *
 * @param {Array<Record<string, unknown>>} ads
 * @returns {Array<Record<string, unknown>>}
 */
export function runBusinessRulesPipeline(ads) {
  let x = layerDedupeByTitleOrDescription(ads);
  x = layerFlagEnderecoApenasBairro(x);
  return x;
}
