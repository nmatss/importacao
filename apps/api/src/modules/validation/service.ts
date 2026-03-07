import { eq } from 'drizzle-orm';
import { db } from '../../shared/database/connection.js';
import { validationResults, documents, importProcesses, followUpTracking } from '../../shared/database/schema.js';
import { allChecks } from './checks/index.js';
import type { CheckInput, CheckResult } from './checks/index.js';
import { aiService } from '../ai/service.js';
import { alertService } from '../alerts/service.js';
import { logger } from '../../shared/utils/logger.js';
import { auditService } from '../audit/service.js';
import { communicationService } from '../communications/service.js';
import { kiomCorrectionTemplate } from '../communications/templates/kiom-correction.js';

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
      throw new Error('Processo nao encontrado');
    }

    // 2. Get all documents for the process with aiParsedData
    const docs = await db
      .select()
      .from(documents)
      .where(eq(documents.processId, processId));

    const invoiceDoc = docs.find((d) => d.type === 'invoice');
    const packingListDoc = docs.find((d) => d.type === 'packing_list');
    const blDoc = docs.find((d) => d.type === 'ohbl');

    // Get follow-up data
    const [followUp] = await db
      .select()
      .from(followUpTracking)
      .where(eq(followUpTracking.processId, processId));

    // 3. Build CheckInput from document data
    const checkInput: CheckInput = {
      invoiceData: (invoiceDoc?.aiParsedData as Record<string, any>) ?? undefined,
      packingListData: (packingListDoc?.aiParsedData as Record<string, any>) ?? undefined,
      blData: (blDoc?.aiParsedData as Record<string, any>) ?? undefined,
      processData: { ...process },
      followUpData: followUp ? { ...followUp } : undefined,
    };

    // 4. Update process status to 'validating'
    await db
      .update(importProcesses)
      .set({ status: 'validating', updatedAt: new Date() })
      .where(eq(importProcesses.id, processId));

    // 5. Run all 17 checks (supports async checks like Odoo)
    const results: CheckResult[] = await Promise.all(allChecks.map((check) => check(checkInput)));

    logger.info(
      {
        processId,
        total: results.length,
        passed: results.filter((r) => r.status === 'passed').length,
        failed: results.filter((r) => r.status === 'failed').length,
        warnings: results.filter((r) => r.status === 'warning').length,
      },
      'Validation checks completed',
    );

    // 6. Atomic: delete old results + insert new ones in a transaction
    await db.transaction(async (tx) => {
      await tx
        .delete(validationResults)
        .where(eq(validationResults.processId, processId));

      await tx.insert(validationResults).values(
        results.map((r) => ({
          processId,
          checkName: r.checkName,
          status: r.status as 'passed' | 'failed' | 'warning' | 'skipped',
          expectedValue: r.expectedValue ?? null,
          actualValue: r.actualValue ?? null,
          documentsCompared: r.documentsCompared,
          message: r.message,
        })),
      );
    });

    // 7. Update process status based on results + correction status
    const hasFailed = results.some((r) => r.status === 'failed');
    if (!hasFailed) {
      // If was pending correction, clear it and move back from correction folder
      if (process.correctionStatus === 'pending_correction') {
        await db
          .update(importProcesses)
          .set({ status: 'validated', correctionStatus: null, updatedAt: new Date() })
          .where(eq(importProcesses.id, processId));

        import('../integrations/google-drive.service.js').then(({ googleDriveService }) => {
          googleDriveService.moveFromCorrection(process.processCode, process.brand).catch(err =>
            logger.error({ err, processId }, 'Failed to move from correction folder')
          );
        }).catch(() => {});
      } else {
        await db
          .update(importProcesses)
          .set({ status: 'validated', updatedAt: new Date() })
          .where(eq(importProcesses.id, processId));
      }

      // Sync pre-inspection milestone to Follow-Up sheet
      import('../integrations/google-sheets.service.js').then(({ googleSheetsService }) => {
        googleSheetsService.syncMilestone(process.processCode, 'preInspectionAt', new Date());
      }).catch(() => {});
    } else {
      // Mark as pending correction and move to correction folder
      await db
        .update(importProcesses)
        .set({ correctionStatus: 'pending_correction', updatedAt: new Date() })
        .where(eq(importProcesses.id, processId));

      import('../integrations/google-drive.service.js').then(({ googleDriveService }) => {
        googleDriveService.moveToCorrection(process.processCode, process.brand).catch(err =>
          logger.error({ err, processId }, 'Failed to move to correction folder')
        );
      }).catch(() => {});
    }

    auditService.log(userId, 'validation_run', 'process', processId, {
      total: results.length,
      passed: results.filter((r) => r.status === 'passed').length,
      failed: results.filter((r) => r.status === 'failed').length,
    }, null);

    // 8. Create alert if any checks failed
    const failedChecks = results.filter((r) => r.status === 'failed');
    if (failedChecks.length > 0) {
      await alertService.create({
        processId,
        severity: 'warning',
        title: 'Falhas na Validacao',
        message: `Processo ${process.processCode ?? processId}: ${failedChecks.length} verificacao(oes) falharam: ${failedChecks.map(c => c.checkName).join(', ')}.`,
        processCode: process.processCode,
      });

      // Auto-draft correction email for KIOM (only for INV/PL related failures)
      const blOnlyChecks = ['ports-match', 'freight-value-match'];
      const invPlFailedChecks = failedChecks.filter(c => !blOnlyChecks.includes(c.checkName));

      if (invPlFailedChecks.length > 0) {
        try {
          const { subject, body } = kiomCorrectionTemplate({
            processCode: process.processCode ?? String(processId),
            brand: process.brand,
            failedChecks: invPlFailedChecks.map(c => ({
              checkName: c.checkName,
              expectedValue: c.expectedValue,
              actualValue: c.actualValue,
              message: c.message,
            })),
          });

          await communicationService.create({
            processId,
            recipient: 'KIOM',
            recipientEmail: KIOM_EMAIL || 'kiom@placeholder.com',
            subject,
            body,
          });
          logger.info({ processId, failedCount: invPlFailedChecks.length }, 'KIOM correction email drafted');
        } catch (emailErr) {
          logger.error({ err: emailErr, processId }, 'Failed to draft KIOM correction email');
        }
      }
    }

    return results;
  },

  async getResults(processId: number) {
    return db
      .select()
      .from(validationResults)
      .where(eq(validationResults.processId, processId));
  },

  async resolveManually(resultId: number, userId: number) {
    const [updated] = await db
      .update(validationResults)
      .set({
        resolvedManually: true,
        resolvedBy: userId,
        resolvedAt: new Date(),
      })
      .where(eq(validationResults.id, resultId))
      .returning();

    if (!updated) {
      throw new Error('Validation result not found');
    }

    auditService.log(userId, 'manual_resolution', 'validation', resultId, null, null);
    logger.info({ resultId, userId }, 'Validation result resolved manually');
    return updated;
  },

  async runAnomalyDetection(processId: number) {
    const docs = await db
      .select()
      .from(documents)
      .where(eq(documents.processId, processId));

    const invoiceDoc = docs.find((d) => d.type === 'invoice');
    const packingListDoc = docs.find((d) => d.type === 'packing_list');
    const blDoc = docs.find((d) => d.type === 'ohbl');

    const invoiceData = (invoiceDoc?.aiParsedData as Record<string, any>) ?? {};
    const packingListData = (packingListDoc?.aiParsedData as Record<string, any>) ?? {};
    const blData = (blDoc?.aiParsedData as Record<string, any>) ?? {};

    logger.info({ processId }, 'Running AI anomaly detection');

    const result = await aiService.detectAnomalies(invoiceData, packingListData, blData);

    logger.info(
      { processId, anomalyCount: result.anomalies.length },
      'AI anomaly detection completed',
    );

    return result;
  },
};
