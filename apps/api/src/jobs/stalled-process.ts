import { and, ne, sql } from 'drizzle-orm';
import { db } from '../shared/database/connection.js';
import { importProcesses } from '../shared/database/schema.js';
import { alertService } from '../modules/alerts/service.js';
import { logger } from '../shared/utils/logger.js';

/**
 * Marcos de inatividade, em dias. O alerta sai UMA vez por marco atingido, nao
 * uma vez por dia enquanto a condicao durar.
 *
 * O comportamento anterior emitia um alerta por processo parado a cada
 * execucao diaria. Como "parado ha mais de 3 dias" nunca deixa de ser verdade,
 * isso virou 74 alertas por dia util numa base de 104 processos — 6.152 dos
 * 6.349 alertas da base (97%). A deduplicacao existente nao ajudava: ela e por
 * (processo, titulo) em 24h, e cada dia era um processo diferente dentro da
 * janela. O sinal util afogou junto: os alertas criticos de falha de extracao
 * ficam enterrados nesse volume.
 */
const DEFAULT_MILESTONES = [3, 7, 14, 30, 60] as const;

function milestones(): number[] {
  const raw = process.env.STALLED_PROCESS_MILESTONE_DAYS;
  if (!raw) return [...DEFAULT_MILESTONES];
  const parsed = raw
    .split(',')
    .map((v) => Number(v.trim()))
    .filter((v) => Number.isFinite(v) && v > 0);
  return parsed.length > 0 ? [...new Set(parsed)].sort((a, b) => a - b) : [...DEFAULT_MILESTONES];
}

/** A partir de 30 dias parado o caso deixa de ser lembrete e vira problema. */
function severityFor(days: number): 'warning' | 'critical' {
  return days >= 30 ? 'critical' : 'warning';
}

export function daysSince(date: Date | string, now: number = Date.now()): number {
  return Math.floor((now - new Date(date).getTime()) / (1000 * 60 * 60 * 24));
}

/**
 * Maior marco ja alcancado por este processo, ou null se ainda nao chegou no
 * primeiro.
 *
 * Deliberadamente NAO e "o dia exato em que cruzou". Casar o dia exato parece
 * mais limpo, mas perde o marco de vez se o cron nao rodar naquele dia — e ele
 * nao roda em dia de deploy, porque o container e recriado. Com "maior marco
 * alcancado" mais a janela de deduplicacao abaixo, uma execucao perdida so
 * atrasa o alerta, nao o cancela.
 */
export function highestMilestoneReached(
  days: number,
  marcos: number[] = milestones(),
): number | null {
  let alcancado: number | null = null;
  for (const m of marcos) {
    if (days >= m) alcancado = m;
  }
  return alcancado;
}

/**
 * Por quantas horas este marco fica "ja avisado".
 *
 * A janela e o espaco ate o proximo marco: enquanto o processo esta entre o
 * marco 3 e o 7, o alerta de 3 nao se repete; ao cruzar 7 o titulo muda e um
 * alerta novo sai. No ultimo marco a janela vira 30 dias — um processo parado
 * ha mais de 60 dias merece ser lembrado de vez em quando, nao esquecido.
 *
 * Isto tambem preserva o caso legitimo de reincidencia: se o processo for
 * trabalhado e parar de novo, `updatedAt` reinicia a contagem e o marco pode
 * alertar outra vez — coisa que uma deduplicacao "para sempre" impediria.
 */
export function dedupeWindowHours(marco: number, marcos: number[] = milestones()): number {
  const proximo = marcos.find((m) => m > marco);
  const dias = proximo ? proximo - marco : 30;
  return dias * 24;
}

export async function checkStalledProcesses() {
  logger.info('Running stalled process check job');

  const marcos = milestones();
  const menorMarco = marcos[0];

  const stalledProcesses = await db
    .select()
    .from(importProcesses)
    .where(
      and(
        ne(importProcesses.status, 'completed'),
        ne(importProcesses.status, 'cancelled'),
        sql`${importProcesses.updatedAt} < NOW() - (${menorMarco} * INTERVAL '1 day')`,
      ),
    );

  let emitidos = 0;

  for (const process of stalledProcesses) {
    if (!process.updatedAt) continue;
    const dias = daysSince(process.updatedAt);
    const marco = highestMilestoneReached(dias, marcos);
    if (marco === null) continue;

    // O marco vai no titulo, entao a deduplicacao distingue um marco do outro:
    // o de 3 dias nao repete enquanto o processo nao chega aos 7, e ao chegar
    // sai um alerta novo em vez de mais uma copia do mesmo.
    const title = `Processo Parado (${marco} dias)`;
    if (await alertService.hasDuplicateRecent(process.id, title, dedupeWindowHours(marco, marcos)))
      continue;

    await alertService.create({
      processId: process.id,
      severity: severityFor(marco),
      title,
      message: `O processo ${process.processCode} está sem atividade há ${dias} dias. Status atual: ${process.status}.`,
      processCode: process.processCode,
    });
    emitidos += 1;
  }

  // Panorama em UMA mensagem. Sem isto, cortar o alerta diario por processo
  // tiraria do operador a nocao do tamanho do problema.
  if (stalledProcesses.length > 0) {
    const amostra = stalledProcesses
      .slice(0, 15)
      .map((p) => p.processCode)
      .join(', ');
    const resto = stalledProcesses.length - Math.min(15, stalledProcesses.length);
    await alertService.create({
      severity: 'info',
      title: 'Resumo de processos parados',
      message:
        `${stalledProcesses.length} processos estão sem atividade há ${menorMarco} dias ou mais. ` +
        `${emitidos} geraram alerta individual nesta execucao. ` +
        `Amostra: ${amostra}${resto > 0 ? ` e mais ${resto}` : ''}.`,
    });
  }

  logger.info(
    { parados: stalledProcesses.length, alertasEmitidos: emitidos, marcos },
    'Stalled process check completed',
  );
}
