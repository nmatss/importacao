import { createHash, randomUUID } from 'node:crypto';
import { eq, desc, sql, and, ne } from 'drizzle-orm';
import path from 'node:path';
import fs from 'fs/promises';
import pdfParse from 'pdf-parse';
import * as XLSX from 'xlsx';
import mammoth from 'mammoth';
import { db } from '../../shared/database/connection.js';
import {
  documents,
  documentExtractionHistory,
  documentExtractionRuns,
  documentExtractedFields,
  comparisonAcceptances,
  comparisonFieldOverrides,
  importProcesses,
  followUpTracking,
  emailIngestionLogs,
  emailAttachmentDocuments,
  users,
} from '../../shared/database/schema.js';
import { aiService, flattenAiData, AIBudgetExceededError } from '../ai/service.js';
import { alertService } from '../alerts/service.js';
import { tryParseEspelhoBuffer } from '../espelho-parser/parser.js';
import { googleDriveService } from '../integrations/google-drive.service.js';
import { logger } from '../../shared/utils/logger.js';
import {
  assertArquivoSeguroParaAbrir,
  tetoDescomprimidoDocx,
} from '../../shared/utils/archive-guard.js';
import { parseSerializado } from '../../shared/utils/parse-serializado.js';
import { auditService } from '../audit/service.js';
import { assertTransition } from '../../shared/state-machine/process-states.js';
import type { ProcessStatus } from '../../shared/state-machine/process-states.js';
import { NotFoundError } from '../../shared/errors/index.js';
import { recordProcessEvent } from '../../shared/utils/process-events.js';
import { getQueue } from '../../shared/queue/index.js';
import { portsMatch as normalizedPortsMatch } from '../validation/utils/port-normalize.js';
import { normalizeCompanyName } from '../validation/utils/name-normalize.js';
import { extractPartyParts } from '../validation/utils/party-extract.js';
import {
  itemCodesMatch,
  cleanItemCodesInAiData,
  extractCanonicalItemCode,
} from '../validation/utils/item-code-normalize.js';
import { compareDates } from '../validation/utils/date-compare.js';
import { buildEspelhoFromAiData } from './utils/build-espelho.js';
import type {
  AcceptComparisonInput,
  EditComparisonFieldInput,
  RemoveComparisonFieldInput,
} from './schema.js';
import { normalizeGtin } from '../ai/harness/format.js';
import { reconcileProcessConfidence } from './reconcile.js';
import { ocrScannedPdf, rasterizePdfPages } from './ocr.js';
import { MIN_OPERATIONAL_CONFIDENCE } from './constants.js';

/**
 * Fonte ÚNICA da conversão XLSX → texto para extração por IA.
 *
 * `blankrows: false` + descarte de linhas so-separador + teto de caracteres:
 * quando alguem formata uma coluna inteira, o range usado da planilha vai ate a
 * linha 1048576 e o CSV vira centenas de milhares de linhas de virgulas. Um
 * xlsx de 27 KB gerava prompt suficiente para estourar o teto de 180 s da
 * extracao — foi assim que 3 dos 4 timeouts de producao nasceram (2026-08-17).
 * A correcao vivia so em extractText(); o fallback de IA do espelho usava um
 * segundo caminho sem nenhuma protecao.
 */
export function spreadsheetBufferToText(
  buffer: Buffer,
  opts: { sheetHeaders?: boolean; logContext?: Record<string, unknown> } = {},
): string {
  const maxChars = Number(process.env.DOCUMENT_SPREADSHEET_MAX_CHARS) || 200_000;
  // ANTES do parse: `maxChars` protege o tamanho do prompt, e so age depois que
  // o `XLSX.read` ja alocou tudo. Um xlsx de 4,7 MB com 400 mil linhas leva o
  // RSS a 770 MB num container de 512 M — e como os workers rodam dentro do
  // processo da API, isso derruba a API, nao um job.
  assertArquivoSeguroParaAbrir(buffer);
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const parts: string[] = [];
  let length = 0;
  let sheetsConverted = 0;
  let stoppedEarly = false;

  for (const sheetName of workbook.SheetNames) {
    // Corte ANTECIPADO: o acumulado ja passou do teto, entao os primeiros
    // maxChars caracteres do texto final ja estao decididos e tudo o que vier
    // depois seria descartado pelo slice. Converter as abas restantes e
    // trabalho puro — uma pasta com 50 abas pagava a conversao inteira para
    // jogar quase tudo fora.
    if (length > maxChars) {
      stoppedEarly = true;
      break;
    }
    sheetsConverted += 1;
    const csv = XLSX.utils.sheet_to_csv(workbook.Sheets[sheetName], { blankrows: false });
    const util = csv
      .split('\n')
      .filter((line) => line.replace(/[,;\s]/g, '').length > 0)
      .join('\n');
    if (!util) continue;
    const part = opts.sheetHeaders ? `--- Sheet: ${sheetName} ---\n${util}` : util;
    // `parts.length` antes do push = numero de separadores '\n' que o join
    // vai inserir, entao `length` acompanha exatamente o texto final.
    length += part.length + (parts.length > 0 ? 1 : 0);
    parts.push(part);
  }

  const text = parts.join('\n');
  if (text.length <= maxChars) return text;

  logger.warn(
    {
      ...(opts.logContext ?? {}),
      chars: text.length,
      maxChars,
      sheetsConverted,
      sheetsTotal: workbook.SheetNames.length,
      stoppedEarly,
    },
    'Spreadsheet text truncated before AI extraction',
  );
  return `${text.slice(0, maxChars)}\n[TEXTO TRUNCADO: a planilha excede o limite de ${maxChars} caracteres]`;
}

/**
 * Convert an XLSX buffer to plain CSV-style text — used as input to the
 * Espelho AI fallback when the deterministic parser fails. Same protections
 * as extractText(), applied to a buffer (no filesystem hop).
 */
function extractTextFromXlsxBuffer(buffer: Buffer): string {
  return spreadsheetBufferToText(buffer, { sheetHeaders: true });
}

function hasFailedEspelhoExtraction(aiParsedData: unknown): boolean {
  if (!aiParsedData || typeof aiParsedData !== 'object' || Array.isArray(aiParsedData)) {
    return false;
  }
  const data = aiParsedData as Record<string, unknown>;
  return Boolean(data.error || data.extractionFailed);
}

const PROJECTED_AI_DATA_KEYS = new Set([
  'invoice',
  'proforma_invoice',
  'packing_list',
  'ohbl',
  'draft_bl',
  'draft_duimp',
  'duimp',
  'espelho',
  'li',
  'certificate',
  'other',
]);
// 25 min: precisa cobrir a PIOR extração real (OCR de 20 páginas + IA) e casar
// com o expireInSeconds do job — lease menor que a extração fazia um reprocess
// concorrente reivindicar o documento enquanto o worker original ainda rodava.
const DEFAULT_EXTRACTION_LEASE_MS = 25 * 60 * 1000;

function extractionLeaseDurationMs(): number {
  const configured = Number(process.env.DOCUMENT_EXTRACTION_LEASE_MS);
  // A lease shorter than the AI timeout would reintroduce concurrent work.
  return Number.isFinite(configured) && configured >= 120_000
    ? configured
    : DEFAULT_EXTRACTION_LEASE_MS;
}
const AI_META_KEYS = new Set([
  'budgetExceeded',
  'confidence',
  'confidenceScore',
  'error',
  'extractionFailed',
  'fieldsWithLowConfidence',
  'reason',
  'rawText',
  'skipped',
  'source',
  '_trust',
  'warnings',
]);

const COVERAGE_EXCLUDED_KEYS = new Set(['items', 'ncmList']);

type CoverageProfile = {
  required: string[];
  important?: string[];
};

const CRITICAL_COVERAGE_FIELDS = 4;
const IMPORTANT_COVERAGE_FIELDS = 2;
const NORMAL_COVERAGE_FIELDS = 1;

const COVERAGE_PROFILES: Record<string, CoverageProfile> = {
  invoice: {
    required: [
      'invoiceNumber',
      'invoiceDate',
      'exporterName',
      'importerName',
      'incoterm',
      'currency',
      'totalFobValue',
      'totalBoxes',
      'totalGrossWeight',
      'portOfLoading',
      'portOfDischarge',
    ],
    important: ['totalCbm', 'shippedOnBoardDate', 'etd', 'shipmentDate', 'manufacturerName'],
  },
  proforma_invoice: {
    required: [
      'piNumber',
      'invoiceNumber',
      'invoiceDate',
      'exporterName',
      'importerName',
      'currency',
      'totalFobValue',
      'totalBoxes',
      'totalGrossWeight',
      'portOfLoading',
      'portOfDischarge',
    ],
    important: ['totalCbm', 'validUntil'],
  },
  packing_list: {
    required: [
      'packingListNumber',
      'date',
      'exporterName',
      'importerName',
      'totalBoxes',
      'totalGrossWeight',
      'portOfLoading',
      'portOfDischarge',
    ],
    important: [
      'invoiceNumber',
      'totalNetWeight',
      'totalCbm',
      'etd',
      'shippedOnBoardDate',
      'shipmentDate',
    ],
  },
  ohbl: {
    required: [
      'blNumber',
      'customerReference',
      'portOfLoading',
      'portOfDischarge',
      'vesselName',
      'voyageNumber',
      'shipmentDate',
      'etd',
      'eta',
      'containerNumber',
      'totalBoxes',
      'totalGrossWeight',
      'cargoDescription',
    ],
    important: [
      'totalCbm',
      'freightValue',
      'freightCurrency',
      'issueDate',
      'sealNumber',
      'containerType',
    ],
  },
  draft_bl: {
    required: [
      'blNumber',
      'customerReference',
      'portOfLoading',
      'portOfDischarge',
      'vesselName',
      'voyageNumber',
      'shipmentDate',
      'etd',
      'eta',
      'containerNumber',
      'totalBoxes',
      'totalGrossWeight',
      'cargoDescription',
    ],
    important: [
      'totalCbm',
      'freightValue',
      'freightCurrency',
      'issueDate',
      'sealNumber',
      'containerType',
    ],
  },
  certificate: {
    required: [
      'certificateType',
      'certificateNumber',
      'issueDate',
      'issuingAuthority',
      'importerName',
    ],
  },
  li: {
    required: [
      'liNumber',
      'registrationDate',
      'status',
      'importerName',
      'importerCnpj',
      'exporterName',
      'totalValue',
      'currency',
    ],
    important: ['deferralDate', 'items', 'anuentes'],
  },
  // A draft can legitimately precede channeling/clearance, while a final
  // DUIMP should normally expose the registration date and all monetary data.
  draft_duimp: {
    required: ['duimpNumber', 'customsValue', 'registrationDollar', 'insuranceValue'],
    important: ['registeredAt', 'customsClearanceAt', 'customsChannel'],
  },
  duimp: {
    required: [
      'duimpNumber',
      'customsValue',
      'registrationDollar',
      'insuranceValue',
      'registeredAt',
    ],
    important: ['customsClearanceAt', 'customsChannel'],
  },
};

function getCoverageProfile(documentType: string): CoverageProfile | null {
  return COVERAGE_PROFILES[documentType] ?? null;
}

function getCoverageWeight(documentType: string, fieldName: string): number {
  const profile = getCoverageProfile(documentType);
  if (!profile) return NORMAL_COVERAGE_FIELDS;
  if (profile.required.includes(fieldName)) return CRITICAL_COVERAGE_FIELDS;
  if (profile.important?.includes(fieldName)) return IMPORTANT_COVERAGE_FIELDS;
  return NORMAL_COVERAGE_FIELDS;
}

function unwrapAiFieldValue(value: unknown): unknown {
  if (isRecord(value) && 'value' in value) return value.value;
  return value;
}

