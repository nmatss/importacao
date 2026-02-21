import { and, ne, sql } from 'drizzle-orm';
import { db } from '../shared/database/connection.js';
import { importProcesses } from '../shared/database/schema.js';
import { alertService } from '../modules/alerts/service.js';
import { logger } from '../shared/utils/logger.js';

export async function checkStalledProcesses() {
  logger.info('Running stalled process check job');

  const stalledProcesses = await db.select().from(importProcesses)
    .where(and(
      ne(importProcesses.status, 'completed'),
      ne(importProcesses.status, 'cancelled'),
      sql`${importProcesses.updatedAt} < NOW() - INTERVAL '3 days'`
    ));

  for (const process of stalledProcesses) {
    const daysSinceUpdate = Math.floor(
      (Date.now() - new Date(process.updatedAt!).getTime()) / (1000 * 60 * 60 * 24)
    );

    await alertService.create({
      processId: process.id,
      severity: 'warning',
      title: 'Processo Parado',
      message: `O processo ${process.processCode} está sem atividade há ${daysSinceUpdate} dias. Status atual: ${process.status}.`,
      processCode: process.processCode,
    });
  }

  logger.info(`Stalled process check completed. Found ${stalledProcesses.length} stalled processes.`);
}
