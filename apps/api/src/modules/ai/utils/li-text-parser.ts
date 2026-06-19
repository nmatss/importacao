import { findLabeledDate } from './dates.js';

type ConfidenceField<T> = { value: T | null; confidence: number };

const cf = <T>(value: T | null, confidence = value == null ? 0 : 0.82): ConfidenceField<T> => ({
  value,
  confidence,
});

export function tryParseLIText(text: string): Record<string, any> | null {
  const source = text ?? '';
  if (!/\b(LICEN[ÇC]A\s+DE\s+IMPORTA[ÇC][AÃ]O|LI\s*[:#-])\b/i.test(source)) return null;

  const liNumber = matchFirst(source, [/\bLI\s*[:#-]\s*([0-9]{2}\/[0-9]{6,7}-?[0-9])\b/i]);
  const registrationDate = findLabeledDate(source, [
    'data registro',
    'data de registro',
    'registro',
    'data',
  ]);
  const importerLine = matchFirst(source, [/\bImportador\s*[:#-]\s*(.+)/i]);
  const importerCnpj = matchFirst(source, [
    /\bCNPJ\s*[:#-]?\s*(\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2})\b/i,
  ]);
  const exporterName = cleanupLine(matchFirst(source, [/\bExportador\s*[:#-]\s*(.+)/i]));
  const ncmCode = matchFirst(source, [/\bNCM\s*[:#-]\s*(\d{4}\.?\d{2}\.?\d{2})\b/i]);
  const description = cleanupLine(matchFirst(source, [/\bDescri[çc][aã]o\s*[:#-]\s*(.+)/i]));
  const quantity = parseNumber(matchFirst(source, [/\bQuantidade\s*[:#-]\s*([\d.,]+)/i]));
  const totalValue = parseNumber(
    matchFirst(source, [/\bValor\s*(?:FOB|Total)?\s*[:#-]?\s*(?:USD|EUR|CNY)?\s*([\d.,]+)/i]),
  );
  const currency = matchFirst(source, [/\b(USD|EUR|CNY)\b/i])?.toUpperCase() ?? null;

  if (!liNumber && !ncmCode && !totalValue) return null;

  const unitPrice = quantity && totalValue ? Number((totalValue / quantity).toFixed(6)) : null;
  const items =
    ncmCode || description || quantity
      ? [
          {
            ncmCode: cf(ncmCode, ncmCode ? 0.86 : 0),
            description: cf(description, description ? 0.78 : 0),
            quantity: cf(quantity, quantity != null ? 0.8 : 0),
            unitPrice: cf(unitPrice, unitPrice != null ? 0.7 : 0),
          },
        ]
      : [];

  return {
    liNumber: cf(liNumber, liNumber ? 0.9 : 0),
    registrationDate: cf(registrationDate, registrationDate ? 0.84 : 0),
    deferralDate: cf<string>(null, 0),
    status: cf(registrationDate ? 'submitted' : null, registrationDate ? 0.66 : 0),
    importerName: cf(cleanImporter(importerLine), importerLine ? 0.78 : 0),
    importerCnpj: cf(importerCnpj, importerCnpj ? 0.88 : 0),
    exporterName: cf(exporterName, exporterName ? 0.82 : 0),
    items,
    totalValue: cf(totalValue, totalValue != null ? 0.82 : 0),
    currency: cf(currency, currency ? 0.8 : 0),
    incoterm: cf<string>(null, 0),
    anuentes: cf<string[]>(null, 0),
  };
}

function matchFirst(text: string, patterns: RegExp[]): string | null {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return match[1].trim();
  }
  return null;
}

function cleanupLine(value: string | null): string | null {
  if (!value) return null;
  return value.replace(/\s{2,}.+$/, '').trim() || null;
}

function cleanImporter(value: string | null): string | null {
  if (!value) return null;
  return value.replace(/\bCNPJ\b.*$/i, '').trim() || null;
}

function parseNumber(value: string | null | undefined): number | null {
  if (!value) return null;
  let clean = String(value).replace(/[^\d,.-]/g, '');
  if (!clean) return null;
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
