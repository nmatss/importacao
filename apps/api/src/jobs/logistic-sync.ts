import { db } from '../shared/database/connection.js';
import { importProcesses } from '../shared/database/schema.js';
import { processService } from '../modules/processes/service.js';
import { logger } from '../shared/utils/logger.js';

export async function runLogisticSync() {
  const rows = await db.select({ id: importProcesses.id }).from(importProcesses);

  let updated = 0;
  for (const row of rows) {
    try {
      const res = await processService.advanceLogisticStatus(row.id);
      if (res?.updated) updated += 1;
    } catch (err) {
      logger.error({ err, processId: row.id }, 'logistic-sync failed for process');
    }
  }
  logger.info({ updated, scanned: rows.length }, 'logistic-sync completed');
  return { updated, scanned: rows.length };
}
