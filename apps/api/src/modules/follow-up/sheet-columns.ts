import {
  normalizeHeader,
  readDateCell,
  readDateTimeCell,
  readIntegerCell,
  readNumberCell,
  readTextCell,
  type CellReading,
} from '../../shared/utils/spreadsheet-parse.js';
import { localDayStartUtc } from '../../shared/utils/dates.js';

/**
 * De QUAL coluna da planilha Follow Up sai CADA campo do nosso banco.
 *
 * Tres regras da reuniao de 11/09 moram aqui:
 *
 * 1. **Mapeamento por CABECALHO, nunca por indice.** `scripts/import-follow-up.js`
 *    fixa `etaFinal: 39`; basta alguem inserir uma coluna no meio para o
 *    processo inteiro passar a ler o campo do vizinho (foi o que aconteceu com
 *    a aba Encerramentos da certificacao).
 * 2. **A data de atracacao e 'ETA Realizado', senao 'ETA Final*'.** Nunca
 *    'ETA Previsto Medio': era dele que saia o "ETA 16/09" da tela enquanto as
 *    tres datas reais do PK2192607SZ diziam 08/09. A coluna continua na
 *    planilha — ela so nao alimenta o nosso banco.
 * 3. **Vazio, `#ERROR!` ou texto livre = indisponivel**, e indisponivel mantem
 *    o valor anterior (ver `sheet-sync.ts`), nunca vira 0 nem NULL.
 */

/** Campos de `import_processes` que a planilha alimenta. */
export type SyncableField =
  | 'etd'
  | 'eta'
  | 'etaCarrier'
  | 'etaActual'
  | 'registeredAt'
  | 'customsClearanceAt'
  | 'cdArrivalAt'
  | 'duimpNumber'
  | 'diNumber'
  | 'customsChannel'
  | 'totalFobValue'
  | 'freightValue'
  | 'insuranceValue'
  | 'customsValue'
  | 'registrationDollar'
  | 'totalCbm'
  | 'containerType'
  | 'containerCount'
  | 'freeTimeDays'
  | 'numerarioValue'
  | 'portOfLoading'
  | 'portOfDischarge'
  | 'exporterName'
  | 'vesselName'
  | 'blNumber'
  | 'shippingLine'
  | 'freightAgent'
  | 'originCity'
  | 'inspectionType'
  | 'purchaseRef'
  | 'consolidationRef';

/** Valor lido da planilha, antes de virar coluna. */
export type SheetFieldValue = string | number | { date: string; time: string | null };

type ColumnKind = 'text' | 'number' | 'integer' | 'date' | 'timestamp';

interface ColumnRule {
  kind: ColumnKind;
  /** Cabecalhos aceitos, em ordem de preferencia (comparados ja normalizados). */
  headers: string[];
  /** Casas decimais da coluna `numeric` correspondente no schema. */
  scale?: number;
  maxLength?: number;
  /** Filtro extra aplicado depois do parse (ex.: e DUIMP ou e DI?). */
  refine?: (value: string) => CellReading<string>;
}

/** Numero de registro no padrao DUIMP (26BR0001660880-2). */
export const DUIMP_PATTERN = /^\d{2}BR\d{10}-\d$/;

const REGISTRO_HEADERS = ['NUMERO DE REGISTRO DI / DUIMP', 'NUMERO DE REGISTRO DI/DUIMP'];

