/**
 * Camadas de regras de negócio aplicadas ao array de anúncios antes da
 * serialização para JSON (após scrape, detalhes e geocode).
 *
 * As funções `*WithState` aceitam um objeto de estado externo para que a
 * deduplicação funcione corretamente entre batches (processamento incremental).
 */

/**
 * @param {unknown} s
 */
function normalizeForDedupe(s) {
  if (typeof s !== "string") return "";
  return s.trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * Remove da esquerda e da direita tudo que não for letra ou dígito Unicode
 * (pontuação, símbolos, espaços "lixo" no início/fim).
 * Ex.: `$Excelente locação- Algarve. ;` → `Excelente locação- Algarve`
 */
function stripJunkFromEdges(s) {
  if (typeof s !== "string") return "";
  const t = s.normalize("NFKC").trim();
  if (!t) return "";
  const isAlnum = (ch) => /\p{L}|\p{N}/u.test(ch);
  let i = 0;
  while (i < t.length && !isAlnum(t[i])) i++;
  let j = t.length - 1;
  while (j >= i && !isAlnum(t[j])) j--;
  if (j < i) return "";
  return t.slice(i, j + 1);
}

/**
 * Chave canónica para deduplicar títulos: ignora variações só com caracteres
 * especiais no início/fim (duplicados OLX com "lixo" no título).
 */
function canonicalKeyForTitulo(s) {
  return stripJunkFromEdges(s).replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * Cria o estado partilhado de deduplicação.
 * Passar este objeto entre batches garante que duplicados inter-batch sejam
 * igualmente removidos.
 *
 * @returns {{
 *   seenTitles: Set<string>,
 *   tituloMantidoPorChave: Map<string, string>,
 *   seenDescriptions: Set<string>,
 * }}
 */
export function createBusinessRulesState() {
  return {
    seenTitles: new Set(),
    tituloMantidoPorChave: new Map(),
    seenDescriptions: new Set(),
  };
}

/**
 * Versão com estado externo — usada no modo batch para que a deduplicação
 * persista entre batches.
 *
 * @param {Array<Record<string, unknown>>} ads
 * @param {ReturnType<typeof createBusinessRulesState>} state
 * @returns {Array<Record<string, unknown>>}
 */
export function layerDedupeByTitleOrDescriptionWithState(ads, state) {
  const { seenTitles, tituloMantidoPorChave, seenDescriptions } = state;
  const out = [];
  let skippedByTitle = 0;
  let skippedByDesc = 0;

  for (const ad of ads) {
    const t = canonicalKeyForTitulo(ad.titulo);
    const d = normalizeForDedupe(ad.descricao);

    if (t.length > 0 && seenTitles.has(t)) {
      skippedByTitle++;
      const mantido = tituloMantidoPorChave.get(t) ?? "";
      const removido =
        typeof ad.titulo === "string" ? ad.titulo : String(ad.titulo ?? "");
      console.log(
        `[dedupe título] Mantido: "${mantido}" | Removido: "${removido}" | Link: "${ad.link}"`
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
      `[camada regras de negócio] Removidos ${removed} duplicados (${skippedByTitle} por título, ${skippedByDesc} por descrição). Saída do batch: ${out.length} anúncios.`
    );
  }

  return out;
}

/**
 * Remove duplicados: mantém a primeira ocorrência na ordem do array.
 * — Versão sem estado externo (uso único, sem batches).
 *
 * @param {Array<Record<string, unknown>>} ads
 * @returns {Array<Record<string, unknown>>}
 */
export function layerDedupeByTitleOrDescription(ads) {
  return layerDedupeByTitleOrDescriptionWithState(ads, createBusinessRulesState());
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
 * Orquestra todas as camadas de negócio usando estado externo.
 * Use esta versão quando processar em batches para deduplicação inter-batch.
 *
 * @param {Array<Record<string, unknown>>} ads
 * @param {ReturnType<typeof createBusinessRulesState>} state
 * @returns {Array<Record<string, unknown>>}
 */
export function runBusinessRulesPipelineWithState(ads, state) {
  let x = layerDedupeByTitleOrDescriptionWithState(ads, state);
  x = layerFlagEnderecoApenasBairro(x);
  return x;
}

/**
 * Orquestra todas as camadas de negócio (versão sem estado externo — uso único).
 *
 * @param {Array<Record<string, unknown>>} ads
 * @returns {Array<Record<string, unknown>>}
 */
export function runBusinessRulesPipeline(ads) {
  return runBusinessRulesPipelineWithState(ads, createBusinessRulesState());
}
