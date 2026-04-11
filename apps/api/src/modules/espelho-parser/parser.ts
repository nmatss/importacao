import * as XLSX from 'xlsx';

export interface EspelhoItem {
  processo: string | null;
  fornecedor: string | null;
  codFabricante: string | null;
  ean13: string | null;
  codigo: string | null;
  tamanho: string | null;
  cor: string | null;
  genero: string | null;
  ncm: string | null;
  nomeProduto: string | null;
  composicao: string | null;
  caixasPorRef: number | null;
  pesoLiquidoTotal: number | null;
  pesoBrutoTotal: number | null;
  gwNt: number | null;
  pesoUnitario: number | null;
  qty: number | null;
  unitPrice: number | null;
  amountUsd: number | null;
}

export interface EspelhoSummary {
  importerName: string | null;
  importerCnpj: string | null;
  importerAddress: string | null;
  totalPieces: number | null;
  totalNetWeight: number | null;
  totalGrossWeight: number | null;
  totalCbm: number | null;
  totalBoxes: number | null;
  totalAmountUsd: number | null;
  shippingLine: string | null;
}

export interface ParsedEspelho {
  summary: EspelhoSummary;
  items: EspelhoItem[];
  headerRowIndex: number; // 0-based
  sheetName: string;
  rawRowCount: number;
}

export class EspelhoParseError extends Error {
  constructor(
    message: string,
    public readonly sheet?: string,
  ) {
    super(message);
    this.name = 'EspelhoParseError';
  }
}

type Row = unknown[];

// Internal keys for EspelhoItem numeric fields (coerced with Number())
const NUMERIC_KEYS: ReadonlySet<keyof EspelhoItem> = new Set<keyof EspelhoItem>([
  'caixasPorRef',
  'pesoLiquidoTotal',
  'pesoBrutoTotal',
  'gwNt',
  'pesoUnitario',
  'qty',
  'unitPrice',
  'amountUsd',
]);

// Keys that must stay as strings (may come as scientific notation / numbers)
const STRING_CODE_KEYS: ReadonlySet<keyof EspelhoItem> = new Set<keyof EspelhoItem>([
  'ncm',
  'ean13',
  'codFabricante',
  'codigo',
]);

const KNOWN_SHIPPING_LINES = [
  'COSCO',
  'CMA CGM',
  'CMA-CGM',
  'MAERSK',
  'MSC',
  'EVERGREEN',
  'HAPAG',
  'HAPAG-LLOYD',
  'ONE',
  'OOCL',
  'YANG MING',
];

function norm(cell: unknown): string {
  return String(cell ?? '')
    .trim()
    .toLowerCase();
}

function isEmpty(cell: unknown): boolean {
  return cell === null || cell === undefined || String(cell).trim() === '';
}

function findHeaderRow(rows: Row[]): number {
  const scanUpTo = Math.min(rows.length, 25);
  // Primary: portuguese labels
  for (let i = 0; i < scanUpTo; i++) {
    const row = rows[i] || [];
    const cells = row.map(norm);
    const hasProcesso = cells.some((c) => c.includes('processo'));
    const hasFornecedor = cells.some((c) => c.includes('fornecedor'));
    if (hasProcesso && hasFornecedor) return i;
  }
  // Fallback: english labels
  for (let i = 0; i < scanUpTo; i++) {
    const row = rows[i] || [];
    const cells = row.map(norm);
    const hasProcess = cells.some((c) => c.includes('process'));
    const hasSupplier = cells.some((c) => c.includes('supplier'));
    if (hasProcess && hasSupplier) return i;
  }
  return -1;
}

