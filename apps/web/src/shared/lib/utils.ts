export function cn(...classes: (string | undefined | null | false)[]): string {
  return classes.filter(Boolean).join(' ').trim();
}

export function formatCurrency(value: number | string, currency = 'USD'): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency }).format(Number(value));
}

export function formatDate(date: string): string {
  const d = new Date(date);
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
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
  draft: 'bg-slate-100 text-slate-600 ring-1 ring-slate-200/60',
  documents_received: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200/60',
  validating: 'bg-primary-50 text-primary-700 ring-1 ring-primary-200/60',
  validated: 'bg-primary-50 text-primary-700 ring-1 ring-primary-200/60',
  espelho_generated: 'bg-violet-50 text-violet-700 ring-1 ring-violet-200/60',
  sent_to_fenicia: 'bg-orange-50 text-orange-700 ring-1 ring-orange-200/60',
  li_pending: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200/60',
  completed: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200/60',
  cancelled: 'bg-danger-50 text-danger-700 ring-1 ring-danger-200/60',
};

export function certStatusColor(status: string): string {
  switch (status) {
    case 'OK':
      return 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200/60';
    case 'INCONSISTENT':
      return 'bg-amber-50 text-amber-700 ring-1 ring-amber-200/60';
    case 'URL_NOT_FOUND':
      return 'bg-slate-100 text-slate-600 ring-1 ring-slate-200/60';
    case 'API_ERROR':
      return 'bg-danger-50 text-danger-700 ring-1 ring-danger-200/60';
    case 'NO_EXPECTED':
      return 'bg-slate-100 text-slate-500 ring-1 ring-slate-200/60';
    case 'EXPIRED':
      return 'bg-rose-50 text-rose-700 ring-1 ring-rose-200/60';
    default:
      return 'bg-slate-100 text-slate-600 ring-1 ring-slate-200/60';
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

  const dayOfWeekNames: Record<string, string> = {
    '0': 'domingo',
    '1': 'segunda-feira',
    '2': 'terça-feira',
    '3': 'quarta-feira',
    '4': 'quinta-feira',
    '5': 'sexta-feira',
    '6': 'sábado',
    '7': 'domingo',
  };

  const time = `${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`;

  if (day !== '*' && dow === '*') return `Todo dia ${day} às ${time}`;
  if (dow !== '*' && day === '*') {
    if (dow.includes('-')) {
      const [start, end] = dow.split('-');
      return `${dayOfWeekNames[start] || start} a ${dayOfWeekNames[end] || end} às ${time}`;
    }
    return `Toda ${dayOfWeekNames[dow] || dow} às ${time}`;
  }
  if (day === '*' && dow === '*') return `Diariamente às ${time}`;
  return cron;
}
