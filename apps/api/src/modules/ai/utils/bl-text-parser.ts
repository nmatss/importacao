import { findLabeledDate } from './dates.js';
import { parseDecimal } from './numbers.js';
import { isValidContainerIso6346 } from '../harness/format.js';

type ConfidenceField<T> = { value: T | null; confidence: number };

/**
 * Confianca de valor recuperado por REGEX do texto-fonte ("text_fallback").
 * Era 0.82 — patamar de campo lido pelo modelo — e por isso o lixo do gabarito
 * de um BL escaneado (ver BL_FORM_LABELS abaixo) SUBIA a nota do documento
 * (reuniao 11/09/2026: doc 156 marcou 0.50 so por causa de 6 campos-lixo; sem
 * eles, 0.14). Fallback nunca e leitura de primeira classe: fica abaixo do
 * corte de 0.7 de `computeConfidenceScore`, entao entra na lista de campos a
 * conferir em vez de inflar o percentual.
 */
const BL_TEXT_FALLBACK_CONFIDENCE = 0.5;

const cf = <T>(
  value: T | null,
  confidence = value == null ? 0 : BL_TEXT_FALLBACK_CONFIDENCE,
): ConfidenceField<T> => ({
  value,
  confidence,
});

const EMPTY_STRING = cf<string>(null, 0);
const EMPTY_NUMBER = cf<number>(null, 0);

const BL_DEFAULT_CONFIDENCE = BL_TEXT_FALLBACK_CONFIDENCE;

/**
 * Rotulos impressos no FORMULARIO do BL. Quando o PDF nao tem camada de texto
 * legivel pelo servidor, o OCR devolve so o gabarito em branco e os regexes
 * abaixo capturam o proprio rotulo como se fosse valor ("Skipper" virando
 * numero de BL, "Place of receipt" virando navio). Comparacao normalizada:
 * maiusculas, sem pontuacao e com espacos colapsados.
 */
const BL_FORM_LABELS = new Set([
  'AS CARRIER',
  'BILL OF LADING',
  'B L NO',
  'CARRIER',
  'CONSIGNEE',
  'CONSIGNE',
  'CONTAINER',
  'CONTAINER NO',
  'CONTAINERS',
  'DESCRIPTION OF GOODS',
  'FINAL DESTINATION',
  'FREIGHT AND CHARGES',
  'GROSS WEIGHT',
  'KIND OF PACKAGES',
  'LOCAL VESSEL',
  'MARKS AND NUMBER',
  'MARKS AND NUMBERS',
  'MEASUREMENT',
  'NOTIFY',
  'NOTIFY PARTY',
  'NUMBER OF PACKAGES',
  'OCEAN BILL OF LADING',
  'OCEAN VESSEL',
  'PARTICULARS FURNISHED BY SHIPPER',
  'PLACE OF DELIVERY',
  'PLACE OF RECEIPT',
  'PORT OF DISCHARGE',
  'PORT OF LOADING',
  'SEAL NO',
  'SHIPPED ON BOARD',
  'SHIPPER',
  'SHIPPER REFERENCE',
  'SKIPPER',
  'VESSEL',
]);

function normalizeForLabelCheck(value: string): string {
  return value
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();
}

function isFormLabel(value: string): boolean {
  return BL_FORM_LABELS.has(normalizeForLabelCheck(value));
}

/** Texto util: comeca com letra/numero, nao e rotulo do gabarito e tem corpo. */
function acceptText(value: string | null, minLetters = 3): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed || !/^[A-Za-z0-9]/.test(trimmed)) return null;
  if (isFormLabel(trimmed)) return null;
  if ((trimmed.match(/[A-Za-z]/g) ?? []).length < minLetters) return null;
  return trimmed;
}

/**
 * Identificador (BL, referencia, lacre, viagem): alfanumerico, com pelo menos
 * um digito e comprimento minimo. Mata "Skipper" (sem digito) e "S/C" (curto)
 * sem recusar numeros reais como SHYY26080167 ou 0079W.
 */
function acceptIdentifier(value: string | null, minLength = 5): string | null {
  if (!value) return null;
  const trimmed = value.trim().replace(/[.,;:]+$/, '');
  if (trimmed.length < minLength) return null;
  if (!/^[A-Za-z0-9][A-Za-z0-9./-]*$/.test(trimmed)) return null;
  if (!/\d/.test(trimmed)) return null;
  if (isFormLabel(trimmed)) return null;
  return trimmed;
}

/**
 * Container ISO 6346 COM digito verificador. Sem isso o regex `\bCONT...`
 * capturava "ainers" do rotulo "Containers" do gabarito e a capa do processo
 * exibia "Numero container: ainers" (print da reuniao 11/09/2026). Aceita
 * lista separada por virgula/ponto-e-virgula/barra e devolve so as partes
 * validas — uma alucinacao parcial nao contamina as demais.
 */
