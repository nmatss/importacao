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

export async function sendToGoogleChat(webhookUrl: string, alert: Alert): Promise<boolean> {
  if (!webhookUrl) {
    logger.warn('Google Chat webhook URL not configured');
    return false;
  }
  if (Date.now() < chatSkipUntil) {
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
      if (chatConsecutiveFailures >= CHAT_FAIL_THRESHOLD) {
        chatSkipUntil = Date.now() + CHAT_COOLDOWN_MS;
        logger.warn(
          { status: response.status, responseBody, cooldownMin: CHAT_COOLDOWN_MS / 60_000 },
          'Google Chat webhook falhando (verifique GOOGLE_CHAT_WEBHOOK_URL/key) — pausando notificacoes pelo cooldown',
        );
      } else {
        logger.warn({ status: response.status, responseBody }, 'Google Chat webhook failed');
      }
      return false;
    }

    chatConsecutiveFailures = 0;
    chatSkipUntil = 0;
    logger.info({ alertTitle: alert.title }, 'Alert sent to Google Chat');
    return true;
  } catch (error: any) {
    chatConsecutiveFailures += 1;
    if (chatConsecutiveFailures >= CHAT_FAIL_THRESHOLD) {
      chatSkipUntil = Date.now() + CHAT_COOLDOWN_MS;
    }
    logger.warn({ error: error.message }, 'Google Chat webhook error');
    return false;
  } finally {
    clearTimeout(timeout);
  }
}
