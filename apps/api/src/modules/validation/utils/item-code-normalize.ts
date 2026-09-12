const CANONICAL_CODE_SOURCE = '[A-Z]{2,4}\\d{3,7}[A-Z]{0,3}';

function normalizeItemCodeCharacters(value: unknown): string {
  if (value == null) return '';
  return String(value)
    .toUpperCase()
    .replace(/[\s\-./\\_]/g, '');
}

function stripKnownDocumentPrefix(normalized: string): string {
  const match = normalized.match(new RegExp(`^FAT\\d{1,4}(${CANONICAL_CODE_SOURCE})$`));
  return match?.[1] ?? normalized;
}

/**
 * Normalizes a SKU / item-code for cross-document matching.
 * Strips whitespace, dashes, dots, slashes; uppercases.
 * Example: "PI 7752Y", "pi-7752y", "PI.7752Y" all -> "PI7752Y"
 */
export function normalizeItemCode(value: unknown): string {
  return stripKnownDocumentPrefix(normalizeItemCodeCharacters(value));
}

export function itemCodesMatch(a: unknown, b: unknown): boolean {
  const na = normalizeItemCode(a);
  const nb = normalizeItemCode(b);
  if (!na || !nb) return false;
  return na === nb;
}

/**
 * Zeros a esquerda de um codigo numerico.
 *
 * O layout Puket escreve o SKU como '050404509'; quando a IA concatena as
 * colunas PI / COLLECTION / ITEM CODE numa unica celula, o zero as vezes se
 * perde ('...S2750404638'). Comparar sem os zeros a esquerda resolve o par sem
 * tocar no dado extraido — o valor exibido continua o da fonte.
 */
export function stripLeadingZeros(code: string): string {
  return code.replace(/^0+(?=[0-9])/, '');
}

// Codigo do item entre colchetes no INICIO da descricao: a invoice da Puket
// escreve '[050404509] PUKET-BACKPACK / WITH WHEELS...'. Exige ao menos um
// digito para nao capturar rotulos como '[SET]' ou '[NEW]'.
const BRACKET_CODE_RE = /^\s*\[\s*([A-Za-z0-9][A-Za-z0-9._\-/]{2,})\s*\]/;

/**
 * Codigo entre colchetes no inicio da descricao, quando houver.
 * Retorna '' quando o texto nao comeca por um colchete com aparencia de codigo.
 */
export function extractBracketItemCode(value: unknown): string {
  if (value == null) return '';
  const match = BRACKET_CODE_RE.exec(String(value));
  const candidate = match?.[1]?.trim() ?? '';
  if (!candidate || !/\d/.test(candidate)) return '';
  return candidate;
}

/**
 * Descricao sem o codigo entre colchetes do inicio. A invoice da Puket escreve
 * o SKU dentro da descricao; compara-la com a descricao da PL, que nao tem o
 * colchete, acusava "descricao divergente" em todos os itens.
 */
export function descriptionWithoutItemCode(value: unknown): string {
  const text = String(value ?? '').trim();
  if (!extractBracketItemCode(text)) return text;
  return text.replace(BRACKET_CODE_RE, '').trim() || text;
}

// PI de compra ('PK2062607BX') + token de colecao ('IS27', 'IHS27', 'S27') +
// codigo do item, concatenados numa celula so. Reuniao 11/09 [17:29]: "ele esta
// juntando PI com codigo... High Summer 27 e o codigo".
const PURCHASE_ORDER_COLLECTION_RE = /^([A-Z]{2,4}\d{6,8}[A-Z]{1,3})([A-Z]{1,4}\d{2})(.+)$/;

/**
 * Remove PI + colecao de um codigo composto JA normalizado
 * (`normalizeItemCode`). Retorna '' quando o codigo nao tem essa forma —
 * assim um codigo comum nunca e mutilado.
 */
export function stripPurchaseOrderAndCollection(normalizedCode: string): string {
  const match = PURCHASE_ORDER_COLLECTION_RE.exec(normalizedCode);
  return match?.[3] ?? '';
}

/** Comprimento minimo para aceitar casamento por sufixo (evita falso positivo). */
const MIN_SUFFIX_MATCH_LENGTH = 6;

/**
 * Casamento tolerante de codigos de item, usado na LEITURA (o dado extraido
 * nunca e reescrito). Aceita, nesta ordem:
 *  1. igualdade exata depois de normalizar pontuacao/caixa;
 *  2. igualdade ignorando zeros a esquerda ('050404638' x '50404638');
 *  3. o codigo curto ser o sufixo de um codigo COMPOSTO (PI + colecao +
 *     codigo), com no minimo 6 caracteres.
 */
export function itemCodesMatchLoose(a: unknown, b: unknown): boolean {
  const na = normalizeItemCode(a);
  const nb = normalizeItemCode(b);
  if (!na || !nb) return false;
  if (na === nb) return true;

  const za = stripLeadingZeros(na);
  const zb = stripLeadingZeros(nb);
  if (za === zb) return true;

  const long = za.length >= zb.length ? za : zb;
  const short = za.length >= zb.length ? zb : za;
  if (short.length < MIN_SUFFIX_MATCH_LENGTH) return false;

  const suffix = stripPurchaseOrderAndCollection(long);
  if (!suffix) return false;
  return stripLeadingZeros(suffix) === short;
}

