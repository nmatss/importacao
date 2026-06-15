import { and, isNull, notInArray } from 'drizzle-orm';
import { db } from '../shared/database/connection.js';
import { importProcesses } from '../shared/database/schema.js';
import { processService } from '../modules/processes/service.js';
import { logger } from '../shared/utils/logger.js';

export async function runLogisticSync() {
  // Only scan active, unlocked processes. Terminal statuses can't advance, and
  // locked processes throw a 423 in advanceLogisticStatus (assertNotLocked),
  // which previously logged an error every 30min for each one (log noise /
  // false-alarm storm). Filtering them at the SELECT keeps behaviour identical
  // for the rows that could actually advance.
  const rows = await db
    .select({ id: importProcesses.id })
    .from(importProcesses)
    .where(
      and(
        notInArray(importProcesses.status, ['completed', 'cancelled']),
        isNull(importProcesses.lockedAt),
      ),
    );

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
