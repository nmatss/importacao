import { findLabeledDate } from './dates.js';
import { parseDecimal } from './numbers.js';

type ConfidenceField<T> = { value: T | null; confidence: number };

type DuimpFields = {
  customsValue: number | null;
  registrationDollar: number | null;
  insuranceValue: number | null;
  duimpNumber: string | null;
  registeredAt: string | null;
  customsClearanceAt: string | null;
  customsChannel: string | null;
};

const DUIMP_FIELD_KEYS = [
  'customsValue',
  'registrationDollar',
  'insuranceValue',
  'duimpNumber',
  'registeredAt',
  'customsClearanceAt',
  'customsChannel',
] as const;

// The right boundary prevents the grouped-number branch from accepting only a
// prefix of a six-decimal exchange rate (e.g. "5,432100" -> "5,432").
const NUMBER_VALUE = String.raw`(?:R\$\s*)?([-+]?(?:\d{1,3}(?:[.,]\d{3})+(?:[.,]\d+)?|\d+(?:[.,]\d+)?))(?=$|[^\d.,])`;

const cf = <T>(value: T | null, confidence = value == null ? 0 : 0.8): ConfidenceField<T> => ({
  value,
  confidence,
});

/** A conservative recognizer: this parser must not read arbitrary registration text as DUIMP. */
function isDuimpText(text: string): boolean {
  return (
    /\bDUIMP\b/i.test(text) || /DECLARA[ÇC][AÃ]O\s+[UÚ]NICA\s+DE\s+IMPORTA[ÇC][AÃ]O/i.test(text)
  );
}

function escapeLabel(label: string): string {
  // Keep a label on its own source line. PDF text extraction can otherwise
  // bridge a heading such as "DUIMP\nNúmero da DUIMP" and capture "Número"
  // as though it were the registration identifier.
  return label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, String.raw`[ \t]*`);
}

function extractNumberAfterLabels(text: string, labels: string[]): number | null {
  for (const label of labels) {
    const match = text.match(
      new RegExp(`${escapeLabel(label)}[ \\t]*[:#-]?[ \\t]*${NUMBER_VALUE}`, 'i'),
    );
    const parsed = parseDecimal(match?.[1]);
    if (parsed != null) return parsed;
  }
  return null;
}

function extractDuimpNumber(text: string): string | null {
  const labels = [
    'numero da duimp',
    'número da duimp',
    'numero duimp',
    'número duimp',
    'nº duimp',
    'n° duimp',
    'duimp',
  ];

  for (const label of labels) {
    const match = text.match(
      new RegExp(
        `${escapeLabel(label)}[ \\t]*(?:n[ºo°.]?|n[uú]mero|number)?[ \\t]*[:#-]?[ \\t]*([A-Z0-9][A-Z0-9./_-]{4,})`,
        'i',
      ),
    );
    const candidate = match?.[1]?.trim();
    // A bare "DUIMP" title followed by "Número" is not the actual number.
    // All real DUIMP registration identifiers include digits.
    if (candidate && /\d/.test(candidate)) return candidate.toUpperCase();
  }
  return null;
}

function extractChannel(text: string): string | null {
  const labels = ['canal de parametrizacao', 'canal de parametrização', 'canal rfb', 'canal'];
  for (const label of labels) {
    const match = text.match(
      new RegExp(`${escapeLabel(label)}[ \\t]*[:#-]?[ \\t]*([^\\n\\r]{2,80})`, 'i'),
    );
    const raw = match?.[1];
    if (!raw) continue;
    const normalized = raw
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();
    if (/\bverde\b/.test(normalized)) return 'Verde';
    if (/\bamarelo\b/.test(normalized)) return 'Amarelo';
    if (/\bvermelho\b/.test(normalized)) return 'Vermelho';
    if (/\bcinza\b/.test(normalized)) return 'Cinza';
  }
  return null;
}

function extractFields(text: string): DuimpFields | null {
  const source = text ?? '';
  if (!source.trim() || !isDuimpText(source)) return null;

  return {
    customsValue: extractNumberAfterLabels(source, ['valor aduaneiro', 'valor aduanero', 'v.a.']),
    registrationDollar: extractNumberAfterLabels(source, [
      'dolar de registro',
      'dólar de registro',
      'dolar registro',
      'dólar registro',
      'taxa de cambio',
      'taxa de câmbio',
      'taxa de conversao',
      'taxa de conversão',
    ]),
    insuranceValue: extractNumberAfterLabels(source, [
      'valor do seguro',
      'valor de seguro',
      'seguro',
      'insurance value',
      'insurance',
    ]),
    duimpNumber: extractDuimpNumber(source),
    registeredAt: findLabeledDate(source, [
      'data de registro',
      'data registro',
      'data do registro',
      'registro da duimp',
    ]),
    customsClearanceAt: findLabeledDate(source, [
      'data de desembaraco',
      'data de desembaraço',
      'desembaraco',
      'desembaraço',
      'clearance date',
    ]),
    customsChannel: extractChannel(source),
  };
}

function populatedFieldCount(fields: DuimpFields): number {
  return DUIMP_FIELD_KEYS.filter((key) => fields[key] != null).length;
}

/**
 * Parse a text-native DUIMP only when enough fields, including its number, are
 * explicitly labelled. Sparse or OCR-damaged documents fall through to the
 * structured/multimodal extractor instead of becoming a deceptively complete
 * deterministic result.
 */
export function tryParseDUIMPText(text: string): Record<string, any> | null {
  const fields = extractFields(text);
  if (!fields || !fields.duimpNumber || populatedFieldCount(fields) < 3) return null;

  return {
    customsValue: cf(fields.customsValue, fields.customsValue != null ? 0.86 : 0),
    registrationDollar: cf(fields.registrationDollar, fields.registrationDollar != null ? 0.88 : 0),
    insuranceValue: cf(fields.insuranceValue, fields.insuranceValue != null ? 0.84 : 0),
    duimpNumber: cf(fields.duimpNumber, 0.94),
    registeredAt: cf(fields.registeredAt, fields.registeredAt ? 0.9 : 0),
    customsClearanceAt: cf(fields.customsClearanceAt, fields.customsClearanceAt ? 0.9 : 0),
    customsChannel: cf(fields.customsChannel, fields.customsChannel ? 0.88 : 0),
  };
}

function isEmptyField(value: unknown): boolean {
  if (value == null || value === '') return true;
  return typeof value === 'object' && 'value' in value
    ? (value as ConfidenceField<unknown>).value == null ||
        (value as ConfidenceField<unknown>).value === ''
    : false;
}

/**
 * Fills only null fields from explicit text labels after the model response.
 * It deliberately never overwrites a model value, and uses modest confidence
 * so the operator can distinguish deterministic fallback evidence.
 */
export function fillDUIMPNullsFromText(
  data: Record<string, any>,
  text: string,
): Record<string, any> {
  const fields = extractFields(text);
  if (!fields) return data;

  const out = { ...data };
  const confidenceByField: Record<(typeof DUIMP_FIELD_KEYS)[number], number> = {
    customsValue: 0.66,
    registrationDollar: 0.68,
    insuranceValue: 0.66,
    duimpNumber: 0.74,
    registeredAt: 0.7,
    customsClearanceAt: 0.7,
    customsChannel: 0.7,
  };

  for (const key of DUIMP_FIELD_KEYS) {
    if (isEmptyField(out[key]) && fields[key] != null) {
      out[key] = cf(fields[key], confidenceByField[key]);
    }
  }
  return out;
}
