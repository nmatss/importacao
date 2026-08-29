import { eq, sql, count, desc, and, gte, ne } from 'drizzle-orm';
import { db } from '../../shared/database/connection.js';
import {
  importProcesses,
  alerts,
  followUpTracking,
  validationResults,
  currencyExchanges,
  users,
} from '../../shared/database/schema.js';
import { cache } from '../../shared/cache/redis.js';
import { logger } from '../../shared/utils/logger.js';
import { localMonthStartUtc, SQL_HOJE_LOCAL, sqlLocalDeUtc } from '../../shared/utils/dates.js';
import {
  statusEnteredAt,
  withUpdatedAtFallback,
  isApproximate,
  approximateCount,
} from './event-dates.js';

/**
 * Safe JSON.parse for cache entries: on malformed JSON, logs a warning and
 * returns null so the caller can treat it as a cache miss and recompute.
 * Without this wrapper a corrupted Redis value propagates as a SyntaxError
 * all the way up to the error-handler, which would try to map it to a
 * request-body parse error and return 400 — totally misleading.
 */
function parseCachedOrNull<T>(raw: string, key: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch (err) {
    logger.warn({ err, cacheKey: key }, 'Corrupted cache entry — treating as miss');
    return null;
  }
}

/**
 * Janela, em dias, que define uma LI como urgente no painel de SLA.
 *
 * PARAMETRO DE NEGOCIO: o valor abaixo e o default operacional e deve ser
 * confirmado com o time fiscal. `calculateLiDeadline` usa embarque + 13 dias,
 * entao 15 dias cobre o prazo inteiro mais uma folga curta.
 */
const LI_URGENT_WINDOW_DAYS = 15;

