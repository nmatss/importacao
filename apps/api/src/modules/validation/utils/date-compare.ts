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

export function parseDate(value: unknown): Date | null {
  if (value == null || value === '') return null;
  if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
  const s = String(value).trim();
  if (!s) return null;

  const iso = ISO_RE.exec(s);
  if (iso) {
    const d = new Date(Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])));
    return isNaN(d.getTime()) ? null : d;
  }

  const dmy = DMY_RE.exec(s);
  if (dmy) {
    let year = Number(dmy[3]);
    if (year < 100) year += year < 70 ? 2000 : 1900;
    const d = new Date(Date.UTC(year, Number(dmy[2]) - 1, Number(dmy[1])));
    return isNaN(d.getTime()) ? null : d;
  }

  const dmyText = DMY_TEXT_RE.exec(s);
  if (dmyText) {
    const month = MONTH_NAMES[dmyText[2].toLowerCase()];
    if (month != null) {
      let year = Number(dmyText[3]);
      if (year < 100) year += year < 70 ? 2000 : 1900;
      const d = new Date(Date.UTC(year, month, Number(dmyText[1])));
      return isNaN(d.getTime()) ? null : d;
    }
  }

  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
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
