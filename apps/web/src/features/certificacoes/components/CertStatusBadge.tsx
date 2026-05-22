import { cn, certStatusColor } from '@/shared/lib/utils';

const STATUS_LABELS: Record<string, string> = {
  // Status técnicos (legacy)
  OK: 'Conforme',
  INCONSISTENT: 'Inconsistente',
  URL_NOT_FOUND: 'Não Encontrado',
  API_ERROR: 'Erro de API',
  NO_EXPECTED: 'Sem Certificação',
  EXPIRED: 'Vencido',
  EXPIRING: 'Expirando',
  // Cert status (derivado port Verificao_status)
  ATIVO: 'Ativo',
  ENCERRADO: 'Encerrado',
  SKU_EXCLUIDO: 'SKU Excluído',
  EM_ANDAMENTO: 'Em Andamento',
  DESCONHECIDO: 'Desconhecido',
  // Site status (derivado)
  CONFORME: 'Conforme',
  NAO_CONFORME: 'Não Conforme',
  PENDENTE: 'Pendente',
  // License status (derivado)
  VENCIDO: 'Vencido',
  NAO_APLICAVEL: 'N/A',
  // Comercialização (derivado)
  LIBERADA: 'Liberada',
  DENTRO_PRAZO: 'Dentro do Prazo',
  ENCERRADA: 'Encerrada',
  NAO_APLICA: 'N/A',
};

const DOT_COLORS: Record<string, string> = {
  OK: 'bg-emerald-500',
  ATIVO: 'bg-emerald-500',
  CONFORME: 'bg-emerald-500',
  LIBERADA: 'bg-emerald-500',
  INCONSISTENT: 'bg-amber-500',
  EXPIRING: 'bg-amber-500',
  DENTRO_PRAZO: 'bg-amber-500',
  PENDENTE: 'bg-amber-500',
  EXPIRED: 'bg-pink-500',
  ENCERRADO: 'bg-pink-500',
  ENCERRADA: 'bg-pink-500',
  VENCIDO: 'bg-pink-500',
  NAO_CONFORME: 'bg-pink-500',
  API_ERROR: 'bg-danger-500',
  SKU_EXCLUIDO: 'bg-slate-500',
  EM_ANDAMENTO: 'bg-blue-500',
  URL_NOT_FOUND: 'bg-slate-400',
  NO_EXPECTED: 'bg-slate-400',
  NAO_APLICAVEL: 'bg-slate-400',
  NAO_APLICA: 'bg-slate-400',
  DESCONHECIDO: 'bg-slate-400',
};

export function CertStatusBadge({ status }: { status: string }) {
  const dotColor = DOT_COLORS[status] || 'bg-slate-400';

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
