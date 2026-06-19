import { findLabeledDate } from './dates.js';

type ConfidenceField<T> = { value: T | null; confidence: number };

const cf = <T>(value: T | null, confidence = value == null ? 0 : 0.8): ConfidenceField<T> => ({
  value,
  confidence,
});

const EMPTY_STRING = cf<string>(null, 0);

export function tryParsePackingListText(text: string): Record<string, any> | null {
  const source = text ?? '';
  if (!isPackingList(source)) return null;

  const packingListNumber = matchFirst(source, [
    /\bpacking\s*list\s*(?:no\.?|number|#)\s*[:#-]?\s*([A-Z0-9][A-Z0-9./_-]{2,})/i,
    /\bpl\s*(?:no\.?|number|#)\s*[:#-]?\s*([A-Z0-9][A-Z0-9./_-]{2,})/i,
  ]);
  const invoiceNumber = matchFirst(source, [
    /\binvoice\s*(?:no\.?|number|#)\s*[:#-]?\s*([A-Z0-9][A-Z0-9./_-]{2,})/i,
    /\binv(?:oice)?\s*[:#-]\s*([A-Z0-9][A-Z0-9./_-]{2,})/i,
  ]);
  // Packing lists carry the shipment/ship/on-board date as often as a plain
  // "date" — anchor on the broad label set and normalize many formats to ISO.
  const date = findLabeledDate(source);
  const exporterName = normalizePartyLine(
    extractLabeledValue(source, ['exporter', 'shipper', 'seller']),
  );
  const importerLine = extractLabeledValue(source, ['importer', 'consignee', 'buyer']);
  const importerName = normalizeImporterName(importerLine);
  const importerCnpj = matchFirst(source, [
    /\bCNPJ\s*[:#-]?\s*(\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2})\b/i,
  ]);
  const portOfLoading = extractPort(source, 'loading');
  const portOfDischarge = extractPort(source, 'discharge');
  const items = parseItems(source);

  const totalBoxes =
    parseNumber(
      matchFirst(source, [/\btotal\s*(?:cartons|boxes|packages|volumes)\b[^\d]{0,20}([\d.,]+)/i]),
    ) ?? sumField(items, 'boxQuantity');
  const totalNetWeight =
    parseNumber(matchFirst(source, [/\btotal\s*net\s*weight\b[^\d]{0,20}([\d.,]+)/i])) ??
    sumField(items, 'netWeight');
  const totalGrossWeight =
    parseNumber(matchFirst(source, [/\btotal\s*gross\s*weight\b[^\d]{0,20}([\d.,]+)/i])) ??
    sumField(items, 'grossWeight');
  const totalCbm = parseNumber(
    matchFirst(source, [/\btotal\s*(?:cbm|m3|m³|volume)\b[^\d]{0,20}([\d.,]+)/i]),
  );

  if (items.length === 0 && !totalBoxes && !totalNetWeight && !totalGrossWeight) return null;

  return {
    packingListNumber: cf(packingListNumber, packingListNumber ? 0.86 : 0),
    invoiceNumber: cf(invoiceNumber, invoiceNumber ? 0.84 : 0),
    date: cf(date, date ? 0.82 : 0),
    exporterName: cf(exporterName, exporterName ? 0.82 : 0),
    exporterAddress: EMPTY_STRING,
    exporterTaxId: EMPTY_STRING,
    importerName: cf(importerName, importerName ? 0.78 : 0),
    importerAddress: EMPTY_STRING,
    importerCnpj: cf(importerCnpj, importerCnpj ? 0.88 : 0),
    portOfLoading: cf(portOfLoading, portOfLoading ? 0.78 : 0),
    portOfDischarge: cf(portOfDischarge, portOfDischarge ? 0.78 : 0),
    items,
    totalBoxes: cf(totalBoxes, totalBoxes != null ? 0.78 : 0),
    totalNetWeight: cf(totalNetWeight, totalNetWeight != null ? 0.78 : 0),
    totalGrossWeight: cf(totalGrossWeight, totalGrossWeight != null ? 0.78 : 0),
    totalCbm: cf(totalCbm, totalCbm != null ? 0.76 : 0),
  };
}

function isPackingList(text: string): boolean {
  const upper = text.toUpperCase();
  if (
    /\b(DANFE|NOTA\s+FISCAL\s+ELETRONICA|NF-E|CT-E|CTE)\b/.test(upper) &&
    /\b(BRL|R\$)\b/.test(upper)
  ) {
    return false;
  }
  return /\bPACKING\s+LIST\b/i.test(text);
}

function parseItems(text: string): Record<string, any>[] {
  const rows: Record<string, any>[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!looksLikeItemLine(line)) continue;
    if (/\b(USD|EUR|CNY|PRICE|AMOUNT|FOB|VALUE)\b/i.test(line)) continue;

    const tokens = line.trim().split(/\s+/).filter(Boolean);
    const ean = line.match(/\b\d{8,14}\b/)?.[0] ?? null;
    const rawNumberEntries = tokens
      .map((token, index) => ({ token, index, value: parseNumber(token) }))
      .filter((entry) => entry.value != null);
    const numberEntries =
      rawNumberEntries.length > 4
        ? rawNumberEntries.filter((entry) => entry.token !== ean)
        : rawNumberEntries;
    if (numberEntries.length < 4) continue;

    const [qtyEntry, boxEntry, netEntry, grossEntry] = numberEntries.slice(-4);
    const codeIndex = /^\d+$/.test(tokens[0]) && tokens[1] ? 1 : 0;
    const code = tokens[codeIndex];
    if (!code || codeIndex >= qtyEntry.index) continue;

    const description = tokens
      .slice(codeIndex + 1, qtyEntry.index)
      .join(' ')
      .trim();
    rows.push({
      itemCode: cf(code, 0.78),
      ean: cf(ean, ean ? 0.82 : 0),
      description: cf(description || null, description ? 0.72 : 0),
      color: EMPTY_STRING,
      size: EMPTY_STRING,
      quantity: cf(qtyEntry.value, 0.78),
      boxQuantity: cf(boxEntry.value, 0.78),
      netWeight: cf(netEntry.value, 0.78),
      grossWeight: cf(grossEntry.value, 0.78),
    });
  }
  return rows;
}

function looksLikeItemLine(line: string): boolean {
  const trimmed = line.trim();
  if (
    !trimmed ||
    /^(total|packing\s+list|invoice|exporter|importer|shipper|consignee)\b/i.test(trimmed)
  ) {
    return false;
  }
  return /\b\d+(?:[.,]\d+)?\b.*\b\d+(?:[.,]\d+)?\b.*\b\d+(?:[.,]\d+)?\b.*\b\d+(?:[.,]\d+)?\b/.test(
    trimmed,
  );
}

function matchFirst(text: string, patterns: RegExp[]): string | null {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return match[1].trim();
  }
  return null;
}

function extractLabeledValue(text: string, labels: string[]): string | null {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  for (const line of lines) {
    for (const label of labels) {
      const pattern = new RegExp(`^${label}\\s*(?:name)?\\s*[:#-]\\s*(.+)$`, 'i');
      const match = line.match(pattern);
      if (match?.[1]) {
        const value = match[1].replace(/\s{2,}.+$/, '').trim();
        if (value) return value;
      }
    }
  }
  return null;
}

function normalizePartyLine(value: string | null): string | null {
  if (!value) return null;
  const cleaned = value
    .replace(/\b(CNPJ|VAT|TAX\s*ID)\b.*$/i, '')
    .replace(/\s+-\s+.*$/, '')
    .trim();
  return cleaned || null;
}

function normalizeImporterName(value: string | null): string | null {
  if (!value) return null;
  const withoutCnpj = value.replace(/\bCNPJ\b.*$/i, '').trim();
  return withoutCnpj || null;
}

function extractPort(text: string, kind: 'loading' | 'discharge'): string | null {
  const label =
    kind === 'loading'
      ? String.raw`port\s+of\s+(?:loading|shipment|embarque)`
      : String.raw`port\s+of\s+(?:discharge|destination|destino)`;
  const stop =
    kind === 'loading'
      ? String.raw`(?=\s{2,}|port\s+of\s+(?:discharge|destination|destino)|$)`
      : String.raw`(?=\s{2,}|port\s+of\s+(?:loading|shipment|embarque)|$)`;
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(
      new RegExp(`${label}\\s*[:#-]?\\s*([A-Z][A-Z ,.-]{2,}?)(?:${stop})`, 'i'),
    );
    if (match?.[1]) return match[1].trim().replace(/[.,;]+$/, '') || null;
  }
  return null;
}

function parseNumber(value: string | null | undefined): number | null {
  if (!value) return null;
  let clean = String(value).replace(/[^\d,.-]/g, '');
  if (!clean || clean === '-' || clean === '.') return null;
  const lastComma = clean.lastIndexOf(',');
  const lastDot = clean.lastIndexOf('.');
  if (lastComma > -1 && lastDot > -1) {
    const decimal = lastComma > lastDot ? ',' : '.';
    const thousands = decimal === ',' ? '.' : ',';
    clean = clean.replace(new RegExp(`\\${thousands}`, 'g'), '');
    if (decimal === ',') clean = clean.replace(',', '.');
  } else if (lastComma > -1) {
    clean = clean.replace(',', '.');
  }
  const parsed = Number(clean);
  return Number.isFinite(parsed) ? parsed : null;
}

function sumField(items: Record<string, any>[], key: string): number | null {
  if (items.length === 0) return null;
  const sum = items.reduce((total, item) => total + (item[key]?.value ?? 0), 0);
  return Number.isFinite(sum) && sum > 0 ? Number(sum.toFixed(3)) : null;
}
