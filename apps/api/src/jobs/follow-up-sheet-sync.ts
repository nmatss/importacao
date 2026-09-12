import { runFollowUpSheetSync, getSyncMode } from '../modules/follow-up/sheet-sync.js';
import { processService } from '../modules/processes/service.js';
import { logger } from '../shared/utils/logger.js';

/**
 * Job da sincronizacao Follow Up -> banco.
 *
 * Em `dry_run` (padrao) ele so calcula e registra o diff — e assim que a
 * primeira execucao em producao vai ser conferida antes de qualquer gravacao.
 * Em `apply`, depois de gravar, reavalia o estagio logistico dos processos que
 * mudaram: as datas que acabaram de chegar (ETA Realizado, Chegada CD, data de
 * registro) sao justamente as que definem o estagio.
 */
export async function runFollowUpSync() {
  const mode = getSyncMode();
  if (mode === 'off') {
    logger.info('follow-up-sheet-sync: desligado (FOLLOW_UP_SYNC_MODE=off)');
    return { mode, changedProcesses: 0, totalChanges: 0 };
  }

  const result = await runFollowUpSheetSync();

  if (result.mode === 'apply') {
    for (const item of result.processes) {
      if (item.changes.length === 0 && !item.sheetStatusChanged) continue;
      try {
        await processService.advanceLogisticStatus(item.processId);
      } catch (err) {
        logger.error(
          { err, processId: item.processId },
          'follow-up-sheet-sync: falha ao reavaliar o estagio logistico',
        );
      }
    }
  }

  return {
    mode: result.mode,
    changedProcesses: result.changedProcesses,
    totalChanges: result.totalChanges,
  };
}
