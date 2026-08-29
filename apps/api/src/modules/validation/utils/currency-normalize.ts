/**
 * Normalizacao e comparacao de moeda para os checks monetarios.
 *
 * Antes desta util, `invoice-value-vs-fup`, `freight-vs-fup` e
 * `freight-value-match` comparavam numeros soltos: uma invoice em EUR gerava um
 * `failed` de moeda no `currency-check` E uma comparacao numerica contra o FOB
 * do sistema (que esta em outra moeda), produzindo um segundo `failed` sem
 * sentido. Comparar valor sem comparar moeda nao e uma comparacao.
 */

/** Codigos que aparecem nas extracoes; qualquer sigla ISO de 3 letras tambem e aceita. */
const CURRENCY_CODE_RE = /\b(USD|EUR|BRL|CNY|RMB|HKD)\b/;

export interface NormalizedCurrency {
  /** Texto original, para mostrar ao operador. */
  raw: string;
  /** Codigo ISO resolvido, ou `null` quando nao da para afirmar qual e a moeda. */
  code: string | null;
}

/**
 * `code: null` significa "nao foi possivel confirmar a moeda" — inclui campo
 * vazio e textos que nao sao moeda (o `freightCurrency` do BL, por exemplo,
 * recebe "PREPAID"/"COLLECT" quando o frete nao esta valorado).
 */
export function normalizeCurrency(value: unknown): NormalizedCurrency {
  const raw = String(value ?? '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, ' ');
  if (!raw) return { raw, code: null };

  const compact = raw.replace(/[\s.]/g, '');

  if (
    compact === 'USD' ||
    compact === 'US$' ||
    compact === 'U$S' ||
    compact === 'USDS' ||
    raw === 'US DOLLAR' ||
    raw === 'US DOLLARS' ||
    raw === 'UNITED STATES DOLLAR' ||
    raw === 'UNITED STATES DOLLARS' ||
    raw === 'DOLLAR' ||
    raw === 'DOLLARS' ||
    raw === 'DOLAR' ||
    raw === 'DOLARES'
  ) {
    return { raw, code: 'USD' };
  }

  const codeMatch = raw.match(CURRENCY_CODE_RE);
  if (codeMatch) return { raw, code: codeMatch[1] === 'RMB' ? 'CNY' : codeMatch[1] };

  if (raw.includes('US$') || raw.includes('U.S.D')) return { raw, code: 'USD' };
  if (compact === 'EUR€' || compact === '€') return { raw, code: 'EUR' };
  if (compact === 'R$') return { raw, code: 'BRL' };

  // Sigla ISO nao listada (GBP, JPY, ...) ainda e uma moeda identificavel.
  if (/^[A-Z]{3}$/.test(compact)) return { raw, code: compact };

  return { raw, code: null };
}

/**
 * Moeda implicita dos valores de referencia do sistema.
 * `import_processes.total_fob_value` / `freight_value` sao numeric SEM coluna de
 * moeda: o fluxo inteiro assume USD (e o `currency-check` existe justamente
 * para exigir que a invoice esteja em USD). Deixar isso explicito aqui evita
 * que a suposicao continue invisivel dentro de cada check.
 */
export const SYSTEM_REFERENCE_CURRENCY = 'USD';

export type CurrencyComparison =
  | { state: 'equal'; code: string }
  | { state: 'different'; left: string; right: string; leftCode: string; rightCode: string }
  | { state: 'unknown'; detail: string };

/**
 * Compara as moedas das duas pontas de um check monetario.
 * - `equal`     -> pode comparar valores normalmente;
 * - `different` -> NAO comparar numeros: reportar a divergencia de moeda;
 * - `unknown`   -> comparar so como indicio; nunca emitir `failed` em cima disso.
 */
export function compareCurrencies(
  leftLabel: string,
  leftValue: unknown,
  rightLabel: string,
  rightValue: unknown,
): CurrencyComparison {
  const left = normalizeCurrency(leftValue);
  const right = normalizeCurrency(rightValue);

  if (left.code && right.code) {
    return left.code === right.code
      ? { state: 'equal', code: left.code }
      : {
          state: 'different',
          left: `${leftLabel}=${left.raw}`,
          right: `${rightLabel}=${right.raw}`,
          leftCode: left.code,
          rightCode: right.code,
        };
  }

  const missing: string[] = [];
  if (!left.code) missing.push(left.raw ? `${leftLabel}="${left.raw}"` : leftLabel);
  if (!right.code) missing.push(right.raw ? `${rightLabel}="${right.raw}"` : rightLabel);
  return { state: 'unknown', detail: `moeda nao confirmada em ${missing.join(' e ')}` };
}
