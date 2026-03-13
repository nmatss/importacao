import { appEvents } from './emitter.js';
import { logger } from '../utils/logger.js';

/**
 * Register all event handlers.
 * Call once at startup after all modules are loaded.
 */
export function registerEventHandlers(): void {
  appEvents.on('process.created', (payload) => {
    logger.info(
      { processId: payload.processId, processCode: payload.processCode },
      'Event: process created',
    );
  });

  appEvents.on('process.status_changed', (payload) => {
    logger.info(
      { processId: payload.processId, from: payload.from, to: payload.to },
      'Event: process status changed',
    );
  });

  appEvents.on('document.uploaded', (payload) => {
    logger.info(
      { documentId: payload.documentId, processId: payload.processId, type: payload.type },
      'Event: document uploaded',
    );
  });

  appEvents.on('validation.completed', (payload) => {
    logger.info(
      { processId: payload.processId, passed: payload.passed, failed: payload.failed },
      'Event: validation completed',
    );
  });

  appEvents.on('espelho.generated', (payload) => {
    logger.info(
      { processId: payload.processId, espelhoId: payload.espelhoId },
      'Event: espelho generated',
    );
  });

  appEvents.on('email.ingested', (payload) => {
    logger.info(
      { emailId: payload.emailId, processId: payload.processId },
      'Event: email ingested',
    );
  });

  logger.info('Event handlers registered');
}
