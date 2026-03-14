import { eq, desc, and, sql, count } from 'drizzle-orm';
import { db } from '../../shared/database/connection.js';
import { alerts, systemSettings } from '../../shared/database/schema.js';
import { sendToGoogleChat } from './google-chat.service.js';
import { logger } from '../../shared/utils/logger.js';
import { auditService } from '../audit/service.js';
import { NotFoundError } from '../../shared/errors/index.js';

export const alertService = {
  async list(filters?: {
    processId?: number;
    severity?: string;
    acknowledged?: boolean;
    page?: number;
    limit?: number;
  }) {
    const page = filters?.page ?? 1;
    const limit = filters?.limit ?? 20;
    const offset = (page - 1) * limit;

    const conditions = [];
    if (filters?.processId) conditions.push(eq(alerts.processId, filters.processId));
    if (filters?.severity) conditions.push(eq(alerts.severity, filters.severity as any));
    if (filters?.acknowledged !== undefined)
      conditions.push(eq(alerts.acknowledged, filters.acknowledged));

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [data, [{ total }]] = await Promise.all([
      db
        .select()
        .from(alerts)
        .where(where)
        .orderBy(desc(alerts.createdAt))
        .limit(limit)
        .offset(offset),
      db.select({ total: count() }).from(alerts).where(where),
    ]);

    return { data, total, page, limit };
  },

  async create(data: {
    processId?: number;
    severity: 'info' | 'warning' | 'critical';
    title: string;
    message: string;
    processCode?: string;
  }) {
    // Skip duplicate alerts (same processId + title within 24h)
    const isDuplicate = await this.hasDuplicateRecent(data.processId, data.title);
    if (isDuplicate) {
      const [existing] = await db
        .select()
        .from(alerts)
        .where(
          and(
            eq(alerts.processId, data.processId!),
            eq(alerts.title, data.title),
            sql`${alerts.createdAt} > NOW() - INTERVAL '24 hours'`,
          ),
        )
        .orderBy(desc(alerts.createdAt))
        .limit(1);
      return existing;
    }

    const [alert] = await db
      .insert(alerts)
      .values({
        processId: data.processId,
        severity: data.severity,
        title: data.title,
        message: data.message,
      })
      .returning();

    // Try sending to Google Chat
    try {
      const [setting] = await db
        .select()
        .from(systemSettings)
        .where(eq(systemSettings.key, 'google_chat_webhook_url'))
        .limit(1);

      const webhookUrl = (setting?.value as string) || process.env.GOOGLE_CHAT_WEBHOOK_URL;
      if (webhookUrl) {
        const sent = await sendToGoogleChat(webhookUrl, { ...data, id: alert.id });
        if (sent) {
          await db
            .update(alerts)
            .set({ sentToChat: true, sentAt: new Date() })
            .where(eq(alerts.id, alert.id));
        }
      }
    } catch (error) {
      logger.error({ alertId: alert.id }, 'Failed to send alert to Google Chat');
    }

    auditService.log(
      null,
      'alert_created',
      'alert',
      alert.id,
      { severity: data.severity, title: data.title },
      null,
    );

    return alert;
  },

  async hasDuplicateRecent(processId: number | undefined, title: string): Promise<boolean> {
    if (!processId) return false;
    const [existing] = await db
      .select({ id: alerts.id })
      .from(alerts)
      .where(
        and(
          eq(alerts.processId, processId),
          eq(alerts.title, title),
          sql`${alerts.createdAt} > NOW() - INTERVAL '24 hours'`,
        ),
      )
      .limit(1);
    return !!existing;
  },

  async acknowledge(id: number, userId: number) {
    const [alert] = await db
      .update(alerts)
      .set({ acknowledged: true, acknowledgedBy: userId, acknowledgedAt: new Date() })
      .where(eq(alerts.id, id))
      .returning();

    if (!alert) throw new NotFoundError('Alerta não encontrado');
    auditService.log(userId, 'acknowledge', 'alert', id, null, null);
    return alert;
  },
};