function buildColumnMap(headerRow: Row): Map<number, keyof EspelhoItem> {
  const map = new Map<number, keyof EspelhoItem>();
  const used = new Set<keyof EspelhoItem>();

  const assign = (colIdx: number, key: keyof EspelhoItem) => {
    if (used.has(key)) return;
    map.set(colIdx, key);
    used.add(key);
  };

  // First pass: map explicit multi-word labels (that might collide with shorter ones)
  // so e.g. "cód. fabricante" claims codFabricante before "código" tries to grab it.
  headerRow.forEach((rawCell, colIdx) => {
    const cell = norm(rawCell);
    if (!cell) return;

    if (
      cell.includes('cód. fabricante') ||
      cell.includes('cod. fabricante') ||
      cell.includes('cód fabricante') ||
      cell.includes('cod fabricante') ||
      cell.includes('fabricante')
    ) {
      assign(colIdx, 'codFabricante');
      return;
    }
    if (cell.includes('nome do produto')) {
      assign(colIdx, 'nomeProduto');
      return;
    }
    if (cell.includes('peso líquido') || cell.includes('peso liquido')) {
      assign(colIdx, 'pesoLiquidoTotal');
      return;
    }
    if (cell.includes('peso bruto')) {
      assign(colIdx, 'pesoBrutoTotal');
      return;
    }
    if (cell.includes('peso unitário') || cell.includes('peso unitario')) {
      assign(colIdx, 'pesoUnitario');
      return;
    }
    if (cell.includes('caixas por ref')) {
      assign(colIdx, 'caixasPorRef');
      return;
    }
    if (cell.includes('unit price')) {
      assign(colIdx, 'unitPrice');
      return;
    }
  });

  // Second pass: simpler / ambiguous labels
  headerRow.forEach((rawCell, colIdx) => {
    if (map.has(colIdx)) return;
    const cell = norm(rawCell);
    if (!cell) return;

    if (cell.includes('processo') || cell === 'process') {
      assign(colIdx, 'processo');
      return;
    }
    if (cell.includes('fornecedor') || cell.includes('supplier')) {
      assign(colIdx, 'fornecedor');
      return;
    }
    if (cell.includes('ean')) {
      assign(colIdx, 'ean13');
      return;
    }
    if (cell.includes('código') || cell.includes('codigo')) {
      assign(colIdx, 'codigo');
      return;
    }
    if (cell.includes('tamanho')) {
      assign(colIdx, 'tamanho');
      return;
    }
    if (cell === 'cor' || cell.includes('cor')) {
      // only match short "cor" labels — not "Cor " with extra, but includes handles both
      assign(colIdx, 'cor');
      return;
    }
    if (cell.includes('gênero') || cell.includes('genero')) {
      assign(colIdx, 'genero');
      return;
    }
    if (cell.includes('ncm')) {
      assign(colIdx, 'ncm');
      return;
    }
    if (cell.includes('composição') || cell.includes('composicao')) {
      assign(colIdx, 'composicao');
      return;
    }
    if (cell.includes('caixas')) {
      assign(colIdx, 'caixasPorRef');
      return;
    }
    if (cell.includes('gw/nt') || cell.includes('gw / nt')) {
      assign(colIdx, 'gwNt');
      return;
    }
    if (cell.includes('qty') || cell.includes('quantidade')) {
      assign(colIdx, 'qty');
      return;
    }
    if (cell.includes('amount')) {
      assign(colIdx, 'amountUsd');
      return;
    }
    if (cell.includes('produto') || cell === 'nome') {
      assign(colIdx, 'nomeProduto');
      return;
    }
  });

  return map;
}

