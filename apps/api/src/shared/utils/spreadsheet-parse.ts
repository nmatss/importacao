/**
 * Leitura de celulas da planilha Follow Up (pt-BR).
 *
 * Porte para TypeScript de `scripts/lib/follow-up-values.mjs`, que ate agora so
 * existia para o importador manual (`scripts/import-follow-up.js`). A API lia a
 * mesma planilha com `parseFloat(texto.replace(/[^\d.,-]/g,'').replace(',','.'))`
 * (follow-up/service.ts), e isso transformava `'$101.346,01'` em **101.346** —
 * mil vezes menos. Aqui existe uma unica regra de parse, testada contra os
 * valores reais da planilha.
 *
 * A diferenca central em relacao ao .mjs e a distincao entre "zero" e
 * "indisponivel". A planilha e viva e tem celula com formula quebrada
 * (`#ERROR!` na linha do IM0762607NB), tracinho, texto livre ("EM TEMPO" na
 * data de registro) e celula vazia. Nada disso pode virar `0`, `null` ou uma
 * data inventada no nosso banco: o valor anterior tem que ficar de pe. Por isso
 * as funcoes `read*` devolvem `CellReading`, com o MOTIVO da indisponibilidade,
 * em vez de so `null`.
 */

/**
 * Valor lido de uma celula, ou a explicacao de por que ele nao existe.
 *
 * `expected` marca a ausencia que e o funcionamento normal, e nao um problema
 * da planilha: a coluna de registro guarda ora uma DI, ora uma DUIMP, entao
 * "nao e DUIMP" nao e defeito de ninguem e nao deve virar aviso.
 */
export type CellReading<T> =
  | { available: true; value: T }
  | { available: false; reason: string; raw: string; expected?: boolean };

/** Erros de formula do Sheets/Excel. A celula existe, mas a FONTE esta quebrada. */
const SPREADSHEET_ERRORS = new Set([
  '#ERROR!',
  '#REF!',
  '#VALUE!',
  '#N/A',
  '#NAME?',
  '#NUM!',
  '#NULL!',
  '#DIV/0!',
  '#SPILL!',
  '#CALC!',
  '#GETTING_DATA',
]);

/** Textos que o operador usa como "ainda nao tem": nao sao dado, nao sao erro. */
const EMPTY_PLACEHOLDERS = new Set(['-', '--', '---', 'N/A', 'NA']);

export function isSpreadsheetError(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  return SPREADSHEET_ERRORS.has(value.trim().toUpperCase());
}

function unavailable<T>(raw: string, reason: string): CellReading<T> {
  return { available: false, reason, raw };
}

/**
 * Motivo padrao de uma celula que nao carrega valor, ou `null` quando ela
 * carrega algo que ainda precisa ser interpretado.
 */
function emptyReason(raw: string): string | null {
  if (raw === '') return 'celula vazia';
  const upper = raw.toUpperCase();
  if (SPREADSHEET_ERRORS.has(upper)) return `erro de formula na planilha (${raw})`;
  if (EMPTY_PLACEHOLDERS.has(upper)) return `marcador de ausencia ("${raw}")`;
  return null;
}

function asText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  return String(value).trim();
}

/**
 * Numero em formato pt-BR ou en-US, com simbolo de moeda, espaco e parenteses
 * de contabilidade. Mesma regra do importador (`follow-up-values.mjs`).
 */
export function parseLocalizedNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;

  const original = asText(value);
  if (!original) return null;

  const accountingNegative = /^\s*\(.*\)\s*$/.test(original);
  let normalized = original.replace(/[^\d.,-]/g, '');
  if (!normalized || normalized === '-') return null;

  const lastComma = normalized.lastIndexOf(',');
  const lastDot = normalized.lastIndexOf('.');
  if (lastComma >= 0 && lastDot >= 0) {
    if (lastComma > lastDot) {
      normalized = normalized.replace(/\./g, '').replace(',', '.');
    } else {
      normalized = normalized.replace(/,/g, '');
    }
  } else if (lastComma >= 0) {
    normalized = normalized.replace(/\./g, '').replace(',', '.');
  } else if (/^-?\d{1,3}(?:\.\d{3})+$/.test(normalized)) {
    // '101.346' na planilha pt-BR e cento e um mil, nao 101 virgula 346.
    normalized = normalized.replace(/\./g, '');
  }

  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) return null;
  return accountingNegative ? -Math.abs(parsed) : parsed;
}

function validCalendarParts(year: number, month: number, day: number): boolean {
  const probe = new Date(Date.UTC(year, month - 1, day));
  return (
    probe.getUTCFullYear() === year &&
    probe.getUTCMonth() === month - 1 &&
    probe.getUTCDate() === day
  );
}

const BR_DATE = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const BR_DATE_TIME = /^(\d{1,2})\/(\d{1,2})\/(\d{4})[ ,]+(\d{1,2}):(\d{2})(?::(\d{2}))?$/;
const ISO_DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{1,2}):(\d{2})(?::(\d{2}))?/;

function pad(value: number, size = 2): string {
  return String(value).padStart(size, '0');
}

