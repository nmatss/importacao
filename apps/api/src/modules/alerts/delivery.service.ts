import { eq, sql } from 'drizzle-orm';
import { db } from '../../shared/database/connection.js';
import { alerts, systemSettings } from '../../shared/database/schema.js';
import { isChatCooldownActive, sendToGoogleChat } from './google-chat.service.js';
import { alertDeliveryTotal } from '../../shared/metrics/index.js';
import { logger } from '../../shared/utils/logger.js';

/**
 * Caminho UNICO de entrega de alerta ao canal externo.
 *
 * Ate 2026-08-29 a entrega vivia dentro de `alertService.create()` e so era
 * tentada uma vez, na criacao: alerta que falhava morria no banco com
 * `sent_to_chat = false` e nada voltava a olhar para ele (6.349 registros,
 * ZERO entregues). Este modulo concentra a tentativa + o registro do estado da
 * tentativa, para que a criacao e o job de reentrega usem exatamente a mesma
 * regra.
 */

/** Teto de tentativas por alerta. Estourou, para de tentar aquele alerta. */
export const MAX_DELIVERY_ATTEMPTS = 5;

const COOLDOWN_ERROR = 'Canal em cooldown apos falhas consecutivas — reentrega pendente';
const UNCONFIGURED_ERROR = 'Webhook do Google Chat nao configurado — reentrega pendente';
const FAILED_ERROR = 'Falha ao entregar no Google Chat (ver log do webhook)';

export interface WebhookResolution {
  url: string | null;
  source: 'database' | 'env' | null;
}

export interface DeliverableAlert {
  id: number;
  processId?: number | null;
  severity: string;
  title: string;
  message: string;
  processCode?: string;
  deliveryAttempts?: number | null;
}

export interface DeliveryOutcome {
  delivered: boolean;
  outcome: 'sent' | 'failed' | 'cooldown' | 'unconfigured' | 'error';
  error?: string;
}

function extractUrl(raw: unknown): string | null {
  if (typeof raw === 'string') return raw.trim() || null;
  if (typeof raw === 'object' && raw !== null && 'url' in raw) {
    const nested = (raw as { url: unknown }).url;
    return typeof nested === 'string' ? nested.trim() || null : null;
  }
  return null;
}

/**
 * De onde sai o webhook do Chat, em UMA definicao.
 *
 * `systemSettings` vem PRIMEIRO e o env e fallback — essa sempre foi a ordem do
 * envio. O `/health/integrations` lia so o env, entao divergia nas duas
 * direcoes: webhook so no banco fazia o health acusar "ausente" sem motivo, e
 * webhook valido no env com valor quebrado no banco deixava o health verde com
 * o canal morto.
 */
export async function resolveGoogleChatWebhook(): Promise<WebhookResolution> {
  const [setting] = await db
    .select()
    .from(systemSettings)
    .where(eq(systemSettings.key, 'google_chat_webhook_url'))
    .limit(1);

  const fromDb = extractUrl(setting?.value);
  if (fromDb) return { url: fromDb, source: 'database' };

  const fromEnv = extractUrl(process.env.GOOGLE_CHAT_WEBHOOK_URL);
  if (fromEnv) return { url: fromEnv, source: 'env' };

  return { url: null, source: null };
}

/** Um valor configurado ainda pode ser lixo. https e o minimo verificavel. */
export function isUsableWebhookUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    return new URL(url).protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Estado observavel do canal: quando saiu a ultima entrega e quantos alertas
 * recentes continuam presos. E o par que distingue "nao houve alerta" de
 * "alerta nao foi entregue".
 */
export async function getChatDeliverySummary(): Promise<{
  lastSentAt: Date | null;
  pendentes24h: number;
}> {
  const [row] = await db
    .select({
      lastSentAt: sql<Date | null>`max(${alerts.sentAt}) filter (where ${alerts.sentToChat} = true)`,
      // `= false` (e nao `is not true`) para casar com o indice parcial
      // alerts_undelivered_idx.
      pendentes24h: sql<number>`count(*) filter (where ${alerts.sentToChat} = false and ${alerts.createdAt} > NOW() - INTERVAL '24 hours')`,
    })
    .from(alerts);

  return {
    lastSentAt: row?.lastSentAt ? new Date(row.lastSentAt) : null,
    pendentes24h: Number(row?.pendentes24h ?? 0),
  };
}

