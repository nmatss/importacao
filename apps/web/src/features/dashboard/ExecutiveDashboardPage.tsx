import {
  FileBox,
  Activity,
  CheckCircle,
  DollarSign,
  ShieldCheck,
  CreditCard,
  FileText,
  Mail,
  TrendingUp,
  TrendingDown,
  BarChart3,
  Clock,
} from 'lucide-react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  Legend,
  AreaChart,
  Area,
} from 'recharts';
import { useApiQuery } from '@/shared/hooks/useApi';
import { cn, formatCurrency } from '@/shared/lib/utils';

// ── Types ────────────────────────────────────────────────────────────────

interface ExecutiveKpis {
  totalProcesses: number;
  activeProcesses: number;
  completedThisMonth: number;
  completedChange: number;
  totalFobThisMonth: string;
  fobChange: number;
  validationPassRate: number;
  pendingPayments: {
    count: number;
    totalUsd: string;
  };
  espelhosGenerated: number;
  emailsSent: number;
}

interface TimelineEntry {
  status: string;
  count: number;
  avgDaysInStatus: number;
}

interface MonthlyTrend {
  month: string;
  count: number;
  fobValue: number;
}

interface FobByBrand {
  brand: string;
  totalFob: number;
}

// ── Constants ────────────────────────────────────────────────────────────

const PIE_COLORS = [
  '#6366f1',
  '#8b5cf6',
  '#ec4899',
  '#10b981',
  '#f59e0b',
  '#f43f5e',
  '#06b6d4',
  '#f97316',
];

const STATUS_LABELS: Record<string, string> = {
  draft: 'Rascunho',
  documents_received: 'Docs Recebidos',
  validating: 'Validando',
  validated: 'Validado',
  espelho_generated: 'Espelho Gerado',
  sent_to_fenicia: 'Enviado Fenicia',
  li_pending: 'LI Pendente',
};

const PIPELINE_COLORS: Record<string, string> = {
  draft: '#94a3b8',
  documents_received: '#6366f1',
  validating: '#f59e0b',
  validated: '#10b981',
  espelho_generated: '#8b5cf6',
  sent_to_fenicia: '#ec4899',
  li_pending: '#f43f5e',
};

// ── Skeletons ────────────────────────────────────────────────────────────

function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn('bg-slate-200/60 dark:bg-slate-700/60 rounded-lg animate-pulse', className)}
    />
  );
}

function KpiSkeleton() {
  return (
    <div className="rounded-2xl border border-slate-200/60 bg-white dark:bg-slate-800 dark:border-slate-700/60 p-5 shadow-sm">
      <div className="flex items-start justify-between">
        <div className="space-y-3 flex-1">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-8 w-20" />
        </div>
        <Skeleton className="h-12 w-12 rounded-2xl" />
      </div>
    </div>
  );
}

function ChartSkeleton({ height = 'h-72' }: { height?: string }) {
  return (
    <div className="rounded-2xl border border-slate-200/60 bg-white dark:bg-slate-800 dark:border-slate-700/60 p-5 shadow-sm">
      <Skeleton className="h-5 w-40 mb-6" />
      <Skeleton className={cn(height, 'w-full rounded-xl')} />
    </div>
  );
}

// ── Change Badge ─────────────────────────────────────────────────────────

function ChangeBadge({ value }: { value: number }) {
  if (value === 0) return null;
  const isPositive = value > 0;
  const Icon = isPositive ? TrendingUp : TrendingDown;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1',
        isPositive
          ? 'bg-emerald-50 text-emerald-700 ring-emerald-200/60'
          : 'bg-danger-50 text-danger-700 ring-danger-200/60',
      )}
    >
      <Icon className="h-3 w-3" />
      {isPositive ? '+' : ''}
      {value}%
    </span>
  );
}

// ── Main Page ────────────────────────────────────────────────────────────