/**
 * Chave UNICA de casamento de um item, compartilhada por `getComparison` e pelo
 * check `item-level-match` (antes cada um tinha o seu algoritmo). Preferencia:
 * codigo entre colchetes na descricao > sufixo do codigo composto > codigo cru.
 * Sem codigo, devolve '' — linha sem codigo nao pode casar por descricao aqui.
 */
export function itemMatchKey(item: Record<string, any> | null | undefined): string {
  if (!item) return '';
  const bracket = extractBracketItemCode(item.description ?? item.descricao);
  if (bracket) return stripLeadingZeros(normalizeItemCode(bracket));
  const normalized = normalizeItemCode(item.itemCode ?? item.code ?? item.codigo ?? item.sku);
  if (!normalized) return '';
  return stripLeadingZeros(stripPurchaseOrderAndCollection(normalized) || normalized);
}

/**
 * Codigo a EXIBIR para o item. O comparativo mostrava a string composta
 * ('PK2062607BXIS2750404509') em vez do SKU real ('050404509').
 */
export function primaryItemCode(item: Record<string, any> | null | undefined): string {
  if (!item) return '';
  const bracket = extractBracketItemCode(item.description ?? item.descricao);
  if (bracket) return bracket;
  const raw = item.itemCode ?? item.codigo ?? item.code ?? item.sku;
  const suffix = stripPurchaseOrderAndCollection(normalizeItemCode(raw));
  if (suffix) return suffix;
  const canonical = extractCanonicalItemCode(raw);
  if (canonical) return canonical;
  return '';
}

/**
 * Candidatos de codigo de um item para casamento entre documentos. Inclui os
 * campos de codigo, o codigo entre colchetes da descricao e o sufixo do codigo
 * composto — nesta ordem de confianca.
 */
export function itemCodeCandidates(item: Record<string, any> | null | undefined): string[] {
  if (!item) return [];
  const bracket = extractBracketItemCode(item.description ?? item.descricao);
  const composedSuffix = stripPurchaseOrderAndCollection(
    normalizeItemCode(item.itemCode ?? item.code ?? item.codigo ?? item.sku),
  );
  const rawCandidates = [
    bracket,
    item.itemCode,
    item.codigo,
    item.code,
    item.sku,
    composedSuffix,
    item.reference,
    item.referencia,
    item.description,
    item.descricao,
  ];
  const seen = new Set<string>();
  const values: string[] = [];
  for (const raw of rawCandidates) {
    if (raw == null || raw === '') continue;
    const cleaned = extractCanonicalItemCode(raw);
    if (!cleaned) continue;
    const key = String(cleaned).trim().toUpperCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    values.push(cleaned);
  }
  return values;
}

// Uni.co item codes follow patterns like PI7752Y, AC2285Y, PKT123, IM0712:
// 2-4 letter prefix + 3-7 digits + optional 1-3 letter suffix.
// Anything else around it (FALL/24, WHITE BOX, brand, supplier ref) is noise.
const CANONICAL_CODE_RE = new RegExp(`\\b(${CANONICAL_CODE_SOURCE})\\b`);

/**
 * Strips column-bleed prefixes/suffixes from a raw item-code value extracted
 * by the AI. Nicolas (2026-05-21 meeting): "ele tá juntando essa coluna de
 * coleção como código do item". Example: "FALL/24 PI7752Y" -> "PI7752Y".
 *
 * Conservative: only rewrites the value when the canonical-pattern regex
 * finds exactly one match AND the original string had extra characters.
 * Returns the original string when no clear canonical code is detected,
 * so we never silently corrupt unfamiliar code formats.
 */
export function extractCanonicalItemCode(raw: unknown): string {
  if (raw == null) return '';
  const original = String(raw).trim();
  if (!original) return '';
  const upper = original.toUpperCase();
  const normalized = normalizeItemCodeCharacters(upper);
  const withoutKnownPrefix = stripKnownDocumentPrefix(normalized);
  if (withoutKnownPrefix !== normalized) return withoutKnownPrefix;

  const matches = upper.match(new RegExp(CANONICAL_CODE_RE.source, 'g'));
  if (!matches || matches.length === 0) return original;
  // If the original IS the canonical code with normal punctuation, leave it
  // alone (we don't want to drop valid PI 7752Y → PI7752Y here — that's
  // normalizeItemCode's job at compare-time).
  if (matches.length === 1 && upper === matches[0]) return original;
  if (matches.length === 1) {
    // Single canonical code embedded in noise — return the canonical.
    return matches[0];
  }
  // Multiple canonical-looking codes (rare): keep the original to avoid
  // arbitrarily picking one. Operator must review.
  return original;
}

/**
 * Walks the items[] in an AI extraction result (BEFORE flattening, i.e. with
 * `{value, confidence}` wrappers) and replaces itemCode.value with the
 * canonical form when noise is detected. Mutates and returns the input.
 */
export function cleanItemCodesInAiData<T extends Record<string, any>>(data: T): T {
  if (!data || !Array.isArray((data as any).items)) return data;
  for (const item of (data as any).items as Array<Record<string, any>>) {
    const code = item.itemCode;
    if (code && typeof code === 'object' && 'value' in code) {
      const cleaned = extractCanonicalItemCode(code.value);
      if (cleaned !== code.value) {
        code.value = cleaned;
      }
    } else if (typeof code === 'string') {
      item.itemCode = extractCanonicalItemCode(code);
    }
  }
  return data;
}
