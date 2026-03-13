import { sql, count, eq, ne, and, gte } from 'drizzle-orm';
import { db } from '../../shared/database/connection.js';
import { importProcesses, validationResults, currencyExchanges, espelhos, communications } from '../../shared/database/schema.js';

export const executiveService = {
  async getExecutiveKpis() {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);

    const [
      totalProcesses,
      activeProcesses,
      completedThisMonth,
      completedLastMonth,
      totalFobThisMonth,
      totalFobLastMonth,
      avgValidationPassRate,
      pendingPayments,
      espelhosGenerated,
      emailsSent,
    ] = await Promise.all([
      // Total processes
      db.select({ count: count() }).from(importProcesses),
      // Active processes
      db.select({ count: count() }).from(importProcesses)
        .where(and(ne(importProcesses.status, 'completed'), ne(importProcesses.status, 'cancelled'))),
      // Completed this month
      db.select({ count: count() }).from(importProcesses)
        .where(and(eq(importProcesses.status, 'completed'), gte(importProcesses.updatedAt, monthStart))),
      // Completed last month
      db.select({ count: count() }).from(importProcesses)
        .where(and(eq(importProcesses.status, 'completed'), gte(importProcesses.updatedAt, lastMonthStart), sql`${importProcesses.updatedAt} < ${monthStart}`)),
      // FOB this month
      db.select({ total: sql<string>`COALESCE(SUM(${importProcesses.totalFobValue}), 0)` }).from(importProcesses)
        .where(and(gte(importProcesses.createdAt, monthStart), ne(importProcesses.status, 'cancelled'))),
      // FOB last month
      db.select({ total: sql<string>`COALESCE(SUM(${importProcesses.totalFobValue}), 0)` }).from(importProcesses)
        .where(and(gte(importProcesses.createdAt, lastMonthStart), sql`${importProcesses.createdAt} < ${monthStart}`, ne(importProcesses.status, 'cancelled'))),
      // Avg validation pass rate
      db.select({
        total: count(),
        passed: sql<number>`COUNT(*) FILTER (WHERE ${validationResults.status} = 'passed')`,
      }).from(validationResults),
      // Pending payments (next 30 days)
      db.select({ count: count(), total: sql<string>`COALESCE(SUM(${currencyExchanges.amountUsd}), 0)` })
        .from(currencyExchanges)
        .where(and(
          sql`${currencyExchanges.paymentDeadline} IS NOT NULL`,
          sql`${currencyExchanges.paymentDeadline}::date <= (now()::date + interval '30 days')`,
          sql`${currencyExchanges.paymentDeadline}::date >= now()::date`,
        )),
      // Espelhos generated this month
      db.select({ count: count() }).from(espelhos)
        .where(gte(espelhos.createdAt, monthStart)),
      // Emails sent this month
      db.select({ count: count() }).from(communications)
        .where(and(eq(communications.status, 'sent'), gte(communications.sentAt, monthStart))),
    ]);

    const completedChange = completedLastMonth[0].count > 0
      ? ((completedThisMonth[0].count - completedLastMonth[0].count) / completedLastMonth[0].count * 100)
      : 0;

    const fobChange = Number(totalFobLastMonth[0].total) > 0
      ? ((Number(totalFobThisMonth[0].total) - Number(totalFobLastMonth[0].total)) / Number(totalFobLastMonth[0].total) * 100)
      : 0;

    const passRate = avgValidationPassRate[0].total > 0
      ? (avgValidationPassRate[0].passed / avgValidationPassRate[0].total * 100)
      : 0;

    return {
      totalProcesses: totalProcesses[0].count,
      activeProcesses: activeProcesses[0].count,
      completedThisMonth: completedThisMonth[0].count,
      completedChange: Math.round(completedChange),
      totalFobThisMonth: totalFobThisMonth[0].total,
      fobChange: Math.round(fobChange),
      validationPassRate: Math.round(passRate),
      pendingPayments: {
        count: pendingPayments[0].count,
        totalUsd: pendingPayments[0].total,
      },
      espelhosGenerated: espelhosGenerated[0].count,
      emailsSent: emailsSent[0].count,
    };
  },

  async getProcessingTimeline() {
    // Average days per stage
    return db.select({
      status: importProcesses.status,
      count: count(),
      avgDaysInStatus: sql<number>`AVG(EXTRACT(DAY FROM now() - ${importProcesses.updatedAt}))::int`,
    }).from(importProcesses)
      .where(and(ne(importProcesses.status, 'completed'), ne(importProcesses.status, 'cancelled')))
      .groupBy(importProcesses.status);
  },
};