export function ExecutiveDashboardPage() {
  const { data: kpis, isLoading: loadingKpis } = useApiQuery<ExecutiveKpis>(
    ['dashboard', 'executive'],
    '/api/dashboard/executive',
  );

  const { data: timeline, isLoading: loadingTimeline } = useApiQuery<TimelineEntry[]>(
    ['dashboard', 'executive', 'timeline'],
    '/api/dashboard/executive/timeline',
  );

  const { data: byMonth } = useApiQuery<MonthlyTrend[]>(
    ['dashboard', 'by-month'],
    '/api/dashboard/by-month',
  );

  const { data: fobByBrand } = useApiQuery<FobByBrand[]>(
    ['dashboard', 'fob-by-brand'],
    '/api/dashboard/fob-by-brand',
  );

  if (loadingKpis) {
    return (
      <div className="space-y-6">
        <div>
          <Skeleton className="h-6 w-64 mb-2" />
          <Skeleton className="h-4 w-96" />
        </div>
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <KpiSkeleton key={i} />
          ))}
        </div>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <ChartSkeleton />
          </div>
          <ChartSkeleton />
        </div>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <ChartSkeleton />
          <ChartSkeleton />
        </div>
      </div>
    );
  }

  const kpiCards = [
    {
      label: 'Total Processos',
      value: kpis?.totalProcesses ?? 0,
      icon: FileBox,
      gradient: 'from-slate-600 to-slate-800',
      valueColor: 'text-slate-800 dark:text-slate-100',
      borderColor: 'border-l-slate-600',
    },
    {
      label: 'Processos Ativos',
      value: kpis?.activeProcesses ?? 0,
      icon: Activity,
      gradient: 'from-primary-500 to-primary-600',
      valueColor: 'text-primary-700',
      borderColor: 'border-l-primary-500',
    },
    {
      label: 'Concluidos no Mes',
      value: kpis?.completedThisMonth ?? 0,
      icon: CheckCircle,
      gradient: 'from-emerald-500 to-emerald-600',
      valueColor: 'text-emerald-600',
      borderColor: 'border-l-emerald-500',
      change: kpis?.completedChange,
    },
    {
      label: 'FOB no Mes',
      value: formatCurrency(Number(kpis?.totalFobThisMonth ?? 0)),
      icon: DollarSign,
      gradient: 'from-violet-500 to-violet-600',
      valueColor: 'text-violet-700',
      borderColor: 'border-l-violet-500',
      change: kpis?.fobChange,
    },
    {
      label: 'Taxa de Aprovacao',
      value: `${kpis?.validationPassRate ?? 0}%`,
      icon: ShieldCheck,
      gradient: 'from-teal-500 to-teal-600',
      valueColor: 'text-teal-700',
      borderColor: 'border-l-teal-500',
    },
    {
      label: 'Pagamentos Pendentes',
      value: kpis?.pendingPayments?.count ?? 0,
      subtitle: formatCurrency(Number(kpis?.pendingPayments?.totalUsd ?? 0)),
      icon: CreditCard,
      gradient: 'from-amber-500 to-amber-600',
      valueColor: 'text-amber-700',
      borderColor: 'border-l-amber-500',
    },
    {
      label: 'Espelhos Gerados',
      value: kpis?.espelhosGenerated ?? 0,
      icon: FileText,
      gradient: 'from-pink-500 to-pink-600',
      valueColor: 'text-pink-700',
      borderColor: 'border-l-pink-500',
    },
    {
      label: 'Emails Enviados',
      value: kpis?.emailsSent ?? 0,
      icon: Mail,
      gradient: 'from-primary-500 to-primary-600',
      valueColor: 'text-primary-700',
      borderColor: 'border-l-primary-500',
    },
  ];

  // Pipeline data for funnel visualization
  const pipelineData = (timeline ?? []).map((entry) => ({
    name: STATUS_LABELS[entry.status] ?? entry.status,
    count: entry.count,
    fill: PIPELINE_COLORS[entry.status] ?? '#94a3b8',
  }));

  // Timeline bar chart data
  const timelineBarData = (timeline ?? []).map((entry) => ({
    name: STATUS_LABELS[entry.status] ?? entry.status,
    dias: entry.avgDaysInStatus ?? 0,
    fill: PIPELINE_COLORS[entry.status] ?? '#94a3b8',
  }));

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Page Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 mb-6">
        <div>
          <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100 tracking-tight">
            Dashboard Executivo
          </h2>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            Visao consolidada dos indicadores de importacao
          </p>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 stagger-children">
        {kpiCards.map((card) => {
          const Icon = card.icon;
          const isZero = card.value === 0;

          return (
            <div
              key={card.label}
              className={cn(
                'group rounded-2xl border border-slate-200/60 bg-white dark:bg-slate-800 dark:border-slate-700/60 p-5 shadow-sm',
                'hover:shadow-md hover:border-slate-300/80 transition-all duration-300',
                'border-l-4',
                card.borderColor,
              )}
            >
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
                    {card.label}
                  </p>
                  <p
                    className={cn(
                      'mt-2 text-lg sm:text-2xl font-bold tabular-nums tracking-tight',
                      isZero ? 'text-slate-300' : card.valueColor,
                    )}
                  >
                    {card.value}
                  </p>
                  {'subtitle' in card && card.subtitle && (
                    <p className="mt-1 text-xs font-medium text-slate-400">{card.subtitle}</p>
                  )}
                  {'change' in card && card.change !== undefined && (
                    <div className="mt-2">
                      <ChangeBadge value={card.change} />
                    </div>
                  )}
                </div>
                <div
                  className={cn(
                    'flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl',
                    'bg-gradient-to-br text-white shadow-sm transition-shadow',
                    card.gradient,
                    'group-hover:shadow-md',
                  )}
                >
                  <Icon className="h-6 w-6" />
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Processing Pipeline */}
      <div className="rounded-2xl border border-slate-200/60 bg-white dark:bg-slate-800 dark:border-slate-700/60 p-4 md:p-5 shadow-sm">
        <div className="flex items-center gap-3 mb-6">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-primary-500 to-primary-600 text-white shadow-sm">
            <BarChart3 className="h-4.5 w-4.5" />
          </div>
          <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">
            Pipeline de Processos
          </h3>
        </div>
        {pipelineData.length > 0 ? (
          <div className="flex items-end gap-1.5 sm:gap-2 overflow-x-auto pb-2">
            {pipelineData.map((stage, index) => {
              const maxCount = Math.max(...pipelineData.map((s) => s.count), 1);
              const heightPercent = Math.max((stage.count / maxCount) * 100, 8);
              return (
                <div
                  key={index}
                  className="flex flex-col items-center flex-1 min-w-[60px] sm:min-w-[80px]"
                >
                  <span className="text-sm sm:text-lg font-bold text-slate-800 dark:text-slate-100 mb-1">
                    {stage.count}
                  </span>
                  <div
                    className="w-full rounded-t-xl transition-all duration-500"
                    style={{
                      height: `${heightPercent * 1.6}px`,
                      backgroundColor: stage.fill,
                      minHeight: '12px',
                    }}
                  />
                  <div
                    className="w-full h-1 rounded-b-sm"
                    style={{ backgroundColor: stage.fill, opacity: 0.3 }}
                  />
                  <p className="mt-2 text-[11px] text-slate-400 text-center leading-tight">
                    {stage.name}
                  </p>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-50 dark:bg-slate-900 mb-3">
              <BarChart3 className="h-5 w-5 text-slate-300" />
            </div>
            <p className="text-sm text-slate-400">Nenhum processo ativo no pipeline</p>
          </div>
        )}
      </div>

      {/* Charts Row: Monthly Trend + FOB by Brand */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Monthly Trend - Area Chart */}
        <div className="lg:col-span-2 rounded-2xl border border-slate-200/60 bg-white dark:bg-slate-800 dark:border-slate-700/60 p-4 md:p-5 shadow-sm">
          <div className="flex items-center gap-3 mb-6">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-500 to-emerald-600 text-white shadow-sm">
              <TrendingUp className="h-4.5 w-4.5" />
            </div>
            <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">
              Tendencia Mensal
            </h3>
          </div>
          <div className="h-56 sm:h-72">
            {byMonth && byMonth.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={byMonth} margin={{ bottom: 20 }}>
                  <defs>
                    <linearGradient id="colorCount" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#6366f1" stopOpacity={0.15} />
                      <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="colorFob" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#10b981" stopOpacity={0.15} />
                      <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                  <XAxis
                    dataKey="month"
                    fontSize={11}
                    tick={{ fill: '#64748b' }}
                    axisLine={{ stroke: '#e2e8f0' }}
                    tickLine={false}
                  />
                  <YAxis
                    yAxisId="left"
                    allowDecimals={false}
                    tick={{ fill: '#64748b', fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    yAxisId="right"
                    orientation="right"
                    tick={{ fill: '#64748b', fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#fff',
                      border: '1px solid #e2e8f0',
                      borderRadius: '12px',
                      boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
                      fontSize: '14px',
                    }}
                  />
                  <Legend iconType="circle" wrapperStyle={{ fontSize: '12px', color: '#64748b' }} />
                  <Area
                    yAxisId="left"
                    type="monotone"
                    dataKey="count"
                    name="Processos"
                    stroke="#6366f1"
                    strokeWidth={2.5}
                    fill="url(#colorCount)"
                    dot={{ r: 4, fill: '#6366f1', strokeWidth: 2, stroke: '#fff' }}
                    activeDot={{ r: 6, fill: '#6366f1', strokeWidth: 2, stroke: '#fff' }}
                  />
                  <Area
                    yAxisId="right"
                    type="monotone"
                    dataKey="fobValue"
                    name="FOB (USD)"
                    stroke="#10b981"
                    strokeWidth={2.5}
                    fill="url(#colorFob)"
                    dot={{ r: 4, fill: '#10b981', strokeWidth: 2, stroke: '#fff' }}
                    activeDot={{ r: 6, fill: '#10b981', strokeWidth: 2, stroke: '#fff' }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex flex-col items-center justify-center h-full text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-50 dark:bg-slate-900 mb-3">
                  <TrendingUp className="h-5 w-5 text-slate-300" />
                </div>
                <p className="text-sm text-slate-400">Sem dados mensais disponiveis</p>
              </div>
            )}
          </div>
        </div>

        {/* FOB by Brand - Donut */}
        <div className="rounded-2xl border border-slate-200/60 bg-white dark:bg-slate-800 dark:border-slate-700/60 p-4 md:p-5 shadow-sm">
          <div className="flex items-center gap-3 mb-6">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500 to-violet-600 text-white shadow-sm">
              <DollarSign className="h-4.5 w-4.5" />
            </div>
            <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">
              FOB por Marca
            </h3>
          </div>
          <div className="h-56 sm:h-72">
            {fobByBrand && fobByBrand.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={fobByBrand}
                    dataKey="totalFob"
                    nameKey="brand"
                    cx="50%"
                    cy="50%"
                    outerRadius={80}
                    innerRadius={40}
                    strokeWidth={2}
                    stroke="#fff"
                    label={({ brand, percent }: { brand: string; percent: number }) =>
                      `${brand} (${(percent * 100).toFixed(0)}%)`
                    }
                  >
                    {fobByBrand.map((_entry, index) => (
                      <Cell key={`cell-${index}`} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#fff',
                      border: '1px solid #e2e8f0',
                      borderRadius: '12px',
                      boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
                      fontSize: '14px',
                    }}
                    formatter={(value: number) => formatCurrency(value)}
                  />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex flex-col items-center justify-center h-full text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-50 dark:bg-slate-900 mb-3">
                  <DollarSign className="h-5 w-5 text-slate-300" />
                </div>
                <p className="text-sm text-slate-400">Sem dados de FOB por marca</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Average processing time per stage */}
      <div className="rounded-2xl border border-slate-200/60 bg-white dark:bg-slate-800 dark:border-slate-700/60 p-4 md:p-5 shadow-sm">
        <div className="flex items-center gap-3 mb-6">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-amber-500 to-amber-600 text-white shadow-sm">
            <Clock className="h-4.5 w-4.5" />
          </div>
          <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">
            Tempo Medio por Etapa (dias)
          </h3>
        </div>
        <div className="h-56 sm:h-72">
          {loadingTimeline ? (
            <Skeleton className="h-full w-full rounded-xl" />
          ) : timelineBarData.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={timelineBarData} margin={{ bottom: 60 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                <XAxis
                  dataKey="name"
                  angle={-35}
                  textAnchor="end"
                  fontSize={11}
                  interval={0}
                  tick={{ fill: '#64748b' }}
                  axisLine={{ stroke: '#e2e8f0' }}
                  tickLine={false}
                />
                <YAxis
                  allowDecimals={false}
                  tick={{ fill: '#64748b', fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                  label={{
                    value: 'Dias',
                    angle: -90,
                    position: 'insideLeft',
                    style: { fill: '#94a3b8', fontSize: 11 },
                  }}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#fff',
                    border: '1px solid #e2e8f0',
                    borderRadius: '12px',
                    boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
                    fontSize: '14px',
                  }}
                  formatter={(value: number) => [`${value} dias`, 'Tempo Medio']}
                />
                <Bar dataKey="dias" radius={[6, 6, 0, 0]} name="Dias">
                  {timelineBarData.map((entry, index) => (
                    <Cell key={`bar-${index}`} fill={entry.fill} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-50 dark:bg-slate-900 mb-3">
                <Clock className="h-5 w-5 text-slate-300" />
              </div>
              <p className="text-sm text-slate-400">Sem dados de tempo por etapa</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
