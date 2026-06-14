import { eq, desc, sql, and } from 'drizzle-orm';
import path from 'node:path';
import fs from 'fs/promises';
import pdfParse from 'pdf-parse';
import * as XLSX from 'xlsx';
import mammoth from 'mammoth';
import { db } from '../../shared/database/connection.js';
import {
  documents,
  documentExtractionHistory,
  importProcesses,
  followUpTracking,
  emailIngestionLogs,
} from '../../shared/database/schema.js';
import { aiService, flattenAiData, AIBudgetExceededError } from '../ai/service.js';
import { alertService } from '../alerts/service.js';
import { tryParseEspelhoBuffer } from '../espelho-parser/parser.js';
import { googleDriveService } from '../integrations/google-drive.service.js';
import { logger } from '../../shared/utils/logger.js';
import { auditService } from '../audit/service.js';
import { assertTransition } from '../../shared/state-machine/process-states.js';
import type { ProcessStatus } from '../../shared/state-machine/process-states.js';
import { NotFoundError } from '../../shared/errors/index.js';
import { recordProcessEvent } from '../../shared/utils/process-events.js';
import { normalizePort } from '../validation/utils/port-normalize.js';
import { normalizeCompanyName } from '../validation/utils/name-normalize.js';
import { extractPartyParts } from '../validation/utils/party-extract.js';
import { itemCodesMatch, cleanItemCodesInAiData } from '../validation/utils/item-code-normalize.js';
import { compareDates } from '../validation/utils/date-compare.js';
import { buildEspelhoFromAiData } from './utils/build-espelho.js';

/**
 * Convert an XLSX buffer to plain CSV-style text — used as input to the
 * Espelho AI fallback when the deterministic parser fails. Mirrors the
 * same XLSX path used by extractText() but operates directly on a buffer
 * (no filesystem hop).
 */
function extractTextFromXlsxBuffer(buffer: Buffer): string {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  let text = '';
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    text += `--- Sheet: ${sheetName} ---\n${XLSX.utils.sheet_to_csv(sheet)}\n`;
  }
  return text;
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

