import { cn, certStatusColor } from '@/shared/lib/utils';

const STATUS_LABELS: Record<string, string> = {
  OK: 'Conforme',
  INCONSISTENT: 'Inconsistente',
  URL_NOT_FOUND: 'Não Encontrado',
  API_ERROR: 'Erro de API',
  NO_EXPECTED: 'Sem Certificação',
  EXPIRED: 'Vencido',
};

export function CertStatusBadge({ status }: { status: string }) {
  const dotColor = (() => {
    switch (status) {
      case 'OK':
        return 'bg-emerald-500';
      case 'INCONSISTENT':
        return 'bg-amber-500';
      case 'URL_NOT_FOUND':
        return 'bg-slate-400';
      case 'API_ERROR':
        return 'bg-red-500';
      case 'NO_EXPECTED':
        return 'bg-slate-400';
      case 'EXPIRED':
        return 'bg-pink-500';
      default:
        return 'bg-slate-400';
    }
  })();

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold',
        certStatusColor(status),
      )}
    >
      <span className={cn('w-1.5 h-1.5 rounded-full shrink-0', dotColor)} />
      {STATUS_LABELS[status] || status}
    </span>
  );
}
