import { findLabeledDate } from './dates.js';
import { parseDecimal } from './numbers.js';

type ConfidenceField<T> = { value: T | null; confidence: number };

const cf = <T>(value: T | null, confidence = value == null ? 0 : 0.82): ConfidenceField<T> => ({
  value,
  confidence,
});

const EMPTY_STRING = cf<string>(null, 0);
const EMPTY_NUMBER = cf<number>(null, 0);

const BL_DEFAULT_CONFIDENCE = 0.82;

function matchFirst(text: string, patterns: RegExp[]): string | null {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return match[1].trim();
  }
  return null;
}

function extractLabeledValue(text: string, labels: string[]): string | null {
  for (const line of text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)) {
    for (const label of labels) {
      const pattern = new RegExp(`^${label}\\s*(?:name)?\\s*[:#-]?\\s*(.+)$`, 'i');
      const match = line.match(pattern);
      if (match?.[1]) {
        const value = match[1].replace(/\s{2,}.+$/, '').trim();
        if (value) return value;
      }
    }
  }
  return null;
}

function pickFirstNonEmpty(values: Array<string | null | undefined>): string | null {
  return values.find((value) => typeof value === 'string' && value.trim().length > 0) ?? null;
}

function isBillOfLadingText(text: string): boolean {
  const containsBlLabel =
    /\b(B\/L|BL|BILL\s+OF\s+LADING|OCEAN\s+BILL\s+OF\s+LADING|HOUSE\s+BL)\b/i.test(text);
  if (containsBlLabel) return true;

  return (
    /\bPort\s+of\s+(?:loading|embarque)\b/i.test(text) &&
    /\bPort\s+of\s+(?:discharge|destino)\b/i.test(text) &&
    /\bVessel\b/i.test(text)
  );
}

function normalizeParty(value: string | null): string | null {
  if (!value) return null;
  return value
    .replace(/\b(CNPJ|VAT|TAX\s*ID)\b.*$/i, '')
    .replace(/\s+-\s+.*$/, '')
    .trim();
}

function extractPort(text: string, type: 'loading' | 'discharge'): string | null {
  const label =
    type === 'loading'
      ? String.raw`port\s+of\s+(?:loading|shipment|embarque)`
      : String.raw`port\s+of\s+(?:discharge|destination|destino)`;
  const stop =
    type === 'loading'
      ? String.raw`(?=\s{2,}|port\s+of\s+(?:discharge|destination|destino)|$)`
      : String.raw`(?=\s{2,}|port\s+of\s+(?:loading|shipment|embarque)|$)`;

  for (const line of text.split(/\r?\n/)) {
    const match = line.match(
      new RegExp(`${label}\\s*[:#-]?\\s*([A-Z][A-Z ,.'-]{2,}?)(?:${stop})`, 'i'),
    );
    if (match?.[1]) {
      return match[1].trim().replace(/[.,;]+$/, '') || null;
    }
  }
  return null;
}

function extractCargoDescription(text: string): string | null {
  const lines = text.split(/\r?\n/);
  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx]!.trim();
    const labeled = line.match(
      /^\s*(?:cargo\s*description|goods\s*description|description\sof\s*goods|marks\s*and\s*numbers?)\s*[:#-]?\s*(.*)$/i,
    );
    if (labeled?.[1] && labeled[1].trim()) {
      const compact = labeled[1].trim();
      if (compact.length > 0) return compact;
    }
    if (labeled && idx + 1 < lines.length) {
      const next = lines[idx + 1]?.trim();
      if (next) return next;
    }
  }
  return null;
}

function extractNcmList(text: string): string[] {
  const matches = text.matchAll(/\b(\d{4}\.\d{2}\.\d{2})\b/g);
  const values = Array.from(matches, (m) => m[1]).filter(Boolean);
  if (values.length > 0) return Array.from(new Set(values));

  const fallback = text.matchAll(/\b(\d{6})\b/g);
  return Array.from(
    new Set(
      Array.from(fallback, (m) => m[1].padEnd(8, '0').replace(/(\d{4})(\d{2})(\d{2})/, '$1.$2.$3')),
    ),
  );
}

