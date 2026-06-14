import { eq, desc } from 'drizzle-orm';
import { db } from '../../shared/database/connection.js';
import {
  validationResults,
  validationResultHistory,
  documents,
  importProcesses,
  followUpTracking,
  documentCorrections,
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
import { NotFoundError } from '../../shared/errors/index.js';
import { getErrorTypesFromChecks } from './error-type-mapping.js';
import { recordProcessEvent } from '../../shared/utils/process-events.js';

const KIOM_EMAIL = process.env.KIOM_EMAIL || '';

export const validationService = {
  async runAllChecks(processId: number, userId: number | null = null): Promise<CheckResult[]> {
    if (!processId || isNaN(processId)) {
      throw new Error('ID do processo invalido');
    }

    logger.info({ processId }, 'Starting validation checks');

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

    const invoiceDoc = docs.find((d) => d.type === 'invoice');
    const packingListDoc = docs.find((d) => d.type === 'packing_list');
    const blDoc = docs.find((d) => d.type === 'ohbl');

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

    // 4. Update process status to 'validating'
    // Capture the originating status so we can roll back if the run fails
    // mid-flight — otherwise the process would stay stuck in 'validating'.
    const originStatus = process.status as ProcessStatus;
    assertTransition(originStatus, 'validating');
    await db
      .update(importProcesses)
      .set({ status: 'validating', updatedAt: new Date() })
      .where(eq(importProcesses.id, processId));

    let results: CheckResult[];
    try {
      // 5. Run all checks (supports async checks like Odoo)
      results = await Promise.all(allChecks.map((check) => check(checkInput)));

      logger.info(
        {
          processId,
          total: results.length,
          passed: results.filter((r) => r.status === 'passed').length,
          failed: results.filter((r) => r.status === 'failed').length,
          warnings: results.filter((r) => r.status === 'warning').length,
          skipped: results.filter((r) => r.status === 'skipped').length,
        },
        'Validation checks completed',
      );

      // 6. Atomic: snapshot previous results to history, then delete old
      // results + insert new ones — all in one transaction. The history
      // snapshot (append-only, regulatory audit — backlog #12) preserves what
      // the live table is about to lose; the live table behavior is unchanged.
      await db.transaction(async (tx) => {
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
      });

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
            const { googleDriveService } = await import('../integrations/google-drive.service.js');
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
        if (current && current.status === 'validating') {
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
        title: `Validacao executada: ${passed}/${results.length} aprovadas`,
        metadata: { passed, failed, warnings, skipped, total: results.length },
      },
      userId,
    );

    if (failed > 0) {
      const errorTypes = getErrorTypesFromChecks(
        results.filter((r) => r.status === 'failed').map((r) => r.checkName),
      );
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
    if (failedChecks.length > 0) {
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
            recipientEmail: KIOM_EMAIL,
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

    // 9. Auto-populate document_corrections with error summary
    const failedCheckNames = results.filter((r) => r.status === 'failed').map((r) => r.checkName);
    const errorTypes = getErrorTypesFromChecks(failedCheckNames);

    try {
      // Upsert: delete old + insert new correction record for this process
      await db.delete(documentCorrections).where(eq(documentCorrections.processId, processId));

      await db.insert(documentCorrections).values({
        processId,
        correctionNeeded: failedCheckNames.length > 0,
        errorCount: failedCheckNames.length,
        errorTypes: errorTypes,
        correctionRequestedAt: failedCheckNames.length > 0 ? new Date() : null,
      });

      logger.info(
        {
          processId,
          correctionNeeded: failedCheckNames.length > 0,
          errorCount: failedCheckNames.length,
          errorTypes,
        },
        'Document corrections record updated',
      );
    } catch (corrErr) {
      logger.error({ err: corrErr, processId }, 'Failed to update document corrections');
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
    return db.select().from(validationResults).where(eq(validationResults.processId, processId));
  },

  /**
   * Historical validation runs for a process (append-only snapshots taken
   * before each delete+recreate). Rows are grouped by run_at — each group is
   * one run — and pagination is applied over runs (newest first).
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

    // Group by run_at (ISO string key keeps grouping stable across rows)
    const runMap = new Map<string, typeof rows>();
    for (const row of rows) {
      const key = row.runAt ? new Date(row.runAt).toISOString() : 'unknown';
      const group = runMap.get(key);
      if (group) {
        group.push(row);
      } else {
        runMap.set(key, [row]);
      }
    }

    const allRuns = Array.from(runMap.entries()).map(([runAt, results]) => ({
      runAt,
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

    // Nothing failed, or still has unresolved failures → no promotion.
    if (failed.length === 0 || unresolvedFailed.length > 0) {
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

    const invoiceDoc = docs.find((d) => d.type === 'invoice');
    const packingListDoc = docs.find((d) => d.type === 'packing_list');
    const blDoc = docs.find((d) => d.type === 'ohbl');

    const rawInvAnomaly = (invoiceDoc?.aiParsedData as Record<string, any>) ?? {};
    const rawPlAnomaly = (packingListDoc?.aiParsedData as Record<string, any>) ?? {};
    const rawBlAnomaly = (blDoc?.aiParsedData as Record<string, any>) ?? {};

    // Flatten for anomaly detection (AI compares plain values)
    const invoiceData = Object.keys(rawInvAnomaly).length > 0 ? flattenAiData(rawInvAnomaly) : {};
    const packingListData = Object.keys(rawPlAnomaly).length > 0 ? flattenAiData(rawPlAnomaly) : {};
    const blData = Object.keys(rawBlAnomaly).length > 0 ? flattenAiData(rawBlAnomaly) : {};

    logger.info({ processId }, 'Running AI anomaly detection');

    const result = await aiService.detectAnomalies(invoiceData, packingListData, blData);

    logger.info(
      { processId, anomalyCount: result.anomalies.length },
      'AI anomaly detection completed',
    );

    return result;
  },

  async uploadValidationReportToDrive(processCode: string, results: CheckResult[]): Promise<void> {
    try {
      const { googleDriveService } = await import('../integrations/google-drive.service.js');
      const configured = await googleDriveService.isConfigured();
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
      summary: {
        total: results.length,
        passed: results.filter((r) => r.status === 'passed').length,
        failed: results.filter((r) => r.status === 'failed').length,
        warnings: results.filter((r) => r.status === 'warning').length,
        skipped: results.filter((r) => r.status === 'skipped').length,
      },
      crossDocumentChecks: results.filter((r) => r.dataSource === 'cross_document'),
      systemChecks: results.filter((r) => r.dataSource === 'system_vs_document'),
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