/**
 * Data de CALENDARIO ('YYYY-MM-DD'). Nunca passa por `new Date(texto)`: o dia
 * escrito na planilha e o dia, sem fuso no meio.
 *
 * Numero = serial do Excel (o importador le xlsx), interpretado em UTC como o
 * proprio Excel faz.
 */
export function parseSpreadsheetDateISO(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null;
    const date = new Date(Math.round((value - 25569) * 86400 * 1000));
    return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
  }

  const text = asText(value);
  if (!text) return null;

  const parts = parseDateTimeParts(text);
  return parts ? parts.date : null;
}

/**
 * Data + hora de uma celula. `time` fica `null` quando a celula so tem o dia —
 * e o caso de 'Chegada CD', que e um dia do calendario, enquanto 'Desembaraco'
 * chega como '08/09/2026 12:11:50'.
 */
export function parseDateTimeParts(value: unknown): { date: string; time: string | null } | null {
  if (typeof value === 'number') {
    const date = parseSpreadsheetDateISO(value);
    return date ? { date, time: null } : null;
  }

  const text = asText(value);
  if (!text) return null;

  const withTime = BR_DATE_TIME.exec(text) ?? ISO_DATE_TIME.exec(text);
  if (withTime) {
    const isIso = withTime[1].length === 4;
    const year = Number(isIso ? withTime[1] : withTime[3]);
    const month = Number(withTime[2]);
    const day = Number(isIso ? withTime[3] : withTime[1]);
    const hour = Number(withTime[4]);
    const minute = Number(withTime[5]);
    const second = Number(withTime[6] ?? '0');
    if (!validCalendarParts(year, month, day)) return null;
    if (hour > 23 || minute > 59 || second > 59) return null;
    return {
      date: `${pad(year, 4)}-${pad(month)}-${pad(day)}`,
      time: `${pad(hour)}:${pad(minute)}:${pad(second)}`,
    };
  }

  const br = BR_DATE.exec(text);
  if (br) {
    const [, dayText, monthText, yearText] = br;
    const [year, month, day] = [Number(yearText), Number(monthText), Number(dayText)];
    if (!validCalendarParts(year, month, day)) return null;
    return { date: `${pad(year, 4)}-${pad(month)}-${pad(day)}`, time: null };
  }

  const iso = ISO_DATE.exec(text);
  if (iso) {
    const [, yearText, monthText, dayText] = iso;
    const [year, month, day] = [Number(yearText), Number(monthText), Number(dayText)];
    if (!validCalendarParts(year, month, day)) return null;
    return { date: `${yearText}-${monthText}-${dayText}`, time: null };
  }

  return null;
}

/** Texto util da celula, ou o motivo de nao haver texto. */
export function readTextCell(value: unknown, maxLength?: number): CellReading<string> {
  const raw = asText(value);
  const reason = emptyReason(raw);
  if (reason) return unavailable(raw, reason);
  return { available: true, value: maxLength ? raw.slice(0, maxLength) : raw };
}

/** Numero da celula, ou o motivo. Texto nao numerico NUNCA vira 0. */
export function readNumberCell(value: unknown): CellReading<number> {
  const raw = asText(value);
  const reason = emptyReason(raw);
  if (reason) return unavailable(raw, reason);
  const parsed =
    typeof value === 'number' ? parseLocalizedNumber(value) : parseLocalizedNumber(raw);
  if (parsed === null) return unavailable(raw, `nao e um numero ("${raw}")`);
  return { available: true, value: parsed };
}

/** Inteiro da celula (quantidade de container, free time). */
export function readIntegerCell(value: unknown): CellReading<number> {
  const reading = readNumberCell(value);
  if (!reading.available) return reading;
  return { available: true, value: Math.round(reading.value) };
}

/** Data de calendario 'YYYY-MM-DD'. Texto livre ("EM TEMPO") e indisponivel. */
export function readDateCell(value: unknown): CellReading<string> {
  const raw = asText(value);
  const reason = emptyReason(raw);
  if (reason) return unavailable(raw, reason);
  const parsed = parseSpreadsheetDateISO(typeof value === 'number' ? value : raw);
  if (!parsed) return unavailable(raw, `nao e uma data ("${raw}")`);
  return { available: true, value: parsed };
}

/** Data com hora opcional, para as colunas que guardam um instante real. */
export function readDateTimeCell(
  value: unknown,
): CellReading<{ date: string; time: string | null }> {
  const raw = asText(value);
  const reason = emptyReason(raw);
  if (reason) return unavailable(raw, reason);
  const parsed = parseDateTimeParts(typeof value === 'number' ? value : raw);
  if (!parsed) return unavailable(raw, `nao e uma data ("${raw}")`);
  return { available: true, value: parsed };
}

/**
 * Chave de comparacao de CABECALHO.
 *
 * O mapeamento por INDICE de coluna (o que `scripts/import-follow-up.js` faz)
 * quebra inteiro quando alguem insere uma coluna no meio da planilha — foi o
 * que aconteceu com a aba Encerramentos da certificacao. Comparar pelo nome
 * normalizado tolera acento, caixa, espaco duplicado e o `*` que a equipe usa
 * para marcar coluna obrigatoria ("ETA Final*").
 */
export function normalizeHeader(value: unknown): string {
  return asText(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/gu, '')
    .replace(/[*]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}