const COLUMN_RULES: Record<SyncableField, ColumnRule> = {
  etd: { kind: 'date', headers: ['ETD ORIGEM'] },
  // Atracacao: 'ETA Final*' e a previsao firme; 'ETA Realizado' entra em
  // etaActual e vence na tela. 'ETA Previsto Medio' fica de fora de proposito.
  eta: { kind: 'date', headers: ['ETA FINAL'] },
  etaCarrier: { kind: 'date', headers: ['ETA ARMADOR'] },
  etaActual: { kind: 'date', headers: ['ETA REALIZADO'] },
  registeredAt: {
    kind: 'timestamp',
    headers: ['DATA REGISTRO DI / DUIMP', 'DATA REGISTRO DI/DUIMP'],
  },
  customsClearanceAt: { kind: 'timestamp', headers: ['DESEMBARACO'] },
  cdArrivalAt: { kind: 'timestamp', headers: ['CHEGADA CD'] },
  duimpNumber: {
    kind: 'text',
    headers: REGISTRO_HEADERS,
    maxLength: 100,
    refine: (value) =>
      DUIMP_PATTERN.test(value)
        ? { available: true, value }
        : {
            available: false,
            reason: `nao esta no padrao DUIMP ("${value}")`,
            raw: value,
            expected: true,
          },
  },
  diNumber: {
    kind: 'text',
    headers: REGISTRO_HEADERS,
    maxLength: 100,
    refine: (value) =>
      DUIMP_PATTERN.test(value)
        ? {
            available: false,
            reason: 'e um numero de DUIMP, nao de DI',
            raw: value,
            expected: true,
          }
        : { available: true, value },
  },
  customsChannel: { kind: 'text', headers: ['CANAL'], maxLength: 20 },
  totalFobValue: { kind: 'number', headers: ['VALOR INVOICE (USD)'], scale: 2 },
  freightValue: { kind: 'number', headers: ['FRETE (USD)'], scale: 2 },
  insuranceValue: { kind: 'number', headers: ['SEGURO (USD)'], scale: 2 },
  customsValue: { kind: 'number', headers: ['VALOR ADUANEIRO'], scale: 2 },
  registrationDollar: { kind: 'number', headers: ['DOLAR DE REGISTRO'], scale: 6 },
  totalCbm: { kind: 'number', headers: ['CBM'], scale: 3 },
  containerType: { kind: 'text', headers: ['CONTAINER'], maxLength: 50 },
  containerCount: { kind: 'integer', headers: ['NO CTNR'] },
  freeTimeDays: { kind: 'integer', headers: ['FREE TIME'] },
  numerarioValue: { kind: 'number', headers: ['VALOR NUMERARIO'], scale: 2 },
  portOfLoading: { kind: 'text', headers: ['PORTO DE EMBARQUE'], maxLength: 100 },
  portOfDischarge: { kind: 'text', headers: ['PORTO DE DESTINO'], maxLength: 100 },
  exporterName: {
    kind: 'text',
    headers: ['FORNECEDOR/ SUPPLIER', 'FORNECEDOR / SUPPLIER', 'FORNECEDOR'],
    maxLength: 255,
  },
  vesselName: { kind: 'text', headers: ['NAVIO FINAL', 'NAVIO'], maxLength: 255 },
  blNumber: { kind: 'text', headers: ['B/L'], maxLength: 100 },
  shippingLine: { kind: 'text', headers: ['ARMADOR'], maxLength: 255 },
  freightAgent: { kind: 'text', headers: ['AGENTE DE CARGA'], maxLength: 255 },
  originCity: { kind: 'text', headers: ['ORIGEM'], maxLength: 100 },
  inspectionType: { kind: 'text', headers: ['INSPECAO'], maxLength: 50 },
  purchaseRef: { kind: 'text', headers: ['COMPRA'], maxLength: 100 },
  consolidationRef: {
    kind: 'text',
    headers: ['CONSOLIDACAO (PKT&IMG)', 'CONSOLIDACAO'],
    maxLength: 255,
    // User decision 18/09: dates in this reference column require source
    // review; never replace an existing consolidation reference with a date.
    refine: (value) =>
      /^(?:\d{1,2}[/.\-]\d{1,2}[/.\-]\d{4}|\d{4}-\d{2}-\d{2})(?:[T\s].*)?$/.test(value)
        ? {
            available: false,
            raw: value,
            reason:
              'Data na coluna de referência da consolidação; referência preservada, pendente de revisão da área.',
          }
        : { available: true, value },
  },
};

export const SYNCABLE_FIELDS = Object.keys(COLUMN_RULES) as SyncableField[];

/** Cabecalho da coluna que identifica o processo (coluna A). */
export const PROCESS_CODE_HEADERS = ['PROCESSOS', 'PROCESSO'];

/** Cabecalho da coluna de status logistico da planilha (coluna B). */
export const SHEET_STATUS_HEADERS = ['STATUS'];

/** Uma linha da planilha ja indexada pelo cabecalho normalizado. */
export type SheetRow = Record<string, unknown>;

function findRawValue(row: SheetRow, headers: string[]): { header: string; raw: unknown } | null {
  for (const header of headers) {
    if (header in row) return { header, raw: row[header] };
  }
  return null;
}

export interface FieldReading {
  field: SyncableField;
  /** Cabecalho normalizado que respondeu (aparece no diff e no log). */
  column: string | null;
  reading: CellReading<SheetFieldValue>;
}

function readByKind(rule: ColumnRule, raw: unknown): CellReading<SheetFieldValue> {
  switch (rule.kind) {
    case 'text': {
      const reading = readTextCell(raw, rule.maxLength);
      if (!reading.available || !rule.refine) return reading;
      return rule.refine(reading.value);
    }
    case 'number':
      return readNumberCell(raw);
    case 'integer':
      return readIntegerCell(raw);
    case 'date':
      return readDateCell(raw);
    case 'timestamp':
      return readDateTimeCell(raw);
  }
}

/** Le um campo da linha, dizendo qual coluna respondeu e por que nao respondeu. */
export function readField(row: SheetRow, field: SyncableField): FieldReading {
  const rule = COLUMN_RULES[field];
  const found = findRawValue(row, rule.headers);
  if (!found) {
    return {
      field,
      column: null,
      reading: {
        available: false,
        reason: `coluna ausente na planilha (${rule.headers[0]})`,
        raw: '',
      },
    };
  }
  return { field, column: found.header, reading: readByKind(rule, found.raw) };
}

