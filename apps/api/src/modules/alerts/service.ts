import { eq, desc, and, sql, count } from 'drizzle-orm';
import { db } from '../../shared/database/connection.js';
import { alerts } from '../../shared/database/schema.js';
import { attemptDelivery } from './delivery.service.js';
import { auditService } from '../audit/service.js';
import { NotFoundError } from '../../shared/errors/index.js';
import { localDayStartUtc, localDayEndExclusiveUtc } from '../../shared/utils/dates.js';

export const alertService = {
  async list(filters?: {
    processId?: number;
    severity?: string;
    acknowledged?: boolean;
    startDate?: string;
    endDate?: string;
    page?: number;
    limit?: number;
  }) {
    const page = filters?.page ?? 1;
    const limit = filters?.limit ?? 20;
    const offset = (page - 1) * limit;

    const conditions = [];
    if (filters?.processId) conditions.push(eq(alerts.processId, filters.processId));
    if (filters?.severity)
      conditions.push(
        eq(alerts.severity, filters.severity as (typeof alerts.severity.enumValues)[number]),
      );
    if (filters?.acknowledged !== undefined)
      conditions.push(eq(alerts.acknowledged, filters.acknowledged));
    // O dia escolhido no calendario local vira o intervalo UTC equivalente.
    const start = filters?.startDate ? localDayStartUtc(filters.startDate) : null;
    if (start) {
      conditions.push(sql`${alerts.createdAt} >= ${start.toISOString()}`);
    }
    // Limite superior EXCLUSIVO: inicio do dia local seguinte, em UTC.
    const end = filters?.endDate ? localDayEndExclusiveUtc(filters.endDate) : null;
    if (end) {
      conditions.push(sql`${alerts.createdAt} < ${end.toISOString()}`);
    }

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
    // Skip duplicate alerts (same processId + title within 24h). When there is
    // no processId (e.g. recurring cron failures like logistic-sync), dedupe by
    // title alone within the window so a failing job does not create ~48
    // identical alerts/day (alert storm).
    const isDuplicate = await this.hasDuplicateRecent(data.processId, data.title);
    if (isDuplicate) {
      const [existing] = await db
        .select()
        .from(alerts)
        .where(
          and(
            data.processId
              ? eq(alerts.processId, data.processId)
              : sql`${alerts.processId} IS NULL`,
            eq(alerts.title, data.title),
            sql`${alerts.createdAt} > NOW() - INTERVAL '24 hours'`,
          ),
        )
        .orderBy(desc(alerts.createdAt))
        .limit(1);

      // A deduplicacao continua correta — errado era pular a ENTREGA junto com
      // a criacao. Se a primeira tentativa da janela falhava, nenhuma das
      // seguintes era sequer tentada: e o caso de `Falha no job: sydle-sync`,
      // criado todo dia de 08/08 a 13/08 e nunca entregue.
      if (existing && existing.sentToChat !== true) {
        await attemptDelivery({ ...existing, processCode: data.processCode });
      }
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

    // Uma unica tentativa aqui; o que nao entregar fica com `sent_to_chat`
    // falso e o job `alert-redelivery` volta nele com backoff.
    await attemptDelivery({ ...alert, processCode: data.processCode });

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

  /**
   * @param windowHours janela da deduplicacao. O padrao de 24h serve para o
   *   caso comum (job diario). O `stalled-process` passa uma janela maior,
   *   casada com o espacamento dos marcos de escalada: assim um marco alerta
   *   uma vez por episodio de parada, sobrevive a uma execucao perdida do cron,
   *   e volta a alertar se o processo parar de novo depois de trabalhado.
   */
  async hasDuplicateRecent(
    processId: number | undefined,
    title: string,
    windowHours = 24,
  ): Promise<boolean> {
    // Dedupe by processId + title when a process is set; otherwise (cron alerts
    // with no processId) dedupe by title alone, matching only rows where
    // processId IS NULL, so recurring job failures collapse into one alert.
    const horas = Number.isFinite(windowHours) && windowHours > 0 ? Math.floor(windowHours) : 24;
    const [existing] = await db
      .select({ id: alerts.id })
      .from(alerts)
      .where(
        and(
          processId ? eq(alerts.processId, processId) : sql`${alerts.processId} IS NULL`,
          eq(alerts.title, title),
          sql`${alerts.createdAt} > NOW() - (${horas} * INTERVAL '1 hour')`,
        ),
      )
      .limit(1);
    return !!existing;
  },

  /**
   * Dedupe forte para jobs recorrentes: existe alerta NÃO reconhecido com o
   * mesmo título para o processo (sem janela de tempo)? Evita recriar o mesmo
   * alerta a cada execução diária enquanto ninguém o trata.
   */
  async hasActiveAlert(processId: number, title: string): Promise<boolean> {
    const [existing] = await db
      .select({ id: alerts.id })
      .from(alerts)
      .where(
        and(
          eq(alerts.processId, processId),
          eq(alerts.title, title),
          eq(alerts.acknowledged, false),
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
