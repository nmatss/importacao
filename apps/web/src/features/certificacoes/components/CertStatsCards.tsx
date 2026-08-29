import { CheckCircle2, AlertTriangle, Search, Package, CircleDashed } from 'lucide-react';

interface StatsData {
  total?: number;
  ok?: number;
  inconsistent?: number;
  not_found?: number;
  /** Produtos que ainda nao passaram por validacao — ausencia de veredito. */
  never_validated?: number;
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

// Cor NEUTRA de propósito: "nunca validado" é ausência de veredito, não veredito
// negativo. Antes esses produtos entravam em `not_found` e apareciam como
// não-conformidade (correção de backend + UI, 2026-08-29).
const NEVER_VALIDATED_CARD = {
  key: 'never_validated',
  label: 'Não validado',
  icon: CircleDashed,
  iconBg: 'from-slate-300 to-slate-400',
  shadowColor: 'shadow-slate-300/25',
} as const;

/** Distingue "sem dado" de "zero": um total real de 0 continua sendo 0. */
function renderValue(value: number | undefined): string {
  if (value === undefined || value === null) return '—';
  return String(value);
}

export function CertStatsCards({
  data,
  loading,
  error,
  showNeverValidated = false,
}: {
  data?: StatsData;
  loading?: boolean;
  /** Falha de carregamento: os cartões mostram "—", nunca "0". */
  error?: boolean;
  showNeverValidated?: boolean;
}) {
  const cards = showNeverValidated ? [...CARDS, NEVER_VALIDATED_CARD] : CARDS;

  return (
    <div
      className={
        showNeverValidated
          ? 'grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4'
          : 'grid grid-cols-2 md:grid-cols-4 gap-4'
      }
    >
      {cards.map((card) => (
        <div
          key={card.key}
          className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-600/80 shadow-sm p-5 transition-shadow hover:shadow-md"
        >
          <div className="flex items-center gap-4">
            <div
              className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br ${card.iconBg} text-white shadow-lg ${card.shadowColor}`}
            >
              <card.icon className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <p className="text-2xl font-bold text-slate-900 dark:text-slate-100 leading-none mb-1">
                {loading ? '-' : error ? '—' : renderValue(data?.[card.key])}
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
