import { alertDeliveryTotal } from '../../shared/metrics/index.js';
import { logger } from '../../shared/utils/logger.js';

interface Alert {
  id?: number;
  processId?: number | null;
  severity: string;
  title: string;
  message: string;
  processCode?: string;
}

function severityEmoji(severity: string): string {
  switch (severity) {
    case 'critical':
      return '🔴';
    case 'warning':
      return '🟡';
    default:
      return '🔵';
  }
}

export function formatGoogleChatCard(alert: Alert) {
  return {
    cards: [
      {
        header: {
          title: `${severityEmoji(alert.severity)} ${alert.title}`,
          subtitle: alert.processCode ? `Processo: ${alert.processCode}` : 'Sistema de Importação',
          imageStyle: 'AVATAR',
        },
        sections: [
          {
            widgets: [
              {
                textParagraph: {
                  text: alert.message,
                },
              },
              {
                keyValue: {
                  topLabel: 'Severidade',
                  content: alert.severity.toUpperCase(),
                },
              },
              {
                keyValue: {
                  topLabel: 'Data/Hora',
                  content: new Date().toLocaleString('pt-BR'),
                },
              },
            ],
          },
        ],
      },
    ],
  };
}

// Circuit-breaker p/ webhook invalido (incidente 2026-06-22: key invalida ->
// logger.error a cada validacao = spam). Apos N falhas consecutivas, para de
// tentar por um cooldown e loga UMA vez em warn (em vez de error a cada chamada).
let chatConsecutiveFailures = 0;
let chatSkipUntil = 0;
const CHAT_FAIL_THRESHOLD = 3;
const CHAT_COOLDOWN_MS = 30 * 60_000;

/**
 * O breaker esta segurando o envio agora?
 *
 * Existe para quem PERSISTE o estado da entrega: o cooldown recusa o envio e
 * `sendToGoogleChat` devolve `false` igual a uma falha real. Sem separar os dois
 * casos, o alerta recusado pelo cooldown consumiria tentativa do teto de
 * reentrega — puniria o alerta por um problema que e do canal.
 */
export function isChatCooldownActive(now = Date.now()): boolean {
  return now < chatSkipUntil;
}

export async function sendToGoogleChat(webhookUrl: string, alert: Alert): Promise<boolean> {
  if (!webhookUrl) {
    alertDeliveryTotal.inc({ channel: 'google_chat', outcome: 'unconfigured' });
    logger.warn('Google Chat webhook URL not configured');
    return false;
  }
  if (Date.now() < chatSkipUntil) {
    alertDeliveryTotal.inc({ channel: 'google_chat', outcome: 'cooldown' });
    return false; // webhook em cooldown apos falhas repetidas — evita spam de log
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  try {
    const card = formatGoogleChatCard(alert);
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(card),
      signal: controller.signal,
    });

    if (!response.ok) {
      const responseBody = (await response.text().catch(() => '')).slice(0, 300);
      chatConsecutiveFailures += 1;
      alertDeliveryTotal.inc({ channel: 'google_chat', outcome: 'failed' });
      if (chatConsecutiveFailures >= CHAT_FAIL_THRESHOLD) {
        chatSkipUntil = Date.now() + CHAT_COOLDOWN_MS;
        // ERROR, nao WARN: um canal de alerta que nao entrega e a falha que
        // apaga todas as outras. Em 17/08 a base tinha 6.349 alertas e ZERO
        // entregues, e nada nesse nivel de log chamava atencao para isso.
        logger.error(
          { status: response.status, responseBody, cooldownMin: CHAT_COOLDOWN_MS / 60_000 },
          'Google Chat webhook falhando (verifique GOOGLE_CHAT_WEBHOOK_URL/key) — pausando notificacoes pelo cooldown',
        );
      } else {
        logger.error({ status: response.status, responseBody }, 'Google Chat webhook failed');
      }
      return false;
    }

    chatConsecutiveFailures = 0;
    chatSkipUntil = 0;
    alertDeliveryTotal.inc({ channel: 'google_chat', outcome: 'sent' });
    logger.info({ alertTitle: alert.title }, 'Alert sent to Google Chat');
    return true;
  } catch (error: any) {
    chatConsecutiveFailures += 1;
    if (chatConsecutiveFailures >= CHAT_FAIL_THRESHOLD) {
      chatSkipUntil = Date.now() + CHAT_COOLDOWN_MS;
    }
    alertDeliveryTotal.inc({ channel: 'google_chat', outcome: 'error' });
    logger.error({ error: error.message }, 'Google Chat webhook error');
    return false;
  } finally {
    clearTimeout(timeout);
  }
}