function toNumber(cell: unknown): number | null {
  if (cell === null || cell === undefined) return null;
  if (typeof cell === 'number') {
    return Number.isFinite(cell) ? cell : null;
  }
  const str = String(cell).trim();
  if (str === '') return null;

  // Strip currency markers and thousand separators
  const cleaned = str
    .replace(/R\$/gi, '')
    .replace(/USD/gi, '')
    .replace(/\s+/g, '')
    .replace(/,/g, '');

  if (cleaned === '') return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function toCodeString(cell: unknown): string | null {
  if (cell === null || cell === undefined) return null;
  if (typeof cell === 'number') {
    if (!Number.isFinite(cell)) return null;
    // Handle scientific notation / floats like 9.5030039e7
    // For integer-like codes, round and return as string.
    const rounded = Math.round(cell);
    // If original was effectively an integer, use rounded
    if (Math.abs(cell - rounded) < 1e-6) return String(rounded);
    return String(cell);
  }
  let str = String(cell).trim();
  if (str === '') return null;
  // If the string looks like scientific notation, parse and format
  if (/^[-+]?\d+(\.\d+)?[eE][-+]?\d+$/.test(str)) {
    const n = Number(str);
    if (Number.isFinite(n)) {
      const rounded = Math.round(n);
      if (Math.abs(n - rounded) < 1e-6) return String(rounded);
      return String(n);
    }
  }
  // Strip trailing ".0" / ".00"
  str = str.replace(/\.0+$/, '');
  return str;
}

function parseItems(
  rows: Row[],
  headerIdx: number,
  colMap: Map<number, keyof EspelhoItem>,
): EspelhoItem[] {
  const items: EspelhoItem[] = [];

  // Find the column index for 'processo' to detect data rows
  let processoCol = -1;
  for (const [idx, key] of colMap.entries()) {
    if (key === 'processo') {
      processoCol = idx;
      break;
    }
  }

  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i] || [];
    const processoCell = processoCol >= 0 ? row[processoCol] : null;
    if (isEmpty(processoCell)) continue;

    const item: EspelhoItem = {
      processo: null,
      fornecedor: null,
      codFabricante: null,
      ean13: null,
      codigo: null,
      tamanho: null,
      cor: null,
      genero: null,
      ncm: null,
      nomeProduto: null,
      composicao: null,
      caixasPorRef: null,
      pesoLiquidoTotal: null,
      pesoBrutoTotal: null,
      gwNt: null,
      pesoUnitario: null,
      qty: null,
      unitPrice: null,
      amountUsd: null,
    };

    for (const [colIdx, key] of colMap.entries()) {
      const cell = row[colIdx];
      if (isEmpty(cell)) continue;

      if (NUMERIC_KEYS.has(key)) {
        (item as any)[key] = toNumber(cell);
      } else if (STRING_CODE_KEYS.has(key)) {
        (item as any)[key] = toCodeString(cell);
      } else {
        // plain string fields
        const str = String(cell).trim();
        (item as any)[key] = str === '' ? null : str;
      }
    }

    items.push(item);
  }

  return items;
}

