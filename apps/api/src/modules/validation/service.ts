import { eq, desc, getTableColumns } from 'drizzle-orm';
import { db } from '../../shared/database/connection.js';
import {
  validationResults,
  validationResultHistory,
  validationRuns,
  documents,
  importProcesses,
  followUpTracking,
  documentCorrections,
  users,
} from '../../shared/database/schema.js';
import type { ValidationResult } from '../../shared/database/schema.js';
import { allChecks } from './checks/index.js';
import type { CheckInput, CheckResult } from './checks/index.js';
import { aiService, flattenAiData } from '../ai/service.js';
import { alertService } from '../alerts/service.js';
import { logger } from '../../shared/utils/logger.js';
import { auditService } from '../audit/service.js';
import { communicationService } from '../communications/service.js';
import { kiomCorrectionTemplate } from '../communications/templates/kiom-correction.js';
import { assertTransition } from '../../shared/state-machine/process-states.js';
import type { ProcessStatus } from '../../shared/state-machine/process-states.js';
import { IntegrationError, NotFoundError } from '../../shared/errors/index.js';
import { getErrorTypesFromChecks } from './error-type-mapping.js';
import { recordProcessEvent } from '../../shared/utils/process-events.js';
import { getOperationalRecipient } from '../settings/operational-recipients.js';

type DocumentWithAiData = {
  type: string;
  aiParsedData: unknown;
  id?: number | null;
  isProcessed?: boolean | null;
  confidenceScore?: string | number | null;
  createdAt?: Date | string | null;
  updatedAt?: Date | string | null;
};

import { MIN_OPERATIONAL_CONFIDENCE } from '../documents/constants.js';
type ValidationRunMode = 'final' | 'partial';

type RunAllChecksOptions = {
  mode?: ValidationRunMode;
  triggerType?: 'manual' | 'auto_full' | 'auto_partial';
};

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExtractionFailureData(aiParsedData: unknown): boolean {
  if (!isRecord(aiParsedData)) return false;
  return Boolean(aiParsedData.extractionFailed || aiParsedData.error || aiParsedData.skipped);
}

function hasOperationalConfidence(confidenceScore: string | number | null | undefined): boolean {
  if (confidenceScore == null) return true;
  const confidence =
    typeof confidenceScore === 'number' ? confidenceScore : Number.parseFloat(confidenceScore);
  return Number.isFinite(confidence) && confidence >= MIN_OPERATIONAL_CONFIDENCE;
}

function hasMeaningfulAiData(value: unknown): boolean {
  if (value == null) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value === 'boolean') return value === true;
  if (Array.isArray(value)) return value.some((item) => hasMeaningfulAiData(item));
  if (!isRecord(value)) return false;

  if ('value' in value) {
    return hasMeaningfulAiData(value.value);
  }

  return Object.entries(value).some(([key, nested]) => {
    if (AI_META_KEYS.has(key)) return false;
    return hasMeaningfulAiData(nested);
  });
}

function documentTime(value: Date | string | null | undefined): number {
  if (!value) return 0;
  if (value instanceof Date) return value.getTime();
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
}

function sortNewestFirst<T extends DocumentWithAiData>(docs: T[]): T[] {
  return [...docs].sort((a, b) => {
    const aTime = Math.max(documentTime(a.updatedAt), documentTime(a.createdAt));
    const bTime = Math.max(documentTime(b.updatedAt), documentTime(b.createdAt));
    if (bTime !== aTime) return bTime - aTime;
    return (b.id ?? 0) - (a.id ?? 0);
  });
}

function isUsableValidationDocument(doc: DocumentWithAiData): boolean {
  return (
    doc.isProcessed !== false &&
    doc.aiParsedData != null &&
    hasMeaningfulAiData(doc.aiParsedData) &&
    hasOperationalConfidence(doc.confidenceScore) &&
    !hasExtractionFailureData(doc.aiParsedData)
  );
}

function selectValidationDoc<T extends DocumentWithAiData>(docs: T[], type: string): T | undefined {
  return sortNewestFirst(docs)
    .filter((d) => d.type === type)
    .find(isUsableValidationDocument);
}

function findValidationBlDocument<T extends DocumentWithAiData>(docs: T[]): T | undefined {
  return selectValidationDoc(docs, 'ohbl') ?? selectValidationDoc(docs, 'draft_bl');
}

function buildDocumentSetCompletenessResult(input: {
  invoiceDoc?: DocumentWithAiData;
  packingListDoc?: DocumentWithAiData;
  blDoc?: DocumentWithAiData;
  mode: ValidationRunMode;
}): CheckResult {
  const missing: string[] = [];
  if (!input.invoiceDoc) missing.push('Invoice utilizavel');
  if (!input.packingListDoc) missing.push('Packing List utilizavel');
  if (!input.blDoc) missing.push('OHBL ou Draft BL utilizavel');

  if (missing.length === 0) {
    return {
      checkName: 'document-set-completeness',
      status: 'passed',
      expectedValue: 'Invoice + Packing List + BL utilizaveis',
      actualValue: 'Conjunto documental completo',
      documentsCompared: 'Sistema',
      message: 'Conjunto documental minimo disponivel para validacao completa.',
    };
  }

  const message =
    `Validacao ${input.mode === 'partial' ? 'parcial' : 'final'} sem conjunto documental completo: ` +
    `${missing.join(', ')}. Documento utilizavel exige extracao concluida, dados uteis e confianca operacional >= ${(MIN_OPERATIONAL_CONFIDENCE * 100).toFixed(0)}%.`;

  return {
    checkName: 'document-set-completeness',
    status: input.mode === 'partial' ? 'warning' : 'failed',
    expectedValue: 'Invoice + Packing List + BL utilizaveis',
    actualValue: missing.join(', '),
    documentsCompared: 'Sistema',
    message,
  };
}

