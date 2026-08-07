import { findLabeledDate, normalizeDate } from './dates.js';
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
const AMOUNT = String.raw`[-+]?(?:\d{1,3}(?:[.,]\d{3})+(?:[.,]\d+)?|\d+(?:[.,]\d+)?)(?=$|[^\d.,])`;

// The Extrato da Duimp (Portal Unico) prints the page-1 summary with an
// explicit currency prefix, and the FOB/frete/seguro lines carry BOTH
// currencies at once ("SEGURO: US$ 117,06 / R$  603,84"). A scan that only
// tolerated an optional "R$" read every US$-prefixed value as null, which is
// why the official extract used to yield a null seguro and a null taxa.
const USD_AMOUNT = new RegExp(String.raw`(?:US\$|USD)[ \t]*(${AMOUNT})`, 'i');
const BRL_AMOUNT = new RegExp(String.raw`(?:R\$|BRL)[ \t]*(${AMOUNT})`, 'i');
const BARE_AMOUNT = new RegExp(`(${AMOUNT})`);

type CurrencyPreference = 'brl' | 'usd';

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

/**
 * Read one amount out of the text that follows a label on the SAME line.
 * `preference` decides which side of a two-currency line wins; a value printed
 * without any currency marker (the Fenicia rascunho style, "Valor do Seguro:0")
 * is the last resort so single-currency documents keep working.
 */
function amountFromSegment(segment: string, preference: CurrencyPreference): number | null {
  const ordered = preference === 'usd' ? [USD_AMOUNT, BRL_AMOUNT] : [BRL_AMOUNT, USD_AMOUNT];
  for (const pattern of ordered) {
    const parsed = parseDecimal(segment.match(pattern)?.[1]);
    if (parsed != null) return parsed;
  }
  return parseDecimal(segment.match(BARE_AMOUNT)?.[1]);
}

/**
 * Scan EVERY occurrence of each label, not just the first. The extract quotes
 * "(VALOR ADUANEIRO)" inside the Decreto 11.090 boilerplate before printing the
 * real "VALOR ADUANEIRO - R$ 900.864,17" line, so stopping at the first hit
 * would lose the value.
 */
function extractAmountAfterLabels(
  text: string,
  labels: string[],
  preference: CurrencyPreference,
): number | null {
  for (const label of labels) {
    const pattern = new RegExp(`${escapeLabel(label)}[ \\t]*[:#=-]?[ \\t]*([^\\n\\r]*)`, 'gi');
    for (const match of text.matchAll(pattern)) {
      const parsed = amountFromSegment(match[1] ?? '', preference);
      if (parsed != null) return parsed;
    }
  }
  return null;
}

/**
 * The registration exchange rate appears in two mutually exclusive layouts:
 * the Portal Unico extract states it as an equation
 * ("TAXA DE CAMBIO: US$ 1,00 = R$ 5,1606"), where a naive label scan would
 * return the 1,00 side; the Fenicia rascunho labels it "Taxa Dólar".
 */
function extractRegistrationDollar(text: string): number | null {
  const equation = text.match(
    new RegExp(
      String.raw`(?:US\$|USD)[ \t]*1(?:[.,]0+)?[ \t]*=[ \t]*(?:R\$|BRL)?[ \t]*(${AMOUNT})`,
      'i',
    ),
  );
  const fromEquation = parseDecimal(equation?.[1]);
  if (fromEquation != null) return fromEquation;

  return extractAmountAfterLabels(
    text,
    [
      'dolar de registro',
      'dólar de registro',
      'dolar registro',
      'dólar registro',
      'taxa de cambio',
      'taxa de câmbio',
      'taxa de conversao',
      'taxa de conversão',
      'taxa dolar',
      'taxa dólar',
      'taxa do dolar',
      'taxa do dólar',
    ],
    'brl',
  );
}

/**
 * The Portal Unico extract has no "Data de registro" label: the registration
 * timestamp only exists as a Histórico row, "<dd/mm/yyyy>, <hh:mm> Declaração
 * registrada". pdf-parse keeps the date/time and the event on separate lines,
 * so anchor on the event and walk back to the date.
 */
function extractRegisteredAtFromHistory(text: string): string | null {
  const match = text.match(
    /(\d{1,2}\/\d{1,2}\/\d{4})[\s,]*(?:\d{1,2}:\d{2}(?::\d{2})?)?\s*Declara[cç][aã]o\s+registrada/i,
  );
  return match ? normalizeDate(match[1]) : null;
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
    // Valor aduaneiro is a BRL figure; seguro is tracked in USD by the process
    // (ProcessInfoCard renders insuranceValue as USD), so each field asks for
    // the currency it is stored in when the document prints both.
    customsValue: extractAmountAfterLabels(
      source,
      ['valor aduaneiro', 'valor aduanero', 'v.a.'],
      'brl',
    ),
    registrationDollar: extractRegistrationDollar(source),
    insuranceValue: extractAmountAfterLabels(
      source,
      ['valor do seguro', 'valor de seguro', 'seguro', 'insurance value', 'insurance'],
      'usd',
    ),
    duimpNumber: extractDuimpNumber(source),
    registeredAt:
      findLabeledDate(source, [
        'data de registro',
        'data registro',
        'data do registro',
        'registro da duimp',
      ]) ?? extractRegisteredAtFromHistory(source),
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
