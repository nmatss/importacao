export function cn(...classes: (string | undefined | null | false)[]): string {
  return classes.filter(Boolean).join(' ').trim();
}

export function formatCurrency(value: number | string, currency = 'USD'): string {
  const numericValue = Number(value);
  const normalizedCurrency = currency.trim().toUpperCase();

  try {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: normalizedCurrency,
    }).format(numericValue);
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;

    const formattedValue = new Intl.NumberFormat('pt-BR', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(numericValue);

    return normalizedCurrency ? `${formattedValue} ${normalizedCurrency}` : formattedValue;
  }
}

/**
 * Formatacao de data — fonte UNICA da web.
 *
 * Dois tipos de valor chegam da API e NAO podem ser tratados igual:
 *
 * - Data de CALENDARIO (`etd`, `eta`, colunas `date`): `'2026-08-07'`, ou a
 *   mesma data serializada como meia-noite UTC, `'2026-08-07T00:00:00.000Z'`.
 *   Nao e um instante: e o dia 07/08 para qualquer pessoa. Passar isso por
 *   `new Date()` e formatar no fuso do navegador mostrava 06/08 em Brasilia
 *   (UTC-3) — o "ETD 06/08" do cabecalho enquanto a invoice dizia 07/08
 *   (reuniao 2026-09-11). Aqui o dia e lido do texto, sem fuso nenhum.
 * - INSTANTE real (`createdAt`, `registeredAt`, `sentAt`): formatado no fuso
 *   da operacao, America/Sao_Paulo, e nao no fuso da maquina de quem abre a
 *   tela. `2026-09-11T02:30:00Z` e 10/09 23:30 em Brasilia.
 *
 * Limite conhecido e aceito: um instante que caia EXATAMENTE em
 * `T00:00:00.000Z` e lido como data de calendario por `formatDate`. Esse e o
 * formato das colunas `date` serializadas, e um instante real nesse
 * milissegundo e raro; `formatDateTime` nao tem essa regra.
 *
 * Valor ausente, vazio ou invalido vira `'-'`, nunca `'Invalid Date'`.
 */
const FUSO_OPERACAO = 'America/Sao_Paulo';
const SEM_DATA = '-';

const DATA_CALENDARIO = /^(\d{4})-(\d{2})-(\d{2})(T00:00:00(\.0{1,3})?Z)?$/;

const formatoData = new Intl.DateTimeFormat('pt-BR', {
  timeZone: FUSO_OPERACAO,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});

