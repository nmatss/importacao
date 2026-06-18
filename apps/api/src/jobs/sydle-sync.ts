import { sydleService } from '../modules/sydle/service.js';
import { logger } from '../shared/utils/logger.js';

export async function runSydleSync() {
  const result = await sydleService.sync('cron', null);

  if (result?.status === 'skipped') {
    logger.info({ result }, 'SYDLE sync skipped');
    return result;
  }

  logger.info(
    {
      fetched: result?.fetched,
      created: result?.created,
      updated: result?.updated,
      matched: result?.matched,
      unmatched: result?.unmatched,
      errors: result?.errors,
    },
    'SYDLE sync completed',
  );
  return result;
}