/**
 * Valor pronto para o `set()` do Drizzle.
 *
 * - `numeric` recebe string com a escala da coluna (o driver arredondaria de
 *   qualquer forma; fazer isso aqui deixa a comparacao com o valor atual exata).
 * - `date` recebe 'YYYY-MM-DD'.
 * - `timestamp` recebe um `Date` no instante UTC da meia-noite LOCAL — e assim
 *   que a tela volta a mostrar o dia escrito na planilha. Gravar
 *   '2026-09-22T00:00:00Z' (o que o importador fazia) exibia 21/09 em Brasilia.
 */
export function toColumnValue(
  field: SyncableField,
  value: SheetFieldValue,
): string | number | Date {
  const rule = COLUMN_RULES[field];
  switch (rule.kind) {
    case 'number':
      return Number(value).toFixed(rule.scale ?? 2);
    case 'integer':
      return Math.round(Number(value));
    case 'timestamp': {
      const parts = value as { date: string; time: string | null };
      const dayStart = localDayStartUtc(parts.date);
      if (!dayStart) throw new Error(`Data invalida vinda da planilha: ${parts.date}`);
      if (!parts.time) return dayStart;
      const [hour, minute, second] = parts.time.split(':').map(Number);
      return new Date(dayStart.getTime() + ((hour * 60 + minute) * 60 + second) * 1000);
    }
    default:
      return String(value);
  }
}

/**
 * Dia de uma coluna `date`, venha ela como 'YYYY-MM-DD' (o que o driver
 * devolve hoje), como ISO completo ou como `Date`.
 *
 * A tolerancia nao e teorica: se o driver passar a entregar `Date`, a
 * comparacao por texto nunca casaria e a sync reescreveria a MESMA data a cada
 * 30 minutos, enchendo o historico de mudanca que nao mudou nada.
 */
function diaDeColuna(value: unknown): string {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? '' : value.toISOString().slice(0, 10);
  }
  const texto = String(value);
  return /^\d{4}-\d{2}-\d{2}T/.test(texto) ? texto.slice(0, 10) : texto;
}

/** Texto do valor para o diff que o operador le. */
export function formatForDiff(field: SyncableField, value: unknown): string {
  if (value === null || value === undefined || value === '') return '(vazio)';
  const rule = COLUMN_RULES[field];
  if (rule.kind === 'date') return diaDeColuna(value);
  if (rule.kind === 'timestamp') {
    const instant = value instanceof Date ? value : new Date(String(value));
    return Number.isNaN(instant.getTime()) ? String(value) : instant.toISOString();
  }
  if (rule.kind === 'number') {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric.toFixed(rule.scale ?? 2) : String(value);
  }
  return String(value);
}

/**
 * O valor da planilha ja e o que esta no banco?
 *
 * Compara pelo MESMO formato em que seria gravado, e nao pelo texto cru: a
 * coluna `numeric(12,2)` devolve '101265.19' e a planilha traz 101265.187,
 * que nao e mudanca nenhuma.
 */
export function isSameAsCurrent(
  field: SyncableField,
  value: SheetFieldValue,
  current: unknown,
): boolean {
  if (current === null || current === undefined || current === '') return false;
  const next = toColumnValue(field, value);
  if (next instanceof Date) {
    const currentInstant = current instanceof Date ? current : new Date(String(current));
    if (Number.isNaN(currentInstant.getTime())) return false;
    return currentInstant.getTime() === next.getTime();
  }
  const rule = COLUMN_RULES[field];
  if (rule.kind === 'number') {
    const currentNumber = Number(current);
    if (!Number.isFinite(currentNumber)) return false;
    return currentNumber.toFixed(rule.scale ?? 2) === next;
  }
  if (rule.kind === 'integer') return Number(current) === next;
  if (rule.kind === 'date') return diaDeColuna(current) === next;
  return String(current) === next;
}

/** Indexa a linha pelo cabecalho NORMALIZADO, preservando a primeira ocorrencia. */
export function indexRowByHeader(headers: unknown[], values: unknown[]): SheetRow {
  const row: SheetRow = {};
  for (let i = 0; i < headers.length; i++) {
    const key = normalizeHeader(headers[i]);
    if (!key || key in row) continue;
    row[key] = values[i] ?? '';
  }
  return row;
}

/**
 * Campos cuja coluna sumiu da planilha (renomeada ou removida).
 *
 * E uma checagem de CABECALHO, feita uma vez por leitura: sem ela, a unica
 * pista de que 'ETA Final*' virou outro nome seria o campo parar de atualizar
 * em silencio, exatamente o defeito que o mapeamento por indice produzia.
 */
export function findMissingColumns(headers: unknown[]): SyncableField[] {
  const present = new Set(headers.map((header) => normalizeHeader(header)).filter(Boolean));
  return SYNCABLE_FIELDS.filter(
    (field) => !COLUMN_RULES[field].headers.some((header) => present.has(header)),
  );
}

/** Texto de uma coluna avulsa (codigo do processo, Status) pelo cabecalho. */
export function readRowText(row: SheetRow, headers: string[]): string {
  const found = findRawValue(row, headers);
  if (!found) return '';
  const reading = readTextCell(found.raw);
  return reading.available ? reading.value : '';
}