function parseSummary(rows: Row[], headerIdx: number): EspelhoSummary {
  const summary: EspelhoSummary = {
    importerName: null,
    importerCnpj: null,
    importerAddress: null,
    totalPieces: null,
    totalNetWeight: null,
    totalGrossWeight: null,
    totalCbm: null,
    totalBoxes: null,
    totalAmountUsd: null,
    shippingLine: null,
  };

  const limit = Math.max(0, headerIdx);
  const summaryRows = rows.slice(0, limit);

  // Importer name: first non-empty column-A cell
  for (const row of summaryRows) {
    if (row && row.length > 0 && !isEmpty(row[0])) {
      summary.importerName = String(row[0]).trim();
      break;
    }
  }

  // Importer address: best-effort — next non-empty column-A cells
  const addressLines: string[] = [];
  let sawFirst = false;
  for (const row of summaryRows) {
    if (row && row.length > 0 && !isEmpty(row[0])) {
      if (!sawFirst) {
        sawFirst = true;
        continue;
      }
      addressLines.push(String(row[0]).trim());
      if (addressLines.length >= 2) break;
    }
  }
  if (addressLines.length > 0) {
    summary.importerAddress = addressLines.join(' ');
  }

  // CNPJ: regex across every summary cell
  const cnpjRegex = /cnpj[:\s]*([\d./-]+)/i;
  outer: for (const row of summaryRows) {
    for (const cell of row || []) {
      if (isEmpty(cell)) continue;
      const m = String(cell).match(cnpjRegex);
      if (m && m[1]) {
        summary.importerCnpj = m[1].trim();
        break outer;
      }
    }
  }

  // Shipping line: prefer column I (index 8) of row 0, then scan
  const row0 = summaryRows[0];
  if (row0 && row0.length > 8 && !isEmpty(row0[8])) {
    summary.shippingLine = String(row0[8]).trim();
  } else {
    for (const row of summaryRows) {
      if (!row) continue;
      if (row.length > 8 && !isEmpty(row[8])) {
        summary.shippingLine = String(row[8]).trim();
        break;
      }
    }
  }
  // Fallback: scan for known shipping line names
  if (!summary.shippingLine) {
    outerSL: for (const row of summaryRows) {
      for (const cell of row || []) {
        if (isEmpty(cell)) continue;
        const up = String(cell).toUpperCase();
        for (const name of KNOWN_SHIPPING_LINES) {
          if (up.includes(name)) {
            summary.shippingLine = String(cell).trim();
            break outerSL;
          }
        }
      }
    }
  }

  // Totals: scan row-by-row looking for labels in any column, pull the
  // neighbouring numeric value (prefer column E = index 4, then any numeric
  // cell on the same row).
  const pickNumericOnRow = (row: Row, preferredIdx = 4): number | null => {
    if (!row) return null;
    const pref = row[preferredIdx];
    const prefNum = toNumber(pref);
    if (prefNum !== null && typeof pref !== 'string') return prefNum;
    if (prefNum !== null) return prefNum;
    // Fallback: first numeric cell
    for (const cell of row) {
      const n = toNumber(cell);
      if (n !== null && typeof cell === 'number') return n;
    }
    // Second fallback: any parseable number
    for (const cell of row) {
      const n = toNumber(cell);
      if (n !== null) return n;
    }
    return null;
  };

  for (const row of summaryRows) {
    if (!row) continue;
    const joined = row.map((c) => norm(c)).join(' | ');

    if (
      summary.totalPieces === null &&
      (joined.includes('total pieces') || joined.includes('total pcs') || /\bpcs\b/.test(joined))
    ) {
      const n = pickNumericOnRow(row);
      if (n !== null) summary.totalPieces = Math.round(n);
    }
    if (
      summary.totalNetWeight === null &&
      (joined.includes('total net') ||
        joined.includes('net w') ||
        joined.includes('peso líquido') ||
        joined.includes('peso liquido'))
    ) {
      const n = pickNumericOnRow(row);
      if (n !== null) summary.totalNetWeight = n;
    }
    if (
      summary.totalGrossWeight === null &&
      (joined.includes('total grs') ||
        joined.includes('grs. w') ||
        joined.includes('gross w') ||
        joined.includes('peso bruto'))
    ) {
      const n = pickNumericOnRow(row);
      if (n !== null) summary.totalGrossWeight = n;
    }
    if (
      summary.totalCbm === null &&
      (joined.includes('cbm') || joined.includes('m³') || joined.includes(' m3'))
    ) {
      const n = pickNumericOnRow(row);
      if (n !== null) summary.totalCbm = n;
    }
    if (
      summary.totalBoxes === null &&
      (joined.includes('caixa') ||
        joined.includes('carton') ||
        joined.includes('packages') ||
        joined.includes('volumes'))
    ) {
      const n = pickNumericOnRow(row);
      if (n !== null) summary.totalBoxes = Math.round(n);
    }
    if (
      summary.totalAmountUsd === null &&
      (joined.includes('amount') || joined.includes('fob') || joined.includes('total usd'))
    ) {
      const n = pickNumericOnRow(row);
      if (n !== null) summary.totalAmountUsd = n;
    }
  }

  return summary;
}

function tryParseSheet(rows: Row[], sheetName: string): ParsedEspelho | null {
  if (!rows || rows.length === 0) return null;
  const headerIdx = findHeaderRow(rows);
  if (headerIdx < 0) return null;

  const headerRow = rows[headerIdx] || [];
  const colMap = buildColumnMap(headerRow);
  if (colMap.size === 0) return null;

  const items = parseItems(rows, headerIdx, colMap);
  const summary = parseSummary(rows, headerIdx);

  return {
    summary,
    items,
    headerRowIndex: headerIdx,
    sheetName,
    rawRowCount: rows.length,
  };
}

export function parseEspelhoBuffer(buffer: Buffer): ParsedEspelho {
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true, cellNF: false });
  for (const sheetName of wb.SheetNames) {
    const sheet = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<Row>(sheet, {
      header: 1,
      blankrows: false,
      defval: null,
    });
    const parsed = tryParseSheet(rows, sheetName);
    if (parsed) return parsed;
  }
  throw new EspelhoParseError(
    'Nenhuma aba de espelho reconhecida (cabecalho Processo/Fornecedor nao encontrado nas primeiras 25 linhas).',
  );
}

export function tryParseEspelhoBuffer(
  buffer: Buffer,
): { ok: true; data: ParsedEspelho } | { ok: false; error: string } {
  try {
    const data = parseEspelhoBuffer(buffer);
    return { ok: true, data };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg };
  }
}