export const dashboardService = {
  async getOverview() {
    const cached = await cache.get('dashboard:overview');
    if (cached) {
      const parsed = parseCachedOrNull<any>(cached, 'dashboard:overview');
      if (parsed !== null) return parsed;
    }

    // Ver a nota em `localMonthStartUtc`: o recorte mensal precisa da meia-noite
    // local, nao da meia-noite UTC.
    const monthStart = localMonthStartUtc(0);

    // Data real da conclusao (evento append-only), nao `updatedAt`. Ver a nota
    // em event-dates.ts.
    const completedAt = statusEnteredAt('completed');

    const [
      [activeResult],
      [completedResult],
      [fobResult],
      [overdueResult],
      recentAlerts,
      recentProcesses,
    ] = await Promise.all([
      db
        .select({ count: count() })
        .from(importProcesses)
        .where(
          and(ne(importProcesses.status, 'completed'), ne(importProcesses.status, 'cancelled')),
        ),
      db
        .select({
          count: count(),
          approximateCount: approximateCount(completedAt),
        })
        .from(importProcesses)
        .where(
          and(
            eq(importProcesses.status, 'completed'),
            sql`${withUpdatedAtFallback(completedAt)} >= ${monthStart.toISOString()}`,
          ),
        ),
      db
        .select({
          total: sql<string>`COALESCE(SUM(${importProcesses.totalFobValue}), 0)`,
        })
        .from(importProcesses)
        .where(and(ne(importProcesses.status, 'cancelled'))),
      db
        .select({ count: count() })
        .from(importProcesses)
        .where(
          and(
            eq(importProcesses.hasLiItems, true),
            ne(importProcesses.status, 'completed'),
            ne(importProcesses.status, 'cancelled'),
            sql`${importProcesses.shipmentDate}::date + 13 < ${sql.raw(SQL_HOJE_LOCAL)}`,
          ),
        ),
      db.select().from(alerts).orderBy(desc(alerts.createdAt)).limit(5),
      // Projecao explicita: `db.select()` trazia os registros COMPLETOS —
      // incluindo `aiExtractedData jsonb` — para exibir 5 colunas.
      // Ordenacao por `createdAt DESC` (era `updatedAt DESC`) para casar com a
      // coluna "Data Criacao" que a tabela do front mostra; `updatedAt` vai
      // junto para quem quiser rotular a ultima edicao.
      db
        .select({
          id: importProcesses.id,
          processCode: importProcesses.processCode,
          brand: importProcesses.brand,
          status: importProcesses.status,
          etd: importProcesses.etd,
          createdAt: importProcesses.createdAt,
          updatedAt: importProcesses.updatedAt,
        })
        .from(importProcesses)
        .orderBy(desc(importProcesses.createdAt))
        .limit(10),
    ]);

    const result = {
      activeProcesses: activeResult.count,
      overdueProcesses: overdueResult.count,
      completedThisMonth: completedResult.count,
      // Quantos dos concluidos acima nao tinham evento `status_changed` e
      // cairam no fallback `updatedAt` — o numero e aproximado quando > 0.
      completedThisMonthApproximate: completedResult.approximateCount > 0,
      completedThisMonthFallbackCount: completedResult.approximateCount,
      totalFobValue: fobResult.total,
      recentAlerts,
      recentProcesses,
    };

    await cache.set('dashboard:overview', JSON.stringify(result), 60);
    return result;
  },

  async getByStatus() {
    return db
      .select({
        status: importProcesses.status,
        count: count(),
      })
      .from(importProcesses)
      .groupBy(importProcesses.status);
  },

  async getByMonth() {
    return db
      .select({
        month: sql<string>`TO_CHAR(${sql.raw(sqlLocalDeUtc('"import_processes"."created_at"'))}, 'YYYY-MM')`,
        count: count(),
        fobValue: sql<string>`COALESCE(SUM(${importProcesses.totalFobValue}), 0)`,
      })
      .from(importProcesses)
      .where(gte(importProcesses.createdAt, sql`NOW() - INTERVAL '6 months'`))
      .groupBy(
        sql`TO_CHAR(${sql.raw(sqlLocalDeUtc('"import_processes"."created_at"'))}, 'YYYY-MM')`,
      )
      .orderBy(
        sql`TO_CHAR(${sql.raw(sqlLocalDeUtc('"import_processes"."created_at"'))}, 'YYYY-MM')`,
      );
  },

  async getFobByBrand() {
    return db
      .select({
        brand: importProcesses.brand,
        totalFob: sql<string>`COALESCE(SUM(${importProcesses.totalFobValue}), 0)`,
        count: count(),
      })
      .from(importProcesses)
      .where(ne(importProcesses.status, 'cancelled'))
      .groupBy(importProcesses.brand);
  },

  async getSla() {
    const cached = await cache.get('dashboard:sla');
    if (cached) {
      const parsed = parseCachedOrNull<any>(cached, 'dashboard:sla');
      if (parsed !== null) return parsed;
    }

    // Marcos reais, append-only. `espelhoGeneratedAt` (follow_up_tracking) e a
    // fonte primaria de "espelho gerado" porque e o proprio marco de negocio; a
    // transicao de status entra como segunda fonte, e `updatedAt` so como
    // ultimo recurso (processos antigos). Ver event-dates.ts.
    const espelhoGeneratedEventAt = statusEnteredAt('espelho_generated');
    const espelhoAt = sql<Date>`COALESCE(${followUpTracking.espelhoGeneratedAt}, ${espelhoGeneratedEventAt}, ${importProcesses.updatedAt})`;
    const espelhoAtIsApprox = sql<boolean>`(${followUpTracking.espelhoGeneratedAt} IS NULL AND ${espelhoGeneratedEventAt} IS NULL)`;
    const validatedAtEvent = statusEnteredAt('validated');
    const validatedAt = withUpdatedAtFallback(validatedAtEvent);

    const [
      docsOverdue,
      liUrgent,
      withDivergences,
      pendingFenicia,
      noEspelho,
      noFollowUpUpdate,
      agingByUser,
      upcomingPayments,
    ] = await Promise.all([
      // 1. docsOverdue: shipmentDate + 10 days < now AND status='draft'
      db
        .select({
          id: importProcesses.id,
          processCode: importProcesses.processCode,
          brand: importProcesses.brand,
          shipmentDate: importProcesses.shipmentDate,
          daysSinceShipment: sql<number>`EXTRACT(DAY FROM now() - ${importProcesses.shipmentDate}::timestamp)::int`,
          assignedUser: users.name,
        })
        .from(importProcesses)
        .leftJoin(users, eq(importProcesses.createdBy, users.id))
        .where(
          and(
            eq(importProcesses.status, 'draft'),
            sql`${importProcesses.shipmentDate} IS NOT NULL`,
            sql`${importProcesses.shipmentDate}::date + 10 < ${sql.raw(SQL_HOJE_LOCAL)}`,
          ),
        )
        .orderBy(sql`${importProcesses.shipmentDate} ASC`),

      // 2. liUrgent: LI cujo prazo ja venceu ou vence dentro da janela de
      //    urgencia. Antes o WHERE so exigia hasLiItems + status aberto +
      //    liDeadline NOT NULL, entao TODA LI em aberto contava como urgente:
      //    um prazo daqui a seis meses inflava o cartao "LI Urgente" do painel
      //    de SLA e o "prazo critico" do Meu Dia. O rotulo prometia urgencia e
      //    a consulta entregava o total.
      db
        .select({
          id: importProcesses.id,
          processCode: importProcesses.processCode,
          brand: importProcesses.brand,
          liDeadline: followUpTracking.liDeadline,
          daysRemaining: sql<number>`(${followUpTracking.liDeadline}::date - ${sql.raw(SQL_HOJE_LOCAL)})::int`,
          status: importProcesses.status,
        })
        .from(importProcesses)
        .innerJoin(followUpTracking, eq(importProcesses.id, followUpTracking.processId))
        .where(
          and(
            eq(importProcesses.hasLiItems, true),
            ne(importProcesses.status, 'completed'),
            ne(importProcesses.status, 'cancelled'),
            sql`${followUpTracking.liDeadline} IS NOT NULL`,
            sql`${followUpTracking.liDeadline}::date <= (now() AT TIME ZONE 'America/Sao_Paulo')::date + make_interval(days => ${LI_URGENT_WINDOW_DAYS})`,
          ),
        )
        .orderBy(sql`${followUpTracking.liDeadline} ASC`),

      // 3. withDivergences: processes with failed validations not resolved
      db
        .select({
          id: importProcesses.id,
          processCode: importProcesses.processCode,
          brand: importProcesses.brand,
          failedCheckCount: count(),
          lastValidationDate: sql<string>`MAX(${validationResults.createdAt})`,
        })
        .from(validationResults)
        .innerJoin(importProcesses, eq(validationResults.processId, importProcesses.id))
        .where(
          and(
            eq(validationResults.status, 'failed'),
            eq(validationResults.resolvedManually, false),
            ne(importProcesses.status, 'completed'),
            ne(importProcesses.status, 'cancelled'),
          ),
        )
        .groupBy(importProcesses.id, importProcesses.processCode, importProcesses.brand)
        .orderBy(desc(sql`MAX(${validationResults.createdAt})`)),

      // 4. pendingFenicia: status='espelho_generated' but not sent to Fenicia
      db
        .select({
          id: importProcesses.id,
          processCode: importProcesses.processCode,
          brand: importProcesses.brand,
          espelhoGeneratedDate: espelhoAt,
          // `updatedAt` como data do espelho era falso: qualquer edicao no
          // processo zerava o "dias parado" deste cartao.
          espelhoGeneratedDateApproximate: espelhoAtIsApprox,
          daysPending: sql<number>`EXTRACT(DAY FROM now() - ${espelhoAt})::int`,
        })
        .from(importProcesses)
        .leftJoin(followUpTracking, eq(importProcesses.id, followUpTracking.processId))
        .where(and(eq(importProcesses.status, 'espelho_generated')))
        .orderBy(sql`${espelhoAt} ASC`),

      // 5. noEspelho: status='validated' but no espelho generated
      db
        .select({
          id: importProcesses.id,
          processCode: importProcesses.processCode,
          brand: importProcesses.brand,
          // Momento em que o processo ENTROU em 'validated' (process_events),
          // nao a ultima edicao qualquer do registro.
          validatedDate: validatedAt,
          validatedDateApproximate: isApproximate(validatedAtEvent),
          daysPending: sql<number>`EXTRACT(DAY FROM now() - ${validatedAt})::int`,
        })
        .from(importProcesses)
        .where(and(eq(importProcesses.status, 'validated')))
        .orderBy(sql`${validatedAt} ASC`),

      // 6. noFollowUpUpdate: follow_up_tracking.updatedAt > 5 days AND process not completed
      db
        .select({
          id: importProcesses.id,
          processCode: importProcesses.processCode,
          brand: importProcesses.brand,
          lastUpdateDate: followUpTracking.updatedAt,
          daysSinceUpdate: sql<number>`EXTRACT(DAY FROM now() - ${followUpTracking.updatedAt})::int`,
        })
        .from(followUpTracking)
        .innerJoin(importProcesses, eq(followUpTracking.processId, importProcesses.id))
        .where(
          and(
            ne(importProcesses.status, 'completed'),
            ne(importProcesses.status, 'cancelled'),
            sql`${followUpTracking.updatedAt} < now() - interval '5 days'`,
          ),
        )
        .orderBy(followUpTracking.updatedAt),

      // 7. agingByUser: count open pendencias grouped by user
      //    Agrupa pelo ID do usuario, nao pelo nome: dois "Ana Silva"
      //    colapsavam numa unica linha com a soma das pendencias das duas.
      db
        .select({
          userId: importProcesses.createdBy,
          userName: sql<string>`COALESCE(${users.name}, 'Sem usuario')`,
          pendingCount: count(),
          oldestPendingDays: sql<number>`MAX(EXTRACT(DAY FROM now() - ${importProcesses.createdAt}))::int`,
        })
        .from(importProcesses)
        .leftJoin(users, eq(importProcesses.createdBy, users.id))
        .where(
          and(ne(importProcesses.status, 'completed'), ne(importProcesses.status, 'cancelled')),
        )
        .groupBy(importProcesses.createdBy, users.name)
        .orderBy(desc(count())),

      // 8. upcomingPayments: currency exchanges with paymentDeadline within 7 days
      db
        .select({
          id: currencyExchanges.id,
          processId: importProcesses.id,
          processCode: importProcesses.processCode,
          amountUsd: currencyExchanges.amountUsd,
          paymentDeadline: currencyExchanges.paymentDeadline,
          daysUntilDue: sql<number>`(${currencyExchanges.paymentDeadline}::date - ${sql.raw(SQL_HOJE_LOCAL)})::int`,
        })
        .from(currencyExchanges)
        .innerJoin(importProcesses, eq(currencyExchanges.processId, importProcesses.id))
        .where(
          and(
            sql`${currencyExchanges.paymentDeadline} IS NOT NULL`,
            sql`${currencyExchanges.paymentDeadline}::date <= (${sql.raw(SQL_HOJE_LOCAL)} + 7)`,
            sql`${currencyExchanges.paymentDeadline}::date >= (${sql.raw(SQL_HOJE_LOCAL)} - 1)`,
          ),
        )
        .orderBy(sql`${currencyExchanges.paymentDeadline} ASC`),
    ]);

    const slaResult = {
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

    await cache.set('dashboard:sla', JSON.stringify(slaResult), 60);
    return slaResult;
  },
};
