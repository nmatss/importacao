import { eq, sql, count, desc, and, gte, lte, ne, isNull } from 'drizzle-orm';
import { db } from '../../shared/database/connection.js';
import { importProcesses, alerts, followUpTracking, validationResults, espelhos, currencyExchanges, users } from '../../shared/database/schema.js';

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

  async getSla() {
    // 1. docsOverdue: shipmentDate + 10 days < now AND status='draft'
    const docsOverdue = await db.select({
      id: importProcesses.id,
      processCode: importProcesses.processCode,
      brand: importProcesses.brand,
      shipmentDate: importProcesses.shipmentDate,
      daysSinceShipment: sql<number>`EXTRACT(DAY FROM now() - ${importProcesses.shipmentDate}::timestamp)::int`,
      assignedUser: users.name,
    }).from(importProcesses)
      .leftJoin(users, eq(importProcesses.createdBy, users.id))
      .where(and(
        eq(importProcesses.status, 'draft'),
        sql`${importProcesses.shipmentDate} IS NOT NULL`,
        sql`${importProcesses.shipmentDate}::date + interval '10 days' < now()`,
      ))
      .orderBy(sql`${importProcesses.shipmentDate} ASC`);

    // 2. liUrgent: hasLiItems=true AND liDeadline is approaching or passed
    const liUrgent = await db.select({
      id: importProcesses.id,
      processCode: importProcesses.processCode,
      brand: importProcesses.brand,
      liDeadline: followUpTracking.liDeadline,
      daysRemaining: sql<number>`EXTRACT(DAY FROM ${followUpTracking.liDeadline}::timestamp - now())::int`,
      status: importProcesses.status,
    }).from(importProcesses)
      .innerJoin(followUpTracking, eq(importProcesses.id, followUpTracking.processId))
      .where(and(
        eq(importProcesses.hasLiItems, true),
        ne(importProcesses.status, 'completed'),
        ne(importProcesses.status, 'cancelled'),
        sql`${followUpTracking.liDeadline} IS NOT NULL`,
      ))
      .orderBy(sql`${followUpTracking.liDeadline} ASC`);

    // 3. withDivergences: processes with failed validations not resolved
    const withDivergences = await db.select({
      id: importProcesses.id,
      processCode: importProcesses.processCode,
      brand: importProcesses.brand,
      failedCheckCount: count(),
      lastValidationDate: sql<string>`MAX(${validationResults.createdAt})`,
    }).from(validationResults)
      .innerJoin(importProcesses, eq(validationResults.processId, importProcesses.id))
      .where(and(
        eq(validationResults.status, 'failed'),
        eq(validationResults.resolvedManually, false),
        ne(importProcesses.status, 'completed'),
        ne(importProcesses.status, 'cancelled'),
      ))
      .groupBy(importProcesses.id, importProcesses.processCode, importProcesses.brand)
      .orderBy(desc(sql`MAX(${validationResults.createdAt})`));

    // 4. pendingFenicia: status='espelho_generated' but not sent to Fenicia
    const pendingFenicia = await db.select({
      id: importProcesses.id,
      processCode: importProcesses.processCode,
      brand: importProcesses.brand,
      espelhoGeneratedDate: followUpTracking.espelhoGeneratedAt,
      daysPending: sql<number>`EXTRACT(DAY FROM now() - COALESCE(${followUpTracking.espelhoGeneratedAt}, ${importProcesses.updatedAt}))::int`,
    }).from(importProcesses)
      .leftJoin(followUpTracking, eq(importProcesses.id, followUpTracking.processId))
      .where(and(
        eq(importProcesses.status, 'espelho_generated'),
      ))
      .orderBy(sql`COALESCE(${followUpTracking.espelhoGeneratedAt}, ${importProcesses.updatedAt}) ASC`);

    // 5. noEspelho: status='validated' but no espelho generated
    const noEspelho = await db.select({
      id: importProcesses.id,
      processCode: importProcesses.processCode,
      brand: importProcesses.brand,
      validatedDate: importProcesses.updatedAt,
      daysPending: sql<number>`EXTRACT(DAY FROM now() - ${importProcesses.updatedAt})::int`,
    }).from(importProcesses)
      .where(and(
        eq(importProcesses.status, 'validated'),
      ))
      .orderBy(importProcesses.updatedAt);

    // 6. noFollowUpUpdate: follow_up_tracking.updatedAt > 5 days AND process not completed
    const noFollowUpUpdate = await db.select({
      id: importProcesses.id,
      processCode: importProcesses.processCode,
      brand: importProcesses.brand,
      lastUpdateDate: followUpTracking.updatedAt,
      daysSinceUpdate: sql<number>`EXTRACT(DAY FROM now() - ${followUpTracking.updatedAt})::int`,
    }).from(followUpTracking)
      .innerJoin(importProcesses, eq(followUpTracking.processId, importProcesses.id))
      .where(and(
        ne(importProcesses.status, 'completed'),
        ne(importProcesses.status, 'cancelled'),
        sql`${followUpTracking.updatedAt} < now() - interval '5 days'`,
      ))
      .orderBy(followUpTracking.updatedAt);

    // 7. agingByUser: count open pendencias grouped by user
    const agingByUser = await db.select({
      userName: sql<string>`COALESCE(${users.name}, 'Sem usuario')`,
      pendingCount: count(),
      oldestPendingDays: sql<number>`MAX(EXTRACT(DAY FROM now() - ${importProcesses.createdAt}))::int`,
    }).from(importProcesses)
      .leftJoin(users, eq(importProcesses.createdBy, users.id))
      .where(and(
        ne(importProcesses.status, 'completed'),
        ne(importProcesses.status, 'cancelled'),
      ))
      .groupBy(users.name)
      .orderBy(desc(count()));

    // 8. upcomingPayments: currency exchanges with paymentDeadline within 7 days
    const upcomingPayments = await db.select({
      id: currencyExchanges.id,
      processId: importProcesses.id,
      processCode: importProcesses.processCode,
      amountUsd: currencyExchanges.amountUsd,
      paymentDeadline: currencyExchanges.paymentDeadline,
      daysUntilDue: sql<number>`EXTRACT(DAY FROM ${currencyExchanges.paymentDeadline}::timestamp - now())::int`,
    }).from(currencyExchanges)
      .innerJoin(importProcesses, eq(currencyExchanges.processId, importProcesses.id))
      .where(and(
        sql`${currencyExchanges.paymentDeadline} IS NOT NULL`,
        sql`${currencyExchanges.paymentDeadline}::date <= (now()::date + interval '7 days')`,
        sql`${currencyExchanges.paymentDeadline}::date >= now()::date - interval '1 day'`,
      ))
      .orderBy(sql`${currencyExchanges.paymentDeadline} ASC`);

    return {
      docsOverdue,
      liUrgent,
      withDivergences,
      pendingFenicia,
      noEspelho,
      noFollowUpUpdate,
      agingByUser,
      upcomingPayments,
      summary: {
        docsOverdue: docsOverdue.length,
        liUrgent: liUrgent.length,
        withDivergences: withDivergences.length,
        pendingFenicia: pendingFenicia.length,
        noEspelho: noEspelho.length,
        noFollowUpUpdate: noFollowUpUpdate.length,
        agingByUser: agingByUser.length,
        upcomingPayments: upcomingPayments.length,
      },
    };
  },
};
