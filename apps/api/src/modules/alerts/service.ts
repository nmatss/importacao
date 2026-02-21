import { eq, desc, and } from 'drizzle-orm';
import { db } from '../../shared/database/connection.js';
import { alerts, systemSettings } from '../../shared/database/schema.js';
import { sendToGoogleChat } from './google-chat.service.js';
import { logger } from '../../shared/utils/logger.js';

export const alertService = {
  async list(filters?: { processId?: number; severity?: string; acknowledged?: boolean }) {
    const conditions = [];
    if (filters?.processId) conditions.push(eq(alerts.processId, filters.processId));
    if (filters?.severity) conditions.push(eq(alerts.severity, filters.severity as any));
    if (filters?.acknowledged !== undefined) conditions.push(eq(alerts.acknowledged, filters.acknowledged));

    const where = conditions.length > 0 ? and(...conditions) : undefined;
    return db.select().from(alerts).where(where).orderBy(desc(alerts.createdAt)).limit(50);
  },

  async create(data: {
    processId?: number;
    severity: 'info' | 'warning' | 'critical';
    title: string;
    message: string;
    processCode?: string;
  }) {
    const [alert] = await db.insert(alerts).values({
      processId: data.processId,
      severity: data.severity,
      title: data.title,
      message: data.message,
    }).returning();

    // Try sending to Google Chat
    try {
      const [setting] = await db.select().from(systemSettings)
        .where(eq(systemSettings.key, 'google_chat_webhook_url')).limit(1);

      const webhookUrl = setting?.value as string;
      if (webhookUrl) {
        const sent = await sendToGoogleChat(webhookUrl, { ...data, id: alert.id });
        if (sent) {
          await db.update(alerts)
            .set({ sentToChat: true, sentAt: new Date() })
            .where(eq(alerts.id, alert.id));
        }
      }
    } catch (error) {
      logger.error({ alertId: alert.id }, 'Failed to send alert to Google Chat');
    }

    return alert;
  },

  async acknowledge(id: number, userId: number) {
    const [alert] = await db.update(alerts)
      .set({ acknowledged: true, acknowledgedBy: userId, acknowledgedAt: new Date() })
      .where(eq(alerts.id, id))
      .returning();

    if (!alert) throw new Error('Alerta não encontrado');
    return alert;
  },
};
