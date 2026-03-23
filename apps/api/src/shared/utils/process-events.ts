import { db } from '../database/connection.js';
import { processEvents } from '../database/schema.js';
import { logger } from './logger.js';

export interface ProcessEventInput {
  eventType: string;
  title: string;
  description?: string;
  metadata?: Record<string, unknown>;
}

export async function recordProcessEvent(
  processId: number,
  event: ProcessEventInput,
  userId?: number | null,
): Promise<void> {
  try {
    await db.insert(processEvents).values({
      processId,
      eventType: event.eventType,
      title: event.title,
      description: event.description ?? null,
      metadata: event.metadata ?? null,
      createdBy: userId ?? null,
    });
  } catch (err) {
    logger.error({ err, processId, eventType: event.eventType }, 'Failed to record process event');
  }
}
