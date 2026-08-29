/**
 * Normalizador numerico unico dos checks de validacao.
 *
 * PROBLEMA QUE ESTE MODULO RESOLVE
 * Os checks usavam `Number(x)` cru sobre texto extraido por IA. Isso produz
 * dois desfechos silenciosos e igualmente ruins:
 *   - `Number("1.234,56")` === NaN  -> o valor era filtrado por `!isNaN` e o
 *     check degradava para "Documentos insuficientes", apresentando como
 *     INDISPONIVEL um dado que EXISTE (viola a regra do projeto: "vazio" nunca
 *     pode ser apresentado como "indisponivel" e vice-versa);
 *   - `Number("1.234")` === 1.234   -> 1234 kg vira 1,234 kg e a comparacao
 *     numerica "confere" (ou acusa divergencia) por um erro de mil vezes.
 *
 * Por isso o parser NAO retorna `number | null`: ele distingue
 *   absent      -> o campo nao veio (null/undefined/string vazia)
 *   unparseable -> veio texto que nao e numero ("N/A", "abc", "1.2.3")
 *   ambiguous   -> veio numero cujo separador decimal e indecidivel ("1.234")
 * para que cada check possa dizer ao operador QUAL dos tres aconteceu.
 *
 * REGRA PARA O CASO AMBIGUO ("1.234" / "1,234") -- decisao documentada
 * Um unico separador seguido de exatamente 3 digitos, com 1 a 3 digitos antes
 * e sem zero a esquerda, tem duas leituras defensaveis:
 *   en-US  "1.234" = 1234        (ponto = milhar em pt-BR / virgula = milhar em en-US)
 *   pt-BR  "1.234" = 1,234
 * Nao ha no documento nenhum sinal que decida entre elas. As duas leituras
 * diferem por 1000x. Chutar errado ou (a) dispara e-mail de correcao para a
 * KIOM/Fenicia sobre uma divergencia inexistente, ou (b) esconde uma
 * divergencia real. Custo de nao chutar: o operador le a string crua no
 * comparativo e resolve em segundos.
 * DECISAO: nao chutamos. O caso vira `ambiguous` e o check reporta `warning`
 * citando o texto original. Casos NAO ambiguos continuam resolvidos:
 *   "1.234.567" (2+ grupos)      -> 1234567  (milhar, indiscutivel)
 *   "1.234,56"  (dois simbolos)  -> 1234.56  (o da direita e o decimal)
 *   "0.500"     (zero a esquerda)-> 0.5      (milhar nao comeca com 0)
 *   "1234.567"  (4+ digitos antes)-> 1234.567 (grupo de milhar invalido)
 *
 * FONTES DE SISTEMA vs FONTES DE DOCUMENTO
 * `processData`/`followUpData` vem de colunas Postgres numeric/integer, que o
 * driver entrega SEMPRE como `-?\d+(\.\d+)?` (ex.: totalCbm numeric(10,3) ->
 * "2.440"). Ali o ponto e inequivocamente decimal e aplicar a heuristica de
 * milhar corromperia o dado ("12.345" m3 viraria 12345). Por isso as duas
 * funcoes sao separadas: `parseSystemNumber` para banco, `parseDocumentNumber`
 * para texto extraido por IA.
 */

export type NumericFailureReason = 'absent' | 'unparseable' | 'ambiguous';

export interface ParsedNumericOk {
  ok: true;
  value: number;
  /** Texto original, para citar no comparativo. */
  raw: string;
  /** Unidade escrita junto do numero, se houver ("1234.56 KGS" -> "KGS"). */
  unit: string | null;
}

export interface ParsedNumericFail {
  ok: false;
  reason: NumericFailureReason;
  raw: string;
  unit: string | null;
}

export type ParsedNumeric = ParsedNumericOk | ParsedNumericFail;

function fail(reason: NumericFailureReason, raw: string, unit: string | null = null) {
  return { ok: false as const, reason, raw, unit };
}

// Unidade escrita DEPOIS do numero: "1234.56 KGS", "2,5M3", "12 CBM".
// Exige que o token comece por letra para nao capturar o "$" de "US$ 1.234,56".
const TRAILING_UNIT_RE = /(?:^|[\d\s)])([A-Za-z][A-Za-z0-9³²]{0,5})\s*\.?\s*$/;

/**
 * Separa o numero da unidade escrita depois dele. O corte tem de acontecer
 * ANTES de limpar os separadores: em "12,45 M3" o "3" de "M3" entraria no
 * numero ("12,453") e mudaria a leitura.
 */
function splitTrailingUnit(raw: string): { numeric: string; unit: string | null } {
  const match = raw.match(TRAILING_UNIT_RE);
  if (!match) return { numeric: raw, unit: null };
  return {
    numeric: raw.slice(0, raw.lastIndexOf(match[1])),
    unit: match[1].toUpperCase(),
  };
}

