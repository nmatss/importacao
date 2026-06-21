/**
 * Deterministic text parser for PROFORMA INVOICES — the first attempt before
 * the LLM (mirrors tryParseInvoiceText). Proforma extraction previously had no
 * deterministic fallback, so items/FOB came back null whenever the local model
 * missed them. This recovers piNumber, currency, totalFobValue and line items
 * (anchored on NCM codes) directly from the OCR/text layer.
 *
 * Returns {value, confidence} fields so the downstream projection / harness see
 * the same shape the LLM path produces.
 */

import { findLabeledDate } from './dates.js';
import { parseDecimal } from './numbers.js';

type ConfidenceField<T> = { value: T | null; confidence: number };

const cf = <T>(value: T | null, confidence = value == null ? 0 : 0.82): ConfidenceField<T> => ({
  value,
  confidence,
});

const EMPTY_STRING = cf<string>(null, 0);
const EMPTY_NUMBER = cf<number>(null, 0);

const FOC_RE =
  /(?:\bfoc\b|free\s*of\s*charge|\b(?:discount|desconto|bonificacao|bonificado|complimentary|sample|brinde|amostra)\b)/i;

export function tryParseProformaText(text: string): Record<string, any> | null {
  const source = text ?? '';
  if (!isProforma(source)) return null;

  const piNumber = matchFirst(source, [
    /\b(?:proforma\s*invoice|pro-?forma\s*invoice|pi)\s*(?:no\.?|number|#)?\s*[:#-]?\s*(PI[A-Z0-9./_-]{1,}|[A-Z0-9][A-Z0-9./_-]{2,})/i,
    /\bPI\s*[:#-]?\s*([A-Z0-9][A-Z0-9./_-]{2,})/i,
    /\b(PI[0-9][A-Z0-9./_-]{1,})\b/,
  ]);
  const invoiceNumber = matchFirst(source, [
    /\binvoice\s*(?:no\.?|number|#)\s*[:#-]?\s*([A-Z0-9][A-Z0-9./_-]{2,})/i,
  ]);
  const invoiceDate = findLabeledDate(source);
  const validUntil = findLabeledDate(source, ['valid until', 'validity', 'valido ate', 'validade']);
  const exporterName = normalizePartyLine(
    extractLabeledValue(source, ['exporter', 'shipper', 'seller', 'supplier']),
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
      /\btotal\s*amount\b[^\d]{0,20}(?:USD|EUR|CNY)?\s*([\d.,]+)/i,
    ]),
  );
  const items = parseItems(source);

  // Only commit when the parse is meaningful — piNumber is the Pre-Cons link,
  // so require it OR at least items + a total to avoid hijacking the LLM path.
  if (!piNumber && items.length === 0 && totalFobValue == null) return null;
  if (items.length === 0 && !piNumber) return null;

  return {
    piNumber: cf(piNumber, piNumber ? 0.9 : 0),
    invoiceNumber: cf(invoiceNumber, invoiceNumber ? 0.82 : 0),
    invoiceDate: cf(invoiceDate, invoiceDate ? 0.8 : 0),
    validUntil: cf(validUntil, validUntil ? 0.78 : 0),
    exporterName: cf(exporterName, exporterName ? 0.84 : 0),
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
 * Fill NULL proforma fields from the deterministic text parse — mirrors
 * fillInvoiceNullsFromText. Used on the LLM path so that scalars the parser
 * recovers (piNumber/totalFobValue/currency/...) are NOT lost when the LLM
 * returns them null. Critical for proformas WITHOUT NCM line items: the
 * deterministic short-circuit only fires when items.length > 0, so a proforma
 * carrying only PI + FOB would otherwise drop both on the model path.
 */
const PROFORMA_FILL_KEYS = [
  'piNumber',
  'invoiceNumber',
  'invoiceDate',
  'validUntil',
  'exporterName',
  'importerName',
  'importerCnpj',
  'incoterm',
  'currency',
  'portOfLoading',
  'portOfDischarge',
  'totalFobValue',
  'totalBoxes',
  'totalNetWeight',
  'totalGrossWeight',
  'totalCbm',
] as const;

export function fillProformaNullsFromText(
  data: Record<string, any>,
  text: string,
): Record<string, any> {
  const parsed = tryParseProformaText(text);
  if (!parsed) return data;
  const out: Record<string, any> = { ...data };
  for (const key of PROFORMA_FILL_KEYS) {
    const par = parsed[key] as ConfidenceField<unknown> | undefined;
    const cur = out[key] as ConfidenceField<unknown> | undefined;
    if (
      par &&
      par.value != null &&
      par.value !== '' &&
      (!cur || cur.value == null || cur.value === '')
    ) {
      out[key] = par;
    }
  }
  // Recover line items only when the model returned none and the parser found some.
  if (
    (!Array.isArray(out.items) || out.items.length === 0) &&
    Array.isArray(parsed.items) &&
    parsed.items.length > 0
  ) {
    out.items = parsed.items;
  }
  return out;
}

function isProforma(text: string): boolean {
  const upper = text.toUpperCase();
  if (
    /\b(DANFE|NOTA\s+FISCAL\s+ELETRONICA|NF-E|CT-E|CTE)\b/.test(upper) &&
    /(\bBRL\b|R\$)/.test(upper)
  ) {
    return false;
  }
  // A true commercial invoice (definitive) without any proforma signal must not
  // be picked up here — the registry classifies those separately.
  return /\b(PROFORMA\s*INVOICE|PRO-?FORMA\s*INVOICE|\bPI[0-9])\b/i.test(text);
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

function parseItems(text: string): Record<string, any>[] {
  const rows: Record<string, any>[] = [];
  for (const line of text.split(/\r?\n/)) {
    const ncmMatch = line.match(/\b\d{4}\.?\d{2}\.?\d{2}\b/);
    if (!ncmMatch || ncmMatch.index == null) continue;
    const beforeNcm = line.slice(0, ncmMatch.index).trim();
    const tokens = beforeNcm.split(/\s+/).filter(Boolean);
    if (tokens.length < 4) continue;

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
      description: cf(description || null, description ? 0.72 : 0),
      color: EMPTY_STRING,
      size: EMPTY_STRING,
      quantity: cf(quantity, quantity != null ? 0.78 : 0),
      unitPrice: cf(unitPrice, unitPrice != null ? 0.78 : 0),
      totalPrice: cf(totalPrice, totalPrice != null ? 0.78 : 0),
      ncmCode: cf(ncmMatch[0], 0.84),
      unitType: EMPTY_STRING,
      isFreeOfCharge: cf(isFreeOfCharge, 0.78),
    });
  }
  return rows;
}

function parseNumber(value: string | null | undefined): number | null {
  return parseDecimal(value);
}
