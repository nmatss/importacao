import { and, ne } from 'drizzle-orm';
import { db } from '../shared/database/connection.js';
import { importProcesses } from '../shared/database/schema.js';
import { alertService } from '../modules/alerts/service.js';
import { financialService } from '../modules/financial/service.js';
import {
  LOW_INVOICE_THRESHOLD_USD,
  INSURANCE_COVERAGE_LIMIT_USD,
} from '../modules/financial/calculations.js';
import { logger } from '../shared/utils/logger.js';

function fmtUsd(value: number): string {
  return value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDateBr(isoDate: string): string {
  const [year, month, day] = isoDate.split('-');
  return `${day}/${month}/${year}`;
}

async function createIfNotActive(input: {
  processId: number;
  processCode: string;
  severity: 'info' | 'warning' | 'critical';
  title: string;
  message: string;
}): Promise<void> {
  // Dedupe: não recriar enquanto houver alerta igual não reconhecido
  if (await alertService.hasActiveAlert(input.processId, input.title)) return;
  await alertService.create(input);
}

/**
 * Job diário do motor financeiro:
 *  - Invoice baixa  (FOB < USD 20k → warning)
 *  - Seguro         (valor aduaneiro/FOB em USD > USD 150k → crítico ACIONAR SEGURADORA)
 *  - Demurrage      (free time vencendo em ≤7 dias → warning; vencido → crítico)
 */
export async function runFinancialCheck() {
  logger.info('Running financial check job');

  const processes = await db
    .select({ id: importProcesses.id, processCode: importProcesses.processCode })
    .from(importProcesses)
    .where(and(ne(importProcesses.status, 'completed'), ne(importProcesses.status, 'cancelled')));

  let alertsEvaluated = 0;

  for (const process of processes) {
    try {
      const snapshot = await financialService.getSnapshot(process.id);

      if (snapshot.alerts.lowInvoice && snapshot.fobValueUsd !== null) {
        alertsEvaluated++;
        await createIfNotActive({
          processId: process.id,
          processCode: process.processCode,
          severity: 'warning',
          title: 'Invoice baixa',
          message: `O valor FOB da invoice do processo ${process.processCode} é USD ${fmtUsd(snapshot.fobValueUsd)}, abaixo do mínimo de USD ${fmtUsd(LOW_INVOICE_THRESHOLD_USD)}. Verificar com o exportador/comercial.`,
        });
      }

      if (snapshot.alerts.insuranceCoverage) {
        alertsEvaluated++;
        const referenceUsd = snapshot.customsValueUsd ?? snapshot.fobValueUsd ?? 0;
        await createIfNotActive({
          processId: process.id,
          processCode: process.processCode,
          severity: 'critical',
          title: 'Acionar seguradora — cobertura de apólice',
          message: `ACIONAR SEGURADORA: o valor do processo ${process.processCode} (USD ${fmtUsd(referenceUsd)}) excede o limite de cobertura da apólice de USD ${fmtUsd(INSURANCE_COVERAGE_LIMIT_USD)}.`,
        });
      }

      const demurrage = snapshot.alerts.demurrage;
      if (demurrage?.status === 'expiring') {
        alertsEvaluated++;
        await createIfNotActive({
          processId: process.id,
          processCode: process.processCode,
          severity: 'warning',
          title: 'Free time (demurrage) vencendo',
          message: `O free time do processo ${process.processCode} vence em ${demurrage.daysRemaining} dia(s), em ${fmtDateBr(demurrage.freeTimeEndsAt)}. Programar devolução do container para evitar demurrage.`,
        });
      } else if (demurrage?.status === 'expired') {
        alertsEvaluated++;
        await createIfNotActive({
          processId: process.id,
          processCode: process.processCode,
          severity: 'critical',
          title: 'Free time (demurrage) vencido',
          message: `O free time do processo ${process.processCode} venceu há ${Math.abs(demurrage.daysRemaining)} dia(s), em ${fmtDateBr(demurrage.freeTimeEndsAt)}. Custos de demurrage/armazenagem podem estar correndo.`,
        });
      }
    } catch (error) {
      logger.error(
        { error, processId: process.id, processCode: process.processCode },
        'Financial check failed for process',
      );
    }
  }

  logger.info({ processCount: processes.length, alertsEvaluated }, 'Financial check job completed');
}
