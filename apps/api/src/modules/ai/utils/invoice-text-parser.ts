import { DATE_VALUE_PATTERN, findLabeledDate, normalizeDate } from './dates.js';

type ConfidenceField<T> = { value: T | null; confidence: number };

const cf = <T>(value: T | null, confidence = value == null ? 0 : 0.82): ConfidenceField<T> => ({
  value,
  confidence,
});

const EMPTY_STRING = cf<string>(null, 0);
const EMPTY_NUMBER = cf<number>(null, 0);

// Nomes de armadores/linhas maritimas (carriers) — NUNCA sao o exportador da
// fatura; pertencem ao Bill of Lading. Usado para corrigir a extracao quando o
// modelo confunde o nome do navio/armador com o exporterName.
const CARRIER_RE =
  /\b(COSCO|MAERSK|MSC|HAPAG[- ]?LLOYD|HAPAG|LLOYD|EVERGREEN|CMA\s*CGM|ONE\s+LINE|HMM|OOCL|YANG\s*MING|ZIM|WAN\s*HAI|APL|PIL)\b|\b(?:SHIPPING\s+LINE|CONTAINER\s+LINE|MARITIME)\b/i;
const FOC_RE =
  /(?:\bfoc\b|free\s*of\s*charge|\b(?:discount|desconto|bonificacao|bonificado|complimentary|sample|brinde|amostra)\b)/i;

