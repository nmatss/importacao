import { statusLabels, statusColors } from '@/shared/lib/utils';

interface StatusBadgeProps {
  status: string;
  size?: 'sm' | 'md';
}

export function StatusBadge({ status, size = 'md' }: StatusBadgeProps) {
  const label = statusLabels[status] || status;
  const colors = statusColors[status] || 'bg-slate-100 text-slate-600 ring-1 ring-slate-200/60';

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full font-medium ${colors} ${
        size === 'sm' ? 'px-2 py-0.5 text-[10px]' : 'px-2.5 py-1 text-xs'
      }`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current opacity-60" />
      {label}
    </span>
  );
}