function sha256Text(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** Teto do encadeamento de reafirmacoes de um mesmo aceite (ver acceptComparison). */
const MAX_ACCEPTANCE_REAFFIRMATIONS = 50;

interface AcceptanceEvidence {
  values: Record<string, unknown> | null;
  status: string | null;
  sources: Record<string, number | null> | null;
}

/**
 * Evidencia de um aceite: os VALORES que o operador viu na linha, o status
 * calculado sobre eles e os documentos que os originaram. O `evidence_hash`
 * cobria apenas a identidade da celula, entao um aceite dado sobre a extracao
 * antiga colidia com o mesmo hash depois de um reprocessamento.
 */
function buildAcceptanceEvidence(
  comparison: {
    aggregateComparison?: any[];
    itemComparison?: any[];
    sourceDocuments?: Record<string, number | null>;
  } | null,
  input: AcceptComparisonInput,
): AcceptanceEvidence {
  const sources = comparison?.sourceDocuments ?? null;

  if (input.scope === 'aggregate') {
    const row = (comparison?.aggregateComparison ?? []).find(
      (candidate: any) => candidate.rowKey === input.rowKey,
    );
    return {
      values: row
        ? {
            invoice: row.invoice ?? null,
            packingList: row.packingList ?? null,
            bl: row.bl ?? null,
            espelho: row.espelho ?? null,
          }
        : null,
      status: row?.status ?? null,
      sources,
    };
  }

  const row = (comparison?.itemComparison ?? []).find(
    (candidate: any) => candidate.rowKey === input.rowKey,
  );
  return {
    values: row
      ? {
          itemCode: row.itemCode ?? null,
          invoiceQty: row.invoiceQty ?? null,
          plQty: row.plQty ?? null,
          espelhoQty: row.espelhoQty ?? null,
          invoiceManufacturer: row.invoiceManufacturer ?? null,
          plManufacturer: row.plManufacturer ?? null,
          espelhoManufacturer: row.espelhoManufacturer ?? null,
          invoiceNetWeight: row.invoiceNetWeight ?? null,
          plNetWeight: row.plNetWeight ?? null,
          invoiceGrossWeight: row.invoiceGrossWeight ?? null,
          plGrossWeight: row.plGrossWeight ?? null,
        }
      : null,
    status: row?.status ?? null,
    sources,
  };
}

function extractConfidence(value: unknown): number | null {
  if (isRecord(value) && typeof value.confidence === 'number') return value.confidence;
  return null;
}

function collectExtractedFields(
  value: unknown,
  prefix = '',
  out: Array<{ fieldPath: string; valueJson: unknown; confidence: number | null }> = [],
): Array<{ fieldPath: string; valueJson: unknown; confidence: number | null }> {
  if (prefix && isRecord(value) && 'value' in value) {
    out.push({
      fieldPath: prefix,
      valueJson: value.value ?? null,
      confidence: extractConfidence(value),
    });
    return out;
  }

  if (Array.isArray(value)) {
    value.slice(0, 500).forEach((item, index) => {
      collectExtractedFields(item, `${prefix}[${index}]`, out);
    });
    return out;
  }

  if (isRecord(value)) {
    for (const [key, nested] of Object.entries(value)) {
      if (AI_META_KEYS.has(key) || key.startsWith('_')) continue;
      const nextPath = prefix ? `${prefix}.${key}` : key;
      collectExtractedFields(nested, nextPath, out);
    }
    return out;
  }

  if (prefix) {
    out.push({ fieldPath: prefix, valueJson: value ?? null, confidence: null });
  }
  return out;
}

type FieldEvidence = { sourcePage: number | null; sourceExcerpt: string | null };

/**
 * Evidence is intentionally deterministic: it identifies the first page whose
 * normalized text contains the extracted scalar and stores only a bounded
 * excerpt. Values not present verbatim (for example normalized dates) retain
 * null evidence instead of inventing provenance.
 */
function findFieldEvidence(value: unknown, pageTexts: string[]): FieldEvidence {
  const scalar = typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
  if (scalar.length < 3) return { sourcePage: null, sourceExcerpt: null };
  const normalized = scalar.replace(/\s+/g, ' ').toLowerCase();
  for (let index = 0; index < pageTexts.length; index += 1) {
    const page = pageTexts[index] ?? '';
    const haystack = page.replace(/\s+/g, ' ').toLowerCase();
    const position = haystack.indexOf(normalized);
    if (position < 0) continue;
    const excerpt = page
      .replace(/\s+/g, ' ')
      .slice(Math.max(0, position - 120), position + normalized.length + 180);
    return { sourcePage: index + 1, sourceExcerpt: excerpt.slice(0, 500) || null };
  }
  return { sourcePage: null, sourceExcerpt: null };
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function shouldProjectAiData(
  type: string,
  aiParsedData: unknown,
  confidenceScore?: string | number | null,
): aiParsedData is Record<string, any> {
  if (!PROJECTED_AI_DATA_KEYS.has(type) || !isRecord(aiParsedData)) return false;
  if (aiParsedData.extractionFailed || aiParsedData.skipped) return false;
  if (!hasMeaningfulAiData(aiParsedData)) return false;
  if (!hasOperationalConfidence(confidenceScore)) return false;
  if (type === 'espelho' && hasFailedEspelhoExtraction(aiParsedData)) return false;
  return true;
}

function hasOperationalConfidence(confidenceScore: string | number | null | undefined): boolean {
  if (confidenceScore == null) return true;
  const confidence =
    typeof confidenceScore === 'number' ? confidenceScore : Number.parseFloat(confidenceScore);
  return Number.isFinite(confidence) && confidence >= MIN_OPERATIONAL_CONFIDENCE;
}

function hasMeaningfulAiData(value: unknown): boolean {
  return hasMeaningfulAiValue(value);
}

function hasMeaningfulAiValue(value: unknown): boolean {
  if (value == null) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value === 'boolean') return value === true;
  if (Array.isArray(value)) return value.some((item) => hasMeaningfulAiValue(item));
  if (!isRecord(value)) return false;

  if ('value' in value) {
    return hasMeaningfulAiValue(value.value);
  }

  return Object.entries(value).some(([key, nested]) => {
    if (AI_META_KEYS.has(key)) return false;
    return hasMeaningfulAiValue(nested);
  });
}

const LOW_CONFIDENCE_FIELD_THRESHOLD = 0.5;

export interface ExtractionCoverageSummary {
  readPercent: number;
  effectiveReadPercent: number;
  trackedMissingFields: string[];
  trackedTotalWeight: number;
  trackedFilledWeight: number;
  totalFields: number;
  filledFields: number;
  missingFields: string[];
  lowConfidenceFields: string[];
}

/**
 * Lightweight per-document coverage report computed from the EXISTING stored
 * extracted data (no AI re-run). Serves Eduarda's "leu só 78% e faltou puxar
 * campos": tells the UI exactly which fields were read, which came back empty,
 * and which were read with low confidence.
 *
 * A field is counted when it is a top-level extracted attribute (the `items`
 * array and harness/AI meta keys are excluded). It is:
 *   - "missing" when its value is null/empty (per hasMeaningfulAiValue), and
 *   - "lowConfidence" when its { value, confidence } carries confidence < 0.5.
 * readPercent = filledFields / totalFields, rounded to a whole percent.
 * effectiveReadPercent = weighted coverage with profile for known document types.
 */
function computeExtractionCoverage(
  aiParsedData: unknown,
  documentType: string,
): ExtractionCoverageSummary | null {
  if (!isRecord(aiParsedData)) return null;
  if (aiParsedData.extractionFailed || aiParsedData.skipped || aiParsedData.error) return null;

  const missingFields: string[] = [];
  const lowConfidenceFields: string[] = [];
  const trackedMissingFields: string[] = [];
  let totalFields = 0;
  let filledFields = 0;
  let trackedTotalWeight = 0;
  let trackedFilledWeight = 0;

  const profile = getCoverageProfile(documentType);
  const trackedFields = profile ? [...profile.required, ...(profile.important ?? [])] : [];
  const trackedSet = profile ? new Set(trackedFields) : null;

  if (profile) {
    for (const key of trackedFields) {
      const raw = aiParsedData[key];
      const weight = getCoverageWeight(documentType, key);
      trackedTotalWeight += weight;
      if (hasMeaningfulAiValue(raw)) {
        trackedFilledWeight += weight;
      } else {
        trackedMissingFields.push(key);
      }
    }
  }

  for (const [key, raw] of Object.entries(aiParsedData)) {
    if (AI_META_KEYS.has(key) || key.startsWith('_') || COVERAGE_EXCLUDED_KEYS.has(key)) continue;
    // Items and aggregate arrays (ncmList) are separate collections and should
    // not dilute a scalar field coverage score.

    totalFields += 1;

    const filled = hasMeaningfulAiValue(raw);
    if (filled) {
      filledFields += 1;
    } else {
      missingFields.push(key);
    }

    if (!trackedSet) {
      const weight = getCoverageWeight(documentType, key);
      trackedTotalWeight += weight;
      if (filled) {
        trackedFilledWeight += weight;
      } else {
        trackedMissingFields.push(key);
      }
    }

    if (isRecord(raw) && 'value' in raw && typeof raw.confidence === 'number') {
      if (
        hasMeaningfulAiValue(unwrapAiFieldValue(raw)) &&
        raw.confidence < LOW_CONFIDENCE_FIELD_THRESHOLD
      ) {
        lowConfidenceFields.push(key);
      }
    }
  }

  const readPercent = totalFields > 0 ? Math.round((filledFields / totalFields) * 100) : 0;
  const effectiveReadPercent =
    trackedSet && trackedTotalWeight > 0
      ? Math.round((trackedFilledWeight / trackedTotalWeight) * 100)
      : readPercent;

  return {
    readPercent,
    effectiveReadPercent,
    trackedMissingFields,
    trackedTotalWeight,
    trackedFilledWeight,
    totalFields,
    filledFields,
    missingFields,
    lowConfidenceFields,
  };
}
function standardizeDocumentName(
  type: string,
  processCode: string,
  aiData: Record<string, any> | null,
): string | null {
  if (type === 'invoice' && aiData) {
    const dateStr = aiData.invoiceDate || aiData.invoice_date;
    if (dateStr) {
      const formatted = String(dateStr).replace(/-/g, '.');
      return `${formatted} KIOM INV ${processCode}.pdf`;
    }
  }
  if (type === 'packing_list' && aiData) {
    const dateStr = aiData.invoiceDate || aiData.invoice_date;
    if (dateStr) {
      const formatted = String(dateStr).replace(/-/g, '.');
      return `${formatted} KIOM PL ${processCode}.pdf`;
    }
  }
  if (type === 'ohbl' && aiData) {
    const dateStr = aiData.shipmentDate || aiData.etd;
    if (dateStr) {
      const formatted = String(dateStr).replace(/-/g, '.');
      return `${formatted} KIOM BL ${processCode}.pdf`;
    }
  }
  if (type === 'draft_bl' && aiData) {
    const dateStr = aiData.shipmentDate || aiData.etd;
    if (dateStr) {
      const formatted = String(dateStr).replace(/-/g, '.');
      return `${formatted} KIOM DRAFT BL ${processCode}.pdf`;
    }
    return `DRAFT BL ${processCode}.pdf`;
  }
  if (type === 'certificate' && aiData) {
    const rawCertType =
      typeof aiData.certificateType === 'object'
        ? aiData.certificateType?.value
        : aiData.certificateType;
    const rawCertNumber =
      typeof aiData.certificateNumber === 'object'
        ? aiData.certificateNumber?.value
        : aiData.certificateNumber;
    const certType = rawCertType || 'CERT';
    const certNumber = rawCertNumber || '';
    return `CERT ${String(certType).toUpperCase()} ${certNumber ? certNumber + ' ' : ''}${processCode}.pdf`;
  }
  return null;
}

async function persistExtractionLineage(params: {
  documentId: number;
  processId: number;
  documentType: string;
  data?: Record<string, any>;
  confidenceScore?: number | null;
  sourceText?: string;
  sourcePages?: string[];
  extractionStatus?: 'completed' | 'failed' | 'skipped' | 'deterministic';
  provider?: string | null;
  model?: string | null;
  documentUpdate?: {
    aiParsedData: Record<string, unknown>;
    confidenceScore: string;
    isProcessed: boolean;
    updatedAt: Date;
  };
}) {
  const hasSourceText = typeof params.sourceText === 'string';
  const sourceText = params.sourceText ?? '';
  const sourceTextHash = hasSourceText ? sha256Text(sourceText) : null;
  const fields = collectExtractedFields(params.data ?? {})
    .filter((field) => field.fieldPath.length <= 255)
    .slice(0, 1000);

  await db.transaction(async (tx) => {
    if (params.documentUpdate) {
      await tx
        .update(documents)
        .set(params.documentUpdate)
        .where(eq(documents.id, params.documentId));
    }

    const [run] = await tx
      .insert(documentExtractionRuns)
      .values({
        documentId: params.documentId,
        processId: params.processId,
        documentType: params.documentType,
        provider: 'provider' in params ? params.provider : (process.env.AI_PROVIDER ?? null),
        model:
          'model' in params
            ? params.model
            : (process.env.AI_MODEL ?? process.env.AI_ANALYSIS_MODEL ?? null),
        confidence: params.confidenceScore == null ? null : String(params.confidenceScore),
        sourceTextHash,
        sourceTextLength: hasSourceText ? sourceText.length : null,
        extractionStatus: params.extractionStatus ?? 'completed',
      })
      .returning({ id: documentExtractionRuns.id });

    if (fields.length === 0) return;

    await tx.insert(documentExtractedFields).values(
      fields.map((field) => {
        const evidence = findFieldEvidence(field.valueJson, params.sourcePages ?? []);
        return {
          runId: run.id,
          documentId: params.documentId,
          processId: params.processId,
          documentType: params.documentType,
          fieldPath: field.fieldPath,
          valueJson: field.valueJson as any,
          confidence: field.confidence == null ? null : String(field.confidence),
          sourceTextHash,
          sourcePage: evidence.sourcePage,
          sourceExcerpt: evidence.sourceExcerpt,
        };
      }),
    );
  });
}

async function invalidateComparisonAcceptances(processId: number, reason: string) {
  await db
    .update(comparisonAcceptances)
    .set({
      invalidatedAt: new Date(),
      invalidationReason: reason,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(comparisonAcceptances.processId, processId),
        sql`${comparisonAcceptances.invalidatedAt} IS NULL`,
      ),
    );
}

const DEFAULT_PROCESSING_STALE_MINUTES = 30;
const processingStaleMinutes = Number(
  process.env.DOCUMENT_PROCESSING_STALE_MINUTES ?? DEFAULT_PROCESSING_STALE_MINUTES,
);
const PROCESSING_STALE_MS =
  Number.isFinite(processingStaleMinutes) && processingStaleMinutes > 0
    ? processingStaleMinutes * 60 * 1000
    : DEFAULT_PROCESSING_STALE_MINUTES * 60 * 1000;
const DEFAULT_AI_EXTRACTION_TIMEOUT_MS = 180_000;

function aiExtractionTimeoutMs(): number {
  const configured = Number(process.env.DOCUMENT_AI_EXTRACTION_TIMEOUT_MS);
  return Number.isFinite(configured) && configured > 0
    ? configured
    : DEFAULT_AI_EXTRACTION_TIMEOUT_MS;
}

async function withAIExtractionTimeout<T>(
  promise: Promise<T>,
  context: { documentId: number; type: string },
  timeoutMsOverride?: number,
): Promise<T> {
  const timeoutMs = timeoutMsOverride ?? aiExtractionTimeoutMs();
  let timeout: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeout = setTimeout(() => {
          reject(
            new Error(
              `Tempo limite operacional de extração IA excedido (${timeoutMs}ms) para documento ${context.documentId} (${context.type})`,
            ),
          );
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function hasExtractionFailureData(aiParsedData: unknown): boolean {
  if (!isRecord(aiParsedData)) return false;
  return Boolean(aiParsedData.extractionFailed || aiParsedData.error);
}

async function assertDocumentProcessNotLocked(processId: number) {
  const [row] = await db
    .select({ lockedAt: importProcesses.lockedAt, lockedReason: importProcesses.lockedReason })
    .from(importProcesses)
    .where(eq(importProcesses.id, processId))
    .limit(1);
  if (row?.lockedAt) {
    const err: Error & { statusCode?: number } = new Error(
      `Processo travado em ${row.lockedAt.toISOString()} (motivo: ${row.lockedReason ?? 'sem motivo registrado'}). Destrave antes de alterar documentos.`,
    );
    err.statusCode = 423;
    throw err;
  }
}

function isProcessingStale(updatedAt: Date | string | null | undefined): boolean {
  if (!updatedAt) return false;
  const timestamp = updatedAt instanceof Date ? updatedAt.getTime() : new Date(updatedAt).getTime();
  if (!Number.isFinite(timestamp)) return false;
  return Date.now() - timestamp > PROCESSING_STALE_MS;
}

function documentAiProcessingStatus(row: {
  isProcessed: boolean | null;
  aiParsedData: unknown;
  updatedAt?: Date | string | null;
  createdAt?: Date | string | null;
}): 'processing' | 'completed' | 'failed' {
  if (row.isProcessed) {
    if (hasExtractionFailureData(row.aiParsedData)) return 'failed';
    return hasMeaningfulAiData(row.aiParsedData) ? 'completed' : 'failed';
  }
  return isProcessingStale(row.updatedAt ?? row.createdAt) ? 'failed' : 'processing';
}

function toDocumentResponse(row: {
  id: number;
  processId: number;
  originalFilename?: string | null;
  type: string;
  createdAt?: Date | string | null;
  updatedAt?: Date | string | null;
  isProcessed?: boolean | null;
  aiParsedData?: unknown;
  confidenceScore?: string | number | null;
  driveFileId?: string | null;
  storagePath?: string | null;
  mimeType?: string | null;
  fileSize?: number | null;
}) {
  const uploadedAt =
    row.createdAt instanceof Date ? row.createdAt.toISOString() : (row.createdAt ?? null);
  const confidence = row.confidenceScore != null ? Number(row.confidenceScore) : null;
  const extractionCoverage = computeExtractionCoverage(row.aiParsedData, row.type);

  return {
    id: row.id,
    processId: row.processId,
    fileName: row.originalFilename,
    documentType: row.type,
    uploadedAt,
    aiProcessingStatus: documentAiProcessingStatus({
      isProcessed: row.isProcessed ?? false,
      aiParsedData: row.aiParsedData,
      updatedAt: row.updatedAt,
      createdAt: row.createdAt,
    }),
    aiParsedData: row.aiParsedData,
    aiConfidence: confidence,
    extractionCoverage,
    driveFileId: row.driveFileId,
    storagePath: row.storagePath,
    mimeType: row.mimeType,
    fileSize: row.fileSize,
  };
}

export const documentService = {
  async rebuildProcessAiExtractedData(
    processId: number,
    client: Pick<typeof db, 'select' | 'update'> = db,
  ) {
    const processDocs = await client
      .select({
        id: documents.id,
        type: documents.type,
        isProcessed: documents.isProcessed,
        aiParsedData: documents.aiParsedData,
        confidenceScore: documents.confidenceScore,
      })
      .from(documents)
      .where(eq(documents.processId, processId))
      .orderBy(desc(documents.createdAt), desc(documents.id));

    const projected: Record<string, any> = {};
    for (const doc of processDocs) {
      if (
        projected[doc.type] ||
        !doc.isProcessed ||
        !shouldProjectAiData(doc.type, doc.aiParsedData, doc.confidenceScore)
      ) {
        continue;
      }
      projected[doc.type] =
        doc.type === 'espelho' ? doc.aiParsedData : flattenAiData(doc.aiParsedData);
    }

    const [processRow] = await client
      .select({ aiExtractedData: importProcesses.aiExtractedData })
      .from(importProcesses)
      .where(eq(importProcesses.id, processId))
      .limit(1);

    const existing = isRecord(processRow?.aiExtractedData) ? processRow.aiExtractedData : {};
    const preserved = Object.fromEntries(
      Object.entries(existing).filter(([key]) => !PROJECTED_AI_DATA_KEYS.has(key)),
    );
    const nextAiExtractedData = { ...preserved, ...projected };

    await client
      .update(importProcesses)
      .set({ aiExtractedData: nextAiExtractedData, updatedAt: new Date() })
      .where(eq(importProcesses.id, processId));

    logger.info(
      { processId, projectedKeys: Object.keys(projected) },
      'Process AI extracted data rebuilt from current documents',
    );

    return nextAiExtractedData;
  },

  async enqueueAIExtraction(
    doc: Pick<
      typeof documents.$inferSelect,
      'id' | 'processId' | 'type' | 'storagePath' | 'originalFilename'
    >,
    type: string = doc.type,
  ) {
    try {
      const boss = await getQueue();
      // Auditoria 2026-07-17: pg-boss v10 tem retryLimit=0 por default — um
      // CRASH DURO do worker (OOM em PDF grande, redeploy no meio) deixava o
      // documento preso para sempre. O retry cobre crash/expiração; erros de
      // extração tratados (markExtractionFailure) NÃO re-tentam — são falhas
      // determinísticas que o operador resolve via reprocess. O lease de
      // documento impede execução dupla concorrente no retry.
      const jobId = await boss.send(
        'ai-extraction',
        {
          documentId: doc.id,
          processId: doc.processId,
          documentType: type,
          filePath: doc.storagePath,
        },
        { retryLimit: 2, retryDelay: 60, retryBackoff: true, expireInSeconds: 25 * 60 },
      );
      if (!jobId) {
        logger.error(
          { documentId: doc.id, processId: doc.processId, type },
          'AI extraction queue did not return a job id — falling back to in-process extraction',
        );
        this.processWithAI(doc.id, type).catch((processErr) =>
          logger.error({ err: processErr, documentId: doc.id }, 'AI fallback processing failed'),
        );
        return;
      }
      logger.info(
        { documentId: doc.id, processId: doc.processId, type, jobId },
        'AI extraction queued',
      );
    } catch (err) {
      // Queue failure should be loud, but it must not recreate the old infinite
      // "processing" trap. Fallback keeps the document moving in single-node
      // deployments while the queue alert/log is investigated.
      logger.error(
        { err, documentId: doc.id, processId: doc.processId, type },
        'Failed to queue AI extraction — falling back to in-process extraction',
      );
      this.processWithAI(doc.id, type).catch((processErr) =>
        logger.error({ err: processErr, documentId: doc.id }, 'AI fallback processing failed'),
      );
    }
  },

  async upload(
    processId: number,
    type: string,
    file: Express.Multer.File,
    userId: number | null = null,
    options: {
      driveFileId?: string;
      ingestionSource?: 'legacy' | 'manual' | 'drive' | 'email';
    } = {},
  ) {
    try {
      await assertDocumentProcessNotLocked(processId);
    } catch (error) {
      await fs.unlink(file.path).catch(() => {});
      throw error;
    }

    let doc;
    try {
      [doc] = await db
        .insert(documents)
        .values({
          processId,
          type: type as (typeof documents.type.enumValues)[number],
          originalFilename: file.originalname,
          storagePath: file.path,
          mimeType: file.mimetype,
          fileSize: file.size,
          // Set when the document was ingested FROM Drive. It is also the
          // dedupe key for the Drive ingestion job — without it a re-run would
          // re-import every file on every pass.
          driveFileId: options.driveFileId,
          ingestionSource: options.ingestionSource ?? 'manual',
        })
        .returning();
    } catch (error) {
      // Clean up the uploaded file if DB insert fails
      await fs.unlink(file.path).catch(() => {});
      throw error;
    }

    // Duplicata: mesmo processo, mesmo nome, mesmo tamanho. Em 17/08 a base
    // tinha 14 grupos assim em 133 documentos, dois deles entre os documentos
    // em falha — um reprocessamento em lote gastaria o dobro no mesmo arquivo.
    // AVISA, nao bloqueia: reenviar a mesma invoice corrigida com o mesmo nome
    // e pratica legitima do time, e recusar o upload atrapalharia mais do que
    // ajuda. A deteccao definitiva pede hash de conteudo, que exige migration.
    try {
      // Sem tamanho nao da para afirmar duplicata: dois arquivos legitimamente
      // diferentes podem ter o mesmo nome. Avisar errado gasta a atencao do
      // time, que e exatamente o recurso que este trabalho esta tentando poupar.
      if (file.size == null) throw new Error('skip-duplicate-check');

      const duplicatas = await db
        .select({ id: documents.id })
        .from(documents)
        .where(
          and(
            eq(documents.processId, processId),
            eq(documents.originalFilename, file.originalname),
            eq(documents.fileSize, file.size),
            ne(documents.id, doc.id),
          ),
        )
        .limit(5);

      if (duplicatas.length > 0) {
        logger.warn(
          {
            documentId: doc.id,
            processId,
            fileName: file.originalname,
            anteriores: duplicatas.map((d) => d.id),
          },
          'Documento duplicado no processo (mesmo nome e tamanho)',
        );
        const [proc] = await db
          .select({ processCode: importProcesses.processCode })
          .from(importProcesses)
          .where(eq(importProcesses.id, processId))
          .limit(1);
        alertService
          .create({
            processId,
            severity: 'warning',
            title: 'Documento duplicado no processo',
            message: `O arquivo "${file.originalname}" ja existe no processo ${proc?.processCode ?? processId} com o mesmo tamanho (documento ${duplicatas.map((d) => d.id).join(', ')}). Confirme qual versao vale e remova a outra — duplicata dobra o custo de reprocessamento e confunde a conferencia.`,
            processCode: proc?.processCode,
          })
          .catch((err) => logger.warn({ err }, 'Failed to create duplicate-document alert'));
      }
    } catch (err) {
      // Deteccao de duplicata nunca pode derrubar o upload.
      if ((err as Error)?.message !== 'skip-duplicate-check') {
        logger.warn({ err, documentId: doc.id }, 'Duplicate check failed');
      }
    }

    // Auto-set hasCertification when a certificate is uploaded
    if (type === 'certificate') {
      await db
        .update(importProcesses)
        .set({ hasCertification: true, updatedAt: new Date() })
        .where(eq(importProcesses.id, processId));
    }

    // Check if all 3 main documents exist → update status
    const processDocs = await db.select().from(documents).where(eq(documents.processId, processId));

    const hasInvoice = processDocs.some((d) => d.type === 'invoice');
    const hasPL = processDocs.some((d) => d.type === 'packing_list');
    const hasBL = processDocs.some((d) => d.type === 'ohbl' || d.type === 'draft_bl');

    if (hasInvoice && hasPL && hasBL) {
      const [currentProc] = await db
        .select({ status: importProcesses.status })
        .from(importProcesses)
        .where(eq(importProcesses.id, processId))
        .limit(1);
      let canTransition = false;
      if (currentProc) {
        try {
          assertTransition(currentProc.status as ProcessStatus, 'documents_received');
          canTransition = true;
        } catch {
          // Process already past draft — skip status transition but continue upload
          logger.info(
            { processId, currentStatus: currentProc.status },
            'Skipping status transition: process already advanced past draft',
          );
        }
      }
      if (canTransition) {
        await db
          .update(importProcesses)
          .set({ status: 'documents_received', updatedAt: new Date() })
          .where(eq(importProcesses.id, processId));
      }

      await db
        .update(followUpTracking)
        .set({ documentsReceivedAt: new Date(), updatedAt: new Date() })
        .where(eq(followUpTracking.processId, processId));

      // Alert: all 3 documents received
      const [proc] = await db
        .select({ processCode: importProcesses.processCode })
        .from(importProcesses)
        .where(eq(importProcesses.id, processId))
        .limit(1);
      try {
        await alertService.create({
          processId,
          severity: 'info',
          title: 'Documentos Completos',
          message: `Todos os 3 documentos recebidos para processo ${proc?.processCode ?? processId}.`,
          processCode: proc?.processCode,
        });
      } catch (err) {
        logger.error({ err }, 'Failed to create documents-received alert');
      }

      // Sync milestone to Follow-Up sheet
      if (proc?.processCode) {
        try {
          const { googleSheetsService } = await import('../integrations/google-sheets.service.js');
          await googleSheetsService.syncMilestone(
            proc.processCode,
            'documentsReceivedAt',
            new Date(),
          );
        } catch (err) {
          logger.error(
            { err, processCode: proc.processCode },
            'Failed to sync milestone to Sheets',
          );
        }
      }
    }

    await auditService.log(
      userId,
      'upload',
      'document',
      doc.id,
      { processId, type, filename: file.originalname },
      null,
    );

    // Record timeline event
    await recordProcessEvent(
      processId,
      {
        eventType: 'document_uploaded',
        title: `Documento enviado: ${file.originalname}`,
        metadata: { type, documentId: doc.id, filename: file.originalname },
      },
      userId,
    );

    // Trigger AI extraction through durable queue so deploy/restart does not
    // lose in-flight invoices and leave the UI polling forever.
    await this.enqueueAIExtraction(doc, type);

    // For invoices and certificates, defer Drive upload to after AI processing to get standardized name
    if (type !== 'invoice' && type !== 'certificate') {
      this.uploadToDrive(doc.id, processId, type, file.path, file.originalname).catch((err) =>
        logger.error({ err, documentId: doc.id }, 'Google Drive upload failed'),
      );
    }

    // Return mapped response matching frontend interface
    return {
      id: doc.id,
      processId: doc.processId,
      fileName: doc.originalFilename,
      documentType: doc.type,
      uploadedAt: doc.createdAt?.toISOString() ?? null,
      aiProcessingStatus: 'processing' as const,
      aiParsedData: null,
      aiConfidence: null,
      driveFileId: null,
    };
  },

  /**
   * Archives the current ai_parsed_data of a document into
   * document_extraction_history BEFORE it gets zeroed (reason 'reprocess')
   * or overwritten by a new extraction (reason 'reextract'). Append-only —
   * regulatory audit, backlog #12. No-op when there is nothing to archive.
   */
  async archiveExtraction(
    doc: {
      id: number;
      processId?: number | null;
      type?: string | null;
      originalFilename?: string | null;
      storagePath?: string | null;
      aiParsedData: unknown;
      confidenceScore: string | null;
    },
    reason: 'reprocess' | 'reextract' | 'delete',
  ) {
    if (doc.aiParsedData == null) return;
    await db.insert(documentExtractionHistory).values({
      documentId: doc.id,
      processId: doc.processId ?? null,
      documentType: doc.type ?? null,
      originalFilename: doc.originalFilename ?? null,
      storagePath: doc.storagePath ?? null,
      aiParsedData: doc.aiParsedData,
      confidence: doc.confidenceScore ?? null,
      reason,
    });
    logger.info({ documentId: doc.id, reason }, 'Previous AI extraction archived to history');
  },

  /** Historical (archived) extractions of a document, newest first. */
  async getExtractionHistory(documentId: number) {
    return db
      .select()
      .from(documentExtractionHistory)
      .where(eq(documentExtractionHistory.documentId, documentId))
      .orderBy(desc(documentExtractionHistory.archivedAt), desc(documentExtractionHistory.id));
  },

  /** Historical archived extractions for a process, including deleted documents. */
  async getExtractionHistoryByProcess(processId: number) {
    return db
      .select()
      .from(documentExtractionHistory)
      .where(eq(documentExtractionHistory.processId, processId))
      .orderBy(desc(documentExtractionHistory.archivedAt), desc(documentExtractionHistory.id));
  },

  async getExtractionEvidence(documentId: number) {
    // Auditoria 2026-07-17: o run mais recente costuma ser o da RECONCILIAÇÃO
    // (provider 'reconciliation'), cujos campos não têm página/trecho-fonte.
    // A evidência "de onde saiu o valor" é a do run de EXTRAÇÃO.
    const [run] = await db
      .select()
      .from(documentExtractionRuns)
      .where(
        and(
          eq(documentExtractionRuns.documentId, documentId),
          sql`${documentExtractionRuns.provider} IS DISTINCT FROM 'reconciliation'`,
        ),
      )
      .orderBy(desc(documentExtractionRuns.createdAt), desc(documentExtractionRuns.id))
      .limit(1);
    if (!run) return { run: null, fields: [] };

    const fields = await db
      .select({
        fieldPath: documentExtractedFields.fieldPath,
        value: documentExtractedFields.valueJson,
        confidence: documentExtractedFields.confidence,
        sourcePage: documentExtractedFields.sourcePage,
        sourceExcerpt: documentExtractedFields.sourceExcerpt,
      })
      .from(documentExtractedFields)
      .where(eq(documentExtractedFields.runId, run.id))
      .orderBy(documentExtractedFields.fieldPath);
    return { run, fields };
  },

  async markExtractionFailure(
    doc: typeof documents.$inferSelect,
    type: string,
    extractionError: unknown,
  ) {
    const isBudget = extractionError instanceof AIBudgetExceededError;
    const reason = isBudget
      ? 'Orçamento mensal de IA esgotado — extração não executada'
      : extractionError instanceof Error
        ? extractionError.message
        : 'Falha desconhecida na extração de IA';

    logger.error(
      { err: extractionError, documentId: doc.id, type, isBudget },
      'AI extraction failed — marking document as processed-with-failure',
    );

    const failedData = {
      extractionFailed: true,
      reason,
      budgetExceeded: isBudget,
      type,
    } as Record<string, unknown>;

    await persistExtractionLineage({
      documentId: doc.id,
      processId: doc.processId,
      documentType: type,
      data: failedData,
      confidenceScore: 0,
      extractionStatus: 'failed',
      provider: process.env.AI_PROVIDER ?? null,
      model: process.env.AI_MODEL ?? process.env.AI_ANALYSIS_MODEL ?? null,
      documentUpdate: {
        aiParsedData: failedData,
        confidenceScore: '0',
        isProcessed: true,
        updatedAt: new Date(),
      },
    });

    const [proc] = await db
      .select({ processCode: importProcesses.processCode })
      .from(importProcesses)
      .where(eq(importProcesses.id, doc.processId))
      .limit(1);

    await alertService
      .create({
        processId: doc.processId,
        severity: 'critical',
        title: isBudget
          ? 'Extração de IA bloqueada — orçamento mensal esgotado'
          : 'Falha na extração de IA',
        message: isBudget
          ? `O documento ${type} do processo ${proc?.processCode ?? doc.processId} não pôde ser extraído porque o orçamento mensal de IA foi esgotado. Ajuste AI_MONTHLY_BUDGET_USD ou aguarde o próximo mês e reprocesse o documento.`
          : `O documento ${type} do processo ${proc?.processCode ?? doc.processId} falhou na extração automática (${reason}). Reprocesse o documento ou revise-o manualmente.`,
        processCode: proc?.processCode,
      })
      .catch((err) => logger.error({ err }, 'Failed to create extraction-failed alert'));

    // Degradable: try to advance the rest of the process with whatever was
    // already extracted from the other documents (mergedAiData comes from the
    // process row, not this failed doc).
    const [processRow] = await db
      .select({ aiExtractedData: importProcesses.aiExtractedData })
      .from(importProcesses)
      .where(eq(importProcesses.id, doc.processId))
      .limit(1);
    await this.runDegradableGate(
      doc.processId,
      (processRow?.aiExtractedData as Record<string, any>) ?? {},
    );
  },

  /**
   * Atomically claim a document before an expensive extraction. The lease is
   * kept on the document (rather than in process memory) because queue
   * workers and queue-fallback execution can run in different API instances.
   */
  async claimExtractionLease(doc: typeof documents.$inferSelect): Promise<string | null> {
    // Compatibility with focused unit-test document stubs created before the
    // lease columns existed. Real Drizzle rows always contain these columns
    // (null when unclaimed), and therefore always take the durable path.
    if (!Object.hasOwn(doc, 'extractionLeaseToken')) return null;

    const token = randomUUID();
    const expiresAt = new Date(Date.now() + extractionLeaseDurationMs());
    const [claimed] = await db
      .update(documents)
      .set({
        extractionLeaseToken: token,
        extractionLeaseExpiresAt: expiresAt,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(documents.id, doc.id),
          sql`(${documents.extractionLeaseExpiresAt} IS NULL OR ${documents.extractionLeaseExpiresAt} <= now())`,
        ),
      )
      .returning({ id: documents.id });

    return claimed ? token : null;
  },

  async releaseExtractionLease(documentId: number, token: string): Promise<void> {
    await db
      .update(documents)
      .set({ extractionLeaseToken: null, extractionLeaseExpiresAt: null, updatedAt: new Date() })
      .where(and(eq(documents.id, documentId), eq(documents.extractionLeaseToken, token)));
  },

  async processWithAI(documentId: number, type: string) {
    const [doc] = await db.select().from(documents).where(eq(documents.id, documentId)).limit(1);
    if (!doc) return;

    const leaseToken = await this.claimExtractionLease(doc);
    if (Object.hasOwn(doc, 'extractionLeaseToken') && !leaseToken) {
      logger.info(
        { documentId, type },
        'Skipping duplicate AI extraction: document lease is active',
      );
      return;
    }

    try {
      await this.processWithAIClaimed(doc, type);
    } finally {
      if (leaseToken) {
        await this.releaseExtractionLease(documentId, leaseToken).catch((err) =>
          logger.error({ err, documentId }, 'Failed to release document extraction lease'),
        );
      }
    }
  },

  async processWithAIClaimed(doc: typeof documents.$inferSelect, type: string) {
    const documentId = doc.id;

    // Re-extraction over an already extracted document overwrites
    // aiParsedData — archive the previous value first (audit, backlog #12).
    // In the reprocess() flow aiParsedData was already archived ('reprocess')
    // and zeroed before this call, so this is a no-op there.
    if (doc.isProcessed && doc.aiParsedData != null) {
      await this.archiveExtraction(doc, 'reextract');
    }

    // Espelho (xlsx) — deterministic parser; no AI round-trip.
    if (type === 'espelho') {
      try {
        await this.processEspelho(doc);
      } catch (extractionError) {
        await this.markExtractionFailure(doc, type, extractionError);
      }
      return;
    }

    let result;
    let sourceText = '';
    let sourcePages: string[] = [];
    try {
      // Timeout também na extração de TEXTO (pdf-parse/OCR/xlsx) — antes só a
      // chamada de IA tinha teto e um OCR travado segurava o job para sempre.
      // Teto PRÓPRIO (20 min default), maior que o da IA: OCR de 20 páginas é
      // legitimamente lento e não pode ser morto pelo teto de 180s da IA.
      const extracted = await withAIExtractionTimeout(
        this.extractText(doc.storagePath, doc.mimeType || ''),
        { documentId, type: `${type}:extract-text` },
        Number(process.env.DOCUMENT_TEXT_EXTRACTION_TIMEOUT_MS) || 20 * 60 * 1000,
      );

      // Build extraction options with optional image data for multimodal processing
      const extractionOpts = extracted.imageBase64
        ? {
            imageBase64: extracted.imageBase64,
            imageMimeType: extracted.imageMimeType,
            additionalImagesBase64: extracted.additionalImagesBase64,
          }
        : undefined;

      const text = extracted.text;
      sourceText = text;
      sourcePages = extracted.pageTexts ?? (text ? text.split(/\f/) : []);
      const runExtraction = async () => {
        switch (type) {
          case 'invoice':
            return aiService.extractInvoiceData(text, extractionOpts);
          case 'proforma_invoice':
            return aiService.extractProformaData(text, extractionOpts);
          case 'packing_list':
            return aiService.extractPackingListData(text, extractionOpts);
          case 'ohbl':
            return aiService.extractBLData(text, extractionOpts);
          case 'draft_bl':
            return aiService.extractDraftBLData(text, extractionOpts);
          case 'certificate':
            return aiService.extractCertificateData(text, extractionOpts);
          case 'li':
            return aiService.extractLIData(text, extractionOpts);
          case 'draft_duimp':
          case 'duimp':
            return aiService.extractDUIMPData(text, type, extractionOpts);
          default:
            throw new Error(`Tipo de documento sem extractor dedicado: ${type}`);
        }
      };

      switch (type) {
        case 'invoice':
        case 'proforma_invoice':
        case 'packing_list':
        case 'ohbl':
        case 'draft_bl':
        case 'certificate':
        case 'li':
        case 'draft_duimp':
        case 'duimp':
          result = await withAIExtractionTimeout(runExtraction(), { documentId, type });
          break;
        default: {
          // Do NOT silent-drop — previously `li` and `other` fell through here
          // with no side effects, which hid documents forever from the pipeline.
          // Now we mark the document as processed so the UI stops spinning,
          // store a structured note, and raise a warning alert so the operator
          // can either pick a correct type manually or investigate.
          logger.warn(
            { documentId: doc.id, processId: doc.processId, type },
            'Document type has no AI extractor — marking processed without extraction',
          );
          const skippedData = {
            skipped: true,
            reason:
              type === 'li'
                ? 'Licença de Importação (LI) — extração automática ainda não implementada'
                : 'Tipo de documento sem extractor dedicado — revisar manualmente',
            type,
          } as Record<string, unknown>;

          await persistExtractionLineage({
            documentId,
            processId: doc.processId,
            documentType: type,
            data: skippedData,
            confidenceScore: 0,
            extractionStatus: 'skipped',
            provider: 'classification',
            model: null,
            documentUpdate: {
              aiParsedData: skippedData,
              confidenceScore: '0',
              isProcessed: true,
              updatedAt: new Date(),
            },
          });

          const [proc] = await db
            .select({ processCode: importProcesses.processCode })
            .from(importProcesses)
            .where(eq(importProcesses.id, doc.processId))
            .limit(1);

          alertService
            .create({
              processId: doc.processId,
              severity: 'warning',
              title:
                type === 'li'
                  ? 'LI recebida — extração não disponível'
                  : 'Documento sem extractor automático',
              message:
                type === 'li'
                  ? `Uma Licença de Importação foi armazenada no processo ${proc?.processCode ?? doc.processId}. A extração automática de LI ainda não está implementada — revise o documento manualmente.`
                  : `Documento do tipo "${type}" no processo ${proc?.processCode ?? doc.processId} foi armazenado mas não tem extractor automático. Revisar classificação manual via UI.`,
              processCode: proc?.processCode,
            })
            .catch((err) => logger.error({ err }, 'Failed to create skip-extraction alert'));
          return;
        }
      }
    } catch (extractionError) {
      await this.markExtractionFailure(doc, type, extractionError);
      return;
    }

    // Defensive cleanup: strip column-bleed noise from itemCodes BEFORE
    // persisting. The prompts already instruct the AI not to concatenate
    // COLLECTION/SEASON/etc. into itemCode, but Nicolas reported real cases
    // where the AI joined columns ("ele tá juntando essa coluna de coleção
    // como código do item"). The cleanup is deterministic — applies only
    // when a canonical PI-style code is unambiguously embedded in noise.
    // Operator kill switch: set AUTO_CLEAN_ITEM_CODES=0 to disable.
    if (
      process.env.AUTO_CLEAN_ITEM_CODES !== '0' &&
      (type === 'invoice' || type === 'packing_list' || type === 'proforma_invoice')
    ) {
      cleanItemCodesInAiData(result.data as Record<string, any>);
    }

    if (!hasMeaningfulAiData(result.data)) {
      await this.markExtractionFailure(
        doc,
        type,
        new Error(
          'Extração IA concluída sem dados úteis no documento. Reclassifique/reenvie ou reprocesse.',
        ),
      );
      return;
    }

    await persistExtractionLineage({
      documentId,
      processId: doc.processId,
      documentType: type,
      data: result.data as Record<string, any>,
      confidenceScore: result.confidenceScore,
      sourceText,
      sourcePages,
      documentUpdate: {
        aiParsedData: result.data as Record<string, unknown>,
        confidenceScore: String(result.confidenceScore),
        isProcessed: true,
        updatedAt: new Date(),
      },
    });

    await invalidateComparisonAcceptances(doc.processId, `document_reprocessed:${documentId}`);

    const veryLowConfidence = result.confidenceScore < MIN_OPERATIONAL_CONFIDENCE;
    // Marcadores meta ('_contract', '_grounding') não são campos do documento —
    // ficam fora da lista mostrada ao operador no alerta.
    const lowConfidenceFields = (
      Array.isArray(result.fieldsWithLowConfidence) ? result.fieldsWithLowConfidence : []
    ).filter((f) => !f.startsWith('_'));

    if (veryLowConfidence) {
      const [proc] = await db
        .select({
          processCode: importProcesses.processCode,
          aiExtractedData: importProcesses.aiExtractedData,
        })
        .from(importProcesses)
        .where(eq(importProcesses.id, doc.processId))
        .limit(1);

      alertService
        .create({
          processId: doc.processId,
          severity: 'critical',
          title: 'Extração IA com Confiança Muito Baixa',
          message: `Documento ${type} do processo ${proc?.processCode ?? doc.processId} teve confiança de extração de ${(result.confidenceScore * 100).toFixed(0)}%. Os dados extraídos ficaram armazenados para revisão, mas NÃO serão usados na validação automática, no espelho ou na projeção operacional. Reclassifique/reenvie o documento ou reprocesse. Campos com baixa confiança: ${lowConfidenceFields.join(', ') || 'N/A'}.`,
          processCode: proc?.processCode,
        })
        .catch((err) => logger.error({ err }, 'Failed to create low-confidence alert'));

      logger.warn(
        { documentId, type, confidence: result.confidenceScore },
        'Very low confidence — extraction stored as evidence but not projected operationally',
      );

      if (type === 'invoice' || type === 'certificate') {
        this.uploadToDrive(
          doc.id,
          doc.processId,
          type,
          doc.storagePath,
          doc.originalFilename,
        ).catch((err) =>
          logger.error(
            { err, documentId: doc.id },
            'Google Drive upload failed (low confidence doc)',
          ),
        );
      }

      await this.runDegradableGate(
        doc.processId,
        (proc?.aiExtractedData as Record<string, any>) ?? {},
      );
      return;
    }

    // Merge AI extracted data — atomic at SQL level to eliminate the race
    // condition Nicolas flagged at 00:14:06 in the 2026-04-10 Odett meeting
    // ("o sistema pode estar tentando olhar todos os documentos
    // simultaneamente, gerando confusão"). Odett's typical email arrives
    // with invoice + PL + BL attachments that are uploaded SEQUENTIALLY but
    // whose processWithAI calls are fire-and-forget, so the 3 extractions
    // race to read + merge + write import_processes.aiExtractedData. With a
    // JS-side `{ ...existingAiData, [type]: flatData }` merge the last
    // writer wins and the other 2 writes are silently lost — the
    // auto-validation trigger below then never sees all 3 types and
    // runAllChecks never fires.
    //
    // Fix: use Postgres' atomic JSONB `||` merge operator (shallow merge,
    // right side wins on key conflicts) and read back the post-merge state
    // via RETURNING so the validation trigger sees the actual current
    // state after every write — no matter what order the concurrent
    // processWithAI calls finish in.
    const flatData = flattenAiData(result.data);
    const patch = { [type]: flatData };

    const [updated] = await db
      .update(importProcesses)
      .set({
        aiExtractedData: sql`coalesce(${importProcesses.aiExtractedData}, '{}'::jsonb) || ${JSON.stringify(patch)}::jsonb`,
        updatedAt: new Date(),
      })
      .where(eq(importProcesses.id, doc.processId))
      .returning();

    const mergedAiData = (updated?.aiExtractedData as Record<string, any>) ?? {};

    logger.info(
      { documentId, type, confidence: result.confidenceScore },
      'AI extraction completed',
    );

    // Confidence score gate: 40-60% still projects data but raises a review
    // alert. Below 40% was handled before the merge: evidence is stored on the
    // document, but it is not projected into process data or downstream gates.
    if (result.confidenceScore < 0.6) {
      const [proc] = await db
        .select({ processCode: importProcesses.processCode })
        .from(importProcesses)
        .where(eq(importProcesses.id, doc.processId))
        .limit(1);

      alertService
        .create({
          processId: doc.processId,
          severity: 'warning',
          title: 'Extração IA com Confiança Baixa',
          message: `Documento ${type} do processo ${proc?.processCode ?? doc.processId} teve confiança de extração de ${(result.confidenceScore * 100).toFixed(0)}%. Recomenda-se revisão manual dos dados extraídos. Campos com baixa confiança: ${lowConfidenceFields.join(', ') || 'N/A'}.`,
          processCode: proc?.processCode,
        })
        .catch((err) => logger.error({ err }, 'Failed to create low-confidence alert'));
    }

    // Auto-populate currency exchanges from invoice payment terms
    if (type === 'invoice' && result.data) {
      try {
        const { currencyExchangeService } = await import('../currency-exchange/service.js');
        await currencyExchangeService.autoPopulate(doc.processId, result.data);
      } catch (err) {
        logger.error({ err, processId: doc.processId }, 'Currency exchange auto-populate failed');
      }
    }

    // Proforma cross-reference: lookup preConsItems by piNumber + alert on mismatches.
    // The proforma is pre-shipment, so it should NOT count toward documents_received
    // or trigger validation; it's recorded for audit + Pre-Cons linkage only.
    if (type === 'proforma_invoice' && result.data) {
      await this.crossReferenceProforma(doc, result.data).catch((err) =>
        logger.error({ err, documentId: doc.id }, 'Proforma cross-reference failed'),
      );
    }

    // Upload to Drive with standardized name after AI extraction.
    // Very-low confidence returned before this point, so standardized naming
    // only uses fields that met the operational confidence floor.
    if ((type === 'invoice' || type === 'certificate') && !veryLowConfidence) {
      const [proc] = await db
        .select({ processCode: importProcesses.processCode })
        .from(importProcesses)
        .where(eq(importProcesses.id, doc.processId))
        .limit(1);
      if (proc) {
        const standardName = standardizeDocumentName(type, proc.processCode, result.data);
        const fileName = standardName || doc.originalFilename;
        this.uploadToDrive(doc.id, doc.processId, type, doc.storagePath, fileName).catch((err) =>
          logger.error({ err, documentId: doc.id }, 'Google Drive upload failed'),
        );
      }
    }

    // Degradable auto-validation / auto-espelho gate (backlog #7(c)).
    //
    // Previously this block required `invoice && packing_list && ohbl` together;
    // if any was missing (typically the INV, which #7 shows is often
    // misclassified/low-confidence), NOTHING ran and there was no signal — the
    // process just sat silently. The new behaviour:
    //   - When all 3 are present: run full validation + auto-espelho as before.
    //   - When at least one core doc is present but others are missing: still
    //     run a PARTIAL validation (runAllChecks already degrades gracefully on
    //     missing inputs) and raise an EXPLICIT alert naming the missing
    //     document(s). Auto-espelho stays gated on all 3.
    // Proforma never participates here (it's pre-shipment); we only consider
    // the three core customs documents.
    await this.runDegradableGate(doc.processId, mergedAiData);

    // Cross-document confidence reconciliation (Levers 1+2): recalibrate the
    // invoice/PL/proforma confidence from arithmetic self-consistency and
    // corroboration against the operator-uploaded espelho. Runs on every doc
    // change so a sibling arriving later (e.g. the espelho after the invoice)
    // re-lifts the others. Non-fatal — never blocks extraction.
    if (process.env.DOCUMENT_REPLAY_DEFER_DERIVED !== '1') {
      await reconcileProcessConfidence(doc.processId).catch((err) =>
        logger.error({ err, processId: doc.processId }, 'Reconciliation after extraction failed'),
      );
    }
  },

  /**
   * Backlog #7(c)/(d): degradable gate for auto-validation + auto-espelho.
   *
   * Runs whatever is possible from the currently-merged AI data instead of
   * silently doing nothing when a core document (usually the INV) is missing.
   * Idempotent: runAllChecks and autoGenerateEspelhoIfMissing are both safe to
   * re-run, and the explicit "aguardando INV" alert is de-duplicated by
   * alertService (same processId + title within 24h).
   */
  async runDegradableGate(processId: number, mergedAiData: Record<string, any>) {
    // A controlled replay rebuilds many documents of the same process. Defer
    // validation, workflow and derived projections until the batch reaches a
    // reconciled terminal state, otherwise every document creates transient
    // results and external operational noise.
    if (process.env.DOCUMENT_REPLAY_DEFER_DERIVED === '1') {
      logger.info({ processId }, 'Derived document effects deferred during replay window');
      return;
    }

    // Boolean(obj) era true para um {} vazio — uma INV classificada mas sem
    // dado útil contava como "presente" e suprimia o alerta "Aguardando INV".
    const hasInvoice = hasMeaningfulAiData(mergedAiData.invoice);
    const hasPackingList = hasMeaningfulAiData(mergedAiData.packing_list);
    const hasOhbl = hasMeaningfulAiData(mergedAiData.ohbl);
    const hasDraftBl = hasMeaningfulAiData(mergedAiData.draft_bl);
    const hasBl = hasOhbl || hasDraftBl;
    const allThree = hasInvoice && hasPackingList && hasBl;

    // Nothing core extracted yet (e.g. only a proforma/espelho/cert so far) —
    // no validation to run, and no alert to raise (the gate hasn't started).
    if (!hasInvoice && !hasPackingList && !hasBl) return;

    // Always run validation with whatever core docs are present. The checks
    // degrade on their own when an input is missing, so a partial run still
    // surfaces the divergences it CAN compute instead of going silent.
    try {
      const { validationService } = await import('../validation/service.js');
      await validationService.runAllChecks(processId, null, {
        mode: allThree ? 'final' : 'partial',
        triggerType: allThree ? 'auto_full' : 'auto_partial',
      });
      logger.info(
        { processId, hasInvoice, hasPackingList, hasOhbl, hasDraftBl, hasBl, partial: !allThree },
        allThree
          ? 'Auto-validation triggered (all 3 core documents present)'
          : 'Partial auto-validation triggered (core document(s) missing)',
      );
    } catch (valErr) {
      logger.error({ err: valErr, processId }, 'Auto-validation failed');
    }

    // Avanca a fase logistica assim que um BL e extraido (ETD/data de embarque
    // ja disponiveis), em vez de esperar ate 30min pelo cron logistic-sync.
    // Eduarda 2026-06-22: processo com ETD de fevereiro nunca foi para "em transito".
    if (hasBl) {
      try {
        const { processService } = await import('../processes/service.js');
        await processService.advanceLogisticStatus(processId);
      } catch (advErr) {
        logger.error({ err: advErr, processId }, 'Auto-advance logistic status failed');
      }
    }

    if (allThree) {
      // Auto-generate espelho from invoice + PL + BL data (deterministic,
      // no AI). Nicolas (2026-05-21): "primeiro que ele não tá criando
      // sozinho". Only fills when there's no operator-uploaded espelho
      // and no prior auto-build (preserves manual edits). Kept gated on all 3
      // because the espelho aggregates fields from every core document.
      // Operator kill switch: set AUTO_GENERATE_ESPELHO=0 to disable.
      if (process.env.AUTO_GENERATE_ESPELHO !== '0') {
        try {
          await this.autoGenerateEspelhoIfMissing(processId);
        } catch (espErr) {
          logger.error({ err: espErr, processId }, 'Auto-espelho generation failed');
        }
      }
      return;
    }

    // A core document is missing — make it LOUD instead of silent. List exactly
    // which ones are absent so the operator knows what to chase (typically the
    // INV, per #7). De-duplicated by alertService within 24h.
    const missing: string[] = [];
    if (!hasInvoice) missing.push('Invoice (INV)');
    if (!hasPackingList) missing.push('Packing List');
    if (!hasBl) missing.push('BL');

    const [proc] = await db
      .select({ processCode: importProcesses.processCode })
      .from(importProcesses)
      .where(eq(importProcesses.id, processId))
      .limit(1);

    alertService
      .create({
        processId,
        severity: 'warning',
        title: 'Aguardando documento para validar / gerar espelho',
        message:
          `O processo ${proc?.processCode ?? processId} ainda não tem ${missing.join(' + ')}. ` +
          `A validação rodou parcialmente com os documentos disponíveis, mas o espelho automático e a validação completa só são gerados quando Invoice + Packing List + BL estiverem presentes.${
            !hasInvoice
              ? ' A Invoice está ausente: verifique se o documento foi classificado corretamente (não como "other"/proforma) ou reprocesse-o.'
              : ''
          }`,
        processCode: proc?.processCode,
      })
      .catch((err) => logger.error({ err }, 'Failed to create awaiting-document alert'));
  },

  /**
   * Builds an espelho-style summary+items aggregation from the AI-extracted
   * Invoice + Packing List + BL data, with no LLM in the path. Called after
   * all 3 docs have been extracted. Writes into importProcesses.aiExtractedData.espelho
   * via atomic JSONB merge — same merge primitive used by processWithAI so
   * concurrent espelho/processWithAI writes do not stomp each other.
   * Skips when an operator-uploaded espelho is pending/successful OR when an
   * auto-built espelho is already present. If every uploaded espelho failed
   * parsing, the deterministic build can still recover the process.
   */
  async autoGenerateEspelhoIfMissing(processId: number) {
    const [processRow] = await db
      .select()
      .from(importProcesses)
      .where(eq(importProcesses.id, processId))
      .limit(1);
    if (!processRow) return;

    const existingProcessAi = (processRow.aiExtractedData as Record<string, any>) ?? {};
    if (existingProcessAi?.espelho?.items?.length || existingProcessAi?.espelho?.summary) {
      // Already populated (either by manual upload or a previous auto-build).
      return;
    }

    const espelhoDocs = await db
      .select({
        id: documents.id,
        isProcessed: documents.isProcessed,
        aiParsedData: documents.aiParsedData,
      })
      .from(documents)
      .where(and(eq(documents.processId, processId), eq(documents.type, 'espelho')));

    const hasPendingOrSuccessfulEspelho = espelhoDocs.some(
      (doc) => !doc.isProcessed || !hasFailedEspelhoExtraction(doc.aiParsedData),
    );
    if (hasPendingOrSuccessfulEspelho) {
      // Operator uploaded a real espelho that is still pending or already valid.
      // Only fall back to auto-build when every uploaded espelho failed parsing.
      return;
    }

    const inv = existingProcessAi.invoice as Record<string, any> | undefined;
    const pl = existingProcessAi.packing_list as Record<string, any> | undefined;
    const bl = (existingProcessAi.ohbl ?? existingProcessAi.draft_bl) as
      | Record<string, any>
      | undefined;
    if (!inv || !pl || !bl) return;

    const { summary, items: espelhoItems } = buildEspelhoFromAiData(inv, pl, bl);

    const patch = { espelho: { summary, items: espelhoItems } };
    // Write guard: only update if no espelho exists yet (atomic). Prevents
    // two concurrent extractions from both inserting + emitting duplicate
    // `espelho_auto_generated` timeline events.
    const written = await db
      .update(importProcesses)
      .set({
        aiExtractedData: sql`coalesce(${importProcesses.aiExtractedData}, '{}'::jsonb) || ${JSON.stringify(patch)}::jsonb`,
        updatedAt: new Date(),
      })
      .where(
        sql`${importProcesses.id} = ${processId}
            AND (${importProcesses.aiExtractedData} IS NULL
                 OR ${importProcesses.aiExtractedData} -> 'espelho' IS NULL)`,
      )
      .returning({ id: importProcesses.id });

    if (written.length === 0) {
      // Another extraction beat us to it — no-op, don't emit a duplicate event.
      logger.info({ processId }, 'Espelho already present (concurrent write) — skipping event');
      return;
    }

    await recordProcessEvent(
      processId,
      {
        eventType: 'espelho_auto_generated',
        title: `Espelho gerado automaticamente (${espelhoItems.length} itens)`,
        metadata: { source: 'auto_deterministic', itemCount: espelhoItems.length },
      },
      null,
    );

    logger.info(
      { processId, itemCount: espelhoItems.length },
      'Espelho auto-generated from invoice + PL + BL',
    );
  },

  /**
   * Aggregate view of all Proforma Invoices attached to a process.
   * Each PI groups its own items. Used by the Proformas tab/section in the UI
   * (Nicolas, 2026-05-21: "tinha alguns processos que tinha várias PIs").
   */
  async getProformasAggregate(processId: number) {
    const proformaDocs = await db
      .select()
      .from(documents)
      .where(and(eq(documents.processId, processId), eq(documents.type, 'proforma_invoice')));

    type ProformaSummary = {
      documentId: number;
      filename: string;
      // Download reference so the Proformas tab can offer "baixar PI" — mirrors
      // how single documents are served (GET /api/documents/:id/file).
      fileUrl: string;
      uploadedAt: Date | null;
      confidence: number | null;
      piNumber: string | null;
      invoiceDate: string | null;
      validUntil: string | null;
      currency: string | null;
      totalFobValue: number | null;
      paymentTerms: Record<string, any> | null;
      itemCount: number;
      items: Array<Record<string, any>>;
      preConsLinked: boolean;
    };

    const summaries: ProformaSummary[] = [];
    for (const doc of proformaDocs) {
      const flat = doc.aiParsedData ? flattenAiData(doc.aiParsedData as Record<string, any>) : null;
      const piNumber = flat?.piNumber ?? null;
      const items = Array.isArray(flat?.items) ? (flat!.items as Array<Record<string, any>>) : [];

      let preConsLinked = false;
      if (piNumber) {
        const { preConsItems } = await import('../../shared/database/schema.js');
        const rows = await db
          .select({ id: preConsItems.id })
          .from(preConsItems)
          .where(eq(preConsItems.piNumber, piNumber))
          .limit(1);
        preConsLinked = rows.length > 0;
      }

      summaries.push({
        documentId: doc.id,
        filename: doc.originalFilename,
        fileUrl: `/api/documents/${doc.id}/file`,
        uploadedAt: doc.createdAt,
        confidence: doc.confidenceScore ? Number(doc.confidenceScore) : null,
        piNumber,
        invoiceDate: flat?.invoiceDate ?? null,
        validUntil: flat?.validUntil ?? null,
        currency: flat?.currency ?? null,
        totalFobValue: flat?.totalFobValue ?? null,
        paymentTerms: flat?.paymentTerms ?? null,
        itemCount: items.length,
        items,
        preConsLinked,
      });
    }

    summaries.sort((a, b) => {
      const at = a.uploadedAt ? a.uploadedAt.getTime() : 0;
      const bt = b.uploadedAt ? b.uploadedAt.getTime() : 0;
      return at - bt;
    });

    const totals = summaries.reduce(
      (acc, s) => {
        acc.itemCount += s.itemCount;
        if (typeof s.totalFobValue === 'number') acc.totalFobValue += s.totalFobValue;
        return acc;
      },
      { itemCount: 0, totalFobValue: 0 },
    );

    return {
      processId,
      proformaCount: summaries.length,
      totals,
      proformas: summaries,
    };
  },

  async crossReferenceProforma(doc: typeof documents.$inferSelect, aiData: Record<string, any>) {
    const { preConsItems } = await import('../../shared/database/schema.js');
    const flat = flattenAiData(aiData);
    const piNumber: string | null = (flat as any).piNumber ?? null;

    const [proc] = await db
      .select({
        id: importProcesses.id,
        processCode: importProcesses.processCode,
        status: importProcesses.status,
      })
      .from(importProcesses)
      .where(eq(importProcesses.id, doc.processId))
      .limit(1);

    if (!proc) return;

    // Record timeline event for proforma receipt — always
    await recordProcessEvent(
      doc.processId,
      {
        eventType: 'document_uploaded',
        title: `Proforma Invoice recebida${piNumber ? ` (PI ${piNumber})` : ''}`,
        metadata: { type: 'proforma_invoice', documentId: doc.id, piNumber },
      },
      null,
    );

    // Without a piNumber we can't cross-reference Pre-Cons
    if (!piNumber) {
      alertService
        .create({
          processId: doc.processId,
          severity: 'warning',
          title: 'Proforma sem numero PI identificavel',
          message: `A Proforma anexada ao processo ${proc.processCode} nao teve numero PI extraido. Revise manualmente para confirmar a correlacao com a planilha Pre-Cons.`,
          processCode: proc.processCode,
        })
        .catch((err) => logger.error({ err }, 'Failed to create proforma-no-pi alert'));
      return;
    }

    const preConRows = await db
      .select({
        processCode: preConsItems.processCode,
        piNumber: preConsItems.piNumber,
      })
      .from(preConsItems)
      .where(eq(preConsItems.piNumber, piNumber))
      .limit(5);

    if (preConRows.length === 0) {
      alertService
        .create({
          processId: doc.processId,
          severity: 'warning',
          title: 'PI nao encontrada no Pre-Cons',
          message: `PI ${piNumber} extraida da Proforma nao bate com nenhuma linha do Pre-Cons (anexada ao processo ${proc.processCode}). Pode ser que o Pre-Cons ainda nao tenha sido sincronizado, ou a PI seja de outro processo.`,
          processCode: proc.processCode,
        })
        .catch((err) => logger.error({ err }, 'Failed to create proforma-no-precon alert'));
      return;
    }

    // Check if any matching Pre-Cons row points to a different processCode
    const mismatched = preConRows.filter((r) => r.processCode !== proc.processCode);
    if (mismatched.length > 0) {
      const expectedCodes = [...new Set(mismatched.map((r) => r.processCode))].join(', ');
      alertService
        .create({
          processId: doc.processId,
          severity: 'critical',
          title: 'Proforma anexada ao processo errado',
          message: `PI ${piNumber} esta vinculada no Pre-Cons aos processos: ${expectedCodes}. Foi anexada por engano ao processo ${proc.processCode}. Mova o documento para o processo correto.`,
          processCode: proc.processCode,
        })
        .catch((err) => logger.error({ err }, 'Failed to create proforma-mismatch alert'));
    } else {
      logger.info(
        { processId: doc.processId, piNumber, processCode: proc.processCode },
        'Proforma cross-reference OK',
      );
    }
  },

  async processEspelho(doc: typeof documents.$inferSelect) {
    const buffer = await fs.readFile(doc.storagePath);
    const parsed = tryParseEspelhoBuffer(buffer);

    // Cabeçalho reconhecido mas ZERO linhas de item não é extração
    // bem-sucedida: gravava confiança 0.99 — o badge mais alto do sistema —
    // sobre uma planilha vazia e a projetava no processo. Segue o mesmo
    // caminho de falha de parse (fallback de IA + alerta ao operador).
    if (!parsed.ok || parsed.data.items.length === 0) {
      const parseError = parsed.ok
        ? 'Espelho reconhecido, mas nenhuma linha de item foi encontrada na planilha.'
        : parsed.error;
      logger.warn(
        { documentId: doc.id, processId: doc.processId, error: parseError },
        'Espelho parse failed — formato não reconhecido',
      );

      // AI fallback (Nicolas 2026-05-21: "religar IA do espelho"). Disabled
      // by default for privacy — only safe with a provider that keeps the data
      // private: Vertex (Google contractually does not train on Vertex data)
      // or IA_LOCAL (100% on-prem, no egress). Operator enables via
      // ESPELHO_AI_FALLBACK=1 after configuring one of those.
      //
      // HARD GUARD: the espelho carries sensitive Pre-Cons-linked data, so the
      // fallback MUST only run on the local provider by default. External
      // providers require the global AI_ALLOW_EXTERNAL opt-in before sensitive
      // document data may leave the perimeter.
      const espelhoFallbackEnabled = process.env.ESPELHO_AI_FALLBACK === '1';
      const aiProvider = (process.env.AI_PROVIDER || 'ialocal').toLowerCase();
      const isAllowedProvider =
        aiProvider === 'ialocal' ||
        (aiProvider === 'vertex' && process.env.AI_ALLOW_EXTERNAL === 'true');
      if (espelhoFallbackEnabled && !isAllowedProvider) {
        logger.warn(
          { documentId: doc.id, processId: doc.processId, aiProvider },
          'ESPELHO_AI_FALLBACK is enabled but AI provider is not allowed for sensitive espelho fallback',
        );
      }
      if (espelhoFallbackEnabled && isAllowedProvider) {
        try {
          const xlsxText = extractTextFromXlsxBuffer(buffer);
          if (xlsxText.trim().length > 0) {
            const result = await aiService.extractEspelhoData(xlsxText);
            const flat = flattenAiData(result.data);
            const items = Array.isArray((flat as any).items) ? (flat as any).items : [];
            const summary: Record<string, any> = { ...flat };
            delete summary.items;
            summary.generatedBy = 'ai_fallback';
            summary.generatedAt = new Date().toISOString();

            await persistExtractionLineage({
              documentId: doc.id,
              processId: doc.processId,
              documentType: 'espelho',
              data: { summary, items },
              confidenceScore: result.confidenceScore,
              sourceText: xlsxText,
              extractionStatus: 'completed',
              documentUpdate: {
                aiParsedData: { summary, items },
                confidenceScore: String(result.confidenceScore.toFixed(4)),
                isProcessed: true,
                updatedAt: new Date(),
              },
            });

            const espelhoPatch = { espelho: { summary, items } };
            await db
              .update(importProcesses)
              .set({
                aiExtractedData: sql`coalesce(${importProcesses.aiExtractedData}, '{}'::jsonb) || ${JSON.stringify(espelhoPatch)}::jsonb`,
                updatedAt: new Date(),
              })
              .where(eq(importProcesses.id, doc.processId));

            await recordProcessEvent(
              doc.processId,
              {
                eventType: 'espelho_ai_fallback',
                title: `Espelho extraído via IA (confiança ${(result.confidenceScore * 100).toFixed(0)}%)`,
                metadata: { source: 'ai_fallback', itemCount: items.length },
              },
              null,
            );

            logger.info(
              { documentId: doc.id, processId: doc.processId, itemCount: items.length },
              'Espelho extracted via AI fallback after deterministic parser failed',
            );
            return;
          }
        } catch (aiErr) {
          logger.error(
            { err: aiErr, documentId: doc.id, processId: doc.processId },
            'Espelho AI fallback failed — alerting operator',
          );
        }
      }

      await persistExtractionLineage({
        documentId: doc.id,
        processId: doc.processId,
        documentType: 'espelho',
        data: { error: parseError },
        confidenceScore: 0,
        extractionStatus: 'failed',
        provider: 'deterministic',
        model: null,
        documentUpdate: {
          aiParsedData: { error: parseError },
          confidenceScore: '0',
          isProcessed: true,
          updatedAt: new Date(),
        },
      });

      const [proc] = await db
        .select({ processCode: importProcesses.processCode })
        .from(importProcesses)
        .where(eq(importProcesses.id, doc.processId))
        .limit(1);

      alertService
        .create({
          processId: doc.processId,
          severity: 'warning',
          title: 'Espelho não pôde ser processado',
          message: `O arquivo de espelho do processo ${proc?.processCode ?? doc.processId} não pôde ser processado: ${parseError} Revise o layout ou envie em formato compatível.`,
          processCode: proc?.processCode,
        })
        .catch((err) => logger.error({ err }, 'Failed to create espelho-parse alert'));
      return;
    }

    const { summary, items, headerRowIndex, sheetName, rawRowCount } = parsed.data;

    // Same atomic JSONB merge pattern as processWithAI — see the long
    // comment there for the full rationale. Espelho extraction runs in
    // parallel with the AI extractions of the other attachments in the
    // same email, so a JS-side merge here also races.
    const espelhoPatch = { espelho: { summary, items } };

    await persistExtractionLineage({
      documentId: doc.id,
      processId: doc.processId,
      documentType: 'espelho',
      data: { summary, items, headerRowIndex, sheetName, rawRowCount },
      confidenceScore: 0.99,
      extractionStatus: 'deterministic',
      provider: 'deterministic',
      model: null,
      documentUpdate: {
        aiParsedData: { summary, items, headerRowIndex, sheetName, rawRowCount },
        confidenceScore: '0.99',
        isProcessed: true,
        updatedAt: new Date(),
      },
    });

    await db
      .update(importProcesses)
      .set({
        aiExtractedData: sql`coalesce(${importProcesses.aiExtractedData}, '{}'::jsonb) || ${JSON.stringify(espelhoPatch)}::jsonb`,
        updatedAt: new Date(),
      })
      .where(eq(importProcesses.id, doc.processId));

    logger.info(
      {
        documentId: doc.id,
        processId: doc.processId,
        itemCount: items.length,
        headerRowIndex,
      },
      'Espelho parsed successfully',
    );

    // The uploaded espelho is the trusted 0.99 source — recalibrate the
    // invoice/PL/proforma of this process against it now that it is available.
    if (process.env.DOCUMENT_REPLAY_DEFER_DERIVED !== '1') {
      await reconcileProcessConfidence(doc.processId).catch((err) =>
        logger.error({ err, processId: doc.processId }, 'Reconciliation after espelho failed'),
      );
    }
  },

  async extractText(
    filePath: string,
    mimeType: string,
  ): Promise<{
    text: string;
    imageBase64?: string;
    imageMimeType?: string;
    additionalImagesBase64?: string[];
    pageTexts?: string[];
    ocrUsed?: boolean;
  }> {
    const buffer = await fs.readFile(filePath);
    const ext = path.extname(filePath).toLowerCase();

    // ── Images: send as base64 for Gemini multimodal ──
    if (mimeType?.startsWith('image/')) {
      const base64 = buffer.toString('base64');
      return { text: '', imageBase64: base64, imageMimeType: mimeType };
    }

    // ── PDF ──
    if (mimeType === 'application/pdf' || ext === '.pdf') {
      const data = await pdfParse(buffer);
      const text = data.text?.trim() || '';

      // Detecção de escaneado (auditoria 2026-07-17): o gatilho antigo era
      // `length < 50` — um scan com watermark/cabeçalho residual de 51 chars
      // passava como "PDF com texto" e mandava lixo pra IA sem OCR nem imagem.
      // Agora: densidade de caracteres alfanuméricos POR PÁGINA (via
      // data.numpages — o pdf-parse junta páginas com \n\n, então split por \f
      // NÃO conta páginas). Página real de invoice/BL tem milhares; scan com
      // camada residual fica <150.
      const pages = text ? text.split(/\f/) : [];
      const pageCount = Math.max(1, Number(data.numpages) || 1);
      const alnumChars = text.replace(/[^\p{L}\p{N}]/gu, '').length;
      const charsPerPage = alnumChars / pageCount;
      const looksScanned = alnumChars < 50 || charsPerPage < 150;

      if (looksScanned) {
        const ocr = await ocrScannedPdf(filePath);
        if (ocr?.text) {
          logger.info(
            {
              filePath,
              textLength: text.length,
              charsPerPage: Math.round(charsPerPage),
              ocrTextLength: ocr.text.length,
              ocrPages: ocr.pageCount,
            },
            'Scanned PDF preprocessed with local OCR',
          );
          return { text: ocr.text, pageTexts: ocr.pageTexts, ocrUsed: true };
        }
        // Multimodal só até um teto de tamanho: base64 de PDF gigante estoura
        // o limite de request do provider e pressiona a memória do worker.
        const MULTIMODAL_MAX_BYTES = 15 * 1024 * 1024;
        if (buffer.length > MULTIMODAL_MAX_BYTES) {
          logger.warn(
            { filePath, bytes: buffer.length, charsPerPage: Math.round(charsPerPage) },
            'Scanned PDF too large for multimodal — proceeding with residual text only',
          );
          return { text, pageTexts: pages };
        }
        logger.info(
          { filePath, textLength: text.length, charsPerPage: Math.round(charsPerPage) },
          'PDF has minimal text, treating as scanned document for multimodal processing',
        );

        // Only Vertex reads a raw PDF part (it becomes Gemini inline_data).
        // IA_LOCAL (Ollama) and OpenRouter vision models expect a real image,
        // and used to receive `data:application/pdf;base64,...` — which they
        // cannot decode, so the extraction came back with nearly every field
        // empty and the UI showed "-" everywhere. Rasterize first.
        if (!aiService.acceptsPdfInput) {
          const pages = await rasterizePdfPages(filePath);
          if (pages && pages.length > 0) {
            logger.info(
              { filePath, pages: pages.length, provider: aiService.providerName },
              'Scanned PDF rasterized to PNG for a provider that cannot read PDF parts',
            );
            return {
              text,
              imageBase64: pages[0],
              imageMimeType: 'image/png',
              additionalImagesBase64: pages.slice(1),
            };
          }
          // No OCR and no rasterizer: there is genuinely nothing readable to
          // send. Failing here is what makes the document show up as "failed"
          // with a reason the operator can act on, instead of silently
          // producing a document whose fields are all empty.
          throw new Error(
            `PDF escaneado sem camada de texto e sem como rasterizar (provider "${aiService.providerName}" não lê PDF). Instale o Poppler (pdftoppm) ou habilite DOCUMENT_OCR_ENABLED=1 no servidor.`,
          );
        }

        const base64 = buffer.toString('base64');
        return { text, imageBase64: base64, imageMimeType: 'application/pdf' };
      }
      return { text, pageTexts: pages };
    }

    // ── Excel (XLSX/XLS) ──
    if (
      mimeType?.includes('spreadsheet') ||
      mimeType?.includes('excel') ||
      ext === '.xlsx' ||
      ext === '.xls'
    ) {
      // Protecoes contra planilha com range inflado: ver spreadsheetBufferToText.
      return { text: spreadsheetBufferToText(buffer, { logContext: { filePath } }) };
    }

    // ── Word (DOCX) ──
    if (
      mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
      ext === '.docx'
    ) {
      // docx e ZIP como o xlsx, mas o teto NAO e o mesmo — medido em
      // 2026-08-29: o `mammoth` custa 15x a 34x o tamanho descomprimido, contra
      // ~3x do SheetJS. Um docx de 580 KB que expande para 31,6 MB consome
      // 563 MB de RSS num container de 512M, e passava folgado no teto de
      // 64 MB herdado do xlsx.
      assertArquivoSeguroParaAbrir(buffer, { maxDescomprimido: tetoDescomprimidoDocx() });
      // Serializado porque `mammoth` e ASSINCRONO: dois docx podem intercalar e
      // o pico vira a SOMA dos orcamentos, enquanto a guarda so garante um por
      // arquivo. O `XLSX.read`, sendo sincrono, ja serializa sozinho no event
      // loop — por isso a fila cobre este caminho e nao aquele.
      const result = await parseSerializado(
        () => mammoth.extractRawText({ buffer }),
        'docx:mammoth',
      );
      return { text: result.value };
    }

    // ── Word (DOC) — treat as binary, send to multimodal ──
    if (mimeType === 'application/msword' || ext === '.doc') {
      // Old .doc format: try as text first, fallback to multimodal
      const textAttempt = buffer.toString('utf-8');
      const readable = textAttempt.replace(/[^\x20-\x7E\n\r\t]/g, '').trim();
      if (readable.length > 100) {
        return { text: readable };
      }
      const base64 = buffer.toString('base64');
      return { text: '', imageBase64: base64, imageMimeType: 'application/msword' };
    }

    // ── CSV ──
    if (mimeType === 'text/csv' || ext === '.csv') {
      return { text: buffer.toString('utf-8') };
    }

    // ── HTML ──
    if (mimeType === 'text/html' || ext === '.html' || ext === '.htm') {
      const html = buffer.toString('utf-8');
      // Strip HTML tags, keep text content
      const text = html
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/\s+/g, ' ')
        .trim();
      return { text };
    }

    // ── EML (email files) ──
    if (mimeType === 'message/rfc822' || ext === '.eml') {
      // Extract readable text from email format
      const raw = buffer.toString('utf-8');
      // Find the body after headers (double newline)
      const bodyStart = raw.indexOf('\n\n');
      const body = bodyStart > 0 ? raw.substring(bodyStart + 2) : raw;
      // Strip any remaining HTML
      const text = body
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      return { text };
    }

    // ── TIFF / BMP — send as image for multimodal ──
    if (ext === '.tif' || ext === '.tiff' || ext === '.bmp') {
      const base64 = buffer.toString('base64');
      const mime = ext === '.bmp' ? 'image/bmp' : 'image/tiff';
      return { text: '', imageBase64: base64, imageMimeType: mime };
    }

    // ── Fallback: plain text ──
    return { text: buffer.toString('utf-8') };
  },

  async getByProcess(processId: number) {
    const rows = await db
      .select()
      .from(documents)
      .where(eq(documents.processId, processId))
      .orderBy(desc(documents.createdAt));

    return rows.map((row) => toDocumentResponse(row));
  },

  async getById(id: number) {
    const [doc] = await db.select().from(documents).where(eq(documents.id, id)).limit(1);
    if (!doc) throw new NotFoundError('Documento', id);
    return doc;
  },

  async getSource(id: number) {
    const [doc] = await db.select().from(documents).where(eq(documents.id, id)).limit(1);
    if (!doc) throw new NotFoundError('Documento', id);

    if (doc.ingestionSource === 'drive') {
      return {
        source: 'drive' as const,
        driveFileId: doc.driveFileId ?? undefined,
      };
    }
    if (doc.ingestionSource === 'manual') {
      return { source: 'manual' as const };
    }

    // Relational lineage is authoritative for explicit e-mail and legacy
    // records. The legacy filename/log scan could
    // mislabel old email attachments after a process accumulated more than ten
    // logs, or attribute a same-named attachment to the wrong email.
    const [lineage] = await db
      .select({ emailSubject: emailIngestionLogs.subject })
      .from(emailAttachmentDocuments)
      .leftJoin(emailIngestionLogs, eq(emailAttachmentDocuments.emailLogId, emailIngestionLogs.id))
      .where(eq(emailAttachmentDocuments.documentId, id))
      .orderBy(desc(emailAttachmentDocuments.createdAt))
      .limit(1);
    if (lineage) {
      return { source: 'email' as const, emailSubject: lineage.emailSubject ?? undefined };
    }

    // Legacy fallback for records created before relational attachment lineage.
    const emailLogs = await db
      .select()
      .from(emailIngestionLogs)
      .where(eq(emailIngestionLogs.processId, doc.processId))
      .limit(10);

    for (const log of emailLogs) {
      type AttachmentEntry = { filename?: string; documentId?: number | null };
      const raw = log.processedAttachments as
        | AttachmentEntry[]
        | { attachments?: AttachmentEntry[] }
        | null;
      // Support both old format (direct array) and enriched format (object with .attachments)
      const attachments: AttachmentEntry[] | undefined = Array.isArray(raw)
        ? raw
        : (raw?.attachments ?? undefined);
      if (Array.isArray(attachments)) {
        const match = attachments.some(
          (a) => a.filename === doc.originalFilename || a.documentId === doc.id,
        );
        if (match) {
          return { source: 'email' as const, emailSubject: log.subject };
        }
      }
    }

    // New e-mail records carry explicit provenance. A missing subject/linkage
    // is incomplete metadata, not evidence that the file was uploaded by hand.
    if (doc.ingestionSource === 'email') {
      return { source: 'email' as const };
    }

    return { source: 'manual' as const };
  },

  async getFileResource(id: number) {
    const [doc] = await db.select().from(documents).where(eq(documents.id, id)).limit(1);
    if (!doc) throw new NotFoundError('Documento', id);

    const absolutePath = path.isAbsolute(doc.storagePath)
      ? doc.storagePath
      : path.resolve(process.cwd(), doc.storagePath);

    // Confirm the file exists on disk; surface a 404 if it doesn't
    try {
      await fs.access(absolutePath);
    } catch {
      if (doc.driveFileId) {
        return {
          kind: 'drive' as const,
          driveFileId: doc.driveFileId,
          filename: doc.originalFilename,
          mimeType: doc.mimeType ?? 'application/octet-stream',
          processId: doc.processId,
        };
      }
      throw new NotFoundError('Arquivo do documento', id);
    }

    return {
      kind: 'local' as const,
      absolutePath,
      filename: doc.originalFilename,
      mimeType: doc.mimeType ?? 'application/octet-stream',
      processId: doc.processId,
    };
  },

  async reprocess(documentId: number, userId: number | null = null) {
    const [doc] = await db.select().from(documents).where(eq(documents.id, documentId)).limit(1);
    if (!doc) throw new NotFoundError('Documento', documentId);
    await assertDocumentProcessNotLocked(doc.processId);

    if (!doc.isProcessed && !isProcessingStale(doc.updatedAt ?? doc.createdAt)) {
      const error = new Error('Reprocessamento já está em andamento para este documento');
      (error as Error & { statusCode?: number }).statusCode = 409;
      throw error;
    }

    // Atomic: archive the previous extraction BEFORE zeroing it (audit,
    // backlog #12) and zero the fields in one transaction, mirroring the
    // history-snapshot + mutate pattern in validation.runAllChecks. Prevents a
    // partial state where the history insert succeeds but the zeroing fails (or
    // vice-versa), losing or duplicating the archived extraction.
    await db.transaction(async (tx) => {
      if (doc.aiParsedData != null) {
        await tx.insert(documentExtractionHistory).values({
          documentId: doc.id,
          processId: doc.processId,
          documentType: doc.type,
          originalFilename: doc.originalFilename,
          storagePath: doc.storagePath,
          aiParsedData: doc.aiParsedData,
          confidence: doc.confidenceScore ?? null,
          reason: 'reprocess',
        });
        logger.info(
          { documentId: doc.id, reason: 'reprocess' },
          'Previous AI extraction archived to history',
        );
      }

      await tx
        .update(documents)
        .set({
          isProcessed: false,
          aiParsedData: null,
          confidenceScore: null,
          updatedAt: new Date(),
        })
        .where(eq(documents.id, documentId));

      await this.rebuildProcessAiExtractedData(doc.processId, tx);
    });

    auditService.log(userId, 'reprocess', 'document', documentId, { type: doc.type }, null);

    await this.enqueueAIExtraction(doc, doc.type);
    return toDocumentResponse({
      ...doc,
      isProcessed: false,
      aiParsedData: null,
      confidenceScore: null,
      updatedAt: new Date(),
    });
  },

  /**
   * Correct a manual/email classification and restart extraction without
   * losing the prior result. This is intentionally available to authenticated
   * operators, like reprocess(): a wrong type otherwise leaves a document in
   * an unrecoverable "other"/wrong-parser path until an admin reuploads it.
   */
  async reclassify(documentId: number, documentType: string, userId: number | null = null) {
    const [doc] = await db.select().from(documents).where(eq(documents.id, documentId)).limit(1);
    if (!doc) throw new NotFoundError('Documento', documentId);
    await assertDocumentProcessNotLocked(doc.processId);

    if (doc.type === documentType) {
      return toDocumentResponse(doc);
    }

    // Mesma guarda de reprocess(): reclassificar durante uma extração ativa
    // deixa o worker que segura a lease gravar dado do tipo ANTIGO num
    // documento já retipado — e o job da reclassificação perde a lease,
    // retorna normalmente e o pg-boss o marca como completo sem reextração.
    if (!doc.isProcessed && !isProcessingStale(doc.updatedAt ?? doc.createdAt)) {
      const error = new Error('Extração já está em andamento para este documento');
      (error as Error & { statusCode?: number }).statusCode = 409;
      throw error;
    }

    await db.transaction(async (tx) => {
      if (doc.aiParsedData != null) {
        await tx.insert(documentExtractionHistory).values({
          documentId: doc.id,
          processId: doc.processId,
          documentType: doc.type,
          originalFilename: doc.originalFilename,
          storagePath: doc.storagePath,
          aiParsedData: doc.aiParsedData,
          confidence: doc.confidenceScore ?? null,
          reason: 'reprocess',
        });
      }

      await tx
        .update(documents)
        .set({
          type: documentType as (typeof documents.type.enumValues)[number],
          isProcessed: false,
          aiParsedData: null,
          confidenceScore: null,
          updatedAt: new Date(),
        })
        .where(eq(documents.id, documentId));

      await this.rebuildProcessAiExtractedData(doc.processId, tx);
    });

    await db
      .update(emailAttachmentDocuments)
      .set({ documentType, updatedAt: new Date() })
      .where(eq(emailAttachmentDocuments.documentId, documentId));

    await invalidateComparisonAcceptances(
      doc.processId,
      `document_reclassified:${documentId}:${doc.type}:${documentType}`,
    );
    await auditService.log(
      userId,
      'reclassify',
      'document',
      documentId,
      { processId: doc.processId, fromType: doc.type, toType: documentType },
      null,
    );
    await recordProcessEvent(
      doc.processId,
      {
        eventType: 'document_reclassified',
        title: `Documento reclassificado: ${doc.type} → ${documentType}`,
        metadata: {
          documentId,
          filename: doc.originalFilename,
          fromType: doc.type,
          toType: documentType,
        },
      },
      userId,
    );

    const reclassified = { ...doc, type: documentType as typeof doc.type };
    await this.enqueueAIExtraction(reclassified, documentType);
    return toDocumentResponse({
      ...reclassified,
      isProcessed: false,
      aiParsedData: null,
      confidenceScore: null,
      updatedAt: new Date(),
    });
  },

  /** Manually re-run cross-document confidence reconciliation for a process. */
  async reconcileProcess(processId: number) {
    return reconcileProcessConfidence(processId);
  },

  /** Backfill: reconcile every existing process. Returns an aggregate summary. */
  async reconcileAllProcesses() {
    const procs = await db.select({ id: importProcesses.id }).from(importProcesses);
    let processesChanged = 0;
    let documentsChanged = 0;
    for (const proc of procs) {
      const results = await reconcileProcessConfidence(proc.id);
      if (results.length > 0) {
        processesChanged++;
        documentsChanged += results.length;
      }
    }
    return { processesScanned: procs.length, processesChanged, documentsChanged };
  },

  async delete(id: number, userId: number | null = null) {
    const [doc] = await db.select().from(documents).where(eq(documents.id, id)).limit(1);
    if (!doc) throw new NotFoundError('Documento', id);
    await assertDocumentProcessNotLocked(doc.processId);

    await db.transaction(async (tx) => {
      if (doc.aiParsedData != null) {
        await tx.insert(documentExtractionHistory).values({
          documentId: doc.id,
          processId: doc.processId,
          documentType: doc.type,
          originalFilename: doc.originalFilename,
          storagePath: doc.storagePath,
          aiParsedData: doc.aiParsedData,
          confidence: doc.confidenceScore ?? null,
          reason: 'delete',
        });
        logger.info(
          { documentId: doc.id, reason: 'delete' },
          'AI extraction archived before document delete',
        );
      }

      await tx.delete(documents).where(eq(documents.id, id));
      await this.rebuildProcessAiExtractedData(doc.processId, tx);
    });

    // Remove the physical file only after the database transaction commits.
    // If this best-effort cleanup fails, the logical delete/history remains
    // consistent and the orphaned file can be removed by an ops cleanup pass.
    try {
      await fs.unlink(doc.storagePath);
    } catch (err) {
      logger.warn(
        { err, documentId: id, storagePath: doc.storagePath },
        'Document file cleanup failed',
      );
    }

    auditService.log(
      userId,
      'delete',
      'document',
      id,
      { processId: doc.processId, filename: doc.originalFilename },
      null,
    );
    return { id };
  },

  async uploadToDrive(
    documentId: number,
    processId: number,
    type: string,
    filePath: string,
    fileName: string,
  ) {
    const configured = await googleDriveService.isRootConfigured();
    if (!configured) return;

    // Documento que VEIO do Drive já está na pasta do processo. Re-subir cria
    // uma CÓPIA e o update lá embaixo trocaria `drive_file_id` pelo id dessa
    // cópia, destruindo a chave de dedupe da varredura — que procura o id
    // ORIGINAL (drive-ingestion.service.ts). Como `listProcessFiles` é
    // recursiva, a cópia na subpasta passaria a ser a única deduplicada e o
    // arquivo original voltaria a cada passada: reimportação a cada 10 min,
    // com uma cópia nova a cada reimportação.
    //
    // A guarda fica aqui, no ponto ÚNICO de escrita de `driveFileId`, e não
    // nos três chamadores (upload manual, invoice/certificate de baixa
    // confiança e invoice/certificate com nome padronizado) — assim nenhum
    // caminho novo consegue furá-la por esquecimento.
    const [docRow] = await db
      .select({ ingestionSource: documents.ingestionSource })
      .from(documents)
      .where(eq(documents.id, documentId))
      .limit(1);

    if (docRow?.ingestionSource === 'drive') {
      logger.info(
        { documentId, processId, type },
        'Skipping Drive upload: document was ingested from Drive — preserving the original driveFileId',
      );
      return;
    }

    const [process] = await db
      .select({
        processCode: importProcesses.processCode,
        brand: importProcesses.brand,
      })
      .from(importProcesses)
      .where(eq(importProcesses.id, processId))
      .limit(1);

    if (!process) return;

    const driveFileId = await googleDriveService.uploadToProcessFolder(
      process.processCode,
      process.brand,
      type,
      filePath,
      fileName,
    );

    await db
      .update(documents)
      .set({ driveFileId, updatedAt: new Date() })
      .where(eq(documents.id, documentId));

    logger.info({ documentId, driveFileId }, 'Document uploaded to Google Drive');
  },

  async acceptComparison(processId: number, input: AcceptComparisonInput, userId?: number | null) {
    const [processRow] = await db
      .select({ id: importProcesses.id })
      .from(importProcesses)
      .where(eq(importProcesses.id, processId))
      .limit(1);

    if (!processRow) {
      throw new NotFoundError('Processo', processId);
    }

    const fieldLabel = input.fieldLabel ?? input.rowKey;
    const itemSuffix = input.itemCode ? ` item ${input.itemCode}` : '';

    // O hash precisa cobrir O QUE esta sendo aceito, nao so QUAL celula. Sem os
    // valores divergentes na evidencia, reenviar o mesmo payload depois de um
    // reprocessamento caia no mesmo hash, e o `onConflictDoUpdate` ressuscitava
    // (invalidatedAt: null) um aceite dado sobre a extracao ANTERIOR.
    const comparison = await this.getComparison(processId);
    const evidence = buildAcceptanceEvidence(comparison, input);
    const baseHash = sha256Text(
      JSON.stringify({
        processId,
        scope: input.scope,
        rowKey: input.rowKey,
        fieldLabel,
        itemCode: input.itemCode ?? null,
        previousStatus: input.previousStatus ?? null,
        resolution_note: input.resolution_note,
        values: evidence.values,
        status: evidence.status,
        sources: evidence.sources,
      }),
    );

    const priorRows = await db
      .select({
        id: comparisonAcceptances.id,
        evidenceHash: comparisonAcceptances.evidenceHash,
        invalidatedAt: comparisonAcceptances.invalidatedAt,
      })
      .from(comparisonAcceptances)
      .where(
        and(
          eq(comparisonAcceptances.processId, processId),
          eq(comparisonAcceptances.scope, input.scope),
          eq(comparisonAcceptances.rowKey, input.rowKey),
        ),
      );

    // O indice unico (process_id, scope, row_key, evidence_hash) cobre linhas
    // ativas E invalidadas, entao reafirmar uma evidencia IDENTICA depois de
    // uma invalidacao nao cabe na mesma chave. Em vez de ressuscitar a linha
    // invalidada, a reafirmacao entra como linha NOVA sob um hash derivado.
    const byHash = new Map((priorRows ?? []).map((row) => [row.evidenceHash, row]));
    let evidenceHash = baseHash;
    let activeRow: { id: number } | null = null;
    for (let attempt = 0; attempt < MAX_ACCEPTANCE_REAFFIRMATIONS; attempt += 1) {
      const row = byHash.get(evidenceHash);
      if (!row) break;
      if (!row.invalidatedAt) {
        activeRow = row;
        break;
      }
      evidenceHash = sha256Text(`${evidenceHash}:reafirmacao`);
    }

    const acceptedAt = new Date();

    if (activeRow) {
      await db
        .update(comparisonAcceptances)
        .set({
          resolutionNote: input.resolution_note,
          acceptedBy: userId ?? null,
          acceptedAt,
          updatedAt: acceptedAt,
        })
        .where(eq(comparisonAcceptances.id, activeRow.id));
    } else {
      await db
        .insert(comparisonAcceptances)
        .values({
          processId,
          scope: input.scope,
          rowKey: input.rowKey,
          fieldLabel,
          itemCode: input.itemCode ?? null,
          previousStatus: input.previousStatus ?? null,
          evidenceHash,
          resolutionNote: input.resolution_note,
          acceptedBy: userId ?? null,
          acceptedAt,
        })
        .onConflictDoUpdate({
          target: [
            comparisonAcceptances.processId,
            comparisonAcceptances.scope,
            comparisonAcceptances.rowKey,
            comparisonAcceptances.evidenceHash,
          ],
          // NUNCA limpa invalidatedAt: em uma corrida, so um aceite que segue
          // ATIVO pode ser reescrito. Um invalidado permanece invalidado.
          setWhere: sql`${comparisonAcceptances.invalidatedAt} IS NULL`,
          set: {
            resolutionNote: input.resolution_note,
            acceptedBy: userId ?? null,
            acceptedAt,
            updatedAt: acceptedAt,
          },
        });
    }

    // Aceites anteriores da MESMA celula sob outra evidencia deixam de valer —
    // inclusive os gravados antes desta mudanca de composicao do hash, que de
    // outro modo ficariam ativos em paralelo e duplicariam a linha na tela.
    await db
      .update(comparisonAcceptances)
      .set({
        invalidatedAt: acceptedAt,
        invalidationReason: 'superseded_by_new_acceptance',
        updatedAt: acceptedAt,
      })
      .where(
        and(
          eq(comparisonAcceptances.processId, processId),
          eq(comparisonAcceptances.scope, input.scope),
          eq(comparisonAcceptances.rowKey, input.rowKey),
          ne(comparisonAcceptances.evidenceHash, evidenceHash),
          sql`${comparisonAcceptances.invalidatedAt} IS NULL`,
        ),
      );

    // Trilha central: aceitar divergencia e supressao de risco, como editar a
    // celula (edit_comparison_field) e resolver manualmente na validacao.
    await auditService.log(
      userId ?? null,
      'accept_comparison',
      'process',
      processId,
      {
        scope: input.scope,
        rowKey: input.rowKey,
        fieldLabel,
        itemCode: input.itemCode ?? null,
        previousStatus: input.previousStatus ?? null,
        evidenceHash,
        resolutionNote: input.resolution_note,
        evidenceValues: evidence.values,
        evidenceStatus: evidence.status,
      },
      null,
    );

    await recordProcessEvent(
      processId,
      {
        eventType: 'comparison_acceptance',
        title: `Aceite no comparativo: ${fieldLabel}${itemSuffix}`,
        description: input.resolution_note,
        metadata: {
          scope: input.scope,
          rowKey: input.rowKey,
          fieldLabel,
          itemCode: input.itemCode ?? null,
          previousStatus: input.previousStatus ?? null,
          evidenceHash,
          evidenceValues: evidence.values,
          evidenceStatus: evidence.status,
          evidenceSources: evidence.sources,
          acceptedAt: acceptedAt.toISOString(),
        },
      },
      userId ?? null,
    );

    return {
      accepted: true,
      rowKey: input.rowKey,
      scope: input.scope,
      evidenceHash,
    };
  },

  async editComparisonField(
    processId: number,
    input: EditComparisonFieldInput,
    userId?: number | null,
  ) {
    const [processRow] = await db
      .select({ id: importProcesses.id })
      .from(importProcesses)
      .where(eq(importProcesses.id, processId))
      .limit(1);

    if (!processRow) {
      throw new NotFoundError('Processo', processId);
    }

    // O `onConflictDoUpdate` abaixo sobrescreve valor, nota e autor da mesma
    // celula: sem ler o estado ANTERIOR aqui, o valor consolidado que estava
    // em vigor e quem o havia editado sumiam da base.
    const [previousOverride] = await db
      .select({
        id: comparisonFieldOverrides.id,
        fieldLabel: comparisonFieldOverrides.fieldLabel,
        valueText: comparisonFieldOverrides.valueText,
        note: comparisonFieldOverrides.note,
        editedBy: comparisonFieldOverrides.editedBy,
        editedAt: comparisonFieldOverrides.editedAt,
      })
      .from(comparisonFieldOverrides)
      .where(
        and(
          eq(comparisonFieldOverrides.processId, processId),
          eq(comparisonFieldOverrides.rowKey, input.rowKey),
          eq(comparisonFieldOverrides.sourceColumn, input.sourceColumn),
        ),
      )
      .limit(1);

    const previousState = previousOverride
      ? {
          value: previousOverride.valueText ?? null,
          note: previousOverride.note ?? null,
          editedBy: previousOverride.editedBy ?? null,
          editedAt:
            previousOverride.editedAt instanceof Date
              ? previousOverride.editedAt.toISOString()
              : (previousOverride.editedAt ?? null),
        }
      : null;

    const editedAt = new Date();
    const [override] = await db
      .insert(comparisonFieldOverrides)
      .values({
        processId,
        rowKey: input.rowKey,
        fieldLabel: input.fieldLabel,
        sourceColumn: input.sourceColumn,
        valueText: input.value,
        note: input.note ?? null,
        editedBy: userId ?? null,
        editedAt,
      })
      .onConflictDoUpdate({
        target: [
          comparisonFieldOverrides.processId,
          comparisonFieldOverrides.rowKey,
          comparisonFieldOverrides.sourceColumn,
        ],
        set: {
          fieldLabel: input.fieldLabel,
          valueText: input.value,
          note: input.note ?? null,
          editedBy: userId ?? null,
          editedAt,
          updatedAt: editedAt,
        },
      })
      .returning();

    await auditService.log(
      userId ?? null,
      'edit_comparison_field',
      'process',
      processId,
      {
        rowKey: input.rowKey,
        fieldLabel: input.fieldLabel,
        sourceColumn: input.sourceColumn,
        note: input.note,
        value: input.value,
        // Historico da celula: a tabela guarda so a ultima edicao.
        previousValue: previousState?.value ?? null,
        previousNote: previousState?.note ?? null,
        previousEditedBy: previousState?.editedBy ?? null,
        previousEditedAt: previousState?.editedAt ?? null,
      },
      null,
    );

    await recordProcessEvent(
      processId,
      {
        eventType: 'comparison_field_edited',
        title: `Comparativo editado: ${input.fieldLabel}`,
        description: input.note || undefined,
        metadata: {
          rowKey: input.rowKey,
          fieldLabel: input.fieldLabel,
          sourceColumn: input.sourceColumn,
          value: input.value,
          note: input.note,
          previousValue: previousState?.value ?? null,
          previousNote: previousState?.note ?? null,
          previousEditedBy: previousState?.editedBy ?? null,
          previousEditedAt: previousState?.editedAt ?? null,
          editedAt: editedAt.toISOString(),
        },
      },
      userId ?? null,
    );

    return override;
  },

  /**
   * Remove a edicao manual de uma celula e devolve a linha ao valor EXTRAIDO.
   * Sem esta rota, um `value: null` gravado por engano apagava o valor
   * permanentemente da tela (getComparison prefere o override existente,
   * inclusive quando `valueText` e null) e nao havia caminho de volta.
   */
  async removeComparisonFieldOverride(
    processId: number,
    input: RemoveComparisonFieldInput,
    userId?: number | null,
  ) {
    const [processRow] = await db
      .select({ id: importProcesses.id })
      .from(importProcesses)
      .where(eq(importProcesses.id, processId))
      .limit(1);

    if (!processRow) {
      throw new NotFoundError('Processo', processId);
    }

    const [removed] = await db
      .delete(comparisonFieldOverrides)
      .where(
        and(
          eq(comparisonFieldOverrides.processId, processId),
          eq(comparisonFieldOverrides.rowKey, input.rowKey),
          eq(comparisonFieldOverrides.sourceColumn, input.sourceColumn),
        ),
      )
      .returning();

    if (!removed) {
      throw new NotFoundError('Edicao manual do comparativo', processId);
    }

    const removedAt = new Date();
    const fieldLabel = removed.fieldLabel ?? input.rowKey;

    await auditService.log(
      userId ?? null,
      'remove_comparison_field_override',
      'process',
      processId,
      {
        rowKey: input.rowKey,
        fieldLabel,
        sourceColumn: input.sourceColumn,
        note: input.note,
        previousValue: removed.valueText ?? null,
        previousNote: removed.note ?? null,
        previousEditedBy: removed.editedBy ?? null,
        previousEditedAt:
          removed.editedAt instanceof Date
            ? removed.editedAt.toISOString()
            : (removed.editedAt ?? null),
      },
      null,
    );

    await recordProcessEvent(
      processId,
      {
        eventType: 'comparison_field_override_removed',
        title: `Edicao revertida no comparativo: ${fieldLabel}`,
        description: input.note,
        metadata: {
          rowKey: input.rowKey,
          fieldLabel,
          sourceColumn: input.sourceColumn,
          note: input.note,
          previousValue: removed.valueText ?? null,
          previousNote: removed.note ?? null,
          previousEditedBy: removed.editedBy ?? null,
          removedAt: removedAt.toISOString(),
        },
      },
      userId ?? null,
    );

    return {
      removed: true,
      rowKey: input.rowKey,
      sourceColumn: input.sourceColumn,
      previousValue: removed.valueText ?? null,
    };
  },

  async getComparison(processId: number) {
    const [docs, processRow, overrides, acceptanceRows] = await Promise.all([
      db.select().from(documents).where(eq(documents.processId, processId)),
      db.select().from(importProcesses).where(eq(importProcesses.id, processId)).limit(1),
      db
        .select({
          id: comparisonFieldOverrides.id,
          processId: comparisonFieldOverrides.processId,
          rowKey: comparisonFieldOverrides.rowKey,
          fieldLabel: comparisonFieldOverrides.fieldLabel,
          sourceColumn: comparisonFieldOverrides.sourceColumn,
          valueText: comparisonFieldOverrides.valueText,
          note: comparisonFieldOverrides.note,
          editedAt: comparisonFieldOverrides.editedAt,
          editedBy: comparisonFieldOverrides.editedBy,
          editedByName: users.name,
        })
        .from(comparisonFieldOverrides)
        .leftJoin(users, eq(comparisonFieldOverrides.editedBy, users.id))
        .where(eq(comparisonFieldOverrides.processId, processId)),
      // O aceite VIGENTE vem da tabela relacional, nao do timeline. Enquanto
      // `comparison_acceptances` era write-only, `invalidateComparisonAcceptances()`
      // marcava a linha como invalidada e a tela continuava exibindo o aceite
      // (que vinha do evento) sobre dados de extracao NOVOS.
      db
        .select({
          id: comparisonAcceptances.id,
          scope: comparisonAcceptances.scope,
          rowKey: comparisonAcceptances.rowKey,
          fieldLabel: comparisonAcceptances.fieldLabel,
          itemCode: comparisonAcceptances.itemCode,
          previousStatus: comparisonAcceptances.previousStatus,
          evidenceHash: comparisonAcceptances.evidenceHash,
          resolutionNote: comparisonAcceptances.resolutionNote,
          acceptedAt: comparisonAcceptances.acceptedAt,
          acceptedBy: comparisonAcceptances.acceptedBy,
          acceptedByName: users.name,
        })
        .from(comparisonAcceptances)
        .leftJoin(users, eq(comparisonAcceptances.acceptedBy, users.id))
        .where(
          and(
            eq(comparisonAcceptances.processId, processId),
            sql`${comparisonAcceptances.invalidatedAt} IS NULL`,
          ),
        ),
    ]);

    const acceptances = acceptanceRows ?? [];
    const acceptanceByRow = new Map<string, (typeof acceptances)[number]>();
    for (const acceptance of acceptances) {
      const key = `${acceptance.scope}|${acceptance.rowKey}`;
      const current = acceptanceByRow.get(key);
      if (!current) {
        acceptanceByRow.set(key, acceptance);
        continue;
      }
      const currentTime = new Date(current.acceptedAt).getTime();
      const candidateTime = new Date(acceptance.acceptedAt).getTime();
      if (candidateTime > currentTime) acceptanceByRow.set(key, acceptance);
    }
    const acceptanceFor = (scope: 'aggregate' | 'item', rowKeyValue: string) =>
      acceptanceByRow.get(`${scope}|${rowKeyValue}`) ?? null;

    const overrideByRow = new Map<string, typeof overrides>();
    for (const override of overrides) {
      const list = overrideByRow.get(override.rowKey) ?? [];
      list.push(override);
      overrideByRow.set(override.rowKey, list);
    }
    const getOverride = (rowKeyValue: string, sourceColumn: string) =>
      overrideByRow.get(rowKeyValue)?.find((override) => override.sourceColumn === sourceColumn);
    const editedMessage = (rowKeyValue: string, baseMessage: string | null) => {
      const list = overrideByRow.get(rowKeyValue) ?? [];
      if (list.length === 0) return baseMessage;
      const latest = [...list].sort((a, b) => {
        const aTime =
          a.editedAt instanceof Date ? a.editedAt.getTime() : new Date(a.editedAt).getTime();
        const bTime =
          b.editedAt instanceof Date ? b.editedAt.getTime() : new Date(b.editedAt).getTime();
        return bTime - aTime;
      })[0];
      const author = latest.editedByName ?? `usuario ${latest.editedBy ?? '-'}`;
      return `${baseMessage ?? 'Valor revisado manualmente.'} Editado por ${author}.`;
    };

    const newestFirst = [...docs].sort((a, b) => {
      const aTime = (a.updatedAt ?? a.createdAt)?.getTime?.() ?? 0;
      const bTime = (b.updatedAt ?? b.createdAt)?.getTime?.() ?? 0;
      if (bTime !== aTime) return bTime - aTime;
      return b.id - a.id;
    });
    const selectComparisonDoc = (type: string) =>
      newestFirst.find(
        (d) =>
          d.type === type &&
          d.isProcessed &&
          d.aiParsedData &&
          hasMeaningfulAiData(d.aiParsedData) &&
          hasOperationalConfidence(d.confidenceScore) &&
          !hasExtractionFailureData(d.aiParsedData),
      );

    const invoiceDoc = selectComparisonDoc('invoice');
    const plDoc = selectComparisonDoc('packing_list');
    const blDoc = selectComparisonDoc('ohbl');
    const draftBlDoc = selectComparisonDoc('draft_bl');
    const espelhoDoc = selectComparisonDoc('espelho');

    // Flatten { value, confidence } structures to plain values for comparison
    const rawInv = (invoiceDoc?.aiParsedData as Record<string, any>) ?? null;
    const rawPl = (plDoc?.aiParsedData as Record<string, any>) ?? null;
    const rawBl = (blDoc?.aiParsedData as Record<string, any>) ?? null;
    const rawDraftBl = (draftBlDoc?.aiParsedData as Record<string, any>) ?? null;

    const inv = rawInv ? flattenAiData(rawInv) : null;
    const pl = rawPl ? flattenAiData(rawPl) : null;
    const bl = rawBl ? flattenAiData(rawBl) : null;
    const draftBl = rawDraftBl ? flattenAiData(rawDraftBl) : null;
    const operationalBl = bl ?? draftBl;
    const operationalBlDoc = blDoc ?? draftBlDoc;
    const operationalBlSource = bl ? 'ohbl' : draftBl ? 'draft_bl' : null;

    // Espelho data lives in importProcesses.aiExtractedData.espelho (atomic merge target).
    // Fallback: read from the espelho document's aiParsedData if process column is empty.
    const processAiData = (processRow[0]?.aiExtractedData as Record<string, any>) ?? null;
    const espelhoFromProcess = processAiData?.espelho as
      | { summary?: Record<string, any>; items?: any[] }
      | undefined;
    const espelhoFromDoc = espelhoDoc?.aiParsedData as
      | { summary?: Record<string, any>; items?: any[] }
      | undefined;
    // Se a coluna do processo guarda o espelho AUTO-gerado mas existe um xlsx
    // do operador, o do operador vence — ele é a fonte real de conferência.
    let espelhoChosen = espelhoFromProcess ?? espelhoFromDoc ?? null;
    if (
      (espelhoChosen?.summary as any)?.generatedBy === 'auto_deterministic' &&
      espelhoFromDoc?.summary
    ) {
      espelhoChosen = espelhoFromDoc;
    }
    const espelhoSource: string | null =
      ((espelhoChosen?.summary as any)?.generatedBy as string | undefined) ??
      (espelhoChosen?.summary ? 'operator' : null);
    let espelhoSummary = espelhoChosen?.summary ?? null;
    let espelhoItems = espelhoChosen?.items ?? [];
    // FALSO VERDE (auditoria 2026-07-17): o espelho auto-gerado é uma CÓPIA da
    // própria Invoice/PL (build-espelho.ts) — usá-lo como 4ª fonte faz a fatura
    // conferir consigo mesma e pintar as linhas de verde a "99%". Derivado NÃO
    // entra na conferência (agregado nem itens); a UI explica via espelhoSource.
    if (espelhoSource === 'auto_deterministic') {
      espelhoSummary = null;
      espelhoItems = [];
    }
    const supplierFooterAliases = normalizeStringList(
      inv?.manufacturerAliases ??
        inv?.manufacturerNicknames ??
        inv?.supplierAliases ??
        inv?.supplierNicknames ??
        [],
    );
    const espelhoSuppliers = normalizeStringList([
      espelhoSummary?.exporterName,
      espelhoSummary?.supplier,
      espelhoSummary?.fornecedor,
      ...espelhoItems.map(
        (item: Record<string, any>) =>
          item.fornecedor ?? item.supplier ?? item.manufacturer ?? item.manufacturerName,
      ),
    ]);

    // Pre-extract structured party parts from each document
    const invExporter = extractPartyParts(inv?.exporterName);
    const plExporter = extractPartyParts(pl?.exporterName);
    const blShipper = extractPartyParts(operationalBl?.shipper ?? operationalBl?.shipperName);
    const invImporter = extractPartyParts(inv?.importerName);
    const plImporter = extractPartyParts(pl?.importerName);
    const blConsignee = extractPartyParts(operationalBl?.consignee ?? operationalBl?.consigneeName);

    // Build aggregate field comparison — `kind` drives comparison semantics
    type Kind = 'string' | 'numeric' | 'port' | 'date' | 'name';
    // Criticality flags which fields are mandatory for customs clearance
    // (Nicolas, 2026-05-21: "se for a parte do endereço do exportador ou
    // alguma outra coisa assim, que não seja da parte aduaneira, talvez a
    // gente consiga relevar"). Defaults are conservative — endereços,
    // pesos/CBM totals e moeda do frete são "secondary" (avisos, não erros).
    type Criticality = 'critical' | 'secondary' | 'info';
    interface AggregateRow {
      label: string;
      inv?: unknown;
      pl?: unknown;
      bl?: unknown;
      espelho?: unknown;
      kind?: Kind;
      criticality?: Criticality;
      // Per-row date tolerance (only used when kind === 'date'). Lets the ETD row
      // widen tolerance so an Invoice/PL issue date used as a fallback is only
      // flagged when VERY divergent from the BL shipment date.
      dateOpts?: { matchDays?: number; warnDays?: number };
    }

    const aggregateFields: AggregateRow[] = [
      {
        label: 'Exportador / Shipper',
        inv: invExporter.name || inv?.exporterName,
        pl: plExporter.name || pl?.exporterName,
        bl: blShipper.name || (operationalBl?.shipper ?? operationalBl?.shipperName),
        espelho: espelhoSummary?.exporterName ?? processRow[0]?.exporterName,
        kind: 'name',
      },
      {
        label: 'Exportador — CNPJ / Tax ID',
        inv: invExporter.taxId || inv?.exporterTaxId,
        pl: plExporter.taxId || pl?.exporterTaxId,
        bl: blShipper.taxId,
        espelho: null,
        criticality: 'secondary',
      },
      {
        label: 'Exportador — Endereço',
        inv: invExporter.address || inv?.exporterAddress,
        pl: plExporter.address || pl?.exporterAddress,
        bl: blShipper.address,
        espelho: null,
        kind: 'name', // fuzzy compare
        criticality: 'secondary',
      },
      {
        label: 'Importador / Consignee',
        inv: invImporter.name || inv?.importerName,
        pl: plImporter.name || pl?.importerName,
        bl: blConsignee.name || (operationalBl?.consignee ?? operationalBl?.consigneeName),
        espelho: espelhoSummary?.importerName,
        kind: 'name',
      },
      {
        label: 'Importador — CNPJ',
        inv: invImporter.taxId || inv?.importerCnpj,
        pl: plImporter.taxId || pl?.importerCnpj,
        bl: blConsignee.taxId,
        espelho: espelhoSummary?.importerCnpj,
      },
      {
        label: 'Importador — Endereço',
        inv: invImporter.address || inv?.importerAddress,
        pl: plImporter.address || pl?.importerAddress,
        bl: blConsignee.address,
        espelho: espelhoSummary?.importerAddress,
        kind: 'name',
        criticality: 'secondary',
      },
      {
        label: 'Invoice Number / Order Ref',
        inv: inv?.invoiceNumber,
        pl: pl?.packingListNumber,
        bl: operationalBl?.customerReference,
      },
      {
        label: 'BL Number (shipping)',
        inv: null,
        pl: null,
        bl: operationalBl?.blNumber,
      },
      { label: 'Incoterm', inv: inv?.incoterm, pl: null, bl: null },
      { label: 'Moeda', inv: inv?.currency, pl: null, bl: operationalBl?.freightCurrency },
      {
        label: 'Porto Embarque',
        inv: inv?.portOfLoading,
        pl: pl?.portOfLoading,
        bl: operationalBl?.portOfLoading,
        kind: 'port',
      },
      {
        label: 'Porto Destino',
        inv: inv?.portOfDischarge,
        pl: pl?.portOfDischarge,
        bl: operationalBl?.portOfDischarge,
        kind: 'port',
      },
      {
        label: 'Total FOB (USD)',
        inv: inv?.totalFobValue,
        pl: null,
        bl: null,
        espelho: espelhoSummary?.totalAmountUsd,
        kind: 'numeric',
      },
      {
        label: 'Frete',
        inv: null,
        pl: null,
        bl: operationalBl?.freightValue,
        kind: 'numeric',
        criticality: 'info',
      },
      {
        label: 'Total Caixas',
        inv: inv?.totalBoxes,
        pl: pl?.totalBoxes,
        bl: operationalBl?.totalBoxes,
        espelho: espelhoSummary?.totalBoxes,
        kind: 'numeric',
      },
      {
        label: 'Peso Liquido (kg)',
        inv: inv?.totalNetWeight,
        pl: pl?.totalNetWeight,
        bl: null,
        espelho: espelhoSummary?.totalNetWeight,
        kind: 'numeric',
        criticality: 'secondary',
      },
      {
        label: 'Peso Bruto (kg)',
        inv: inv?.totalGrossWeight,
        pl: pl?.totalGrossWeight,
        bl: operationalBl?.totalGrossWeight,
        espelho: espelhoSummary?.totalGrossWeight,
        kind: 'numeric',
        criticality: 'secondary',
      },
      {
        label: 'CBM (m3)',
        inv: inv?.totalCbm,
        pl: pl?.totalCbm,
        bl: operationalBl?.totalCbm,
        espelho: espelhoSummary?.totalCbm,
        kind: 'numeric',
        criticality: 'secondary',
      },
      {
        // Eduarda: considerar a data da Invoice e do Packing List aqui, mas marcar
        // divergente apenas se MUITO divergentes (não precisam ser iguais). A data
        // de embarque real (ETD/shipmentDate) tem precedência; a data de EMISSÃO da
        // Invoice / data do Packing List entram só como fallback, com tolerância
        // ampla (match ≤45d, warning ≤90d, divergente acima disso).
        label: 'ETD / Shipped On Board',
        inv:
          inv?.etd ??
          inv?.shipmentDate ??
          inv?.shippingDate ??
          inv?.dateOfShipment ??
          inv?.shippedOnBoardDate ??
          inv?.onBoardDate ??
          inv?.invoiceDate,
        pl:
          pl?.etd ??
          pl?.shipmentDate ??
          pl?.shippingDate ??
          pl?.dateOfShipment ??
          pl?.shippedOnBoardDate ??
          pl?.onBoardDate ??
          pl?.packingListDate ??
          pl?.date,
        bl:
          operationalBl?.shipmentDate ??
          operationalBl?.shippedOnBoardDate ??
          operationalBl?.onBoardDate ??
          operationalBl?.etd,
        espelho: null,
        kind: 'date',
        dateOpts: { matchDays: 45, warnDays: 90 },
      },
      {
        label: 'ETA',
        inv: null,
        pl: null,
        bl: operationalBl?.eta,
        kind: 'date',
        criticality: 'info',
      },
      {
        label: 'Container',
        inv: null,
        pl: null,
        bl: operationalBl?.containerNumber,
        criticality: 'info',
      },
      {
        label: 'Tipo Container',
        inv: null,
        pl: null,
        bl: operationalBl?.containerType,
        espelho: espelhoSummary?.containerType,
        criticality: 'info',
      },
      { label: 'Navio', inv: null, pl: null, bl: operationalBl?.vesselName, criticality: 'info' },
    ];

    // Compute match status for each field — supports 4 docs (inv/pl/bl/espelho).
    // For 'secondary' criticality, a hard divergence is downgraded to warning
    // (per Nicolas: "endereço do exportador… talvez a gente consiga relevar").
    const aggregateComparison = aggregateFields.map((f, index) => {
      const key = comparisonRowKey('aggregate', f.label, index);
      const invoiceOverride = getOverride(key, 'invoice');
      const packingListOverride = getOverride(key, 'packingList');
      const blOverride = getOverride(key, 'bl');
      const espelhoOverride = getOverride(key, 'espelho');

      // Um override existente vale mesmo com valueText null (célula limpa de
      // propósito); só na ausência de override a célula cai no valor extraído.
      const resolveCell = (
        override: { valueText: string | null } | undefined,
        raw: unknown,
      ): string | null => {
        if (override) return override.valueText;
        return raw != null && raw !== '' ? String(raw) : null;
      };

      const invoice = resolveCell(invoiceOverride, f.inv);
      const packingList = resolveCell(packingListOverride, f.pl);
      const bl = resolveCell(blOverride, f.bl);
      const espelho = resolveCell(espelhoOverride, f.espelho);

      // O status considera os valores efetivamente exibidos: corrigir uma
      // célula editada deve reconciliar (ou divergir) a linha de verdade.
      const values = [invoice, packingList, bl, espelho].filter((v) => v != null && v !== '');
      let status = computeRowStatus(values, f.kind ?? 'string', f.dateOpts);
      const criticality: Criticality = f.criticality ?? 'critical';
      if (criticality === 'secondary' && status === 'divergent') status = 'warning';
      const baseMessage = aggregateMessage(status, criticality);
      return {
        rowKey: key,
        label: f.label,
        invoice,
        packingList,
        bl,
        espelho,
        status,
        criticality,
        message: editedMessage(key, baseMessage),
        overrides: overrideByRow.get(key) ?? [],
        accepted: acceptanceFor('aggregate', key),
      };
    });

    // Build item-level comparison — normalize item codes (PI7752Y vs PI 7752Y, etc.)
    const invItems = inv?.items ?? [];
    const plItems = pl?.items ?? [];

    const findPlMatch = (invItem: any) =>
      plItems.find((plItem: any) => {
        if (itemIdentityMatches(plItem, invItem)) return true;
        const plDesc = plItem.description ?? plItem.descricao;
        const invDesc = invItem.description ?? invItem.descricao;
        return Boolean(
          plDesc &&
          invDesc &&
          String(plDesc).toLowerCase().includes(String(invDesc).toLowerCase().slice(0, 20)),
        );
      });

    const findEspelhoMatch = (invItem: any) =>
      espelhoItems.find((espItem: any) => {
        return itemIdentityMatches(espItem, invItem);
      });

    const itemComparison = invItems.map((invItem: any, index: number) => {
      const plMatch = findPlMatch(invItem);
      const espelhoMatch = findEspelhoMatch(invItem);
      const itemCode =
        extractCanonicalItemCode(
          invItem.itemCode ?? invItem.codigo ?? invItem.code ?? invItem.sku,
        ) ||
        itemCodeCandidates(invItem)[0] ||
        invItem.itemCode ||
        invItem.codigo;
      const invoiceQty = toNumberOrNull(invItem.quantity);
      const plQty = toNumberOrNull(plMatch?.quantity);
      const espelhoQty = toNumberOrNull(espelhoMatch?.qty ?? espelhoMatch?.quantity);
      const invoiceManufacturer =
        invItem.manufacturer ?? invItem.manufacturerName ?? invItem.fabricante ?? null;
      const plManufacturer =
        plMatch?.manufacturer ?? plMatch?.manufacturerName ?? plMatch?.fabricante ?? null;
      const espelhoManufacturer =
        espelhoMatch?.manufacturer ??
        espelhoMatch?.manufacturerName ??
        espelhoMatch?.fabricante ??
        espelhoMatch?.fornecedor ??
        null;
      const isFreeOfCharge = isInvoiceFreeOfCharge(invItem);
      const quantityDiverges =
        plQty != null && invoiceQty != null && Math.abs(plQty - invoiceQty) > 0.0001;
      const espelhoDiverges =
        espelhoQty != null && invoiceQty != null && Math.abs(espelhoQty - invoiceQty) > 0.0001;
      const manufacturerDiverges = manufacturerValuesDiverge([
        invoiceManufacturer,
        plManufacturer,
        espelhoManufacturer,
      ]);
      const weightRatio = compareItemWeightRatio({
        invoiceNetWeight: toNumberOrNull(invItem.netWeight),
        invoiceGrossWeight: toNumberOrNull(invItem.grossWeight),
        plNetWeight: toNumberOrNull(plMatch?.netWeight),
        plGrossWeight: toNumberOrNull(plMatch?.grossWeight),
      });
      const matched = !!plMatch;
      const espelhoMatched = !!espelhoMatch;
      const status: RowStatus = isFreeOfCharge
        ? 'warning'
        : !matched || (espelhoItems.length > 0 && !espelhoMatched) || manufacturerDiverges
          ? 'warning'
          : quantityDiverges || espelhoDiverges || weightRatio.status === 'divergent'
            ? 'divergent'
            : weightRatio.status === 'warning'
              ? 'warning'
              : 'match';
      const divergence = buildItemDivergence({
        matched,
        espelhoMatched,
        hasEspelho: espelhoItems.length > 0,
        quantityDiverges,
        espelhoDiverges,
        isFreeOfCharge,
        manufacturerDiverges,
        weightRatioMessage: weightRatio.message,
      });

      const itemRowKey = comparisonRowKey(
        'item',
        itemCode ?? invItem.description ?? 'sem-codigo',
        index,
      );

      return {
        rowKey: itemRowKey,
        accepted: acceptanceFor('item', itemRowKey),
        itemCode,
        description: invItem.description ?? invItem.descricao,
        ncm: invItem.ncmCode ?? invItem.ncm,
        invoiceQty,
        plQty,
        espelhoQty,
        invoiceUnitPrice: invItem.unitPrice,
        invoiceTotal: invItem.totalPrice,
        espelhoUnitPrice: espelhoMatch?.unitPrice ?? null,
        espelhoTotal: espelhoMatch?.amountUsd ?? null,
        invoiceManufacturer,
        plManufacturer,
        espelhoManufacturer,
        manufacturerMatch: !manufacturerDiverges,
        invoiceBoxes: invItem.boxQuantity ?? null,
        plBoxes: plMatch?.boxQuantity ?? null,
        espelhoBoxes: espelhoMatch?.caixasPorRef ?? null,
        invoiceNetWeight: invItem.netWeight ?? null,
        plNetWeight: plMatch?.netWeight ?? null,
        espelhoNetWeight: espelhoMatch?.pesoLiquidoTotal ?? null,
        invoiceGrossWeight: invItem.grossWeight ?? null,
        plGrossWeight: plMatch?.grossWeight ?? null,
        plWeight: plMatch?.grossWeight ?? plMatch?.netWeight ?? null,
        espelhoGrossWeight: espelhoMatch?.pesoBrutoTotal ?? null,
        isFreeOfCharge,
        weightRatioStatus: weightRatio.status,
        weightRatioMessage: weightRatio.message,
        qtyMatch: plMatch ? !quantityDiverges : null,
        matched,
        espelhoMatched,
        divergence,
        status,
        message: itemComparisonMessage(status, divergence, isFreeOfCharge),
      };
    });

    // Find PL items not matched in invoice
    const unmatchedPlItems = plItems
      .filter(
        (plItem: any) =>
          !invItems.some((invItem: any) => {
            if (itemIdentityMatches(plItem, invItem)) return true;
            const plDesc = plItem.description ?? plItem.descricao;
            const invDesc = invItem.description ?? invItem.descricao;
            return Boolean(
              invDesc &&
              plDesc &&
              String(invDesc).toLowerCase().includes(String(plDesc).toLowerCase().slice(0, 20)),
            );
          }),
      )
      .map((item: any) => ({
        itemCode:
          extractCanonicalItemCode(item.itemCode ?? item.codigo ?? item.code ?? item.sku) ||
          itemCodeCandidates(item)[0] ||
          item.itemCode ||
          item.codigo,
        description: item.description ?? item.descricao,
        quantity: item.quantity,
        source: 'packing_list',
      }));

    // Opposite direction: Invoice items not matched in the Packing List. Same
    // matching primitives (EAN / itemCode / description) so the anomaly stream
    // and the comparison panels agree in BOTH directions, not just PL→INV.
    const unmatchedInvoiceItems = invItems
      .filter(
        (invItem: any) =>
          !plItems.some((plItem: any) => {
            if (itemIdentityMatches(plItem, invItem)) return true;
            const plDesc = plItem.description ?? plItem.descricao;
            const invDesc = invItem.description ?? invItem.descricao;
            return Boolean(
              plDesc &&
              invDesc &&
              String(plDesc).toLowerCase().includes(String(invDesc).toLowerCase().slice(0, 20)),
            );
          }),
      )
      .map((item: any) => ({
        itemCode:
          extractCanonicalItemCode(item.itemCode ?? item.codigo ?? item.code ?? item.sku) ||
          itemCodeCandidates(item)[0] ||
          item.itemCode ||
          item.codigo,
        description: item.description ?? item.descricao,
        quantity: item.quantity,
        source: 'invoice',
      }));

    // Per-document extraction coverage (additive/optional). Computed from the
    // EXISTING raw extracted data ({ value, confidence }) — no AI re-run. Lets
    // the UI tell the operator exactly which fields were not read.
    const extractionCoverage = {
      invoice: computeExtractionCoverage(rawInv, 'invoice'),
      packingList: computeExtractionCoverage(rawPl, 'packing_list'),
      bl: computeExtractionCoverage(rawBl, 'ohbl'),
      draftBl: computeExtractionCoverage(rawDraftBl, 'draft_bl'),
    };

    // Draft BL vs Final BL ("Revisado") — only when both are present
    const draftBlRevisions = draftBl && bl ? computeDraftBlRevisions(draftBl, bl) : [];

    return {
      hasInvoice: !!inv,
      hasPackingList: !!pl,
      hasBl: !!operationalBl,
      hasFinalBl: !!bl,
      hasDraftBl: !!draftBl,
      hasOperationalBl: !!operationalBl,
      operationalBlSource,
      hasEspelho: !!espelhoSummary || espelhoItems.length > 0,
      aggregateComparison,
      itemComparison,
      // Aceites ATIVOS (invalidated_at IS NULL) lidos da tabela relacional.
      // O timeline (`comparison_acceptance`) permanece como historico.
      acceptances,
      // Documentos que originaram os valores comparados — entram na evidencia
      // do aceite (ver acceptComparison) e permitem a tela citar a origem.
      sourceDocuments: {
        invoice: invoiceDoc?.id ?? null,
        packingList: plDoc?.id ?? null,
        bl: operationalBlDoc?.id ?? null,
        finalBl: blDoc?.id ?? null,
        draftBl: draftBlDoc?.id ?? null,
        espelho: espelhoDoc?.id ?? null,
      },
      unmatchedPlItems,
      unmatchedInvoiceItems,
      supplierFooterAliases,
      espelhoSuppliers,
      extractionCoverage,
      draftBlRevisions,
      invoiceConfidence: invoiceDoc?.confidenceScore,
      plConfidence: plDoc?.confidenceScore,
      blConfidence: operationalBlDoc?.confidenceScore,
      finalBlConfidence: blDoc?.confidenceScore,
      draftBlConfidence: draftBlDoc?.confidenceScore,
      espelhoConfidence: espelhoDoc?.confidenceScore ?? (espelhoSummary ? 0.99 : null),
      espelhoSource,
    };
  },
};

type RowStatus = 'match' | 'warning' | 'divergent' | 'empty' | 'single_source';

function comparisonRowKey(scope: 'aggregate' | 'item', value: unknown, index: number): string {
  const raw = String(value ?? `linha-${index + 1}`)
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
  return `${scope}:${raw || `linha-${index + 1}`}`;
}

function aggregateMessage(status: RowStatus, criticality: 'critical' | 'secondary' | 'info') {
  if (status === 'empty') return 'Sem dados extraidos para comparar.';
  if (status === 'single_source') {
    return 'Fonte unica — nenhum outro documento disponivel para corroborar este valor.';
  }
  if (status === 'match') return 'Conforme entre os documentos disponiveis.';
  if (status === 'warning' && criticality === 'secondary') {
    return 'Divergencia secundaria registrada como atencao.';
  }
  if (status === 'warning') return 'Divergencia pequena ou informativa; revisar antes do envio.';
  return 'Divergencia entre documentos; requer correcao ou aceite.';
}

function toNumberOrNull(value: unknown): number | null {
  if (value == null || value === '') return null;
  const parsed = Number(String(value).replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
}

function itemCodeCandidates(item: Record<string, any> | null | undefined): string[] {
  if (!item) return [];
  const rawCandidates = [
    item.itemCode,
    item.codigo,
    item.code,
    item.sku,
    item.reference,
    item.referencia,
    item.description,
    item.descricao,
  ];
  const seen = new Set<string>();
  const values: string[] = [];
  for (const raw of rawCandidates) {
    if (raw == null || raw === '') continue;
    const cleaned = extractCanonicalItemCode(raw);
    if (!cleaned) continue;
    const key = String(cleaned).trim().toUpperCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    values.push(cleaned);
  }
  return values;
}

function itemIdentityMatches(left: Record<string, any>, right: Record<string, any>): boolean {
  const leftEan = normalizeGtin(left.ean ?? left.ean13);
  const rightEan = normalizeGtin(right.ean ?? right.ean13);
  if (leftEan && rightEan && leftEan === rightEan) return true;

  const leftCodes = itemCodeCandidates(left);
  const rightCodes = itemCodeCandidates(right);
  return leftCodes.some((leftCode) =>
    rightCodes.some((rightCode) => itemCodesMatch(leftCode, rightCode)),
  );
}

function isInvoiceFreeOfCharge(item: Record<string, any>): boolean {
  const total = toNumberOrNull(item.totalPrice);
  const unit = toNumberOrNull(item.unitPrice);
  const marker = String(item.notes ?? item.observations ?? item.description ?? item.descricao ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  return (
    item.isFreeOfCharge === true ||
    total === 0 ||
    marker.includes('free of charge') ||
    marker.includes('foc') ||
    marker.includes('discount') ||
    marker.includes('desconto') ||
    marker.includes('bonificacao') ||
    marker.includes('bonificado') ||
    unit === 0
  );
}

function buildItemDivergence(input: {
  matched: boolean;
  espelhoMatched: boolean;
  hasEspelho: boolean;
  quantityDiverges: boolean;
  espelhoDiverges: boolean;
  isFreeOfCharge: boolean;
  manufacturerDiverges?: boolean;
  weightRatioMessage?: string | null;
}): string {
  if (input.isFreeOfCharge) return 'FOC/desconto identificado na Invoice';
  if (!input.matched) return 'Item nao localizado no Packing List';
  if (input.hasEspelho && !input.espelhoMatched) return 'Item nao localizado no Espelho';
  const divergences: string[] = [];
  if (input.quantityDiverges) divergences.push('quantidade Invoice x Packing List');
  if (input.espelhoDiverges) divergences.push('quantidade Invoice x Espelho');
  if (input.manufacturerDiverges) divergences.push('fabricante INV x PL x Espelho');
  if (input.weightRatioMessage) divergences.push(input.weightRatioMessage);
  return divergences.length > 0 ? divergences.join('; ') : 'Sem divergencia';
}

function manufacturerValuesDiverge(values: unknown[]): boolean {
  const normalized = values
    .filter((value) => value != null && value !== '')
    .map((value) => normalizeCompanyName(value))
    .filter(Boolean);
  if (normalized.length <= 1) return false;
  // Compara todos os pares (não só contra o primeiro): 'ACME X' vs 'ACME Y'
  // diverge mesmo quando ambos casam por prefixo com 'ACME'. Prefixo mútuo
  // continua tolerado para absorver sufixos societários/ruído de extração.
  for (let i = 0; i < normalized.length; i += 1) {
    for (let j = i + 1; j < normalized.length; j += 1) {
      const a = normalized[i];
      const b = normalized[j];
      if (a !== b && !a.startsWith(b) && !b.startsWith(a)) return true;
    }
  }
  return false;
}

function normalizeStringList(value: unknown): string[] {
  const rawValues = Array.isArray(value) ? value : [value];
  const seen = new Set<string>();
  const result: string[] = [];

  for (const raw of rawValues.flatMap((item) =>
    typeof item === 'string' ? item.split(/[;\n]/) : [item],
  )) {
    const text = String(raw ?? '')
      .trim()
      .replace(/\s+/g, ' ');
    if (!text) continue;
    const key = normalizeCompanyName(text) || text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(text);
  }

  return result;
}

function compareItemWeightRatio(input: {
  invoiceNetWeight: number | null;
  invoiceGrossWeight: number | null;
  plNetWeight: number | null;
  plGrossWeight: number | null;
}): { status: RowStatus; message: string | null } {
  const ratio = (gross: number | null, net: number | null) => {
    if (gross == null || net == null || net <= 0 || gross <= 0) return null;
    return gross / net;
  };
  const invoiceRatio = ratio(input.invoiceGrossWeight, input.invoiceNetWeight);
  const plRatio = ratio(input.plGrossWeight, input.plNetWeight);
  if (invoiceRatio == null && plRatio == null) return { status: 'empty', message: null };
  if (
    (input.invoiceGrossWeight != null &&
      input.invoiceNetWeight != null &&
      input.invoiceGrossWeight < input.invoiceNetWeight) ||
    (input.plGrossWeight != null &&
      input.plNetWeight != null &&
      input.plGrossWeight < input.plNetWeight)
  ) {
    return { status: 'divergent', message: 'peso bruto menor que peso liquido' };
  }
  if (invoiceRatio == null || plRatio == null) return { status: 'warning', message: null };
  const diffPct = Math.abs(invoiceRatio - plRatio) / Math.max(invoiceRatio, plRatio, 1);
  if (diffPct <= 0.15) return { status: 'match', message: null };
  if (diffPct <= 0.25)
    return { status: 'warning', message: 'proporcao peso bruto/liquido fora da margem de 15%' };
  return { status: 'divergent', message: 'proporcao peso bruto/liquido divergente' };
}

function itemComparisonMessage(
  status: RowStatus,
  divergence: string,
  isFreeOfCharge: boolean,
): string {
  if (isFreeOfCharge) return 'Diferença explicada por item FOC/desconto identificado na Invoice';
  if (status === 'match') return 'Item conforme entre os documentos disponiveis.';
  if (status === 'warning') return `${divergence}; revisar ou aceitar operacionalmente.`;
  return `${divergence}; requer correcao ou aceite.`;
}

function computeRowStatus(
  values: unknown[],
  kind: string,
  dateOpts?: { matchDays?: number; warnDays?: number },
): RowStatus {
  if (values.length === 0) return 'empty';
  // FALSO VERDE (auditoria 2026-07-17): um valor sozinho não "confere" com nada
  // — verde aqui fazia um Incoterm errado extraído só da Invoice parecer
  // validado. Estado neutro próprio, nem conforme nem divergente.
  if (values.length === 1) return 'single_source';

  if (kind === 'date') {
    return compareDates(values, dateOpts) as RowStatus;
  }

  if (kind === 'port') {
    const base = values[0];
    const allEqual = values.every((value) => normalizedPortsMatch(base, value));
    return allEqual ? 'match' : 'divergent';
  }

  if (kind === 'name') {
    // Compare normalized company names; tolerate punctuation/suffix differences.
    const norm = values.map((v) => normalizeCompanyName(v));
    const base = norm[0];
    if (!base) return 'empty';
    const allEqual = norm.every((n) => n === base);
    if (allEqual) return 'match';
    // Soft tolerance: prefix match counts as warning, not divergent
    const allPrefix = norm.every((n) => n.startsWith(base) || base.startsWith(n));
    return allPrefix ? 'warning' : 'divergent';
  }

  if (kind === 'numeric') {
    const nums = values.map((v) => parseFloat(String(v).replace(',', '.')));
    if (nums.some((n) => isNaN(n))) return 'divergent';
    const max = Math.max(...nums);
    const min = Math.min(...nums);
    const diff = max - min;
    const denom = Math.max(Math.abs(max), 1);
    if (diff < 0.5 || diff / denom < 0.005) return 'match';
    if (diff / denom < 0.02) return 'warning';
    return 'divergent';
  }

  // Default string comparison
  const norm = values.map((v) => String(v).trim().toLowerCase());
  const base = norm[0];
  if (norm.every((n) => n === base)) return 'match';
  // Numeric fallback for cases where the field happens to be numeric
  const nums = norm.map((n) => parseFloat(n));
  if (nums.every((n) => !isNaN(n))) {
    const max = Math.max(...nums);
    const min = Math.min(...nums);
    return max - min < 0.5 ? 'match' : 'divergent';
  }
  return 'divergent';
}

interface DraftBlRevision {
  field: string;
  label: string;
  draftValue: string | null;
  finalValue: string | null;
  isRevised: boolean;
}

const DRAFT_BL_COMPARE_FIELDS: { field: string; label: string }[] = [
  { field: 'blNumber', label: 'BL Number' },
  { field: 'customerReference', label: 'Order / Customer Reference' },
  { field: 'shipper', label: 'Exportador / Shipper' },
  { field: 'consignee', label: 'Importador / Consignee' },
  { field: 'notifyParty', label: 'Notify Party' },
  { field: 'vesselName', label: 'Navio' },
  { field: 'voyageNumber', label: 'Viagem' },
  { field: 'portOfLoading', label: 'Porto Embarque' },
  { field: 'portOfDischarge', label: 'Porto Destino' },
  { field: 'etd', label: 'ETD' },
  { field: 'eta', label: 'ETA' },
  { field: 'shipmentDate', label: 'Shipment Date' },
  { field: 'containerNumber', label: 'Container' },
  { field: 'sealNumber', label: 'Seal' },
  { field: 'totalBoxes', label: 'Total Caixas' },
  { field: 'totalGrossWeight', label: 'Peso Bruto (kg)' },
  { field: 'totalCbm', label: 'CBM (m³)' },
  { field: 'freightValue', label: 'Frete' },
  { field: 'freightCurrency', label: 'Moeda do Frete' },
];

function computeDraftBlRevisions(
  draft: Record<string, any>,
  final: Record<string, any>,
): DraftBlRevision[] {
  return DRAFT_BL_COMPARE_FIELDS.map(({ field, label }) => {
    const d = draft[field];
    const f = final[field];
    const isRevised = !draftBlFieldMatches(d, f);
    return {
      field,
      label,
      draftValue: d != null && d !== '' ? String(d) : null,
      finalValue: f != null && f !== '' ? String(f) : null,
      isRevised,
    };
  }).filter((r) => r.isRevised && (r.draftValue != null || r.finalValue != null));
}

function draftBlFieldMatches(a: unknown, b: unknown): boolean {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  if (a === '' && b === '') return true;
  if (a === '' || b === '') return false;

  // Numeric tolerance (0.5 absolute or 0.5% relative)
  const na = typeof a === 'number' ? a : parseFloat(String(a).replace(',', '.'));
  const nb = typeof b === 'number' ? b : parseFloat(String(b).replace(',', '.'));
  if (!isNaN(na) && !isNaN(nb)) {
    const diff = Math.abs(na - nb);
    return diff < 0.5 || diff / Math.max(Math.abs(na), Math.abs(nb), 1) < 0.005;
  }

  // Date normalization (ISO or dd/mm/yyyy or dd-mmm-yyyy)
  const da = toIsoDate(a);
  const db = toIsoDate(b);
  if (da && db) return da === db;

  // String normalization (lowercase + collapse whitespace + strip common punctuation)
  const sa = String(a)
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[.,;:()]/g, '')
    .trim();
  const sb = String(b)
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[.,;:()]/g, '')
    .trim();
  return sa === sb;
}

function toIsoDate(v: unknown): string | null {
  if (!v) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = String(v).trim();
  const iso = /^\d{4}-\d{2}-\d{2}/.exec(s);
  if (iso) return s.slice(0, 10);
  const d = new Date(s);
  if (isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}