export function tryParseInvoiceText(text: string): Record<string, any> | null {
  const source = text ?? '';
  if (!isCommercialInvoice(source)) return null;

  const invoiceNumber = matchFirst(source, [
    /\binvoice\s*(?:no\.?|number|#)\s*[:#-]?\s*([A-Z0-9][A-Z0-9./_-]{2,})/i,
    /\binv(?:oice)?\s*[:#-]\s*([A-Z0-9][A-Z0-9./_-]{2,})/i,
    /CI\s*NUMBER\s*([A-Z0-9][A-Z0-9./_-]{2,}?)(?=PAYMENT|CI\s*DATE|PO\s*CUSTOMER|FREIGHT|$)/i,
  ]);
  // Broad label set + many-format normalization via the shared date library.
  // The compact KIOM layout glues label and value ("CI DATE22-Feb-26"), so we
  // also try a bare anchored match before the generic labeled scan.
  const invoiceDate =
    normalizeDate(
      matchFirst(source, [
        new RegExp(String.raw`CI\s*DATE\s*(${DATE_VALUE_PATTERN})(?=FREIGHT|PAYMENT|$)`, 'i'),
      ]),
    ) ?? findLabeledDate(source);
  const exporterName = normalizePartyLine(
    extractLabeledValue(source, ['exporter', 'shipper', 'seller']) ??
      extractCompactExporter(source),
  );
  const importerLine = extractLabeledValue(source, ['importer', 'consignee', 'buyer']);
  const importerName = normalizeImporterName(importerLine);
  const importerCnpj = matchFirst(source, [
    /\bCNPJ\s*[:#-]?\s*(\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2})\b/i,
  ]);
  const currency = matchFirst(source, [
    /\bTOTAL\s*FOB\s*(USD|EUR|CNY)/i,
    /\bcurrency\s*[:#-]?\s*(USD|EUR|CNY)\b/i,
    /\b(USD|EUR|CNY)\b/i,
  ]);
  const incoterm = matchFirst(source, [
    /INCOTERM\s*(FOB|CIF|CFR|EXW|FCA)/i,
    /\b(FOB|CIF|CFR|EXW|FCA)\b/i,
  ]);
  const portOfLoading = extractPort(source, 'loading');
  const portOfDischarge = extractPort(source, 'discharge');
  const totalFobValue = parseNumber(
    matchFirst(source, [
      /\btotal\s*FOB\s*(?:USD|EUR|CNY)\s*([\d.,]+)/i,
      /\btotal\s*FOB\b[^\d]{0,20}(?:USD|EUR|CNY)?\s*([\d.,]+)/i,
      /\bFOB\s*total\b[^\d]{0,20}(?:USD|EUR|CNY)?\s*([\d.,]+)/i,
      /\bgrand\s*total\b[^\d]{0,20}(?:USD|EUR|CNY)?\s*([\d.,]+)/i,
    ]),
  );
  const items = parseItems(source);

  if (!invoiceNumber && !totalFobValue && items.length === 0) return null;
  if (items.length === 0 && (!invoiceNumber || !totalFobValue)) return null;

  return {
    invoiceNumber: cf(invoiceNumber, invoiceNumber ? 0.9 : 0),
    invoiceDate: cf(invoiceDate, invoiceDate ? 0.82 : 0),
    exporterName: cf(exporterName, exporterName ? 0.86 : 0),
    exporterAddress: EMPTY_STRING,
    exporterTaxId: EMPTY_STRING,
    importerName: cf(importerName, importerName ? 0.78 : 0),
    importerAddress: EMPTY_STRING,
    importerCnpj: cf(importerCnpj, importerCnpj ? 0.88 : 0),
    incoterm: cf(incoterm?.toUpperCase() ?? null, incoterm ? 0.82 : 0),
    currency: cf(currency?.toUpperCase() ?? null, currency ? 0.86 : 0),
    portOfLoading: cf(portOfLoading, portOfLoading ? 0.78 : 0),
    portOfDischarge: cf(portOfDischarge, portOfDischarge ? 0.78 : 0),
    items,
    manufacturerName: EMPTY_STRING,
    manufacturerAddress: EMPTY_STRING,
    paymentTerms: cf(
      { depositPercent: null, balancePercent: null, paymentDays: null, description: null },
      0,
    ),
    totalFobValue: cf(totalFobValue, totalFobValue != null ? 0.86 : 0),
    totalBoxes: EMPTY_NUMBER,
    totalNetWeight: EMPTY_NUMBER,
    totalGrossWeight: EMPTY_NUMBER,
    totalCbm: EMPTY_NUMBER,
  };
}

/**
 * Fill scalar header fields the model left NULL using the deterministic
 * extractors, WITHOUT touching values the model did extract.
 *
 * Eduarda 2026-06-19: the local model frequently returns exporterName /
 * invoiceDate / portOfLoading as null even when the invoice has a clean text
 * layer ("leu 78% da Invoice e ficou sem puxar alguns campos"). The
 * deterministic library already knows how to read these labels — wiring it as a
 * post-LLM null-fill recovers them independently of the model (and of the Vertex
 * migration, #60). Filled fields get a modest confidence (0.6) so the UI flags
 * them as needing a glance rather than presenting them as high-confidence.
 */
export function fillInvoiceNullsFromText(
  data: Record<string, any>,
  text: string,
): Record<string, any> {
  const source = text ?? '';
  // Only recover on documents that actually look like a commercial invoice.
  if (!source.trim() || !isCommercialInvoice(source)) return data;

  const out = { ...data };
  const isNull = (field: unknown) => getConfidenceValue(field) == null;
  const FILLED = 0.6;

  if (isNull(out.invoiceDate)) {
    const date =
      normalizeDate(
        matchFirst(source, [
          new RegExp(String.raw`CI\s*DATE\s*(${DATE_VALUE_PATTERN})(?=FREIGHT|PAYMENT|$)`, 'i'),
        ]),
      ) ?? findLabeledDate(source);
    if (date) out.invoiceDate = cf(date, FILLED);
  }

  if (isNull(out.exporterName)) {
    const exporter = normalizePartyLine(
      extractLabeledValue(source, ['exporter', 'shipper', 'seller']) ??
        extractCompactExporter(source),
    );
    if (exporter && !CARRIER_RE.test(exporter)) out.exporterName = cf(exporter, FILLED);
  }

  if (isNull(out.portOfLoading)) {
    const port = extractPort(source, 'loading');
    if (port) out.portOfLoading = cf(port, FILLED);
  }

  if (isNull(out.portOfDischarge)) {
    const port = extractPort(source, 'discharge');
    if (port) out.portOfDischarge = cf(port, FILLED);
  }

  if (isNull(out.incoterm)) {
    const incoterm = matchFirst(source, [
      /INCOTERM\s*(FOB|CIF|CFR|EXW|FCA)/i,
      /\b(FOB|CIF|CFR|EXW|FCA)\b/i,
    ]);
    if (incoterm) out.incoterm = cf(incoterm.toUpperCase(), FILLED);
  }

  if (isNull(out.currency)) {
    const currency = matchFirst(source, [
      /\bTOTAL\s*FOB\s*(USD|EUR|CNY)/i,
      /\bcurrency\s*[:#-]?\s*(USD|EUR|CNY)\b/i,
      /\b(USD|EUR|CNY)\b/i,
    ]);
    if (currency) out.currency = cf(currency.toUpperCase(), FILLED);
  }

  if (isNull(out.importerCnpj)) {
    const cnpj = matchFirst(source, [
      /\bCNPJ\s*[:#-]?\s*(\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2})\b/i,
    ]);
    if (cnpj) out.importerCnpj = cf(cnpj, 0.7);
  }

  if (isNull(out.totalFobValue)) {
    const fob = parseNumber(
      matchFirst(source, [
        /\btotal\s*FOB\s*(?:USD|EUR|CNY)\s*([\d.,]+)/i,
        /\btotal\s*FOB\b[^\d]{0,20}(?:USD|EUR|CNY)?\s*([\d.,]+)/i,
        /\bFOB\s*total\b[^\d]{0,20}(?:USD|EUR|CNY)?\s*([\d.,]+)/i,
      ]),
    );
    if (fob != null) out.totalFobValue = cf(fob, FILLED);
  }

  return out;
}

export function repairInvoiceExtractionFromText(
  data: Record<string, any>,
  text: string,
): Record<string, any> {
  const exporter = getConfidenceValue<string>(data.exporterName);
  if (exporter && !CARRIER_RE.test(exporter)) return data;

  const labeledExporter = normalizePartyLine(extractLabeledValue(text, ['exporter', 'shipper']));
  if (!labeledExporter || CARRIER_RE.test(labeledExporter)) return data;

  return {
    ...data,
    exporterName: cf(labeledExporter, 0.86),
  };
}

function isCommercialInvoice(text: string): boolean {
  const upper = text.toUpperCase();
  if (
    /\b(DANFE|NOTA\s+FISCAL\s+ELETRONICA|NF-E|CT-E|CTE)\b/.test(upper) &&
    /\b(BRL|R\$)\b/.test(upper)
  ) {
    return false;
  }
  return /\b(COMMERCIAL\s+INVOICE|INVOICE\s*(?:NO|NUMBER|#)|TOTAL\s+FOB)\b/i.test(text);
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

function extractCompactExporter(text: string): string | null {
  const match = text.match(
    /\bTOTAL\s*FOB\s*(?:USD|EUR|CNY)?[\d.,]+\s+([A-Z][A-Z0-9 .,&'()-]{2,}?(?:LIMITED|LTD\.?|CO\.?\s*,?\s*LTD\.?|CORPORATION|INC\.?))(?=UNI\.CO|CNPJ|CI\s*NUMBER|PAYMENT|$)/i,
  );
  return match?.[1]?.trim() ?? null;
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

    const compactLabel =
      kind === 'loading'
        ? String.raw`port\s+of\s+loading`
        : String.raw`port\s+of\s+(?:destination|discharge)`;
    const compactMatch = line.match(
      new RegExp(
        `${compactLabel}\\s*([A-Z][A-Z ,.-]{2,}?)(?=BALANCE|FREIGHT|DEPOSIT|PORT\\s+OF|ETD|$)`,
        'i',
      ),
    );
    if (compactMatch?.[1]) return compactMatch[1].trim().replace(/[.,;]+$/, '') || null;
  }
  return null;
}

function parseItems(text: string): Record<string, any>[] {
  const rows: Record<string, any>[] = [];
  for (const line of text.split(/\r?\n/)) {
    const ncmMatch = line.match(/\b\d{4}\.?\d{2}\.?\d{2}\b/);
    if (!ncmMatch || ncmMatch.index == null) continue;
    const beforeNcm = line.slice(0, ncmMatch.index).trim();
    const ean = line.slice(ncmMatch.index + ncmMatch[0].length).match(/\b\d{8,14}\b/)?.[0] ?? null;
    const tokens = beforeNcm.split(/\s+/).filter(Boolean);
    if (tokens.length < 5) continue;

    const numberIndexes = tokens
      .map((token, index) => ({ token, index, value: parseNumber(token) }))
      .filter((entry) => entry.value != null);
    if (numberIndexes.length < 3) continue;

    const [qtyEntry, unitEntry, totalEntry] = numberIndexes.slice(-3);
    const codeIndex = /^\d+$/.test(tokens[0]) && tokens[1] ? 1 : 0;
    const code = tokens[codeIndex];
    if (!code || codeIndex >= qtyEntry.index) continue;

    const description = tokens
      .slice(codeIndex + 1, qtyEntry.index)
      .join(' ')
      .trim();
    const quantity = qtyEntry.value;
    const unitPrice = unitEntry.value;
    const totalPrice = totalEntry.value;
    const isFreeOfCharge =
      FOC_RE.test(description) || FOC_RE.test(line) || unitPrice === 0 || totalPrice === 0;

    rows.push({
      itemCode: cf(code, 0.8),
      ean: cf(ean, ean ? 0.86 : 0),
      description: cf(description || null, description ? 0.72 : 0),
      color: EMPTY_STRING,
      size: EMPTY_STRING,
      quantity: cf(quantity, quantity != null ? 0.78 : 0),
      unitPrice: cf(unitPrice, unitPrice != null ? 0.78 : 0),
      totalPrice: cf(totalPrice, totalPrice != null ? 0.78 : 0),
      ncmCode: cf(ncmMatch[0], 0.84),
      unitType: EMPTY_STRING,
      manufacturer: EMPTY_STRING,
      isFreeOfCharge: cf(isFreeOfCharge, 0.78),
    });
  }

  const compactRows = parseCompactKiomItems(text);
  return compactRows.length > rows.length ? compactRows : rows;
}

function parseCompactKiomItems(text: string): Record<string, any>[] {
  const rows: Record<string, any>[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!/^\d{3}/.test(line.trim())) continue;

    const match = line.match(
      /^\d{3}.*?-\s*FAT\d{2}\s*([A-Z]{1,4}\s*\d{3,5}Y)(.+?)(\d{1,3}(?:\.\d{3})*,\d{2})\s*(PC|SET)\s*([0-9.,]+)/i,
    );
    if (!match) continue;

    const itemCode = match[1].replace(/\s+/g, ' ').trim();
    const description = match[2].replace(/\s+/g, ' ').trim();
    const quantity = parseNumber(match[3]);
    const unitType = match[4].toUpperCase();
    const unitPrice = parseNumber(match[5]);
    const computedTotal =
      quantity != null && unitPrice != null ? Number((quantity * unitPrice).toFixed(2)) : null;
    const percentAmounts = Array.from(line.matchAll(/%\s*([0-9.,]+)/g))
      .map((amountMatch) => parseNumber(amountMatch[1]))
      .filter((value): value is number => value != null);
    const totalPrice =
      percentAmounts.length > 0
        ? Number(percentAmounts.reduce((sum, value) => sum + value, 0).toFixed(2))
        : computedTotal;
    const isFreeOfCharge =
      FOC_RE.test(description) || FOC_RE.test(line) || unitPrice === 0 || totalPrice === 0;

    rows.push({
      itemCode: cf(itemCode, 0.8),
      ean: EMPTY_STRING,
      description: cf(description || null, description ? 0.7 : 0),
      color: EMPTY_STRING,
      size: EMPTY_STRING,
      quantity: cf(quantity, quantity != null ? 0.78 : 0),
      unitPrice: cf(unitPrice, unitPrice != null ? 0.78 : 0),
      totalPrice: cf(totalPrice, totalPrice != null ? 0.76 : 0),
      ncmCode: EMPTY_STRING,
      unitType: cf(unitType, 0.78),
      manufacturer: EMPTY_STRING,
      isFreeOfCharge: cf(isFreeOfCharge, 0.82),
    });
  }
  return rows;
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

function getConfidenceValue<T>(field: unknown): T | null {
  if (field && typeof field === 'object' && 'value' in field) {
    return (field as ConfidenceField<T>).value ?? null;
  }
  return (field as T | null) ?? null;
}
