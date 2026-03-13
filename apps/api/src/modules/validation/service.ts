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
import { assertTransition } from '../../shared/state-machine/process-states.js';
import type { ProcessStatus } from '../../shared/state-machine/process-states.js';
import { NotFoundError } from '../../shared/errors/index.js';

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

    // 3. Build CheckInput from document data + process data from DB
    const checkInput: CheckInput = {
      invoiceData: (invoiceDoc?.aiParsedData as Record<string, any>) ?? undefined,
      packingListData: (packingListDoc?.aiParsedData as Record<string, any>) ?? undefined,
      blData: (blDoc?.aiParsedData as Record<string, any>) ?? undefined,
      processData: { ...process },
      followUpData: followUp ? { ...followUp } : undefined,
    };

    // 4. Update process status to 'validating'
    assertTransition(process.status as ProcessStatus, 'validating');
    await db
      .update(importProcesses)
      .set({ status: 'validating', updatedAt: new Date() })
      .where(eq(importProcesses.id, processId));

    // 5. Run all checks (supports async checks like Odoo)
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
          dataSource: r.documentsCompared.includes('Sistema') ? 'system_vs_document' : 'cross_document',
        })),
      );
    });

    // Upload validation report to Drive Sistema Automatico
    this.uploadValidationReportToDrive(process.processCode, results).catch(err =>
      logger.error({ err, processId }, 'Failed to upload validation report to Drive')
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

        import('../integrations/google-drive.service.js').then(({ googleDriveService }) => {
          googleDriveService.moveFromCorrection(process.processCode, process.brand).catch(err =>
            logger.error({ err, processId }, 'Failed to move from correction folder')
          );
        }).catch(() => {});
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

    // 8. Create alert with severity based on failure count
    const failedChecks = results.filter((r) => r.status === 'failed');
    if (failedChecks.length > 0) {
      const severity: 'warning' | 'critical' = failedChecks.length > 3 ? 'critical' : 'warning';
      const criticalItems = failedChecks.filter(c =>
        ['fob-value-match', 'total-value-match', 'net-weight-match', 'gross-weight-match'].includes(c.checkName)
      );

      await alertService.create({
        processId,
        severity,
        title: `Falhas na Validacao${severity === 'critical' ? ' (Critico)' : ''}`,
        message: `Processo ${process.processCode ?? processId}: ${failedChecks.length} verificacao(oes) falharam: ${failedChecks.map(c => c.checkName).join(', ')}.${criticalItems.length > 0 ? ` Itens criticos: ${criticalItems.map(c => c.checkName).join(', ')}.` : ''}`,
        processCode: process.processCode,
      });

      // Auto-draft correction email for KIOM (only for cross-document failures, not system checks)
      const nonKiomChecks = ['ports-match', 'freight-value-match', 'invoice-value-vs-fup', 'freight-vs-fup', 'cbm-vs-fup', 'container-type-vs-fup'];
      const invPlFailedChecks = failedChecks.filter(c => !nonKiomChecks.includes(c.checkName));

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

      // Send validation failure summary to Google Chat
      this.notifyGoogleChat(process.processCode ?? String(processId), failedChecks, severity).catch(err =>
        logger.error({ err, processId }, 'Failed to send validation summary to Google Chat')
      );
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
          passed: results.filter(r => r.status === 'passed').length,
          failed: results.filter(r => r.status === 'failed').length,
          warnings: results.filter(r => r.status === 'warning').length,
        },
        crossDocumentChecks: results.filter(r => !r.documentsCompared.includes('Sistema')),
        systemChecks: results.filter(r => r.documentsCompared.includes('Sistema')),
      };

      await googleDriveService.uploadValidationReport(processCode, report);

      const failedChecks = results.filter(r => r.status === 'failed');
      if (failedChecks.length > 0) {
        const alertContent = JSON.stringify({
          processCode,
          generatedAt: new Date().toISOString(),
          failedChecks: failedChecks.map(c => ({
            checkName: c.checkName,
            expected: c.expectedValue,
            actual: c.actualValue,
            message: c.message,
          })),
        }, null, 2);
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
        passed: results.filter(r => r.status === 'passed').length,
        failed: results.filter(r => r.status === 'failed').length,
        warnings: results.filter(r => r.status === 'warning').length,
      },
      crossDocumentChecks: results.filter(r => r.dataSource === 'cross_document'),
      systemChecks: results.filter(r => r.dataSource === 'system_vs_document'),
    };
  },

  async notifyGoogleChat(processCode: string, failedChecks: CheckResult[], severity: 'warning' | 'critical') {
    try {
      const { sendToGoogleChat } = await import('../alerts/google-chat.service.js');
      const { systemSettings } = await import('../../shared/database/schema.js');
      const { eq: eqOp } = await import('drizzle-orm');

      const [setting] = await db.select().from(systemSettings)
        .where(eqOp(systemSettings.key, 'google_chat_webhook_url')).limit(1);

      const webhookUrl = (setting?.value as string) || process.env.GOOGLE_CHAT_WEBHOOK_URL;
      if (!webhookUrl) return;

      const criticalItems = failedChecks.filter(c =>
        ['fob-value-match', 'total-value-match', 'net-weight-match', 'gross-weight-match'].includes(c.checkName)
      );

      const message = [
        `Validacao do processo ${processCode} concluida com ${failedChecks.length} falha(s).`,
        criticalItems.length > 0
          ? `Itens criticos: ${criticalItems.map(c => c.checkName).join(', ')}.`
          : '',
        `Verificacoes com falha: ${failedChecks.map(c => c.checkName).join(', ')}.`,
        'Um rascunho de e-mail de correcao foi gerado automaticamente.',
      ].filter(Boolean).join('\n');

      await sendToGoogleChat(webhookUrl, {
        severity,
        title: `Validacao com Falhas - ${processCode}`,
        message,
        processCode,
      });

      logger.info({ processCode, failedCount: failedChecks.length }, 'Validation summary sent to Google Chat');
    } catch (err) {
      logger.error({ err, processCode }, 'Failed to send validation summary to Google Chat');
    }
  },
};
