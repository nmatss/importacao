import { and, eq, inArray, sql } from 'drizzle-orm';
import { db } from '../shared/database/connection.js';
import { alerts } from '../shared/database/schema.js';
import { attemptDelivery, MAX_DELIVERY_ATTEMPTS } from '../modules/alerts/delivery.service.js';
import { logger } from '../shared/utils/logger.js';

/**
 * Reentrega de alerta que nao chegou ao canal.
 *
 * Ate 2026-08-29 `sent_to_chat = false` nao era lido por NENHUM job, rota ou
 * servico do repositorio: a deteccao funcionava, a entrega falhava e o aviso
 * morria no banco — 6.349 registros, zero entregues. Este job e o unico leitor
 * daquela coluna.
 */

/** Teto por passada. A base tem milhares de linhas historicas. */
export const REDELIVERY_BATCH_SIZE = 25;
/** So o que ainda e acionavel: alerta de ontem entregue hoje nao ajuda ninguem. */
export const REDELIVERY_WINDOW_HOURS = 24;
const BACKOFF_BASE_MINUTES = 5;

/** 5, 10, 20, 40, 80 min. Teto no expoente para nao crescer sem limite. */
export function backoffMinutes(attempts: number | null | undefined): number {
  const n = Math.max(0, Math.floor(attempts ?? 0));
  return BACKOFF_BASE_MINUTES * 2 ** Math.min(n, 4);
}

/**
 * Este alerta pode ser tentado agora?
 *
 * A decisao mora aqui, em JS, e nao na clausula SQL: o teto e o backoff sao a
 * regra que impede o job de martelar o mesmo alerta a cada 5 minutos, e regra
 * assim precisa ser verificavel sem banco. O SELECT filtra por indice, esta
 * funcao decide.
 */
export function isDueForRetry(
  row: { deliveryAttempts?: number | null; lastDeliveryAttemptAt?: Date | string | null },
  now: number = Date.now(),
): boolean {
  const attempts = row.deliveryAttempts ?? 0;
  if (attempts >= MAX_DELIVERY_ATTEMPTS) return false;
  if (!row.lastDeliveryAttemptAt) return true;

  const last = new Date(row.lastDeliveryAttemptAt).getTime();
  if (!Number.isFinite(last)) return true;
  return now - last >= backoffMinutes(attempts) * 60_000;
}

export async function runAlertRedelivery() {
  const rows = await db
    .select({
      id: alerts.id,
      processId: alerts.processId,
      severity: alerts.severity,
      title: alerts.title,
      message: alerts.message,
      deliveryAttempts: alerts.deliveryAttempts,
      lastDeliveryAttemptAt: alerts.lastDeliveryAttemptAt,
    })
    .from(alerts)
    .where(
      and(
        // `= false` casa com o indice parcial alerts_undelivered_idx.
        eq(alerts.sentToChat, false),
        // `info` fica de fora de proposito: nao vale acordar o canal por ele.
        inArray(alerts.severity, ['warning', 'critical']),
        sql`${alerts.createdAt} > NOW() - (${REDELIVERY_WINDOW_HOURS} * INTERVAL '1 hour')`,
        sql`${alerts.deliveryAttempts} < ${MAX_DELIVERY_ATTEMPTS}`,
      ),
    )
    // Nunca tentados primeiro, depois os que esperam ha mais tempo: assim o
    // filtro de backoff logo abaixo nunca deixa um alerta para tras por causa
    // do LIMIT.
    .orderBy(sql`${alerts.lastDeliveryAttemptAt} ASC NULLS FIRST`)
    .limit(REDELIVERY_BATCH_SIZE);

  const now = Date.now();
  let delivered = 0;
  let failed = 0;
  let aguardando = 0;

  for (const row of rows) {
    if (!isDueForRetry(row, now)) {
      aguardando += 1;
      continue;
    }
    const outcome = await attemptDelivery(row);
    if (outcome.delivered) delivered += 1;
    else failed += 1;
  }

  logger.info(
    { scanned: rows.length, delivered, failed, aguardando },
    'alert-redelivery completed',
  );
  return { scanned: rows.length, delivered, failed, aguardando };
}
