import { eq, sql, count, desc, and, gte, ne } from 'drizzle-orm';
import { db } from '../../shared/database/connection.js';
import { importProcesses, alerts, followUpTracking } from '../../shared/database/schema.js';

export const dashboardService = {
  async getOverview() {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const [activeResult] = await db.select({ count: count() }).from(importProcesses)
      .where(and(
        ne(importProcesses.status, 'completed'),
        ne(importProcesses.status, 'cancelled')
      ));

    const [completedResult] = await db.select({ count: count() }).from(importProcesses)
      .where(and(
        eq(importProcesses.status, 'completed'),
        gte(importProcesses.updatedAt, monthStart)
      ));

    const [fobResult] = await db.select({
      total: sql<string>`COALESCE(SUM(${importProcesses.totalFobValue}), 0)`,
    }).from(importProcesses)
      .where(and(
        ne(importProcesses.status, 'cancelled')
      ));

    // Overdue: processes with LI items where shipment_date + 13 days < now
    const [overdueResult] = await db.select({ count: count() }).from(importProcesses)
      .where(and(
        eq(importProcesses.hasLiItems, true),
        ne(importProcesses.status, 'completed'),
        ne(importProcesses.status, 'cancelled'),
        sql`${importProcesses.shipmentDate}::date + interval '13 days' < now()`
      ));

    const recentAlerts = await db.select().from(alerts)
      .orderBy(desc(alerts.createdAt)).limit(5);

    const recentProcesses = await db.select().from(importProcesses)
      .orderBy(desc(importProcesses.updatedAt)).limit(10);

    return {
      activeProcesses: activeResult.count,
      overdueProcesses: overdueResult.count,
      completedThisMonth: completedResult.count,
      totalFobValue: fobResult.total,
      recentAlerts,
      recentProcesses,
    };
  },

  async getByStatus() {
    return db.select({
      status: importProcesses.status,
      count: count(),
    }).from(importProcesses)
      .groupBy(importProcesses.status);
  },

  async getByMonth() {
    return db.select({
      month: sql<string>`TO_CHAR(${importProcesses.createdAt}, 'YYYY-MM')`,
      count: count(),
    }).from(importProcesses)
      .where(gte(importProcesses.createdAt, sql`NOW() - INTERVAL '6 months'`))
      .groupBy(sql`TO_CHAR(${importProcesses.createdAt}, 'YYYY-MM')`)
      .orderBy(sql`TO_CHAR(${importProcesses.createdAt}, 'YYYY-MM')`);
  },

  async getFobByBrand() {
    return db.select({
      brand: importProcesses.brand,
      totalFob: sql<string>`COALESCE(SUM(${importProcesses.totalFobValue}), 0)`,
      count: count(),
    }).from(importProcesses)
      .where(ne(importProcesses.status, 'cancelled'))
      .groupBy(importProcesses.brand);
  },
};
