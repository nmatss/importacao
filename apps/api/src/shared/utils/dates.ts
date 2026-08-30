import { getTableName } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
export function formatDate(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

export function daysBetween(date1: Date, date2: Date): number {
  const msPerDay = 1000 * 60 * 60 * 24;
  const diff = Math.abs(date2.getTime() - date1.getTime());
  return Math.floor(diff / msPerDay);
}

export function isDeadlineCritical(deadline: Date, warningDays = 3): boolean {
  const now = new Date();
  const remaining = daysBetween(now, deadline);
  return deadline.getTime() >= now.getTime() && remaining <= warningDays;
}

export function calculateLiDeadline(shipmentDate: Date): Date {
  return addDays(shipmentDate, 13);
}

/**
 * Fuso operacional do negocio.
 *
 * Os containers de API e Postgres rodam em UTC (nem `docker-compose.yml`, nem
 * `docker-compose.prod.yml`, nem `apps/api/Dockerfile` definem `TZ`), entao as
 * colunas `timestamp` sem time zone guardam UTC. O operador, porem, escolhe a
 * data num calendario brasileiro e a tela exibe o valor ja convertido para o
 * fuso local. Tratar 'YYYY-MM-DD' como meia-noite UTC desloca a janela em tres
 * horas: um registro exibido como "29/08 22:00" tem `created_at` em
 * '2026-08-30 01:00' UTC e ficava de fora do filtro "29/08".
 *
 * Estas funcoes convertem o dia local no intervalo UTC equivalente.
 */
export const OPERATIONAL_TIME_ZONE = 'America/Sao_Paulo';

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function zoneOffsetMs(instant: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: OPERATIONAL_TIME_ZONE,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant);
  const part = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(
    part('year'),
    part('month') - 1,
    part('day'),
    part('hour') % 24,
    part('minute'),
    part('second'),
  );
  return asUtc - instant.getTime();
}

/** `true` quando a string e uma data de calendario real no formato YYYY-MM-DD. */
export function isCalendarDate(value: string): boolean {
  if (!ISO_DATE_PATTERN.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const probe = new Date(Date.UTC(year, month - 1, day));
  return (
    probe.getUTCFullYear() === year &&
    probe.getUTCMonth() === month - 1 &&
    probe.getUTCDate() === day
  );
}

/**
 * Instante UTC da meia-noite local do dia informado. Retorna `null` quando a
 * entrada nao e uma data de calendario valida, para o chamador ignorar o filtro
 * em vez de estourar `RangeError: Invalid time value`.
 */
export function localDayStartUtc(isoDate: string): Date | null {
  if (!isCalendarDate(isoDate)) return null;
  const [year, month, day] = isoDate.split('-').map(Number);
  const naive = Date.UTC(year, month - 1, day);
  // Duas passagens resolvem a borda em que o proprio offset muda.
  const first = new Date(naive - zoneOffsetMs(new Date(naive)));
  return new Date(naive - zoneOffsetMs(first));
}

/**
 * Instante UTC do inicio do dia local seguinte — limite superior EXCLUSIVO,
 * de modo que o dia escolhido entre inteiro no intervalo.
 */
export function localDayEndExclusiveUtc(isoDate: string): Date | null {
  if (!isCalendarDate(isoDate)) return null;
  const [year, month, day] = isoDate.split('-').map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + 1));
  const nextIso = `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-${String(
    next.getUTCDate(),
  ).padStart(2, '0')}`;
  return localDayStartUtc(nextIso);
}

/** Data de hoje ('YYYY-MM-DD') no fuso operacional, nao no fuso do processo. */
export function localTodayIso(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: OPERATIONAL_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/**
 * Instante UTC do primeiro dia do mes local, deslocado por `monthOffset`.
 *
 * `new Date(now.getFullYear(), now.getMonth(), 1)` num container UTC produz a
 * meia-noite UTC do dia 1, que e 21:00 do ultimo dia do mes ANTERIOR em
 * Brasilia — as tres ultimas horas do mes passado entravam no mes corrente.
 */
export function localMonthStartUtc(monthOffset = 0, now: Date = new Date()): Date {
  const [year, month] = localTodayIso(now).split('-').map(Number);
  const shifted = new Date(Date.UTC(year, month - 1 + monthOffset, 1));
  const iso = `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}-01`;
  // A data e sempre valida por construcao, entao o `??` so satisfaz o tipo.
  return localDayStartUtc(iso) ?? shifted;
}

/**
 * "Hoje" no calendario do operador, em SQL.
 *
 * `now()::date` da o dia em UTC, e os containers rodam em UTC: entre 21:00 e
 * 23:59 no Brasil o banco ja virou o dia. Toda decisao de calendario feita
 * assim erra um dia nessas tres horas.
 *
 * `now()` e `timestamptz`, entao `AT TIME ZONE` CONVERTE para a hora local —
 * que e o que se quer aqui.
 */
export const SQL_HOJE_LOCAL = `(now() AT TIME ZONE '${OPERATIONAL_TIME_ZONE}')::date`;

/**
 * Converte para a hora local uma coluna `timestamp` SEM fuso que guarda UTC.
 *
 * Precisa das DUAS conversoes, e a ordem importa. Em `timestamp` sem fuso,
 * `AT TIME ZONE 'America/Sao_Paulo'` INTERPRETA o valor como se ja fosse local
 * — o oposto do desejado. O primeiro `AT TIME ZONE 'UTC'` diz ao Postgres o que
 * o valor realmente e; o segundo e que converte.
 *
 * **Recebe a COLUNA, e nao o nome dela.** A primeira versao recebia a string
 * `'"import_processes"."created_at"'` escrita a mao, e isso carregava dois
 * riscos que nenhum teste pegava: um alias na consulta quebraria em runtime, e
 * — pior — aplicar a mesma expressao a uma coluna `timestamptz` deslocaria o
 * valor no sentido ERRADO, em silencio. O schema tem 26 colunas com fuso, entao
 * essa nao e uma hipotese remota. Com a coluna em maos da para conferir o tipo
 * e montar a referencia sozinho.
 */
export function sqlLocalDeUtc(coluna: PgColumn): string {
  const referencia = `"${getTableName(coluna.table)}"."${coluna.name}"`;

  if (coluna.columnType !== 'PgTimestamp') {
    throw new Error(
      `sqlLocalDeUtc espera uma coluna timestamp sem fuso; ${referencia} e ${coluna.columnType}.`,
    );
  }
  if ((coluna as PgColumn & { withTimezone?: boolean }).withTimezone) {
    throw new Error(
      `sqlLocalDeUtc nao pode ser aplicada a ${referencia}, que ja tem fuso: ` +
        "em timestamptz, `AT TIME ZONE 'UTC'` CONVERTE em vez de interpretar, e o " +
        'resultado sai deslocado no sentido oposto ao pretendido.',
    );
  }

  return `((${referencia}) AT TIME ZONE 'UTC') AT TIME ZONE '${OPERATIONAL_TIME_ZONE}'`;
}