const formatoDataHora = new Intl.DateTimeFormat('pt-BR', {
  timeZone: FUSO_OPERACAO,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

const formatoDataHoraSegundos = new Intl.DateTimeFormat('pt-BR', {
  timeZone: FUSO_OPERACAO,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

const formatoDataHoraCurto = new Intl.DateTimeFormat('pt-BR', {
  timeZone: FUSO_OPERACAO,
  day: '2-digit',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

type ValorDeData = string | Date | null | undefined;

/**
 * `'DD/MM/AAAA'` de uma data de calendario; `null` se o texto tem o formato mas
 * o dia nao existe (30/02); `undefined` se o texto nao e data de calendario.
 */
function dataDeCalendario(texto: string, aceitaMeiaNoiteUtc: boolean): string | null | undefined {
  const match = DATA_CALENDARIO.exec(texto);
  if (!match || (match[4] && !aceitaMeiaNoiteUtc)) return undefined;
  const [, ano, mes, dia] = match;
  const conferida = new Date(Date.UTC(Number(ano), Number(mes) - 1, Number(dia)));
  const existe =
    conferida.getUTCFullYear() === Number(ano) &&
    conferida.getUTCMonth() === Number(mes) - 1 &&
    conferida.getUTCDate() === Number(dia);
  return existe ? `${dia}/${mes}/${ano}` : null;
}

function formatarNoFuso(
  valor: ValorDeData,
  formato: Intl.DateTimeFormat,
  aceitaMeiaNoiteUtc: boolean,
): string {
  if (valor === null || valor === undefined) return SEM_DATA;
  if (typeof valor === 'string') {
    const texto = valor.trim();
    if (texto === '') return SEM_DATA;
    const calendario = dataDeCalendario(texto, aceitaMeiaNoiteUtc);
    if (calendario !== undefined) return calendario ?? SEM_DATA;
  }
  const instante = valor instanceof Date ? valor : new Date(valor.trim());
  return Number.isNaN(instante.getTime()) ? SEM_DATA : formato.format(instante);
}

/** `'DD/MM/AAAA'`. Data de calendario sem deslocar o dia; instante no fuso da operacao. */
export function formatDate(date: ValorDeData): string {
  return formatarNoFuso(date, formatoData, true);
}

/** Mantido por compatibilidade: e o mesmo formatador de `formatDate`. */
export function formatDateOnly(date: ValorDeData): string {
  return formatDate(date);
}

/**
 * `'DD/MM'` — a forma curta usada nas etapas do ciclo de transporte, onde o ano
 * so ocupa espaco. Mesma regra de `formatDate`: data de calendario nao passa
 * por `new Date()`.
 */
export function formatDayMonth(date: ValorDeData): string {
  const completo = formatDate(date);
  return completo === SEM_DATA ? SEM_DATA : completo.slice(0, 5);
}

/**
 * A data ja passou, no calendario do operador?
 *
 * Para uma data de CALENDARIO a comparacao e entre dias, e nao entre instantes:
 * `new Date('2026-09-11') <= new Date()` considera o dia 11 como passado a
 * partir das 21h do dia 10 em Brasilia, porque a string vira meia-noite UTC. O
 * proprio dia de hoje conta como "ja aconteceu" — um embarque marcado para hoje
 * ja saiu.
 */
export function isDateInPast(value: ValorDeData, agora: Date = new Date()): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') {
    const texto = value.trim();
    if (texto === '') return false;
    const calendario = dataDeCalendario(texto, true);
    if (calendario !== undefined) {
      if (calendario === null) return false;
      const [dia, mes, ano] = calendario.split('/');
      const hoje = new Intl.DateTimeFormat('en-CA', {
        timeZone: FUSO_OPERACAO,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(agora);
      return `${ano}-${mes}-${dia}` <= hoje;
    }
  }
  const instante = value instanceof Date ? value : new Date(String(value).trim());
  return !Number.isNaN(instante.getTime()) && instante.getTime() <= agora.getTime();
}

export function formatWeight(kg: number | string): string {
  return `${Number(kg).toFixed(3)} kg`;
}

export const statusLabels: Record<string, string> = {
  draft: 'Rascunho',
  documents_received: 'Documentos Recebidos',
  validating: 'Validando',
  validated: 'Validado',
  espelho_generated: 'Espelho Gerado',
  sent_to_fenicia: 'Enviado Fenícia',
  li_pending: 'LI Pendente',
  completed: 'Concluído',
  cancelled: 'Cancelado',
};

export const statusColors: Record<string, string> = {
  draft:
    'bg-slate-100 text-slate-600 ring-1 ring-slate-200/60 dark:bg-slate-700/60 dark:text-slate-200 dark:ring-slate-600',
  documents_received:
    'bg-amber-50 text-amber-700 ring-1 ring-amber-200/60 dark:bg-amber-950/30 dark:text-amber-300 dark:ring-amber-700/50',
  validating:
    'bg-primary-50 text-primary-700 ring-1 ring-primary-200/60 dark:bg-primary-950/30 dark:text-primary-300 dark:ring-primary-700/50',
  validated:
    'bg-primary-50 text-primary-700 ring-1 ring-primary-200/60 dark:bg-primary-950/30 dark:text-primary-300 dark:ring-primary-700/50',
  espelho_generated:
    'bg-violet-50 text-violet-700 ring-1 ring-violet-200/60 dark:bg-violet-950/30 dark:text-violet-300 dark:ring-violet-700/50',
  sent_to_fenicia:
    'bg-orange-50 text-orange-700 ring-1 ring-orange-200/60 dark:bg-orange-950/30 dark:text-orange-300 dark:ring-orange-700/50',
  li_pending:
    'bg-amber-50 text-amber-700 ring-1 ring-amber-200/60 dark:bg-amber-950/30 dark:text-amber-300 dark:ring-amber-700/50',
  completed:
    'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200/60 dark:bg-emerald-950/30 dark:text-emerald-300 dark:ring-emerald-700/50',
  cancelled:
    'bg-danger-50 text-danger-700 ring-1 ring-danger-200/60 dark:bg-danger-950/30 dark:text-danger-300 dark:ring-danger-700/50',
};

export function certStatusColor(status: string): string {
  switch (status) {
    // Status técnico legacy
    case 'OK':
      return 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200/60 dark:bg-emerald-950/30 dark:text-emerald-300 dark:ring-emerald-700/50';
    case 'INCONSISTENT':
      return 'bg-amber-50 text-amber-700 ring-1 ring-amber-200/60 dark:bg-amber-950/30 dark:text-amber-300 dark:ring-amber-700/50';
    case 'URL_NOT_FOUND':
      return 'bg-slate-100 text-slate-600 ring-1 ring-slate-200/60 dark:bg-slate-700/60 dark:text-slate-200 dark:ring-slate-600';
    case 'API_ERROR':
      return 'bg-danger-50 text-danger-700 ring-1 ring-danger-200/60 dark:bg-danger-950/30 dark:text-danger-300 dark:ring-danger-700/50';
    case 'NO_EXPECTED':
      return 'bg-slate-100 text-slate-500 ring-1 ring-slate-200/60 dark:bg-slate-700/60 dark:text-slate-200 dark:ring-slate-600';
    case 'EXPIRED':
    case 'EXPIRING':
      return 'bg-rose-50 text-rose-700 ring-1 ring-rose-200/60 dark:bg-rose-950/30 dark:text-rose-300 dark:ring-rose-700/50';
    // Status derivados (port Verificao_status):
    case 'ATIVO':
    case 'VALIDO':
    case 'CONFORME':
    case 'LIBERADA':
      return 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200/60 dark:bg-emerald-950/30 dark:text-emerald-300 dark:ring-emerald-700/50';
    case 'ENCERRADO':
    case 'ENCERRADA':
    case 'NAO_CONFORME':
    case 'VENCIDO':
      return 'bg-rose-50 text-rose-700 ring-1 ring-rose-200/60 dark:bg-rose-950/30 dark:text-rose-300 dark:ring-rose-700/50';
    case 'DENTRO_PRAZO':
    case 'PENDENTE':
      return 'bg-amber-50 text-amber-700 ring-1 ring-amber-200/60 dark:bg-amber-950/30 dark:text-amber-300 dark:ring-amber-700/50';
    case 'EM_ANDAMENTO':
      return 'bg-blue-50 text-blue-700 ring-1 ring-blue-200/60 dark:bg-primary-950/30 dark:text-primary-300 dark:ring-primary-700/50';
    case 'SKU_EXCLUIDO':
    case 'NAO_APLICAVEL':
    case 'NAO_APLICA':
    case 'DESCONHECIDO':
      return 'bg-slate-100 text-slate-600 ring-1 ring-slate-200/60 dark:bg-slate-700/60 dark:text-slate-200 dark:ring-slate-600';
    default:
      return 'bg-slate-100 text-slate-600 ring-1 ring-slate-200/60 dark:bg-slate-700/60 dark:text-slate-200 dark:ring-slate-600';
  }
}

/**
 * `'DD/MM/AAAA, HH:mm'` no fuso da operacao. Uma data de calendario pura
 * (`'2026-08-07'`) nao tem hora: sai so o dia, sem inventar `21:00` do dia
 * anterior.
 */
export function formatDateTime(date: ValorDeData): string {
  return formatarNoFuso(date, formatoDataHora, false);
}

/**
 * `'DD/MM/AAAA, HH:mm:ss'` no fuso da operacao. O segundo importa no log de
 * auditoria, onde duas acoes do mesmo minuto precisam ficar em ordem.
 */
export function formatDateTimeSeconds(date: ValorDeData): string {
  return formatarNoFuso(date, formatoDataHoraSegundos, false);
}

/** `'11 de set., 10:13'` — instante em forma curta, no fuso da operacao. */
export function formatDateTimeShort(date: ValorDeData): string {
  return formatarNoFuso(date, formatoDataHoraCurto, false);
}

export function relativeTime(date: string | Date): string {
  const now = Date.now();
  const then = new Date(date).getTime();
  const diffMs = now - then;
  const diffMin = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMin / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMin < 1) return 'agora mesmo';
  if (diffMin < 60) return `há ${diffMin} min`;
  if (diffHours < 24) return `há ${diffHours}h`;
  if (diffDays < 7) return `há ${diffDays}d`;
  return formatDateTime(date);
}

export function cronToHuman(cron: string): string {
  const presets: Record<string, string> = {
    daily: 'Diariamente às 06:00',
    weekly: 'Toda segunda-feira às 06:00',
    monthly: 'Todo dia 1 às 06:00',
  };
  if (presets[cron.toLowerCase()]) return presets[cron.toLowerCase()];

  const parts = cron.split(' ');
  if (parts.length !== 5) return cron;

  const [minute, hour, day, , dow] = parts;

  // Convenção CRONTAB (0 = domingo … 6 = sábado, 7 também domingo) — a mesma que
  // o operador digita e que o cert-api grava/devolve. Os aliases textuais valem
  // o MESMO dia nas duas convenções, então entram na mesma tabela.
  const dayOfWeekNames: Record<string, string> = {
    '0': 'domingo',
    '1': 'segunda-feira',
    '2': 'terça-feira',
    '3': 'quarta-feira',
    '4': 'quinta-feira',
    '5': 'sexta-feira',
    '6': 'sábado',
    '7': 'domingo',
    sun: 'domingo',
    mon: 'segunda-feira',
    tue: 'terça-feira',
    wed: 'quarta-feira',
    thu: 'quinta-feira',
    fri: 'sexta-feira',
    sat: 'sábado',
  };
  const dayName = (token: string) => dayOfWeekNames[token.trim().toLowerCase()] || token;

  const time = `${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`;

  if (day !== '*' && dow === '*') return `Todo dia ${day} às ${time}`;
  if (dow !== '*' && day === '*') {
    if (dow.includes('-')) {
      const [start, end] = dow.split('-');
      return `${dayName(start)} a ${dayName(end)} às ${time}`;
    }
    return `Toda ${dayName(dow)} às ${time}`;
  }
  if (day === '*' && dow === '*') return `Diariamente às ${time}`;
  return cron;
}