/**
 * Registra a tentativa SEM marcar entrega.
 *
 * `consumed` distingue tentativa real de transporte (conta para o teto) de
 * recusa do proprio canal — cooldown e webhook ausente nao sao culpa do alerta
 * e nao podem gastar o orcamento de reentrega dele.
 *
 * A recusa do canal tambem nao pode ESCREVER como se fosse tentativa. Medido em
 * producao em 2026-08-29, uma hora depois do deploy: de 4 alertas que tiveram
 * falha real de transporte, 3 estavam com `last_delivery_error` sobrescrito por
 * "Canal em cooldown" — o operador abria a Central de Alertas e lia que o canal
 * estava apenas pausado, quando o webhook havia respondido erro. Por isso:
 *
 * - `last_delivery_attempt_at` so e carimbado por tentativa real. Essa coluna e
 *   a chave do ORDER BY da fila de reentrega; carimba-la a cada passada de
 *   cooldown embaralha a prioridade sem que nada tenha sido tentado.
 * - `last_delivery_error` de recusa do canal so preenche o campo VAZIO
 *   (`coalesce`), nunca apaga um motivo real ja conhecido.
 */
async function recordFailedAttempt(
  alert: DeliverableAlert,
  options: { consumed: boolean; error: string },
): Promise<void> {
  await db
    .update(alerts)
    .set(
      options.consumed
        ? {
            deliveryAttempts: sql`${alerts.deliveryAttempts} + 1`,
            lastDeliveryAttemptAt: new Date(),
            lastDeliveryError: options.error,
          }
        : {
            lastDeliveryError: sql`coalesce(${alerts.lastDeliveryError}, ${options.error})`,
          },
    )
    .where(eq(alerts.id, alert.id));
}

function failureMessage(alert: DeliverableAlert): string {
  const proxima = (alert.deliveryAttempts ?? 0) + 1;
  return proxima >= MAX_DELIVERY_ATTEMPTS
    ? `${FAILED_ERROR} — teto de ${MAX_DELIVERY_ATTEMPTS} tentativas atingido, sem novas tentativas`
    : FAILED_ERROR;
}

/**
 * Tenta entregar um alerta e persiste o resultado. Nunca lanca: o chamador
 * (criacao ou job de reentrega) segue adiante de qualquer jeito, e o que ficou
 * pendente continua elegivel para a proxima passada.
 */
export async function attemptDelivery(alert: DeliverableAlert): Promise<DeliveryOutcome> {
  try {
    // Cooldown ANTES de resolver o webhook: `sendToGoogleChat` tambem recusa,
    // mas la o `false` seria indistinguivel de uma falha de transporte.
    if (isChatCooldownActive()) {
      alertDeliveryTotal.inc({ channel: 'google_chat', outcome: 'cooldown' });
      await recordFailedAttempt(alert, { consumed: false, error: COOLDOWN_ERROR });
      return { delivered: false, outcome: 'cooldown', error: COOLDOWN_ERROR };
    }

    const { url } = await resolveGoogleChatWebhook();
    if (!url) {
      alertDeliveryTotal.inc({ channel: 'google_chat', outcome: 'unconfigured' });
      await recordFailedAttempt(alert, { consumed: false, error: UNCONFIGURED_ERROR });
      return { delivered: false, outcome: 'unconfigured', error: UNCONFIGURED_ERROR };
    }

    const sent = await sendToGoogleChat(url, {
      id: alert.id,
      processId: alert.processId,
      severity: alert.severity,
      title: alert.title,
      message: alert.message,
      processCode: alert.processCode,
    });

    if (sent) {
      await db
        .update(alerts)
        .set({
          sentToChat: true,
          sentAt: new Date(),
          deliveryAttempts: sql`${alerts.deliveryAttempts} + 1`,
          lastDeliveryAttemptAt: new Date(),
          lastDeliveryError: null,
        })
        .where(eq(alerts.id, alert.id));
      return { delivered: true, outcome: 'sent' };
    }

    const error = failureMessage(alert);
    await recordFailedAttempt(alert, { consumed: true, error });
    return { delivered: false, outcome: 'failed', error };
  } catch (err) {
    // Sem `sent_to_chat = true` aqui: o alerta permanece elegivel a reentrega.
    logger.error({ err, alertId: alert.id }, 'Failed to send alert to Google Chat');
    return { delivered: false, outcome: 'error' };
  }
}
