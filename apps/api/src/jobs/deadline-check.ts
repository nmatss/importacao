import { and, eq, ne, sql, isNotNull } from 'drizzle-orm';
import { db } from '../shared/database/connection.js';
import { importProcesses, currencyExchanges } from '../shared/database/schema.js';
import { alertService } from '../modules/alerts/service.js';
import { logger } from '../shared/utils/logger.js';

export async function checkDeadlines() {
  logger.info('Running deadline check job');

  // Check LI deadlines
  const liProcesses = await db.select().from(importProcesses)
    .where(and(
      eq(importProcesses.hasLiItems, true),
      ne(importProcesses.status, 'completed'),
      ne(importProcesses.status, 'cancelled'),
      isNotNull(importProcesses.shipmentDate),
    ));

  const now = new Date();

  for (const process of liProcesses) {
    const shipmentDate = new Date(process.shipmentDate!);
    const deadline = new Date(shipmentDate);
    deadline.setDate(deadline.getDate() + 13);

    const daysRemaining = Math.ceil((deadline.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

    if (daysRemaining < 0) {
      const title = 'Prazo LI Excedido';
      if (!(await alertService.hasDuplicateRecent(process.id, title))) {
        await alertService.create({
          processId: process.id,
          severity: 'critical',
          title,
          message: `O prazo de LI do processo ${process.processCode} expirou há ${Math.abs(daysRemaining)} dias. Deadline era: ${deadline.toLocaleDateString('pt-BR')}.`,
          processCode: process.processCode,
        });
      }
    } else if (daysRemaining <= 3) {
      const title = 'Prazo LI se Aproximando';
      if (!(await alertService.hasDuplicateRecent(process.id, title))) {
        await alertService.create({
          processId: process.id,
          severity: 'warning',
          title,
          message: `O prazo de LI do processo ${process.processCode} vence em ${daysRemaining} dias (${deadline.toLocaleDateString('pt-BR')}).`,
          processCode: process.processCode,
        });
      }
    }
  }

  // Check currency exchange payment deadlines
  const exchanges = await db.select().from(currencyExchanges)
    .where(isNotNull(currencyExchanges.paymentDeadline));

  for (const exchange of exchanges) {
    const deadline = new Date(exchange.paymentDeadline!);
    const daysRemaining = Math.ceil((deadline.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

    if (daysRemaining <= 3 && daysRemaining >= 0) {
      const title = 'Câmbio Vencendo';
      if (!(await alertService.hasDuplicateRecent(exchange.processId, title))) {
        await alertService.create({
          processId: exchange.processId,
          severity: 'warning',
          title,
          message: `Pagamento de câmbio de USD ${exchange.amountUsd} vence em ${daysRemaining} dias.`,
        });
      }
    }
  }

  logger.info('Deadline check job completed');
}