/** Extrai a unidade escrita junto do numero, sem interpreta-la. */
export function extractTrailingUnit(value: unknown): string | null {
  if (value == null) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  return splitTrailingUnit(raw).unit;
}

/**
 * Parser para valores extraidos de DOCUMENTO (IA/OCR), onde a convencao de
 * separadores e desconhecida. Ver o cabecalho do modulo para as regras.
 */
export function parseDocumentNumber(value: unknown): ParsedNumeric {
  if (value == null) return fail('absent', '');
  if (typeof value === 'number') {
    return Number.isFinite(value)
      ? { ok: true, value, raw: String(value), unit: null }
      : fail('unparseable', String(value));
  }
  if (typeof value !== 'string') {
    // boolean, objeto, array: presente mas nao numerico.
    return fail('unparseable', String(value));
  }

  const raw = value.trim();
  if (!raw) return fail('absent', raw);

  const { numeric, unit } = splitTrailingUnit(raw);
  const firstDigit = numeric.search(/\d/);
  if (firstDigit === -1) return fail('unparseable', raw, unit);

  const parenthesesNegative = /^\(.*\)$/.test(raw);
  const signNegative = numeric.slice(0, firstDigit).includes('-');

  const digits = numeric.replace(/[^\d.,]/g, '');
  if (!/\d/.test(digits)) return fail('unparseable', raw, unit);

  const dots = (digits.match(/\./g) ?? []).length;
  const commas = (digits.match(/,/g) ?? []).length;

  let normalized: string;

  if (dots > 0 && commas > 0) {
    // Dois simbolos presentes: o mais a direita e o decimal.
    const decimalSep = digits.lastIndexOf(',') > digits.lastIndexOf('.') ? ',' : '.';
    const thousandSep = decimalSep === ',' ? '.' : ',';
    normalized = digits.split(thousandSep).join('');
    if (decimalSep === ',') normalized = normalized.replace(',', '.');
    if ((normalized.match(/\./g) ?? []).length > 1) return fail('unparseable', raw, unit);
  } else if (dots + commas === 0) {
    normalized = digits;
  } else {
    const sep = dots > 0 ? '.' : ',';
    const occurrences = dots + commas;
    const grouped = new RegExp(`^\\d{1,3}(\\${sep}\\d{3})+$`).test(digits);

    if (occurrences >= 2) {
      // Dois ou mais separadores iguais so fazem sentido como milhar.
      if (!grouped) return fail('unparseable', raw, unit);
      normalized = digits.split(sep).join('');
    } else {
      const [head, tail] = digits.split(sep);
      const couldBeThousandGroup = /^[1-9]\d{0,2}$/.test(head) && tail.length === 3;
      if (couldBeThousandGroup) return fail('ambiguous', raw, unit);
      normalized = `${head}.${tail}`;
    }
  }

  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) return fail('unparseable', raw, unit);

  return {
    ok: true,
    value: parenthesesNegative || signNegative ? -Math.abs(parsed) : parsed,
    raw,
    unit,
  };
}

/**
 * Parser para valores vindos do SISTEMA (colunas Postgres numeric/integer via
 * Drizzle, que chegam como string). O ponto e sempre o separador decimal e nao
 * ha separador de milhar, entao nao existe caso ambiguo aqui.
 */
export function parseSystemNumber(value: unknown): ParsedNumeric {
  if (value == null) return fail('absent', '');
  if (typeof value === 'number') {
    return Number.isFinite(value)
      ? { ok: true, value, raw: String(value), unit: null }
      : fail('unparseable', String(value));
  }
  if (typeof value !== 'string') return fail('unparseable', String(value));

  const raw = value.trim();
  if (!raw) return fail('absent', raw);

  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fail('unparseable', raw);
  return { ok: true, value: parsed, raw, unit: null };
}

/** `true` quando o campo simplesmente nao veio (diferente de veio ilegivel). */
export function isAbsent(parsed: ParsedNumeric): boolean {
  return !parsed.ok && parsed.reason === 'absent';
}

/** `true` quando o valor EXISTE no documento mas nao pode ser comparado. */
export function isUnusable(parsed: ParsedNumeric): boolean {
  return !parsed.ok && parsed.reason !== 'absent';
}

/**
 * Texto para o operador. Nunca diz "nao encontrado" para um valor que existe:
 * essa distincao e exatamente a regra que este modulo protege.
 */
export function describeNumericFailure(label: string, parsed: ParsedNumericFail): string {
  switch (parsed.reason) {
    case 'absent':
      return `${label}: nao informado`;
    case 'ambiguous':
      return `${label}: valor "${parsed.raw}" e ambiguo (separador decimal indefinido: pode ser ${parsed.raw.replace(/[.,]/g, '')} ou ${parsed.raw.replace(/[.,]/g, '.')}) — confira no documento original`;
    case 'unparseable':
    default:
      return `${label}: valor "${parsed.raw}" nao pode ser interpretado como numero`;
  }
}