function acceptContainerNumbers(value: string | null): string | null {
  if (!value) return null;
  const parts = value
    .split(/[,;/]+/)
    .map((part) => part.trim().toUpperCase())
    .filter(Boolean)
    .filter((part) => isValidContainerIso6346(part));
  return parts.length > 0 ? parts.join(',') : null;
}

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

  const blNumber = acceptIdentifier(
    matchFirst(source, [
      /\bb(?:ill)?\/?l\b\s*(?:n\.?|no\.?|number|num\.)?\s*[:#-]?\s*([A-Z0-9][A-Z0-9./-]{3,})/i,
      /\bBL\s+#?\s*([A-Z0-9][A-Z0-9./-]{3,})\b/i,
      /\bBL Number\b\s*[:#-]?\s*([A-Z0-9][A-Z0-9./-]{3,})/i,
      /\bDocument\s+No\.?\s*[:#-]?\s*([A-Z0-9][A-Z0-9./-]{3,})/i,
    ]),
  );

  const customerReference = acceptIdentifier(
    pickFirstNonEmpty([
      matchFirst(source, [
        /\bCustomer\s*Reference\s*(?:No\.?|Number|#)?\s*[:#-]?\s*([A-Z0-9][A-Z0-9./-]{2,})/i,
        /\bReference\s*[:#-]?\s*([A-Z0-9][A-Z0-9./-]{2,})/i,
        /\bPO\s*(?:No\.?|Number|#)?\s*[:#-]?\s*([A-Z0-9][A-Z0-9./-]{2,})/i,
      ]),
      matchFirst(source, [/\bBooking\s*(?:No\.?|Number|#)?\s*[:#-]?\s*([A-Z0-9][A-Z0-9./-]{2,})/i]),
    ]),
  );

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

  const vesselName = acceptText(
    matchFirst(source, [
      /\bVessel\s*(?:Name)?\s*[:#-]?\s*([A-Z0-9][A-Z0-9 .'/-]{2,60})(?:\r?\n|$)/i,
      /\bSHIP\s*(?:Name)?\s*[:#-]?\s*([A-Z0-9][A-Z0-9 .'/-]{2,60})(?:\r?\n|$)/i,
    ]),
  );
  const voyageNumber = acceptIdentifier(
    matchFirst(source, [
      /\bVoyage\s*(?:No\.?|Number|#)?\s*[:#-]?\s*([A-Z0-9]{2,20})/i,
      /\bVOY\s*[:#-]?\s*([A-Z0-9]{2,20})/i,
    ]),
    3,
  );

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

  const portOfLoading = acceptText(
    extractPort(source, 'loading') ||
      matchFirst(source, [/\bPort\s+of\s+Loading\s*[:#-]?\s*([A-Z][A-Z\s,.-]{2,80})(?:\n|$)/i]),
  );
  const portOfDischarge = acceptText(
    extractPort(source, 'discharge') ||
      matchFirst(source, [/\bPort\s+of\s+Discharge\s*[:#-]?\s*([A-Z][A-Z\s,.-]{2,80})(?:\n|$)/i]),
  );

  // ISO 6346 obrigatorio: o padrao `CONT...` sozinho casava "Cont"+"ainers" do
  // rotulo do gabarito e gravava "ainers" como numero de container.
  const containerNumber = acceptContainerNumbers(
    matchFirst(source, [
      /\b(?:Container|CNTR|CNT)\s*(?:No\.?|Number|#)?\s*[:#-]?\s*([A-Z]{4}\s?\d{6,7}(?:\s*[,;/]\s*[A-Z]{4}\s?\d{6,7})*)/i,
    ]),
  );
  const sealNumber = acceptIdentifier(
    matchFirst(source, [
      /\bSeal\s*(?:No\.?|Number|#)?\s*[:#-]?\s*([A-Z0-9][A-Z0-9.-]{2,})/i,
      /\bSeal\s*:??\s*([A-Z0-9.-]{4,})/i,
    ]),
    4,
  );

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
  // Descricao da carga precisa de corpo: "No, o" (pedaco de "Marks and Number
  // No, of pkgs" lido pelo OCR do gabarito) nao e descricao de mercadoria.
  const cargoDescription = acceptText(extractCargoDescription(source), 8);
  const ncmList = extractNcmList(source);

  const shipperName = acceptText(normalizeParty(shipper));
  const consigneeName = acceptText(normalizeParty(consignee));
  const notifyPartyName = acceptText(normalizeParty(notifyParty));

  const parsed = {
    blNumber: toTextField(blNumber),
    customerReference: toTextField(customerReference),
    shipper: toTextField(shipperName),
    consignee: toTextField(consigneeName),
    notifyParty: toTextField(notifyPartyName),
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
    shipperName ||
    consigneeName ||
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

/**
 * @param options.sourceTextReliable - `false` quando o texto veio de OCR de um
 *   PDF que o servidor nao consegue ler (o original foi anexado ao provider
 *   multimodal). Nesse caso o texto e um GABARITO em branco: preencher nulos a
 *   partir dele so injeta lixo com cara de dado lido. A normalizacao de frete
 *   PREPAID/COLLECT continua valendo porque age sobre o que o modelo extraiu.
 */
export function fillBLNullsFromText(
  data: Record<string, any>,
  text: string,
  options?: { sourceTextReliable?: boolean },
): Record<string, any> {
  const parsed = options?.sourceTextReliable === false ? null : tryParseBLText(text);
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
