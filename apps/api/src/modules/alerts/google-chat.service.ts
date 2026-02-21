import { logger } from '../../shared/utils/logger.js';

interface Alert {
  id?: number;
  processId?: number | null;
  severity: string;
  title: string;
  message: string;
  processCode?: string;
}

function severityColor(severity: string): string {
  switch (severity) {
    case 'critical': return '#DC2626';
    case 'warning': return '#D97706';
    default: return '#2563EB';
  }
}

function severityEmoji(severity: string): string {
  switch (severity) {
    case 'critical': return '🔴';
    case 'warning': return '🟡';
    default: return '🔵';
  }
}

export function formatGoogleChatCard(alert: Alert) {
  return {
    cards: [{
      header: {
        title: `${severityEmoji(alert.severity)} ${alert.title}`,
        subtitle: alert.processCode ? `Processo: ${alert.processCode}` : 'Sistema de Importação',
        imageStyle: 'AVATAR',
      },
      sections: [{
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
      }],
    }],
  };
}

export async function sendToGoogleChat(webhookUrl: string, alert: Alert): Promise<boolean> {
  if (!webhookUrl) {
    logger.warn('Google Chat webhook URL not configured');
    return false;
  }

  try {
    const card = formatGoogleChatCard(alert);
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(card),
    });

    if (!response.ok) {
      logger.error({ status: response.status }, 'Google Chat webhook failed');
      return false;
    }

    logger.info({ alertTitle: alert.title }, 'Alert sent to Google Chat');
    return true;
  } catch (error: any) {
    logger.error({ error: error.message }, 'Google Chat webhook error');
    return false;
  }
}
