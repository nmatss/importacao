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

export function formatDate(date: string): string {
  const d = new Date(date);
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

/** Format a date-only ISO value without applying a timezone offset. */
export function formatDateOnly(date: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : formatDate(date);
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

export function formatDateTime(date: string | Date): string {
  return new Date(date).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
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
