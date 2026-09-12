import { alertDeliveryTotal } from '../../shared/metrics/index.js';
import { localWeekKey } from '../../shared/utils/dates.js';
import { logger } from '../../shared/utils/logger.js';

interface Alert {
  id?: number;
  processId?: number | null;
  severity: string;
  title: string;
  message: string;
  processCode?: string;
}

/** Texto vira chave: sem acento, sem espaco, curto. */
function chavear(valor: string): string {
  return valor
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

/**
 * Sob qual topico do espaco esta mensagem cai.
 *
 * Sem `threadKey` toda mensagem abre um topico novo: em 11/09, 13 cards de
 * eventos de 3 processos sairam em ~1h30, cada um num topico proprio. Agrupar
 * por processo e o pedido da reuniao ("cuidar para nao ficar poluido").
 *
 * A chave sai do `processId` quando ele existe, e nao do codigo: o job de
 * reentrega nao carrega o codigo do processo, e duas chaves diferentes para o
 * mesmo processo partiriam a conversa em dois topicos. Mensagem sem processo
 * (digest de inatividade, falha de job) agrupa por titulo + semana, para nao
 * virar um topico eterno.
 */
export function threadKeyParaAlerta(alert: Alert, now: Date = new Date()): string {
  if (alert.processId) return `processo-${alert.processId}`;
  if (alert.processCode) return `processo-${chavear(alert.processCode)}`;
  return `sistema-${chavear(alert.title)}-${localWeekKey(now)}`;
}

/**
 * Acrescenta o topico ao URL do webhook NA HORA DO ENVIO.
 *
 * O segredo continua sendo o URL guardado (SOPS/banco), intocado; aqui so se
 * junta o parametro. `REPLY_MESSAGE_FALLBACK_TO_NEW_THREAD` garante que, se o
 * espaco nao aceitar resposta em topico, o comportamento seja o atual — topico
 * novo — em vez de erro.
 */
export function urlComTopico(webhookUrl: string, threadKey: string): string {
  try {
    const url = new URL(webhookUrl);
    url.searchParams.set('threadKey', threadKey);
    url.searchParams.set('messageReplyOption', 'REPLY_MESSAGE_FALLBACK_TO_NEW_THREAD');
    return url.toString();
  } catch {
    // URL invalido nao e problema deste modulo: o envio segue e falha (ou nao)
    // exatamente como falharia antes.
    return webhookUrl;
  }
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

  const threadKey = threadKeyParaAlerta(alert);

  try {
    const card = formatGoogleChatCard(alert);
    const response = await fetch(urlComTopico(webhookUrl, threadKey), {
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
    // Nunca o URL: ele carrega key e token do webhook.
    logger.info({ alertTitle: alert.title, threadKey }, 'Alert sent to Google Chat');
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