/**
 * True when the process carries at least one SYSTEM (Sydle/FUP) reference value
 * that the system_vs_document checks compare extracted documents against. Used
 * by getReport so the "Documentos vs Sistema" panel can show an explicit
 * "sem dados do sistema" state instead of appearing silently empty.
 */
function hasSystemReferenceData(process: Record<string, unknown>): boolean {
  const SYSTEM_REFERENCE_FIELDS = [
    'totalFobValue',
    'freightValue',
    'totalCbm',
    'totalNetWeight',
    'totalGrossWeight',
    'totalBoxes',
    'containerType',
    'purchaseRef',
    'paymentTerms',
  ];
  return SYSTEM_REFERENCE_FIELDS.some((field) => {
    const value = process[field];
    if (value == null) return false;
    if (typeof value === 'string') return value.trim().length > 0;
    if (typeof value === 'number') return Number.isFinite(value);
    if (typeof value === 'object') return Object.keys(value).length > 0;
    return true;
  });
}

export const validationService = {
  async runAllChecks(
    processId: number,
    userId: number | null = null,
    options: RunAllChecksOptions = {},
  ): Promise<CheckResult[]> {
    if (!processId || isNaN(processId)) {
      throw new Error('ID do processo invalido');
    }

    const mode: ValidationRunMode = options.mode ?? 'final';
    const triggerType = options.triggerType ?? (mode === 'partial' ? 'auto_partial' : 'manual');
    const startedAt = Date.now();

    logger.info({ processId, mode, triggerType }, 'Starting validation checks');

    // 1. Verify process exists
    const [process] = await db
      .select()
      .from(importProcesses)
      .where(eq(importProcesses.id, processId));

    if (!process) {
      throw new NotFoundError('Processo', processId);
    }

    // 2. Get all documents for the process with aiParsedData
    const docs = await db.select().from(documents).where(eq(documents.processId, processId));

    const invoiceDoc = selectValidationDoc(docs, 'invoice');
    const packingListDoc = selectValidationDoc(docs, 'packing_list');
    const blDoc = findValidationBlDocument(docs);
    const documentSetResult = buildDocumentSetCompletenessResult({
      invoiceDoc,
      packingListDoc,
      blDoc,
      mode,
    });

    // Get follow-up data
    const [followUp] = await db
      .select()
      .from(followUpTracking)
      .where(eq(followUpTracking.processId, processId));

    // 3. Build CheckInput from document data + process data from DB
    // Flatten { value, confidence } structures to plain values for validation checks
    const rawInv = (invoiceDoc?.aiParsedData as Record<string, any>) ?? undefined;
    const rawPl = (packingListDoc?.aiParsedData as Record<string, any>) ?? undefined;
    const rawBl = (blDoc?.aiParsedData as Record<string, any>) ?? undefined;

    const checkInput: CheckInput = {
      invoiceData: rawInv ? flattenAiData(rawInv) : undefined,
      packingListData: rawPl ? flattenAiData(rawPl) : undefined,
      blData: rawBl ? flattenAiData(rawBl) : undefined,
      processData: { ...process },
      followUpData: followUp ? { ...followUp } : undefined,
    };

    // 4. Final validations own the process state machine. Partial validations
    // are diagnostic only: they must not promote status, open correction flows,
    // move Drive folders, or overwrite live final results.
    const originStatus = process.status as ProcessStatus;
    if (mode === 'final') {
      // Capture the originating status so we can roll back if the run fails
      // mid-flight — otherwise the process would stay stuck in 'validating'.
      assertTransition(originStatus, 'validating');
      await db
        .update(importProcesses)
        .set({ status: 'validating', updatedAt: new Date() })
        .where(eq(importProcesses.id, processId));
    }

    let results: CheckResult[];
    let validationRunId: number | null = null;
    let failedCheckNames: string[] = [];
    let errorTypes: ReturnType<typeof getErrorTypesFromChecks> = [];
    try {
      // 5. Run all checks (supports async checks like Odoo)
      const checkResults = await Promise.all(allChecks.map((check) => check(checkInput)));
      results = [documentSetResult, ...checkResults];

      logger.info(
        {
          processId,
          mode,
          total: results.length,
          passed: results.filter((r) => r.status === 'passed').length,
          failed: results.filter((r) => r.status === 'failed').length,
          warnings: results.filter((r) => r.status === 'warning').length,
          skipped: results.filter((r) => r.status === 'skipped').length,
        },
        'Validation checks completed',
      );

      const passedCount = results.filter((r) => r.status === 'passed').length;
      const failedCount = results.filter((r) => r.status === 'failed').length;
      const warningCount = results.filter((r) => r.status === 'warning').length;
      const duration = Date.now() - startedAt;
      failedCheckNames = results.filter((r) => r.status === 'failed').map((r) => r.checkName);
      errorTypes = getErrorTypesFromChecks(failedCheckNames);

      if (mode === 'partial') {
        // Diagnostic runs must be reproducible after the HTTP response is gone.
        // Keep the current final projection untouched, but persist every check
        // as an immutable history row linked to the aggregate validation run.
        // The run and its evidence are atomic so an interrupted batch cannot
        // leave an aggregate without the corresponding field/check details.
        await db.transaction(async (tx) => {
          try {
            const [run] = await tx
              .insert(validationRuns)
              .values({
                processId,
                triggeredBy: userId,
                triggerType,
                totalChecks: results.length,
                passedChecks: passedCount,
                failedChecks: failedCount,
                warningChecks: warningCount,
                duration,
              })
              .returning({ id: validationRuns.id });
            validationRunId = run?.id ?? null;
          } catch (runErr) {
            logger.error({ err: runErr, processId, mode }, 'Failed to record validation run');
            throw runErr;
          }

          if (!validationRunId) {
            throw new Error('Falha ao registrar validation_runs para a validacao');
          }

          const runAt = new Date();
          await tx.insert(validationResultHistory).values(
            results.map((result) => ({
              processId,
              validationRunId,
              runAt,
              checkName: result.checkName,
              status: result.status,
              message: result.message,
              details: {
                expectedValue: result.expectedValue ?? null,
                actualValue: result.actualValue ?? null,
                documentsCompared: result.documentsCompared ?? null,
                dataSource: result.documentsCompared.includes('Sistema')
                  ? 'system_vs_document'
                  : 'cross_document',
                mode,
                triggerType,
              },
              resolvedManually: false,
            })),
          );
        });

        if (!validationRunId) {
          throw new Error('Falha ao registrar validation_runs para a validacao');
        }

        logger.info(
          { processId, validationRunId, total: results.length },
          'Partial validation completed without final side effects',
        );
      } else {
        // 6. Atomic: create canonical run, snapshot previous results, replace
        // live results and refresh correction summary in one transaction. This
        // prevents orphan validation_runs or lost document_corrections when a
        // final validation fails mid-persistence.
        await db.transaction(async (tx) => {
          try {
            const [run] = await tx
              .insert(validationRuns)
              .values({
                processId,
                triggeredBy: userId,
                triggerType,
                totalChecks: results.length,
                passedChecks: passedCount,
                failedChecks: failedCount,
                warningChecks: warningCount,
                duration,
              })
              .returning({ id: validationRuns.id });
            validationRunId = run?.id ?? null;
          } catch (runErr) {
            logger.error({ err: runErr, processId, mode }, 'Failed to record validation run');
            throw runErr;
          }

          if (!validationRunId) {
            throw new Error('Falha ao registrar validation_runs para a validacao');
          }

          const previousRaw = await tx
            .select()
            .from(validationResults)
            .where(eq(validationResults.processId, processId));
          const previous: ValidationResult[] = Array.isArray(previousRaw) ? previousRaw : [];

          if (previous.length > 0) {
            const now = new Date();
            await tx.insert(validationResultHistory).values(
              previous.map((r) => ({
                processId,
                validationRunId: r.validationRunId ?? null,
                // run_at = moment the previous run was recorded, when available.
                runAt: r.createdAt ?? now,
                checkName: r.checkName,
                status: r.status as string,
                message: r.message,
                details: {
                  expectedValue: r.expectedValue ?? null,
                  actualValue: r.actualValue ?? null,
                  documentsCompared: r.documentsCompared ?? null,
                  dataSource: r.dataSource ?? null,
                  resolvedBy: r.resolvedBy ?? null,
                  resolvedAt: r.resolvedAt ? new Date(r.resolvedAt).toISOString() : null,
                },
                resolvedManually: r.resolvedManually ?? false,
                resolutionNote: r.resolutionNote ?? null,
              })),
            );
          }

          await tx.delete(validationResults).where(eq(validationResults.processId, processId));

          await tx.insert(validationResults).values(
            results.map((r) => ({
              processId,
              validationRunId,
              checkName: r.checkName,
              status: r.status as 'passed' | 'failed' | 'warning' | 'skipped',
              expectedValue: r.expectedValue ?? null,
              actualValue: r.actualValue ?? null,
              documentsCompared: r.documentsCompared,
              message: r.message,
              dataSource: r.documentsCompared.includes('Sistema')
                ? 'system_vs_document'
                : 'cross_document',
            })),
          );

          await tx.delete(documentCorrections).where(eq(documentCorrections.processId, processId));

          await tx.insert(documentCorrections).values({
            processId,
            validationRunId,
            correctionNeeded: failedCheckNames.length > 0,
            errorCount: failedCheckNames.length,
            errorTypes,
            correctionRequestedAt: failedCheckNames.length > 0 ? new Date() : null,
          });
        });

        logger.info(
          {
            processId,
            validationRunId,
            correctionNeeded: failedCheckNames.length > 0,
            errorCount: failedCheckNames.length,
            errorTypes,
          },
          'Validation results and correction summary persisted atomically',
        );

        // Upload validation report to Drive Sistema Automatico
        this.uploadValidationReportToDrive(process.processCode, results).catch((err) =>
          logger.error({ err, processId }, 'Failed to upload validation report to Drive'),
        );

        // 7. Update process status based on results + correction status
        const hasFailed = results.some((r) => r.status === 'failed');
        if (!hasFailed) {
          // If was pending correction, clear it and move back from correction folder
          if (process.correctionStatus === 'pending_correction') {
            assertTransition('validating' as ProcessStatus, 'validated');
            await db
              .update(importProcesses)
              .set({ status: 'validated', correctionStatus: null, updatedAt: new Date() })
              .where(eq(importProcesses.id, processId));

            try {
              const { googleDriveService } =
                await import('../integrations/google-drive.service.js');
              await googleDriveService.moveFromCorrection(process.processCode, process.brand);
            } catch (err) {
              logger.error({ err, processId }, 'Failed to move from correction folder');
            }
          } else {
            assertTransition('validating' as ProcessStatus, 'validated');
            await db
              .update(importProcesses)
              .set({ status: 'validated', updatedAt: new Date() })
              .where(eq(importProcesses.id, processId));
          }

          // Update pre-inspection milestone in DB
          await db
            .update(followUpTracking)
            .set({ preInspectionAt: new Date(), updatedAt: new Date() })
            .where(eq(followUpTracking.processId, processId));
        } else {
          // Mark as pending correction and move to correction folder
          await db
            .update(importProcesses)
            .set({ correctionStatus: 'pending_correction', updatedAt: new Date() })
            .where(eq(importProcesses.id, processId));

          try {
            const { googleDriveService } = await import('../integrations/google-drive.service.js');
            await googleDriveService.moveToCorrection(process.processCode, process.brand);
          } catch (err) {
            logger.error({ err, processId }, 'Failed to move to correction folder');
          }
        }
      }
    } catch (err) {
      // The run failed mid-flight after we moved the process into
      // 'validating'. Roll the status back to where it came from so the
      // process is not left stuck in 'validating' (which previously required
      // a manual exit). Re-running validation is idempotent, but we still
      // restore the originating state for correctness. Re-throw afterwards so
      // the caller surfaces the original failure.
      try {
        const [current] = await db
          .select()
          .from(importProcesses)
          .where(eq(importProcesses.id, processId));
        if (mode === 'final' && current && current.status === 'validating') {
          await db
            .update(importProcesses)
            .set({ status: originStatus, updatedAt: new Date() })
            .where(eq(importProcesses.id, processId));
          logger.warn(
            { processId, from: 'validating', to: originStatus, err },
            'Validation run failed; reverted process status',
          );
        }
      } catch (revertErr) {
        logger.error(
          { err: revertErr, processId },
          'Failed to revert process status after validation error',
        );
      }
      throw err;
    }

    await auditService.log(
      userId,
      'validation_run',
      'process',
      processId,
      {
        mode,
        triggerType,
        validationRunId,
        total: results.length,
        passed: results.filter((r) => r.status === 'passed').length,
        failed: results.filter((r) => r.status === 'failed').length,
      },
      null,
    );

    // Record timeline events for validation
    const passed = results.filter((r) => r.status === 'passed').length;
    const failed = results.filter((r) => r.status === 'failed').length;
    const warnings = results.filter((r) => r.status === 'warning').length;
    const skipped = results.filter((r) => r.status === 'skipped').length;

    await recordProcessEvent(
      processId,
      {
        eventType: 'validation_run',
        title:
          mode === 'partial'
            ? `Validacao parcial executada: ${passed}/${results.length} aprovadas`
            : `Validacao executada: ${passed}/${results.length} aprovadas`,
        metadata: {
          mode,
          triggerType,
          validationRunId,
          passed,
          failed,
          warnings,
          skipped,
          total: results.length,
        },
      },
      userId,
    );

    if (mode === 'final' && failed > 0) {
      await recordProcessEvent(
        processId,
        {
          eventType: 'correction_needed',
          title: `Correcao necessaria: ${failed} erros`,
          metadata: { errorCount: failed, errorTypes },
        },
        userId,
      );
    }

    // 8. Create alert with severity based on failure count
    const failedChecks = results.filter((r) => r.status === 'failed');
    if (mode === 'final' && failedChecks.length > 0) {
      const severity: 'warning' | 'critical' = failedChecks.length > 3 ? 'critical' : 'warning';
      const criticalItems = failedChecks.filter((c) =>
        ['fob-value-match', 'total-value-match', 'net-weight-match', 'gross-weight-match'].includes(
          c.checkName,
        ),
      );

      await alertService.create({
        processId,
        severity,
        title: `Falhas na Validacao${severity === 'critical' ? ' (Critico)' : ''}`,
        message: `Processo ${process.processCode ?? processId}: ${failedChecks.length} verificacao(oes) falharam: ${failedChecks.map((c) => c.checkName).join(', ')}.${criticalItems.length > 0 ? ` Itens criticos: ${criticalItems.map((c) => c.checkName).join(', ')}.` : ''}`,
        processCode: process.processCode,
      });

      // Auto-draft correction email for KIOM (only for cross-document failures, not system checks)
      const nonKiomChecks = [
        'ports-match',
        'freight-value-match',
        'invoice-value-vs-fup',
        'freight-vs-fup',
        'cbm-vs-fup',
        'container-type-vs-fup',
        'document-set-completeness',
      ];
      const invPlFailedChecks = failedChecks.filter((c) => !nonKiomChecks.includes(c.checkName));

      if (invPlFailedChecks.length > 0) {
        try {
          const { subject, body } = kiomCorrectionTemplate({
            processCode: process.processCode ?? String(processId),
            brand: process.brand,
            failedChecks: invPlFailedChecks.map((c) => ({
              checkName: c.checkName,
              expectedValue: c.expectedValue,
              actualValue: c.actualValue,
              message: c.message,
            })),
          });

          await communicationService.create({
            processId,
            recipient: 'KIOM',
            recipientEmail: await getOperationalRecipient('kiom_email'),
            subject,
            body,
          });
          logger.info(
            { processId, failedCount: invPlFailedChecks.length },
            'KIOM correction email drafted',
          );
        } catch (emailErr) {
          logger.error({ err: emailErr, processId }, 'Failed to draft KIOM correction email');
        }
      }

      // Send validation failure summary to Google Chat
      this.notifyGoogleChat(process.processCode ?? String(processId), failedChecks, severity).catch(
        (err) =>
          logger.error({ err, processId }, 'Failed to send validation summary to Google Chat'),
      );
    }

    return results;
  },

  async getCorrections(processId: number) {
    const [correction] = await db
      .select()
      .from(documentCorrections)
      .where(eq(documentCorrections.processId, processId))
      .limit(1);
    return correction ?? null;
  },

  async updateCorrection(
    processId: number,
    data: {
      correctionReceivedAt?: Date | null;
      notes?: string | null;
    },
  ) {
    const [updated] = await db
      .update(documentCorrections)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(documentCorrections.processId, processId))
      .returning();
    return updated;
  },

  async getResults(processId: number) {
    // Resolve the accepting user's name so the checklist can show "Aceito por
    // <Nome>" instead of the raw user id (Eduarda 2026-06-19: "Incluir o nome da
    // pessoa no log quando esta clica em feito").
    return db
      .select({ ...getTableColumns(validationResults), resolvedByName: users.name })
      .from(validationResults)
      .leftJoin(users, eq(validationResults.resolvedBy, users.id))
      .where(eq(validationResults.processId, processId));
  },

  /**
   * Historical validation runs for a process (append-only snapshots taken
   * before each delete+recreate). Rows are grouped by validation_run_id when
   * available and fall back to run_at for legacy rows; pagination is applied
   * over runs (newest first).
   */
  async getValidationHistory(processId: number, page = 1, pageSize = 10) {
    const safePage = Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
    const safePageSize =
      Number.isFinite(pageSize) && pageSize > 0 ? Math.min(Math.floor(pageSize), 50) : 10;

    const rows = await db
      .select()
      .from(validationResultHistory)
      .where(eq(validationResultHistory.processId, processId))
      .orderBy(desc(validationResultHistory.runAt), validationResultHistory.checkName);

    // Prefer canonical validation_run_id. Legacy rows without a run id keep the
    // previous run_at grouping to avoid losing historical compatibility.
    const runMap = new Map<string, typeof rows>();
    for (const row of rows) {
      const key =
        row.validationRunId != null
          ? `run:${row.validationRunId}`
          : `time:${row.runAt ? new Date(row.runAt).toISOString() : 'unknown'}`;
      const group = runMap.get(key);
      if (group) {
        group.push(row);
      } else {
        runMap.set(key, [row]);
      }
    }

    const allRuns = Array.from(runMap.values()).map((results) => ({
      validationRunId: results[0]?.validationRunId ?? null,
      runAt: results[0]?.runAt ? new Date(results[0].runAt).toISOString() : 'unknown',
      total: results.length,
      passed: results.filter((r) => r.status === 'passed').length,
      failed: results.filter((r) => r.status === 'failed').length,
      warnings: results.filter((r) => r.status === 'warning').length,
      skipped: results.filter((r) => r.status === 'skipped').length,
      results,
    }));

    const start = (safePage - 1) * safePageSize;
    return {
      page: safePage,
      pageSize: safePageSize,
      totalRuns: allRuns.length,
      runs: allRuns.slice(start, start + safePageSize),
    };
  },

  async resolveManually(resultId: number, userId: number, resolutionNote: string) {
    const note = (resolutionNote ?? '').trim();
    if (!note) {
      throw new Error('Justificativa (resolutionNote) e obrigatoria');
    }

    // Load the current row so we can snapshot the divergent value at the moment
    // of resolution and recompute the aggregate status afterwards.
    const [current] = await db
      .select()
      .from(validationResults)
      .where(eq(validationResults.id, resultId))
      .limit(1);

    if (!current) {
      throw new NotFoundError('Resultado de validação', resultId);
    }
    if (current.checkName === 'document-set-completeness') {
      throw new Error(
        'Completude documental nao pode ser resolvida manualmente; envie/reprocesse os documentos obrigatorios.',
      );
    }

    const [updated] = await db
      .update(validationResults)
      .set({
        resolvedManually: true,
        resolvedBy: userId,
        resolvedAt: new Date(),
        resolutionNote: note,
        updatedAt: new Date(),
      })
      .where(eq(validationResults.id, resultId))
      .returning();

    if (!updated) {
      throw new NotFoundError('Resultado de validação', resultId);
    }

    await auditService.log(
      userId,
      'manual_resolution',
      'validation',
      resultId,
      {
        processId: current.processId,
        checkName: current.checkName,
        previousStatus: current.status,
        divergentValue: current.actualValue ?? null,
        expectedValue: current.expectedValue ?? null,
        resolutionNote: note,
      },
      null,
    );
    logger.info(
      { resultId, userId, processId: current.processId, checkName: current.checkName },
      'Validation result resolved manually',
    );

    // Recompute aggregate status: if every failed check for this process is now
    // resolved manually, promote the process out of pending_correction.
    await this.recomputeProcessStatus(current.processId, userId);

    return updated;
  },

  /**
   * Recomputes whether a process still has unresolved failures. When all
   * 'failed' checks are resolvedManually, clears pending_correction and
   * promotes the process to 'validated' (and moves it out of the correction
   * folder, mirroring runAllChecks). Skipped/warning never block promotion.
   */
  async recomputeProcessStatus(processId: number, userId: number | null = null) {
    const results = await db
      .select()
      .from(validationResults)
      .where(eq(validationResults.processId, processId));

    const failed = results.filter((r) => r.status === 'failed');
    const unresolvedFailed = failed.filter((r) => !r.resolvedManually);
    const documentSet = results.find((r) => r.checkName === 'document-set-completeness');

    // Nothing failed, or still has unresolved failures → no promotion.
    if (
      failed.length === 0 ||
      unresolvedFailed.length > 0 ||
      (documentSet && documentSet.status !== 'passed')
    ) {
      return;
    }

    const [process] = await db
      .select()
      .from(importProcesses)
      .where(eq(importProcesses.id, processId));

    if (!process) return;

    // Only promote if the process is still in a pre-validated state.
    if (process.status !== 'validating') {
      return;
    }

    try {
      assertTransition(process.status as ProcessStatus, 'validated');
    } catch {
      logger.warn(
        { processId, from: process.status },
        'Cannot transition to validated after manual resolution',
      );
      return;
    }

    await db
      .update(importProcesses)
      .set({ status: 'validated', correctionStatus: null, updatedAt: new Date() })
      .where(eq(importProcesses.id, processId));

    if (process.correctionStatus === 'pending_correction') {
      try {
        const { googleDriveService } = await import('../integrations/google-drive.service.js');
        await googleDriveService.moveFromCorrection(process.processCode, process.brand);
      } catch (err) {
        logger.error(
          { err, processId },
          'Failed to move from correction folder after manual resolution',
        );
      }
    }

    await recordProcessEvent(
      processId,
      {
        eventType: 'validation_run',
        title: 'Processo validado: todas as falhas resolvidas manualmente',
        metadata: { resolvedManually: failed.length },
      },
      userId,
    );

    logger.info(
      { processId, resolvedFailed: failed.length },
      'Process promoted to validated after manual resolution of all failures',
    );
  },

  async runAnomalyDetection(processId: number) {
    const docs = await db.select().from(documents).where(eq(documents.processId, processId));

    const invoiceDoc = selectValidationDoc(docs, 'invoice');
    const packingListDoc = selectValidationDoc(docs, 'packing_list');
    const blDoc = findValidationBlDocument(docs);

    const rawInvAnomaly = (invoiceDoc?.aiParsedData as Record<string, any>) ?? {};
    const rawPlAnomaly = (packingListDoc?.aiParsedData as Record<string, any>) ?? {};
    const rawBlAnomaly = (blDoc?.aiParsedData as Record<string, any>) ?? {};

    // Flatten for anomaly detection (AI compares plain values)
    const invoiceData = Object.keys(rawInvAnomaly).length > 0 ? flattenAiData(rawInvAnomaly) : {};
    const packingListData = Object.keys(rawPlAnomaly).length > 0 ? flattenAiData(rawPlAnomaly) : {};
    const blData = Object.keys(rawBlAnomaly).length > 0 ? flattenAiData(rawBlAnomaly) : {};

    logger.info({ processId }, 'Running AI anomaly detection');

    let result: { anomalies: Array<{ field: string; description: string; severity: string }> };
    try {
      result = await aiService.detectAnomalies(invoiceData, packingListData, blData);
    } catch (err) {
      logger.warn(
        {
          processId,
          errorName: err instanceof Error ? err.name : typeof err,
        },
        'AI anomaly detection unavailable',
      );
      throw new IntegrationError(
        'IA',
        'deteccao de anomalias indisponivel; verifique o provider configurado e tente novamente',
      );
    }

    logger.info(
      { processId, anomalyCount: result.anomalies.length },
      'AI anomaly detection completed',
    );

    // Reconcile item-presence anomalies against the DETERMINISTIC document
    // comparison so the anomaly stream and the comparison panel ("Itens no
    // Packing List sem correspondencia na Invoice") never contradict each
    // other. The AI/fuzzy matcher over-reports unmatched items; the
    // deterministic unmatchedPlItems set is the single source of truth.
    const reconciled = await this.reconcileItemAnomalies(processId, result.anomalies);

    return { anomalies: reconciled };
  },

  /**
   * Replaces every AI-emitted item-presence anomaly ("Item X nao localizado no
   * Packing List") with deterministic anomalies whose counts come from
   * documentService.getComparison(): unmatchedPlItems (PL items absent from the
   * Invoice) AND unmatchedInvoiceItems (Invoice items absent from the PL).
   *
   * BOTH directions are re-emitted (one clearly-labeled anomaly per non-empty
   * direction) so the anomaly stream and the comparison panels agree in both
   * directions instead of collapsing into a single PL→INV count. Quantity-
   * divergence and non-item anomalies are passed through untouched. If the
   * deterministic comparison reports zero unmatched items in both directions,
   * the item-presence anomalies are dropped entirely (false positives from
   * fuzzy matching).
   */
  async reconcileItemAnomalies(
    processId: number,
    anomalies: Array<{ field: string; description: string; severity: string }>,
  ): Promise<Array<{ field: string; description: string; severity: string }>> {
    const { isItemPresenceAnomaly, ITEM_MATCH_ANOMALY_FIELD, ITEM_MATCH_ANOMALY_FIELD_INVOICE } =
      await import('../ai/prompts/anomaly.js');

    // Detect item-presence anomalies by field AND description: the model often
    // labels them with free-form fields ("itens", "consistencia_numerica")
    // instead of the "items." prefix, which previously let the fuzzy "7 itens"
    // bypass reconciliation and contradict the deterministic panel's "1".
    const itemPresenceAnomalies = anomalies.filter((a) => isItemPresenceAnomaly(a));
    const passthrough = anomalies.filter((a) => !isItemPresenceAnomaly(a));

    let unmatchedPlCount = 0;
    let unmatchedInvoiceCount = 0;
    try {
      const { documentService } = await import('../documents/service.js');
      const comparison = await documentService.getComparison(processId);
      unmatchedPlCount = Array.isArray(comparison?.unmatchedPlItems)
        ? comparison.unmatchedPlItems.length
        : 0;
      unmatchedInvoiceCount = Array.isArray(comparison?.unmatchedInvoiceItems)
        ? comparison.unmatchedInvoiceItems.length
        : 0;
    } catch (err) {
      // If the deterministic comparison is unavailable, do not invent or trust
      // the fuzzy AI count — fall back to passing the AI anomalies through.
      logger.warn(
        { processId, err: err instanceof Error ? err.message : err },
        'Could not load deterministic comparison to reconcile item anomalies; keeping AI anomalies',
      );
      return anomalies;
    }

    // Deterministic comparison says everything matches in BOTH directions → the
    // AI item-presence anomalies were false positives. Drop them.
    if (unmatchedPlCount <= 0 && unmatchedInvoiceCount <= 0) {
      logger.info(
        { processId, suppressed: itemPresenceAnomalies.length },
        'Suppressed AI item-presence anomalies: deterministic comparison found no unmatched items',
      );
      return passthrough;
    }

    // Re-emit one deterministic anomaly PER non-empty direction.
    logger.info(
      {
        processId,
        aiReported: itemPresenceAnomalies.length,
        unmatchedPl: unmatchedPlCount,
        unmatchedInvoice: unmatchedInvoiceCount,
      },
      'Reconciled item-presence anomalies with deterministic unmatched counts (bidirectional)',
    );

    const reconciled = [...passthrough];
    if (unmatchedPlCount > 0) {
      reconciled.push({
        field: ITEM_MATCH_ANOMALY_FIELD,
        description: `${unmatchedPlCount} ${
          unmatchedPlCount === 1 ? 'item' : 'itens'
        } no Packing List sem correspondencia na Invoice (comparacao deterministica).`,
        severity: 'medium',
      });
    }
    if (unmatchedInvoiceCount > 0) {
      reconciled.push({
        field: ITEM_MATCH_ANOMALY_FIELD_INVOICE,
        description: `${unmatchedInvoiceCount} ${
          unmatchedInvoiceCount === 1 ? 'item' : 'itens'
        } na Invoice sem correspondencia no Packing List (comparacao deterministica).`,
        severity: 'medium',
      });
    }
    return reconciled;
  },

  async uploadValidationReportToDrive(processCode: string, results: CheckResult[]): Promise<void> {
    try {
      const { googleDriveService } = await import('../integrations/google-drive.service.js');
      const configured = await googleDriveService.isRootConfigured();
      if (!configured) return;

      const report = {
        processCode,
        generatedAt: new Date().toISOString(),
        summary: {
          total: results.length,
          passed: results.filter((r) => r.status === 'passed').length,
          failed: results.filter((r) => r.status === 'failed').length,
          warnings: results.filter((r) => r.status === 'warning').length,
          skipped: results.filter((r) => r.status === 'skipped').length,
        },
        crossDocumentChecks: results.filter((r) => !r.documentsCompared.includes('Sistema')),
        systemChecks: results.filter((r) => r.documentsCompared.includes('Sistema')),
      };

      await googleDriveService.uploadValidationReport(processCode, report);

      const failedChecks = results.filter((r) => r.status === 'failed');
      if (failedChecks.length > 0) {
        const alertContent = JSON.stringify(
          {
            processCode,
            generatedAt: new Date().toISOString(),
            failedChecks: failedChecks.map((c) => ({
              checkName: c.checkName,
              expected: c.expectedValue,
              actual: c.actualValue,
              message: c.message,
            })),
          },
          null,
          2,
        );
        const alertFileName = `alerta_${processCode}_${new Date().toISOString().slice(0, 10)}.json`;
        await googleDriveService.uploadToAlertas(alertFileName, alertContent);
      }
    } catch (err) {
      logger.error({ err, processCode }, 'Failed to upload validation report to Drive');
    }
  },

  async getReport(processId: number) {
    const [process] = await db
      .select()
      .from(importProcesses)
      .where(eq(importProcesses.id, processId));

    if (!process) throw new NotFoundError('Processo', processId);

    const results = await this.getResults(processId);

    // Whether the process carries any SYSTEM (Sydle/FUP) reference values to
    // compare extracted documents against. When false, the "Documentos vs
    // Sistema" panel must show an explicit "sem dados do sistema" state rather
    // than appearing silently empty. These are exactly the fields the
    // *-vs-fup / system checks read from processData.
    const systemDataAvailable = hasSystemReferenceData(process);

    // Bucket each result by data source. dataSource is persisted at write time
    // (documentsCompared.includes('Sistema') => system_vs_document) but legacy
    // rows may have it null — recompute the bucket from documentsCompared as a
    // fallback so the system panel is never silently empty for older runs.
    const isSystemResult = (r: (typeof results)[number]) =>
      r.dataSource === 'system_vs_document' ||
      (r.dataSource == null && (r.documentsCompared ?? '').includes('Sistema'));

    const systemChecks = results.filter(isSystemResult);
    const crossDocumentChecks = results.filter((r) => !isSystemResult(r));

    return {
      processCode: process.processCode,
      brand: process.brand,
      status: process.status,
      generatedAt: new Date().toISOString(),
      processData: {
        totalFobValue: process.totalFobValue,
        freightValue: process.freightValue,
        totalCbm: process.totalCbm,
        containerType: process.containerType,
      },
      systemDataAvailable,
      summary: {
        total: results.length,
        passed: results.filter((r) => r.status === 'passed').length,
        failed: results.filter((r) => r.status === 'failed').length,
        warnings: results.filter((r) => r.status === 'warning').length,
        skipped: results.filter((r) => r.status === 'skipped').length,
      },
      crossDocumentChecks,
      systemChecks,
    };
  },

  async notifyGoogleChat(
    processCode: string,
    failedChecks: CheckResult[],
    severity: 'warning' | 'critical',
  ) {
    try {
      const { sendToGoogleChat } = await import('../alerts/google-chat.service.js');
      const { systemSettings } = await import('../../shared/database/schema.js');
      const { eq: eqOp } = await import('drizzle-orm');

      const [setting] = await db
        .select()
        .from(systemSettings)
        .where(eqOp(systemSettings.key, 'google_chat_webhook_url'))
        .limit(1);

      const webhookUrl = (setting?.value as string) || process.env.GOOGLE_CHAT_WEBHOOK_URL;
      if (!webhookUrl) return;

      const criticalItems = failedChecks.filter((c) =>
        ['fob-value-match', 'total-value-match', 'net-weight-match', 'gross-weight-match'].includes(
          c.checkName,
        ),
      );

      const message = [
        `Validacao do processo ${processCode} concluida com ${failedChecks.length} falha(s).`,
        criticalItems.length > 0
          ? `Itens criticos: ${criticalItems.map((c) => c.checkName).join(', ')}.`
          : '',
        `Verificacoes com falha: ${failedChecks.map((c) => c.checkName).join(', ')}.`,
        'Um rascunho de e-mail de correcao foi gerado automaticamente.',
      ]
        .filter(Boolean)
        .join('\n');

      await sendToGoogleChat(webhookUrl, {
        severity,
        title: `Validacao com Falhas - ${processCode}`,
        message,
        processCode,
      });

      logger.info(
        { processCode, failedCount: failedChecks.length },
        'Validation summary sent to Google Chat',
      );
    } catch (err) {
      logger.error({ err, processCode }, 'Failed to send validation summary to Google Chat');
    }
  },
};
