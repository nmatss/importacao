import PgBoss from 'pg-boss';
import { logger } from '../utils/logger.js';

// `email-send` foi removida: caminho morto que contornava allow-list de
// destinatario e sanitizacao de HTML. Ver a nota em `workers.ts`.
export const QUEUE_NAMES = ['drive-sync', 'sheets-sync', 'ai-extraction'] as const;

/**
 * Politica de retry DECLARADA, em vez do default implicito da versao do pg-boss.
 *
 * `createQueue(name)` sem opcoes deixava a politica a cargo do default da
 * biblioteca — que muda entre versoes e que ninguem no projeto sabia dizer qual
 * era. `ai-extraction` ja passava `retryLimit` no envio, entao o default so
 * valia para as outras duas filas, silenciosamente.
 *
 * Backoff exponencial e deliberado: as tres filas falham majoritariamente por
 * indisponibilidade externa (Drive, Sheets, provider de IA), e re-tentar rapido
 * contra um servico fora so gasta cota.
 *
 * PENDENTE: nao ha dead-letter. Job que estoura as tentativas termina como
 * `failed` no pg-boss e nada varre esse estado — o mesmo padrao do alerta que
 * morria no banco. Exige decidir onde a fila morta e observada antes de criar.
 */
export const QUEUE_RETRY_POLICY = {
  retryLimit: 3,
  retryDelay: 60,
  retryBackoff: true,
} as const;
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
    await boss.createQueue(queueName, { name: queueName, ...QUEUE_RETRY_POLICY });
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
