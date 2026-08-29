import { and, eq, inArray, sql } from 'drizzle-orm';
import { db } from '../shared/database/connection.js';
import { alerts } from '../shared/database/schema.js';
import {
  attemptDelivery,
  backoffMinutes,
  isDueForRetry,
  MAX_DELIVERY_ATTEMPTS,
} from '../modules/alerts/delivery.service.js';
import { isChatCooldownActive } from '../modules/alerts/google-chat.service.js';
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
/**
 * `backoffMinutes` e `isDueForRetry` moram em `delivery.service.ts`, junto com
 * `MAX_DELIVERY_ATTEMPTS`, porque o job nao e o unico chamador de
 * `attemptDelivery` — `alertService.create()` tambem chama. Reexportados aqui
 * porque este continua sendo o lugar onde a regra e testada em conjunto com o
 * SELECT que a alimenta.
 */
export { backoffMinutes, isDueForRetry };

/**
 * Latch contra passadas sobrepostas, no mesmo idioma de `email-check.ts`, que
 * roda de 5 em 5 minutos, a mesma cadencia deste.
 *
 * `node-cron` nao serializa execucoes: se uma passada demora mais que o
 * periodo, a proxima dispara junto. Com lote de 25 e timeout de 10s por chamada
 * ao webhook, o pior caso e ~250s, perto dos 300s do intervalo — e duas passadas
 * simultaneas leem a MESMA linha (o SELECT nao tem FOR UPDATE/SKIP LOCKED, e
 * `sent_to_chat` so muda depois do POST), postando a mesma mensagem duas vezes
 * no canal corporativo.
 *
 * Cobre uma instancia, que e a topologia atual. Se a API passar a rodar com
 * mais de uma replica, cada uma tera seu proprio scheduler e o latch em memoria
 * nao basta — ai o caminho e o `pg_try_advisory_xact_lock` ja usado em
 * `modules/sydle/service.ts`.
 */
let isRunning = false;

export async function runAlertRedelivery() {
  if (isRunning) {
    logger.debug('alert-redelivery ja esta rodando, pulando esta passada');
    return { scanned: 0, delivered: 0, failed: 0, aguardando: 0, skipped: 'running' as const };
  }

  // Com o breaker aberto NADA pode ser entregue, entao a passada inteira e
  // trabalho perdido. Sem esta saida cada ciclo varria 25 linhas e gravava 25
  // UPDATEs de no-op: medido em producao, 11 ciclos em 55 min, ~275 escritas,
  // zero entregas. O estado do canal e do canal, nao de cada alerta.
  if (isChatCooldownActive()) {
    logger.info(
      { scanned: 0, delivered: 0, failed: 0, aguardando: 0, motivo: 'cooldown' },
      'alert-redelivery skipped: canal em cooldown',
    );
    return { scanned: 0, delivered: 0, failed: 0, aguardando: 0, skipped: 'cooldown' as const };
  }

  isRunning = true;
  try {
    return await varrerLote();
  } finally {
    isRunning = false;
  }
}

/** O lote em si. Separado para o latch acima ter um `finally` limpo. */
async function varrerLote() {
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
