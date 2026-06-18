import PgBoss from 'pg-boss';
import { logger } from '../utils/logger.js';

export const QUEUE_NAMES = ['email-send', 'drive-sync', 'sheets-sync', 'ai-extraction'] as const;
export type QueueName = (typeof QUEUE_NAMES)[number];

let boss: PgBoss | null = null;

export async function initQueue(): Promise<PgBoss> {
  if (boss) return boss;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL required for job queue');

  boss = new PgBoss({ connectionString, schedule: false });

  boss.on('error', (err) => logger.error({ err }, 'pg-boss error'));

  await boss.start();

  for (const queueName of QUEUE_NAMES) {
    await boss.createQueue(queueName);
  }

  logger.info('Job queue started');

  return boss;
}

export async function getQueue(): Promise<PgBoss> {
  if (!boss) return initQueue();
  return boss;
}

export async function stopQueue(): Promise<void> {
  if (boss) {
    await boss.stop();
    boss = null;
  }
}
