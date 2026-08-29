import { sql, count, eq, ne, and, gte } from 'drizzle-orm';
import { db } from '../../shared/database/connection.js';
import {
  importProcesses,
  validationResults,
  validationResultHistory,
  currencyExchanges,
  espelhos,
  communications,
} from '../../shared/database/schema.js';
import { localMonthStartUtc } from '../../shared/utils/dates.js';
import {
  statusEnteredAt,
  currentStatusEnteredAt,
  withUpdatedAtFallback,
  approximateCount,
} from './event-dates.js';

export const executiveService = {
  async getExecutiveKpis() {
    // Recorte mensal no fuso da operacao. Com o container em UTC,
    // `new Date(now.getFullYear(), now.getMonth(), 1)` era a meia-noite UTC do
    // dia 1 — 21:00 do ultimo dia do mes anterior em Brasilia — e as tres
    // ultimas horas do mes passado eram contadas no mes corrente.
    const monthStart = localMonthStartUtc(0);
    const lastMonthStart = localMonthStartUtc(-1);
    const monthStartStr = monthStart.toISOString();

    // Data real da conclusao (process_events), com fallback documentado para
    // processos anteriores a essa tabela. Ver event-dates.ts.
    const completedAtEvent = statusEnteredAt('completed');
    const completedAt = withUpdatedAtFallback(completedAtEvent);

    const [
      totalProcesses,
      activeProcesses,
      completedThisMonth,
      completedLastMonth,
      totalFobThisMonth,
      totalFobLastMonth,
      avgValidationPassRate,
      monthChecksLive,
      monthChecksHistory,
      pendingPayments,
      espelhosGenerated,
      emailsSent,
    ] = await Promise.all([
      // Total processes
      db.select({ count: count() }).from(importProcesses),
      // Active processes
      db
        .select({ count: count() })
        .from(importProcesses)
        .where(
          and(ne(importProcesses.status, 'completed'), ne(importProcesses.status, 'cancelled')),
        ),
      // Completed this month
      db
        .select({ count: count(), approximateCount: approximateCount(completedAtEvent) })
        .from(importProcesses)
        .where(
          and(eq(importProcesses.status, 'completed'), sql`${completedAt} >= ${monthStartStr}`),
        ),
      // Completed last month
      db
        .select({ count: count(), approximateCount: approximateCount(completedAtEvent) })
        .from(importProcesses)
        .where(
          and(
            eq(importProcesses.status, 'completed'),
            sql`${completedAt} >= ${lastMonthStart.toISOString()}`,
            sql`${completedAt} < ${monthStartStr}`,
          ),
        ),
      // FOB this month
      db
        .select({ total: sql<string>`COALESCE(SUM(${importProcesses.totalFobValue}), 0)` })
        .from(importProcesses)
        .where(
          and(gte(importProcesses.createdAt, monthStart), ne(importProcesses.status, 'cancelled')),
        ),
      // FOB last month
      db
        .select({ total: sql<string>`COALESCE(SUM(${importProcesses.totalFobValue}), 0)` })
        .from(importProcesses)
        .where(
          and(
            gte(importProcesses.createdAt, lastMonthStart),
            sql`${importProcesses.createdAt} < ${monthStartStr}`,
            ne(importProcesses.status, 'cancelled'),
          ),
        ),
      // RETRATO, nao taxa: `validation_results` guarda apenas o resultado VIVO
      // de cada processo (runAllChecks apaga e recria as linhas a cada
      // validacao final), entao isto e o ESTADO ATUAL de todos os processos.
      // Continua exposto como `validationPassRate` so por compatibilidade com o
      // frontend; o nome honesto e `currentChecksPassRate`.
      db
        .select({
          total: sql<number>`COUNT(*) FILTER (WHERE ${validationResults.status} IN ('passed', 'failed'))`,
          passed: sql<number>`COUNT(*) FILTER (WHERE ${validationResults.status} = 'passed')`,
        })
        .from(validationResults),
      // TAXA de verdade, com recorte temporal. As checagens do mes vivem em
      // dois lugares append-only: as linhas da rodada atual
      // (`validation_results.created_at`) e as rodadas ja arquivadas
      // (`validation_result_history.run_at`). Somar as duas evita contar a
      // mesma rodada duas vezes — history so recebe a linha DEPOIS que ela sai
      // de validation_results.
      db
        .select({
          total: sql<number>`COUNT(*) FILTER (WHERE ${validationResults.status} IN ('passed', 'failed'))`,
          passed: sql<number>`COUNT(*) FILTER (WHERE ${validationResults.status} = 'passed')`,
        })
        .from(validationResults)
        .where(gte(validationResults.createdAt, monthStart)),
      db
        .select({
          total: sql<number>`COUNT(*) FILTER (WHERE ${validationResultHistory.status} IN ('passed', 'failed'))`,
          passed: sql<number>`COUNT(*) FILTER (WHERE ${validationResultHistory.status} = 'passed')`,
        })
        .from(validationResultHistory)
        .where(gte(validationResultHistory.runAt, monthStart)),
      // Pending payments (next 30 days).
      // O agregado nao tinha join com import_processes, entao pagamentos de
      // processos CANCELADOS entravam no KPI. E o recorte usava `now()::date`,
      // que num container UTC vira o dia seguinte a partir das 21:00 de
      // Brasilia — o intervalo de 30 dias andava um dia antes da hora.
      db
        .select({
          count: count(),
          total: sql<string>`COALESCE(SUM(${currencyExchanges.amountUsd}), 0)`,
        })
        .from(currencyExchanges)
        .innerJoin(importProcesses, eq(currencyExchanges.processId, importProcesses.id))
        .where(
          and(
            ne(importProcesses.status, 'cancelled'),
            sql`${currencyExchanges.paymentDeadline} IS NOT NULL`,
            sql`${currencyExchanges.paymentDeadline}::date <= ((now() AT TIME ZONE 'America/Sao_Paulo')::date + interval '30 days')`,
            sql`${currencyExchanges.paymentDeadline}::date >= (now() AT TIME ZONE 'America/Sao_Paulo')::date`,
          ),
        ),
      // Espelhos generated this month
      db.select({ count: count() }).from(espelhos).where(gte(espelhos.createdAt, monthStart)),
      // Emails sent this month
      db
        .select({ count: count() })
        .from(communications)
        .where(and(eq(communications.status, 'sent'), gte(communications.sentAt, monthStart))),
    ]);

    const completedChange =
      completedLastMonth[0].count > 0
        ? ((completedThisMonth[0].count - completedLastMonth[0].count) /
            completedLastMonth[0].count) *
          100
        : 0;

    const fobChange =
      Number(totalFobLastMonth[0].total) > 0
        ? ((Number(totalFobThisMonth[0].total) - Number(totalFobLastMonth[0].total)) /
            Number(totalFobLastMonth[0].total)) *
          100
        : 0;

    const passRate =
      avgValidationPassRate[0].total > 0
        ? (avgValidationPassRate[0].passed / avgValidationPassRate[0].total) * 100
        : 0;

    const monthTotal = Number(monthChecksLive[0].total) + Number(monthChecksHistory[0].total);
    const monthPassed = Number(monthChecksLive[0].passed) + Number(monthChecksHistory[0].passed);
    const monthPassRate = monthTotal > 0 ? (monthPassed / monthTotal) * 100 : 0;

    const completedFallback =
      completedThisMonth[0].approximateCount + completedLastMonth[0].approximateCount;

    return {
      totalProcesses: totalProcesses[0].count,
      activeProcesses: activeProcesses[0].count,
      completedThisMonth: completedThisMonth[0].count,
      completedChange: Math.round(completedChange),
      // Verdadeiro quando algum dos processos contados nao tinha evento
      // `status_changed` e a data de conclusao veio do fallback `updatedAt`.
      completedApproximate: completedFallback > 0,
      completedFallbackCount: completedFallback,
      totalFobThisMonth: totalFobThisMonth[0].total,
      fobChange: Math.round(fobChange),
      // DEPRECADO: mantido para nao quebrar o frontend. Nao e uma taxa ao longo
      // do tempo — e o retrato do estado atual. Use `currentChecksPassRate`
      // (mesmo numero, nome honesto) ou `validationPassRateThisMonth`.
      validationPassRate: Math.round(passRate),
      currentChecksPassRate: Math.round(passRate),
      currentChecksSampleSize: Number(avgValidationPassRate[0].total),
      validationPassRateThisMonth: Math.round(monthPassRate),
      validationPassRateThisMonthSampleSize: monthTotal,
      pendingPayments: {
        count: pendingPayments[0].count,
        totalUsd: pendingPayments[0].total,
      },
      espelhosGenerated: espelhosGenerated[0].count,
      emailsSent: emailsSent[0].count,
    };
  },

  async getProcessingTimeline() {
    // Tempo medio no estagio ATUAL, contado a partir do momento em que o
    // processo ENTROU nesse estagio (`process_events`). Com `updatedAt` bastava
    // editar qualquer campo para o processo aparecer como recem-chegado ao
    // estagio, e um travamento de 40 dias virava "0 dias".
    const enteredEvent = currentStatusEnteredAt();
    const enteredAt = withUpdatedAtFallback(enteredEvent);

    return db
      .select({
        status: importProcesses.status,
        count: count(),
        avgDaysInStatus: sql<number>`AVG(EXTRACT(DAY FROM now() - ${enteredAt}))::int`,
        // Linhas sem evento historico: o valor acima e aproximado para elas.
        fallbackCount: approximateCount(enteredEvent),
      })
      .from(importProcesses)
      .where(and(ne(importProcesses.status, 'completed'), ne(importProcesses.status, 'cancelled')))
      .groupBy(importProcesses.status);
  },
};
