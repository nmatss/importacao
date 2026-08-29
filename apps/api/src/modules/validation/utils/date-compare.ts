export type DateMatchStatus = 'match' | 'warning' | 'divergent' | 'empty';

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})/;
const DMY_RE = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/;
const DMY_TEXT_RE = /^(\d{1,2})[\s-]+([A-Za-z]{3,9})[\s-]+(\d{2,4})/;

const MONTH_NAMES: Record<string, number> = {
  jan: 0,
  january: 0,
  janeiro: 0,
  feb: 1,
  february: 1,
  fev: 1,
  fevereiro: 1,
  mar: 2,
  march: 2,
  marco: 2,
  março: 2,
  apr: 3,
  april: 3,
  abr: 3,
  abril: 3,
  may: 4,
  mai: 4,
  maio: 4,
  jun: 5,
  june: 5,
  junho: 5,
  jul: 6,
  july: 6,
  julho: 6,
  aug: 7,
  august: 7,
  ago: 7,
  agosto: 7,
  sep: 8,
  sept: 8,
  september: 8,
  set: 8,
  setembro: 8,
  oct: 9,
  october: 9,
  out: 9,
  outubro: 9,
  nov: 10,
  november: 10,
  novembro: 10,
  dec: 11,
  december: 11,
  dez: 11,
  dezembro: 11,
};

const MAX_YEAR = 2100;

/**
 * Ano <= 1900 é sentinela de "vazio" em sistema legado (Linx/WMS mandam
 * 01/01/1900), nunca data real de um processo de importação.
 */
function isSentinelYear(year: number): boolean {
  return year <= 1900 || year > MAX_YEAR;
}

/**
 * Constrói a data UTC REJEITANDO componentes fora de faixa. `Date.UTC` rola
 * silenciosamente: `03/15/2026` virava 2027-03-03 e `32/01/2026` virava
 * 2026-02-01 — uma invoice americana ou um OCR ruim viravam data plausível e
 * errada. A verificação de round-trip (ano/mês/dia da Date construída têm de
 * bater com a entrada) mata o rollover, inclusive 31/02.
 */
function makeUtcDate(year: number, month: number, day: number): Date | null {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  if (isSentinelYear(year)) return null;
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > 31) return null;
  const d = new Date(Date.UTC(year, month - 1, day));
  if (isNaN(d.getTime())) return null;
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) {
    return null;
  }
  return d;
}

/** Aplica a mesma sentinela às datas que não passam por makeUtcDate. */
function rejectSentinel(d: Date): Date | null {
  if (isNaN(d.getTime())) return null;
  return isSentinelYear(d.getUTCFullYear()) ? null : d;
}

function expandTwoDigitYear(raw: string): number {
  const year = Number(raw);
  if (year < 100) return year + (year < 70 ? 2000 : 1900);
  return year;
}

export function parseDate(value: unknown): Date | null {
  // `0`/`false` não são datas — sem este corte `new Date('0')` devolveria
  // 2000-01-01 (era o `if (!value) return null` do parser local de
  // date-sequence-check, preservado aqui na unificação).
  if (value == null || value === '' || value === 0 || value === false) return null;
  if (value instanceof Date) return rejectSentinel(value);
  const s = String(value).trim();
  if (!s) return null;

  const iso = ISO_RE.exec(s);
  if (iso) {
    return makeUtcDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  }

  const dmy = DMY_RE.exec(s);
  if (dmy) {
    // Formato reconhecido: componente fora de faixa é entrada inválida e vira
    // `null`. NÃO cai no `new Date(s)` abaixo, que reinterpretaria como MM/DD.
    return makeUtcDate(expandTwoDigitYear(dmy[3]), Number(dmy[2]), Number(dmy[1]));
  }

  const dmyText = DMY_TEXT_RE.exec(s);
  if (dmyText) {
    const month = MONTH_NAMES[dmyText[2].toLowerCase()];
    if (month != null) {
      return makeUtcDate(expandTwoDigitYear(dmyText[3]), month + 1, Number(dmyText[1]));
    }
  }

  return rejectSentinel(new Date(s));
}

export function daysBetween(a: Date, b: Date): number {
  const ms = Math.abs(a.getTime() - b.getTime());
  return ms / (1000 * 60 * 60 * 24);
}

/**
 * Compare a set of date-like values. Returns:
 *  - 'match' if all parse and pairwise differences are <= matchDays
 *  - 'warning' if differences are <= warnDays
 *  - 'divergent' if any difference exceeds warnDays
 *  - 'empty' if fewer than 2 parseable values
 */
export function compareDates(
  values: unknown[],
  opts: { matchDays?: number; warnDays?: number } = {},
): DateMatchStatus {
  const matchDays = opts.matchDays ?? 10;
  const warnDays = opts.warnDays ?? 30;
  const parsed = values.map(parseDate).filter((d): d is Date => d != null);
  if (parsed.length < 2) return 'empty';
  let maxDiff = 0;
  for (let i = 0; i < parsed.length; i++) {
    for (let j = i + 1; j < parsed.length; j++) {
      const diff = daysBetween(parsed[i], parsed[j]);
      if (diff > maxDiff) maxDiff = diff;
    }
  }
  if (maxDiff <= matchDays) return 'match';
  if (maxDiff <= warnDays) return 'warning';
  return 'divergent';
}