export const documentService = {
  async upload(
    processId: number,
    type: string,
    file: Express.Multer.File,
    userId: number | null = null,
  ) {
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
        })
        .returning();
    } catch (error) {
      // Clean up the uploaded file if DB insert fails
      await fs.unlink(file.path).catch(() => {});
      throw error;
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
    const hasBL = processDocs.some((d) => d.type === 'ohbl');

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

    // Trigger AI extraction in background
    this.processWithAI(doc.id, type).catch((err) =>
      logger.error({ err, documentId: doc.id }, 'AI processing failed'),
    );

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
    doc: { id: number; aiParsedData: unknown; confidenceScore: string | null },
    reason: 'reprocess' | 'reextract',
  ) {
    if (doc.aiParsedData == null) return;
    await db.insert(documentExtractionHistory).values({
      documentId: doc.id,
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

  async processWithAI(documentId: number, type: string) {
    const [doc] = await db.select().from(documents).where(eq(documents.id, documentId)).limit(1);
    if (!doc) return;

    // Re-extraction over an already extracted document overwrites
    // aiParsedData — archive the previous value first (audit, backlog #12).
    // In the reprocess() flow aiParsedData was already archived ('reprocess')
    // and zeroed before this call, so this is a no-op there.
    if (doc.isProcessed && doc.aiParsedData != null) {
      await this.archiveExtraction(doc, 'reextract');
    }

    // Espelho (xlsx) — deterministic parser; no AI round-trip.
    if (type === 'espelho') {
      await this.processEspelho(doc);
      return;
    }

    const extracted = await this.extractText(doc.storagePath, doc.mimeType || '');

    // Build extraction options with optional image data for multimodal processing
    const extractionOpts = extracted.imageBase64
      ? { imageBase64: extracted.imageBase64, imageMimeType: extracted.imageMimeType }
      : undefined;

    const text = extracted.text;

    let result;
    try {
      switch (type) {
        case 'invoice':
          result = await aiService.extractInvoiceData(text, extractionOpts);
          break;
        case 'proforma_invoice':
          result = await aiService.extractProformaData(text, extractionOpts);
          break;
        case 'packing_list':
          result = await aiService.extractPackingListData(text, extractionOpts);
          break;
        case 'ohbl':
          result = await aiService.extractBLData(text, extractionOpts);
          break;
        case 'draft_bl':
          result = await aiService.extractDraftBLData(text, extractionOpts);
          break;
        case 'certificate':
          result = await aiService.extractCertificateData(text, extractionOpts);
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
          await db
            .update(documents)
            .set({
              aiParsedData: {
                skipped: true,
                reason:
                  type === 'li'
                    ? 'Licença de Importação (LI) — extração automática ainda não implementada'
                    : 'Tipo de documento sem extractor dedicado — revisar manualmente',
                type,
              } as Record<string, unknown>,
              confidenceScore: '0',
              isProcessed: true,
              updatedAt: new Date(),
            })
            .where(eq(documents.id, documentId));

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
      // Extraction THREW — the AI call failed hard (monthly budget exhausted,
      // or every model in the fallback chain failed). Previously this bubbled
      // out of processWithAI and the document stayed isProcessed=false /
      // aiParsedData=null forever: the UI spinner never stopped and the
      // degradable gate (auto-validation / auto-espelho for the OTHER
      // documents) never fired. Now we mark the document as processed-with-
      // failure so the spinner stops and the doc remains reprocessable, raise
      // a CRITICAL alert, and fall through to the degradable gate so the rest
      // of the process is not held hostage by one failed extraction.
      const isBudget = extractionError instanceof AIBudgetExceededError;
      const reason = isBudget
        ? 'Orçamento mensal de IA esgotado — extração não executada'
        : extractionError instanceof Error
          ? extractionError.message
          : 'Falha desconhecida na extração de IA';

      logger.error(
        { err: extractionError, documentId, type, isBudget },
        'AI extraction failed — marking document as processed-with-failure',
      );

      await db
        .update(documents)
        .set({
          aiParsedData: {
            extractionFailed: true,
            reason,
            budgetExceeded: isBudget,
            type,
          } as Record<string, unknown>,
          confidenceScore: '0',
          isProcessed: true,
          updatedAt: new Date(),
        })
        .where(eq(documents.id, documentId));

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

    await db
      .update(documents)
      .set({
        aiParsedData: result.data,
        confidenceScore: String(result.confidenceScore),
        isProcessed: true,
        updatedAt: new Date(),
      })
      .where(eq(documents.id, documentId));

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

    // Confidence score gate: alert on low-confidence extractions.
    //
    // Backlog #7(d): the previous behaviour was an `return` whenever the score
    // dropped below 0.4. That early-return had two harmful side effects flagged
    // by Nicolas: (1) the document type was NOT re-written / kept reprocessable,
    // and (2) the WHOLE process gate (auto-validation + auto-espelho for the
    // OTHER documents) was silently aborted just because one attachment came in
    // weak. We now keep the alert, mark the document so the operator can
    // reclassify/retry, but ALWAYS fall through to the degradable gate below so
    // the remaining documents are not held hostage by one low-confidence
    // extraction. The only thing very-low confidence still suppresses is the
    // AI-name standardization for the Drive upload (we can't trust the parsed
    // date when confidence is that low).
    const veryLowConfidence = result.confidenceScore < 0.4;
    if (result.confidenceScore < 0.6) {
      const [proc] = await db
        .select({ processCode: importProcesses.processCode })
        .from(importProcesses)
        .where(eq(importProcesses.id, doc.processId))
        .limit(1);

      const severity = veryLowConfidence ? 'critical' : 'warning';
      const title = veryLowConfidence
        ? 'Extração IA com Confiança Muito Baixa'
        : 'Extração IA com Confiança Baixa';

      alertService
        .create({
          processId: doc.processId,
          severity,
          title,
          message: `Documento ${type} do processo ${proc?.processCode ?? doc.processId} teve confiança de extração de ${(result.confidenceScore * 100).toFixed(0)}%. ${
            veryLowConfidence
              ? 'Os dados extraídos NÃO são confiáveis: reclassifique/reenvie o documento ou reprocesse. A validação automática usará os demais documentos disponíveis e tratará este como ausente.'
              : 'Recomenda-se revisão manual dos dados extraídos.'
          } Campos com baixa confiança: ${result.fieldsWithLowConfidence.join(', ') || 'N/A'}.`,
          processCode: proc?.processCode,
        })
        .catch((err) => logger.error({ err }, 'Failed to create low-confidence alert'));

      // Very low confidence: skip AI-name standardization for the Drive upload
      // (parsed date/fields untrustworthy) — upload with the original name so
      // the file is still archived, then continue to the degradable gate.
      if (veryLowConfidence) {
        logger.warn(
          { documentId, type, confidence: result.confidenceScore },
          'Very low confidence — uploading with original name and continuing to degradable gate',
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
      }
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
    // When confidence is very low we already uploaded with the original name
    // above (can't trust parsed fields for standardization) — don't double-upload.
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
    // Boolean(obj) era true para um {} vazio — uma INV classificada mas com
    // extração vazia contava como "presente" e suprimia o alerta "Aguardando
    // INV" (UAT Odett #7). Exige pelo menos um campo com valor ou itens.
    const hasRelevantData = (obj: any): boolean => {
      if (!obj || typeof obj !== 'object') return false;
      if (Array.isArray(obj.items) && obj.items.length > 0) return true;
      return Object.values(obj).some(
        (f: any) => f && typeof f === 'object' && 'value' in f && f.value != null,
      );
    };
    const hasInvoice = hasRelevantData(mergedAiData.invoice);
    const hasPackingList = hasRelevantData(mergedAiData.packing_list);
    const hasBl = hasRelevantData(mergedAiData.ohbl);
    const allThree = hasInvoice && hasPackingList && hasBl;

    // Nothing core extracted yet (e.g. only a proforma/espelho/cert so far) —
    // no validation to run, and no alert to raise (the gate hasn't started).
    if (!hasInvoice && !hasPackingList && !hasBl) return;

    // Always run validation with whatever core docs are present. The checks
    // degrade on their own when an input is missing, so a partial run still
    // surfaces the divergences it CAN compute instead of going silent.
    try {
      const { validationService } = await import('../validation/service.js');
      await validationService.runAllChecks(processId);
      logger.info(
        { processId, hasInvoice, hasPackingList, hasBl, partial: !allThree },
        allThree
          ? 'Auto-validation triggered (all 3 core documents present)'
          : 'Partial auto-validation triggered (core document(s) missing)',
      );
    } catch (valErr) {
      logger.error({ err: valErr, processId }, 'Auto-validation failed');
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
   * Skips when an operator-uploaded espelho document exists OR when an
   * auto-built espelho is already present (the user can force a rebuild via
   * the regenerate endpoint — outside scope here).
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
      .select({ id: documents.id })
      .from(documents)
      .where(and(eq(documents.processId, processId), eq(documents.type, 'espelho')))
      .limit(1);
    if (espelhoDocs.length > 0) {
      // Operator uploaded a real espelho — don't override.
      return;
    }

    const inv = existingProcessAi.invoice as Record<string, any> | undefined;
    const pl = existingProcessAi.packing_list as Record<string, any> | undefined;
    const bl = existingProcessAi.ohbl as Record<string, any> | undefined;
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

    if (!parsed.ok) {
      logger.warn(
        { documentId: doc.id, processId: doc.processId, error: parsed.error },
        'Espelho parse failed — formato não reconhecido',
      );

      // AI fallback (Nicolas 2026-05-21: "religar IA do espelho"). Disabled
      // by default for privacy — only safe with a provider that keeps the data
      // private: Vertex (Google contractually does not train on Vertex data)
      // or IA_LOCAL (100% on-prem, no egress). Operator enables via
      // ESPELHO_AI_FALLBACK=1 after configuring one of those.
      //
      // HARD GUARD: the espelho carries sensitive Pre-Cons-linked data, so the
      // fallback MUST only run on a private provider. If the flag is on but the
      // provider is still OpenRouter (the default), running the fallback would
      // ship that data to a provider with no no-training guarantee — refuse and
      // warn instead of leaking.
      const espelhoFallbackEnabled = process.env.ESPELHO_AI_FALLBACK === '1';
      const aiProvider = (process.env.AI_PROVIDER || 'openrouter').toLowerCase();
      const isPrivateProvider = aiProvider === 'vertex' || aiProvider === 'ialocal';
      if (espelhoFallbackEnabled && !isPrivateProvider) {
        logger.warn(
          { documentId: doc.id, processId: doc.processId, aiProvider },
          'ESPELHO_AI_FALLBACK is enabled but AI_PROVIDER is not a private provider (vertex|ialocal) — refusing to run espelho AI fallback (sensitive Pre-Cons data must not leave the perimeter)',
        );
      }
      if (espelhoFallbackEnabled && isPrivateProvider) {
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

            await db
              .update(documents)
              .set({
                aiParsedData: { summary, items } as Record<string, unknown>,
                confidenceScore: String(result.confidenceScore.toFixed(4)),
                isProcessed: true,
                updatedAt: new Date(),
              })
              .where(eq(documents.id, doc.id));

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

      await db
        .update(documents)
        .set({
          aiParsedData: { error: parsed.error } as Record<string, unknown>,
          confidenceScore: '0',
          isProcessed: true,
          updatedAt: new Date(),
        })
        .where(eq(documents.id, doc.id));

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
          message: `O arquivo de espelho do processo ${proc?.processCode ?? doc.processId} não foi reconhecido (cabeçalho Processo/Fornecedor ausente). Revise o layout ou envie em formato compatível.`,
          processCode: proc?.processCode,
        })
        .catch((err) => logger.error({ err }, 'Failed to create espelho-parse alert'));
      return;
    }

    const { summary, items, headerRowIndex, sheetName, rawRowCount } = parsed.data;

    await db
      .update(documents)
      .set({
        aiParsedData: { summary, items, headerRowIndex, sheetName, rawRowCount } as Record<
          string,
          unknown
        >,
        confidenceScore: '0.99',
        isProcessed: true,
        updatedAt: new Date(),
      })
      .where(eq(documents.id, doc.id));

    // Same atomic JSONB merge pattern as processWithAI — see the long
    // comment there for the full rationale. Espelho extraction runs in
    // parallel with the AI extractions of the other attachments in the
    // same email, so a JS-side merge here also races.
    const espelhoPatch = { espelho: { summary, items } };

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
  },

  async extractText(
    filePath: string,
    mimeType: string,
  ): Promise<{ text: string; imageBase64?: string; imageMimeType?: string }> {
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

      // If PDF has very little text, it's likely a scanned image
      if (text.length < 50) {
        logger.info(
          { filePath, textLength: text.length },
          'PDF has minimal text, treating as scanned document for multimodal processing',
        );
        const base64 = buffer.toString('base64');
        return { text, imageBase64: base64, imageMimeType: 'application/pdf' };
      }
      return { text };
    }

    // ── Excel (XLSX/XLS) ──
    if (
      mimeType?.includes('spreadsheet') ||
      mimeType?.includes('excel') ||
      ext === '.xlsx' ||
      ext === '.xls'
    ) {
      const workbook = XLSX.read(buffer, { type: 'buffer' });
      let text = '';
      for (const sheetName of workbook.SheetNames) {
        const sheet = workbook.Sheets[sheetName];
        text += XLSX.utils.sheet_to_csv(sheet) + '\n';
      }
      return { text };
    }

    // ── Word (DOCX) ──
    if (
      mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
      ext === '.docx'
    ) {
      const result = await mammoth.extractRawText({ buffer });
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

    return rows.map((row) => ({
      id: row.id,
      processId: row.processId,
      fileName: row.originalFilename,
      documentType: row.type,
      uploadedAt: row.createdAt?.toISOString() ?? null,
      aiProcessingStatus: row.isProcessed
        ? row.aiParsedData
          ? 'completed'
          : 'failed'
        : 'processing',
      aiParsedData: row.aiParsedData,
      aiConfidence: row.confidenceScore != null ? Number(row.confidenceScore) : null,
      driveFileId: row.driveFileId,
      storagePath: row.storagePath,
      mimeType: row.mimeType,
      fileSize: row.fileSize,
    }));
  },

  async getById(id: number) {
    const [doc] = await db.select().from(documents).where(eq(documents.id, id)).limit(1);
    if (!doc) throw new NotFoundError('Documento', id);
    return doc;
  },

  async getSource(id: number) {
    const [doc] = await db.select().from(documents).where(eq(documents.id, id)).limit(1);
    if (!doc) throw new NotFoundError('Documento', id);

    // Check if this document came from email ingestion
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

    // Atomic: archive the previous extraction BEFORE zeroing it (audit,
    // backlog #12) and zero the fields in one transaction, mirroring the
    // history-snapshot + mutate pattern in validation.runAllChecks. Prevents a
    // partial state where the history insert succeeds but the zeroing fails (or
    // vice-versa), losing or duplicating the archived extraction.
    await db.transaction(async (tx) => {
      if (doc.aiParsedData != null) {
        await tx.insert(documentExtractionHistory).values({
          documentId: doc.id,
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
    });

    auditService.log(userId, 'reprocess', 'document', documentId, { type: doc.type }, null);

    await this.processWithAI(documentId, doc.type);
    return this.getById(documentId);
  },

  async delete(id: number, userId: number | null = null) {
    const [doc] = await db.select().from(documents).where(eq(documents.id, id)).limit(1);
    if (!doc) throw new NotFoundError('Documento', id);

    // Remove file from disk
    try {
      await fs.unlink(doc.storagePath);
    } catch {
      // File might already be gone
    }

    await db.delete(documents).where(eq(documents.id, id));
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
    const configured = await googleDriveService.isConfigured();
    if (!configured) return;

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

  async getComparison(processId: number) {
    const [docs, processRow] = await Promise.all([
      db.select().from(documents).where(eq(documents.processId, processId)),
      db.select().from(importProcesses).where(eq(importProcesses.id, processId)).limit(1),
    ]);

    const invoiceDoc = docs.find((d) => d.type === 'invoice');
    const plDoc = docs.find((d) => d.type === 'packing_list');
    const blDoc = docs.find((d) => d.type === 'ohbl');
    const draftBlDoc = docs.find((d) => d.type === 'draft_bl');
    const espelhoDoc = docs.find((d) => d.type === 'espelho');

    // Flatten { value, confidence } structures to plain values for comparison
    const rawInv = (invoiceDoc?.aiParsedData as Record<string, any>) ?? null;
    const rawPl = (plDoc?.aiParsedData as Record<string, any>) ?? null;
    const rawBl = (blDoc?.aiParsedData as Record<string, any>) ?? null;
    const rawDraftBl = (draftBlDoc?.aiParsedData as Record<string, any>) ?? null;

    const inv = rawInv ? flattenAiData(rawInv) : null;
    const pl = rawPl ? flattenAiData(rawPl) : null;
    const bl = rawBl ? flattenAiData(rawBl) : null;
    const draftBl = rawDraftBl ? flattenAiData(rawDraftBl) : null;

    // Espelho data lives in importProcesses.aiExtractedData.espelho (atomic merge target).
    // Fallback: read from the espelho document's aiParsedData if process column is empty.
    const processAiData = (processRow[0]?.aiExtractedData as Record<string, any>) ?? null;
    const espelhoFromProcess = processAiData?.espelho as
      | { summary?: Record<string, any>; items?: any[] }
      | undefined;
    const espelhoFromDoc = espelhoDoc?.aiParsedData as
      | { summary?: Record<string, any>; items?: any[] }
      | undefined;
    const espelhoSummary = espelhoFromProcess?.summary ?? espelhoFromDoc?.summary ?? null;
    const espelhoItems = espelhoFromProcess?.items ?? espelhoFromDoc?.items ?? [];

    // Pre-extract structured party parts from each document
    const invExporter = extractPartyParts(inv?.exporterName);
    const plExporter = extractPartyParts(pl?.exporterName);
    const blShipper = extractPartyParts(bl?.shipper ?? bl?.shipperName);
    const invImporter = extractPartyParts(inv?.importerName);
    const plImporter = extractPartyParts(pl?.importerName);
    const blConsignee = extractPartyParts(bl?.consignee ?? bl?.consigneeName);

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
    }

    const aggregateFields: AggregateRow[] = [
      {
        label: 'Exportador / Shipper',
        inv: invExporter.name || inv?.exporterName,
        pl: plExporter.name || pl?.exporterName,
        bl: blShipper.name || (bl?.shipper ?? bl?.shipperName),
        espelho: espelhoSummary?.shippingLine,
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
        bl: blConsignee.name || (bl?.consignee ?? bl?.consigneeName),
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
        bl: bl?.customerReference,
      },
      {
        label: 'BL Number (shipping)',
        inv: null,
        pl: null,
        bl: bl?.blNumber,
      },
      { label: 'Incoterm', inv: inv?.incoterm, pl: null, bl: null },
      { label: 'Moeda', inv: inv?.currency, pl: null, bl: bl?.freightCurrency },
      {
        label: 'Porto Embarque',
        inv: inv?.portOfLoading,
        pl: pl?.portOfLoading,
        bl: bl?.portOfLoading,
        kind: 'port',
      },
      {
        label: 'Porto Destino',
        inv: inv?.portOfDischarge,
        pl: pl?.portOfDischarge,
        bl: bl?.portOfDischarge,
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
        bl: bl?.freightValue,
        kind: 'numeric',
        criticality: 'info',
      },
      {
        label: 'Total Caixas',
        inv: inv?.totalBoxes,
        pl: pl?.totalBoxes,
        bl: bl?.totalBoxes,
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
        bl: bl?.totalGrossWeight,
        espelho: espelhoSummary?.totalGrossWeight,
        kind: 'numeric',
        criticality: 'secondary',
      },
      {
        label: 'CBM (m3)',
        inv: inv?.totalCbm,
        pl: pl?.totalCbm,
        bl: bl?.totalCbm,
        espelho: espelhoSummary?.totalCbm,
        kind: 'numeric',
        criticality: 'secondary',
      },
      {
        label: 'ETD / Shipped On Board',
        inv: inv?.invoiceDate ?? inv?.etd ?? inv?.shipmentDate,
        pl: pl?.packingListDate ?? (pl as any)?.date ?? pl?.shipmentDate,
        bl: bl?.shipmentDate ?? bl?.etd,
        espelho: null,
        kind: 'date',
      },
      { label: 'ETA', inv: null, pl: null, bl: bl?.eta, kind: 'date', criticality: 'info' },
      { label: 'Container', inv: null, pl: null, bl: bl?.containerNumber, criticality: 'info' },
      { label: 'Navio', inv: null, pl: null, bl: bl?.vesselName, criticality: 'info' },
    ];

    // Compute match status for each field — supports 4 docs (inv/pl/bl/espelho).
    // For 'secondary' criticality, a hard divergence is downgraded to warning
    // (per Nicolas: "endereço do exportador… talvez a gente consiga relevar").
    const aggregateComparison = aggregateFields.map((f) => {
      const rawValues = [f.inv, f.pl, f.bl, f.espelho];
      const values = rawValues.filter((v) => v != null && v !== '');
      let status = computeRowStatus(values, f.kind ?? 'string');
      const criticality: Criticality = f.criticality ?? 'critical';
      if (criticality === 'secondary' && status === 'divergent') status = 'warning';
      return {
        label: f.label,
        invoice: f.inv != null && f.inv !== '' ? String(f.inv) : null,
        packingList: f.pl != null && f.pl !== '' ? String(f.pl) : null,
        bl: f.bl != null && f.bl !== '' ? String(f.bl) : null,
        espelho: f.espelho != null && f.espelho !== '' ? String(f.espelho) : null,
        status,
        criticality,
      };
    });

    // Build item-level comparison — normalize item codes (PI7752Y vs PI 7752Y, etc.)
    const invItems = inv?.items ?? [];
    const plItems = pl?.items ?? [];

    const findPlMatch = (invItem: any) =>
      plItems.find((plItem: any) => {
        if (itemCodesMatch(plItem.itemCode ?? plItem.codigo, invItem.itemCode ?? invItem.codigo)) {
          return true;
        }
        const plDesc = plItem.description ?? plItem.descricao;
        const invDesc = invItem.description ?? invItem.descricao;
        return Boolean(
          plDesc &&
          invDesc &&
          String(plDesc).toLowerCase().includes(String(invDesc).toLowerCase().slice(0, 20)),
        );
      });

    const findEspelhoMatch = (invItem: any) =>
      espelhoItems.find((espItem: any) =>
        itemCodesMatch(espItem.codigo ?? espItem.itemCode, invItem.itemCode ?? invItem.codigo),
      );

    const itemComparison = invItems.map((invItem: any) => {
      const plMatch = findPlMatch(invItem);
      const espelhoMatch = findEspelhoMatch(invItem);

      return {
        itemCode: invItem.itemCode ?? invItem.codigo,
        description: invItem.description ?? invItem.descricao,
        ncm: invItem.ncmCode ?? invItem.ncm,
        invoiceQty: invItem.quantity,
        plQty: plMatch?.quantity ?? null,
        espelhoQty: espelhoMatch?.qty ?? null,
        invoiceUnitPrice: invItem.unitPrice,
        invoiceTotal: invItem.totalPrice,
        espelhoUnitPrice: espelhoMatch?.unitPrice ?? null,
        espelhoTotal: espelhoMatch?.amountUsd ?? null,
        invoiceBoxes: invItem.boxQuantity ?? null,
        plBoxes: plMatch?.boxQuantity ?? null,
        espelhoBoxes: espelhoMatch?.caixasPorRef ?? null,
        invoiceNetWeight: invItem.netWeight ?? null,
        plNetWeight: plMatch?.netWeight ?? null,
        espelhoNetWeight: espelhoMatch?.pesoLiquidoTotal ?? null,
        invoiceGrossWeight: invItem.grossWeight ?? null,
        plGrossWeight: plMatch?.grossWeight ?? null,
        espelhoGrossWeight: espelhoMatch?.pesoBrutoTotal ?? null,
        isFreeOfCharge: Boolean(invItem.isFreeOfCharge),
        qtyMatch: plMatch ? plMatch.quantity === invItem.quantity : null,
        matched: !!plMatch,
        espelhoMatched: !!espelhoMatch,
      };
    });

    // Find PL items not matched in invoice
    const unmatchedPlItems = plItems
      .filter(
        (plItem: any) =>
          !invItems.some((invItem: any) => {
            if (
              itemCodesMatch(plItem.itemCode ?? plItem.codigo, invItem.itemCode ?? invItem.codigo)
            ) {
              return true;
            }
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
        itemCode: item.itemCode ?? item.codigo,
        description: item.description ?? item.descricao,
        quantity: item.quantity,
        source: 'packing_list',
      }));

    // Draft BL vs Final BL ("Revisado") — only when both are present
    const draftBlRevisions = draftBl && bl ? computeDraftBlRevisions(draftBl, bl) : [];

    return {
      hasInvoice: !!inv,
      hasPackingList: !!pl,
      hasBl: !!bl,
      hasDraftBl: !!draftBl,
      hasEspelho: !!espelhoSummary || espelhoItems.length > 0,
      aggregateComparison,
      itemComparison,
      unmatchedPlItems,
      draftBlRevisions,
      invoiceConfidence: invoiceDoc?.confidenceScore,
      plConfidence: plDoc?.confidenceScore,
      blConfidence: blDoc?.confidenceScore,
      draftBlConfidence: draftBlDoc?.confidenceScore,
      espelhoConfidence: espelhoDoc?.confidenceScore ?? (espelhoSummary ? 0.99 : null),
    };
  },
};

type RowStatus = 'match' | 'warning' | 'divergent' | 'empty';

function computeRowStatus(values: unknown[], kind: string): RowStatus {
  if (values.length === 0) return 'empty';
  if (values.length === 1) return 'match';

  if (kind === 'date') {
    return compareDates(values) as RowStatus;
  }

  if (kind === 'port') {
    const norm = values.map((v) => normalizePort(v));
    const base = norm[0];
    const allEqual = norm.every((n) => n === base || n.startsWith(base) || base.startsWith(n));
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
