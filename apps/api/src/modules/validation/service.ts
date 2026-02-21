import { eq } from 'drizzle-orm';
import { db } from '../../shared/database/connection.js';
import { validationResults, documents, importProcesses, followUpTracking } from '../../shared/database/schema.js';
import { allChecks } from './checks/index.js';
import type { CheckInput, CheckResult } from './checks/index.js';
import { aiService } from '../ai/service.js';
import { alertService } from '../alerts/service.js';
import { logger } from '../../shared/utils/logger.js';
import { auditService } from '../audit/service.js';

export const validationService = {
  async runAllChecks(processId: number): Promise<CheckResult[]> {
    logger.info({ processId }, 'Starting validation checks');

    // 1. Get all documents for the process with aiParsedData
    const docs = await db
      .select()
      .from(documents)
      .where(eq(documents.processId, processId));

    const invoiceDoc = docs.find((d) => d.type === 'invoice');
    const packingListDoc = docs.find((d) => d.type === 'packing_list');
    const blDoc = docs.find((d) => d.type === 'ohbl');

    // Get process data
    const [process] = await db
      .select()
      .from(importProcesses)
      .where(eq(importProcesses.id, processId));

    // Get follow-up data
    const [followUp] = await db
      .select()
      .from(followUpTracking)
      .where(eq(followUpTracking.processId, processId));

    // 2. Build CheckInput from document data
    const checkInput: CheckInput = {
      invoiceData: (invoiceDoc?.aiParsedData as Record<string, any>) ?? undefined,
      packingListData: (packingListDoc?.aiParsedData as Record<string, any>) ?? undefined,
      blData: (blDoc?.aiParsedData as Record<string, any>) ?? undefined,
      processData: process ? { ...process } : undefined,
      followUpData: followUp ? { ...followUp } : undefined,
    };

    // 3. Update process status to 'validating'
    await db
      .update(importProcesses)
      .set({ status: 'validating', updatedAt: new Date() })
      .where(eq(importProcesses.id, processId));

    // 4. Run all 14 checks
    const results: CheckResult[] = allChecks.map((check) => check(checkInput));

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

    // 5. Delete old validation results for this process
    await db
      .delete(validationResults)
      .where(eq(validationResults.processId, processId));

    // 6. Insert new results
    await db.insert(validationResults).values(
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

    // 7. Update process status based on results
    const hasFailed = results.some((r) => r.status === 'failed');
    if (!hasFailed) {
      await db
        .update(importProcesses)
        .set({ status: 'validated', updatedAt: new Date() })
        .where(eq(importProcesses.id, processId));
    }

    auditService.log(null, 'validation_run', 'process', processId, {
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
        title: 'Falhas na Validação',
        message: `Processo ${process?.processCode ?? processId}: ${failedChecks.length} verificação(ões) falharam: ${failedChecks.map(c => c.checkName).join(', ')}.`,
        processCode: process?.processCode,
      });
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
