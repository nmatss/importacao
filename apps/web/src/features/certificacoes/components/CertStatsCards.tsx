import { CheckCircle2, AlertTriangle, Search, Package } from 'lucide-react';

interface StatsData {
  total: number;
  ok: number;
  inconsistent: number;
  not_found: number;
}

const CARDS = [
  {
    key: 'total',
    label: 'Total Produtos',
    icon: Package,
    iconBg: 'from-slate-500 to-slate-700',
    shadowColor: 'shadow-slate-500/25',
  },
  {
    key: 'ok',
    label: 'Conforme',
    icon: CheckCircle2,
    iconBg: 'from-emerald-500 to-emerald-700',
    shadowColor: 'shadow-emerald-500/25',
  },
  {
    key: 'inconsistent',
    label: 'Inconsistente',
    icon: AlertTriangle,
    iconBg: 'from-amber-500 to-amber-600',
    shadowColor: 'shadow-amber-500/25',
  },
  {
    key: 'not_found',
    label: 'Não Encontrado',
    icon: Search,
    iconBg: 'from-slate-400 to-slate-600',
    shadowColor: 'shadow-slate-400/25',
  },
] as const;

export function CertStatsCards({ data, loading }: { data?: StatsData; loading?: boolean }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      {CARDS.map((card) => (
        <div
          key={card.key}
          className="bg-white rounded-2xl border border-slate-200 dark:border-slate-600/80 shadow-sm p-5 transition-shadow hover:shadow-md"
        >
          <div className="flex items-center gap-4">
            <div
              className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br ${card.iconBg} text-white shadow-lg ${card.shadowColor}`}
            >
              <card.icon className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <p className="text-2xl font-bold text-slate-900 dark:text-slate-100 leading-none mb-1">
                {loading ? '-' : (data?.[card.key] ?? 0)}
              </p>
              <p className="text-xs font-medium text-slate-500 dark:text-slate-400 truncate">
                {card.label}
              </p>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