function extractContainerType(text: string): string | null {
  const patterns = [
    /\b(2[04]'(?:HQ|GP|HC|FT|RF|NOR|GPF|RFR|RF|NOR)?|2[0]\s*\w+)\b/i,
    /\b(4[0]\s*'\s*(?:HQ|GP|HC|NOR|RFR|RF|PIL))\b/i,
    /\b((?:40|45|20)\s*(?:HC|HQ|GP|NOR|RF|OPEN|REEFER|PLT)?)\b/i,
    /\b(ISO\s*[^\n]{0,20}\b(?:20|40)[^\n]{0,20})\b/i,
  ];

  return matchFirst(text, patterns);
}

function toNumericField(value: string | null): ConfidenceField<number> {
  const numeric = parseDecimal(value);
  if (numeric == null) return EMPTY_NUMBER;
  return cf(numeric, BL_DEFAULT_CONFIDENCE);
}

function toTextField(value: string | null): ConfidenceField<string> {
  if (!value) return EMPTY_STRING;
  return cf(value, BL_DEFAULT_CONFIDENCE);
}

export function tryParseBLText(text: string): Record<string, any> | null {
  const source = text ?? '';
  if (!source.trim() || !isBillOfLadingText(source)) return null;

  const blNumber = matchFirst(source, [
    /\bb(?:ill)?\/?l\b\s*(?:n\.?|no\.?|number|num\.)?\s*[:#-]?\s*([A-Z0-9][A-Z0-9./-]{3,})/i,
    /\bBL\s+#?\s*([A-Z0-9][A-Z0-9./-]{3,})\b/i,
    /\bBL Number\b\s*[:#-]?\s*([A-Z0-9][A-Z0-9./-]{3,})/i,
    /\bDocument\s+No\.?\s*[:#-]?\s*([A-Z0-9][A-Z0-9./-]{3,})/i,
  ]);

  const customerReference = pickFirstNonEmpty([
    matchFirst(source, [
      /\bCustomer\s*Reference\s*(?:No\.?|Number|#)?\s*[:#-]?\s*([A-Z0-9][A-Z0-9./-]{2,})/i,
      /\bReference\s*[:#-]?\s*([A-Z0-9][A-Z0-9./-]{2,})/i,
      /\bPO\s*(?:No\.?|Number|#)?\s*[:#-]?\s*([A-Z0-9][A-Z0-9./-]{2,})/i,
    ]),
    matchFirst(source, [/\bBooking\s*(?:No\.?|Number|#)?\s*[:#-]?\s*([A-Z0-9][A-Z0-9./-]{2,})/i]),
  ]);

  const shipper = extractLabeledValue(source, [
    'shipper',
    'shipper/consignor',
    'consignor',
    'exporter',
    'shipper name',
  ]);
  const consignee = extractLabeledValue(source, [
    'consignee',
    'receiver',
    'consignee name',
    'importer',
  ]);
  const notifyParty = extractLabeledValue(source, [
    'notify\\s*party',
    'notify',
    'notify party name',
    'notiy',
  ]);

  const vesselName = matchFirst(source, [
    /\bVessel\s*(?:Name)?\s*[:#-]?\s*([A-Z0-9][A-Z0-9 .'/-]{2,60})(?:\r?\n|$)/i,
    /\bSHIP\s*(?:Name)?\s*[:#-]?\s*([A-Z0-9][A-Z0-9 .'/-]{2,60})(?:\r?\n|$)/i,
  ]);
  const voyageNumber = matchFirst(source, [
    /\bVoyage\s*(?:No\.?|Number|#)?\s*[:#-]?\s*([A-Z0-9]{2,20})/i,
    /\bVOY\s*[:#-]?\s*([A-Z0-9]{2,20})/i,
  ]);

  const etd =
    findLabeledDate(source, [
      'etd',
      'etd date',
      'estimated time of departure',
      'vessel departure',
    ]) ?? findLabeledDate(source, ['issue date', 'shipped on board', 'shipment date']);
  const eta =
    findLabeledDate(source, ['eta', 'arrival date', 'estimated time of arrival']) ??
    findLabeledDate(source, ['port of discharge']);
  const shipmentDate =
    findLabeledDate(source, ['shipment date', 'ship date', 'on board', 'on board date']) ?? etd;
  const issueDate = findLabeledDate(source, [
    'issue date',
    'date of issue',
    'bl date',
    'b/l date',
    'place and date of issue',
  ]);

  const portOfLoading =
    extractPort(source, 'loading') ||
    matchFirst(source, [/\bPort\s+of\s+Loading\s*[:#-]?\s*([A-Z][A-Z\s,.-]{2,80})(?:\n|$)/i]);
  const portOfDischarge =
    extractPort(source, 'discharge') ||
    matchFirst(source, [/\bPort\s+of\s+Discharge\s*[:#-]?\s*([A-Z][A-Z\s,.-]{2,80})(?:\n|$)/i]);

  const containerNumber = matchFirst(source, [
    /\b(?:Container\s*(?:No\.?|Number|#)?|CNT\s*(?:No\.?|Number|#)?)\s*[:#-]?\s*([A-Z0-9]{6,14})/i,
    /\bCONT\s*[:#-]?\s*([A-Z0-9]{6,14})/i,
  ]);
  const sealNumber = matchFirst(source, [
    /\bSeal\s*(?:No\.?|Number|#)?\s*[:#-]?\s*([A-Z0-9][A-Z0-9.-]{2,})/i,
    /\bSeal\s*:??\s*([A-Z0-9.-]{4,})/i,
  ]);

  const totalBoxes = matchFirst(source, [
    /\bTotal\s*(?:No\.?\s*|Number\s*)?(?:Packages|CTNS|PACKAGES|BOXES|CARTONS)\s*[:#-]?\s*([\d.,]+)/i,
    /\bTotal\s*Packages\s*[:#-]?\s*([\d.,]+)/i,
  ]);
  const totalGrossWeight = matchFirst(source, [
    /\bTotal\s*Gross\s*Weight\b[\s:;,/-]*([\d.,]+)\s*(?:KGS?|KG|MT|MTON|TON|KILOGRAMS?)?/i,
    /\bGross\s*Weight\b[\s:;,/-]*([\d.,]+)\s*(?:KGS?|KG|MT|MTON|TON|KILOGRAMS?)?/i,
  ]);
  const totalCbm = matchFirst(source, [
    /\bTotal\s*(?:CBM|M\s*3|M3|C\.M\.|Cubic\s*Metres?)\b[^\d]{0,12}([\d.,]+)/i,
    /\bVolume\b[^\d]{0,12}([\d.,]+)\s*(?:M3|CBM|CUBIC)?/i,
  ]);
  const freightPaymentTerm = matchFirst(source, [
    /\bFreight\b[^\r\n]{0,50}?\b(PREPAID|COLLECT)\b/i,
    /\b(PREPAID|COLLECT)\b[^\r\n]{0,50}?\bFreight\b/i,
  ])?.toUpperCase();
  const freightValue = freightPaymentTerm
    ? null
    : matchFirst(source, [
        /\bFreight\b[^\d\r\n]{0,50}?([\d.,]+)\s*(?:USD|EUR|CNY)?/i,
        /\bFreight\s*([A-Z]{3})?\s*[^\d\r\n]{0,20}([\d.,]+)(?:\s*(?:USD|EUR|CNY))?/i,
      ]);
  const freightCurrency =
    freightPaymentTerm ??
    matchFirst(source, [
      /\b(USD|EUR|CNY)\b(?=[^\r\n]{0,80}\bFreight\b)/i,
      /\bFreight\b[^\r\n]{0,80}\b(USD|EUR|CNY)\b/i,
    ])?.toUpperCase() ??
    null;
  const containerType = extractContainerType(source);
  const freeTime = matchFirst(source, [
    /\bFree\s*Time\s*(?:days?)?\s*[:#-]?\s*([\d]{1,4})\b/i,
    /\bFree\s*Time\s*\(?(?:DAYS?|DIAS)?\)?\s*[:#-]?\s*([\d]{1,4})\b/i,
  ]);
  const woodDeclaration =
    /\bwood\s*(?:declaration|certificate|plank|package|pallet)|\bmadeira\b/i.test(source)
      ? true
      : false;
  const cargoDescription = extractCargoDescription(source);
  const ncmList = extractNcmList(source);

  const parsed = {
    blNumber: toTextField(blNumber),
    customerReference: toTextField(customerReference),
    shipper: toTextField(normalizeParty(shipper)),
    consignee: toTextField(normalizeParty(consignee)),
    notifyParty: toTextField(normalizeParty(notifyParty)),
    vesselName: toTextField(vesselName),
    voyageNumber: toTextField(voyageNumber),
    portOfLoading: toTextField(portOfLoading),
    portOfDischarge: toTextField(portOfDischarge),
    etd: toTextField(etd),
    eta: toTextField(eta),
    shipmentDate: toTextField(shipmentDate),
    issueDate: toTextField(issueDate),
    containerNumber: toTextField(containerNumber),
    sealNumber: toTextField(sealNumber),
    totalBoxes: toNumericField(totalBoxes),
    totalGrossWeight: toNumericField(totalGrossWeight),
    totalCbm: toNumericField(totalCbm),
    freightValue: toNumericField(freightValue),
    freightCurrency: toTextField(freightCurrency),
    containerType: toTextField(containerType),
    cargoDescription: toTextField(cargoDescription),
    freeTime: freeTime == null ? EMPTY_NUMBER : cf(parseInt(freeTime, 10), BL_DEFAULT_CONFIDENCE),
    woodDeclaration: {
      value: woodDeclaration,
      confidence: woodDeclaration ? BL_DEFAULT_CONFIDENCE : 0,
    },
    ncmList: cf(
      ncmList.length > 0 ? ncmList : null,
      ncmList.length > 0 ? BL_DEFAULT_CONFIDENCE : 0,
    ),
  };

  const hasSignal = Boolean(
    blNumber ||
    customerReference ||
    shipper ||
    consignee ||
    portOfLoading ||
    portOfDischarge ||
    vesselName ||
    voyageNumber ||
    containerNumber ||
    containerType ||
    ncmList.length > 0,
  );
  if (!hasSignal) return null;

  return parsed;
}

function isFieldEmpty(value: unknown): boolean {
  if (value == null) return true;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'string') return value.trim().length === 0;
  return false;
}

function unwrapValue(field: unknown): unknown {
  if (field && typeof field === 'object' && 'value' in (field as Record<string, unknown>)) {
    return (field as { value: unknown }).value;
  }
  return field;
}

const BL_FILL_KEYS: string[] = [
  'blNumber',
  'customerReference',
  'shipper',
  'consignee',
  'notifyParty',
  'vesselName',
  'voyageNumber',
  'portOfLoading',
  'portOfDischarge',
  'etd',
  'eta',
  'shipmentDate',
  'issueDate',
  'containerNumber',
  'sealNumber',
  'totalBoxes',
  'totalGrossWeight',
  'totalCbm',
  'freightValue',
  'freightCurrency',
  'containerType',
  'cargoDescription',
  'freeTime',
  'woodDeclaration',
  'ncmList',
];

export function fillBLNullsFromText(data: Record<string, any>, text: string): Record<string, any> {
  const parsed = tryParseBLText(text);
  const out = { ...data };
  if (parsed) {
    for (const key of BL_FILL_KEYS) {
      const parsedField = parsed[key];
      const currentField = out[key];
      const currentValue = unwrapValue(currentField);

      if (!isFieldEmpty(currentValue) && currentField !== null && currentField !== undefined) {
        continue;
      }

      if (!isFieldEmpty(unwrapValue(parsedField))) {
        out[key] = parsedField;
      }
    }

    if (
      (out.ncmList == null || isFieldEmpty(unwrapValue(out.ncmList))) &&
      parsed.ncmList &&
      !isFieldEmpty(parsed.ncmList)
    ) {
      out.ncmList = parsed.ncmList;
    }

    if (out.woodDeclaration == null && !isFieldEmpty(unwrapValue(parsed.woodDeclaration))) {
      out.woodDeclaration = parsed.woodDeclaration;
    }
  }

  const freightCurrency = String(unwrapValue(out.freightCurrency) ?? '')
    .trim()
    .toUpperCase();
  if (freightCurrency === 'PREPAID' || freightCurrency === 'COLLECT') {
    const currentFreightValue = out.freightValue;
    out.freightValue =
      currentFreightValue && typeof currentFreightValue === 'object'
        ? { ...currentFreightValue, value: null }
        : { value: null, confidence: 0 };
  }

  return out;
}
