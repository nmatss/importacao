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
 * Dia local ('YYYY-MM-DD') de qualquer entrada de calendario.
 *
 * Aceita tanto um instante (o `updated_at` de uma linha) quanto uma data de
 * calendario ja em 'YYYY-MM-DD' (as colunas `date` do Postgres, como `eta`, que
 * o driver devolve como string). A distincao importa: passar 'YYYY-MM-DD' por
 * `new Date()` a interpreta como meia-noite UTC e, em Brasilia, volta um dia —
 * o mesmo defeito do "ETD 06/08" com a invoice em 07/08.
 */
export function localDateIso(value: Date | string | number): string {
  if (typeof value === 'string') {
    if (isCalendarDate(value)) return value;
    const isoPrefix = value.slice(0, 10);
    const instante = new Date(value);
    if (Number.isNaN(instante.getTime())) {
      if (isCalendarDate(isoPrefix)) return isoPrefix;
      throw new Error(`localDateIso recebeu um valor que nao e data: ${value}`);
    }
    return localTodayIso(instante);
  }
  const instante = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(instante.getTime())) {
    throw new Error('localDateIso recebeu uma data invalida');
  }
  return localTodayIso(instante);
}

/** Indice do dia (dias inteiros desde 1970-01-01) de uma data 'YYYY-MM-DD'. */
function indiceDoDia(isoDate: string): number {
  const [year, month, day] = isoDate.split('-').map(Number);
  return Date.UTC(year, month - 1, day) / 86_400_000;
}

/** 1970-01-01 foi quinta-feira, entao o indice 0 tem `diaDaSemana` 4 (0 = domingo). */
function diaDaSemanaDoIndice(indice: number): number {
  return (((indice + 4) % 7) + 7) % 7;
}

function ehDiaUtilPeloIndice(indice: number): boolean {
  const dow = diaDaSemanaDoIndice(indice);
  return dow >= 1 && dow <= 5;
}

/**
 * E dia util (segunda a sexta) no calendario do operador?
 *
 * Primeira versao SEM feriados, por decisao registrada na reuniao de 11/09: o
 * repositorio nao tem calendario de feriados e inventar um aqui seria pior que
 * a aproximacao — o unico efeito de um feriado e adiantar em um dia um aviso
 * que ja espera cinco.
 */
export function isBusinessDay(value: Date | string | number): boolean {
  return ehDiaUtilPeloIndice(indiceDoDia(localDateIso(value)));
}

/**
 * Dias uteis decorridos entre duas datas, no fuso do operador.
 *
 * Conta o intervalo ABERTO no inicio e FECHADO no fim — de sexta para segunda da
 * 1, de sexta para sabado da 0, e o mesmo dia da 0. E a contagem que o operador
 * faz quando diz "isso esta parado ha tres dias uteis": o dia em que a coisa
 * aconteceu nao conta, o de hoje conta.
 *
 * Datas invertidas devolvem 0 (nunca negativo): quem pergunta "ha quantos dias
 * uteis" sobre um evento futuro esta perguntando "nenhum".
 */
export function businessDaysBetween(
  from: Date | string | number,
  to: Date | string | number,
): number {
  const inicio = indiceDoDia(localDateIso(from));
  const fim = indiceDoDia(localDateIso(to));
  if (fim <= inicio) return 0;

  const totalDias = fim - inicio;
  const semanasCompletas = Math.floor(totalDias / 7);
  // Sete dias consecutivos tem exatamente cinco dias uteis, entao as semanas
  // inteiras entram por multiplicacao e sobram no maximo seis dias para andar.
  let uteis = semanasCompletas * 5;
  for (let cursor = inicio + semanasCompletas * 7 + 1; cursor <= fim; cursor++) {
    if (ehDiaUtilPeloIndice(cursor)) uteis += 1;
  }
  return uteis;
}

/**
 * Instante UTC do inicio do dia local que contem `now`.
 *
 * Chave de deduplicacao dos alertas de agregacao diaria. Uma janela deslizante
 * de 24h aplicada a um job de periodo 24h e uma corrida de borda: se hoje o job
 * dispara alguns milissegundos antes do instante de ontem, o de ontem "ainda
 * esta na janela", o de hoje nao e criado e a mensagem VELHA e reentregue com os
 * numeros de ontem (medido em producao: alerta 6509, criado 06/09 12:00:00.369,
 * entregue 07/09 12:00:01.437).
 */
export function localDayStartForInstant(now: Date = new Date()): Date {
  const iso = localTodayIso(now);
  // A data vem do proprio formatador, entao e sempre valida; o `??` so satisfaz
  // o tipo.
  return localDayStartUtc(iso) ?? new Date(now);
}

/** Os dois instantes caem no MESMO dia do calendario do operador? */
export function isSameLocalDay(a: Date | string | number, b: Date | string | number): boolean {
  return localDateIso(a) === localDateIso(b);
}

/**
 * Semana ISO local no formato '2026-S37'.
 *
 * Usada como chave de agrupamento de topico no Chat para as mensagens que nao
 * pertencem a um processo (o digest de inatividade, as falhas de job): sem uma
 * chave estavel cada mensagem abre um topico novo no espaco.
 */
export function localWeekKey(now: Date | string | number = new Date()): string {
  const indice = indiceDoDia(localDateIso(now));
  // Quinta-feira da mesma semana define o ano ISO (ISO-8601).
  const dow = diaDaSemanaDoIndice(indice);
  const deslocamentoParaQuinta = 4 - (dow === 0 ? 7 : dow);
  const quinta = indice + deslocamentoParaQuinta;
  const dataQuinta = new Date(quinta * 86_400_000);
  const ano = dataQuinta.getUTCFullYear();
  const primeiroDiaDoAno = Date.UTC(ano, 0, 1) / 86_400_000;
  const semana = Math.floor((quinta - primeiroDiaDoAno) / 7) + 1;
  return `${ano}-S${String(semana).padStart(2, '0')}`;
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
