import { eq, desc, and, gte, lte, count, sql } from 'drizzle-orm';
import { db } from '../../shared/database/connection.js';
import { auditLogs, users } from '../../shared/database/schema.js';
import { logger } from '../../shared/utils/logger.js';

export interface AuditLogFilters {
  page: number;
  limit: number;
  action?: string;
  entityType?: string;
  entityId?: number;
  userId?: number;
  startDate?: string;
  endDate?: string;
}

export const auditService = {
  async log(
    userId: number | null,
    action: string,
    entityType: string | null,
    entityId: number | null,
    details: Record<string, unknown> | null,
    ipAddress: string | null,
  ) {
    try {
      await db.insert(auditLogs).values({
        userId,
        action,
        entityType,
        entityId,
        details,
        ipAddress,
      });
    } catch (err) {
      logger.error({ err, action, entityType, entityId }, 'Failed to write audit log');
    }
  },

  async getLogs(filters: AuditLogFilters) {
    const conditions = [];

    if (filters.action) conditions.push(eq(auditLogs.action, filters.action));
    if (filters.entityType) conditions.push(eq(auditLogs.entityType, filters.entityType));
    if (filters.entityId) conditions.push(eq(auditLogs.entityId, filters.entityId));
    if (filters.userId) conditions.push(eq(auditLogs.userId, filters.userId));
    if (filters.startDate) conditions.push(gte(auditLogs.createdAt, new Date(filters.startDate)));
    if (filters.endDate) conditions.push(lte(auditLogs.createdAt, new Date(filters.endDate)));

    const where = conditions.length > 0 ? and(...conditions) : undefined;
    const offset = (filters.page - 1) * filters.limit;

    const [data, [{ total }]] = await Promise.all([
      db
        .select({
          id: auditLogs.id,
          userId: auditLogs.userId,
          userName: users.name,
          action: auditLogs.action,
          entityType: auditLogs.entityType,
          entityId: auditLogs.entityId,
          details: auditLogs.details,
          ipAddress: auditLogs.ipAddress,
          createdAt: auditLogs.createdAt,
        })
        .from(auditLogs)
        .leftJoin(users, eq(auditLogs.userId, users.id))
        .where(where)
        .orderBy(desc(auditLogs.createdAt))
        .limit(filters.limit)
        .offset(offset),
      db.select({ total: count() }).from(auditLogs).where(where),
    ]);

    return { data, total, page: filters.page, limit: filters.limit };
  },
};
