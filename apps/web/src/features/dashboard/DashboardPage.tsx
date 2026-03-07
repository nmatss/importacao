import { Link, useNavigate } from 'react-router-dom';
import {
  FileBox,
  AlertTriangle,
  CheckCircle,
  DollarSign,
  ArrowRight,
  TrendingUp,
  Bell,
  BarChart3,
  Clock,
  Mail,
  XCircle,
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
} from 'recharts';
import { useApiQuery } from '@/shared/hooks/useApi';
import { cn, formatCurrency, formatDate } from '@/shared/lib/utils';
import { StatusBadge } from '@/shared/components/StatusBadge';
import { LoadingSpinner } from '@/shared/components/LoadingSpinner';

interface DashboardOverview {
  activeProcesses: number;
  overdueProcesses: number;
  completedThisMonth: number;
  totalFobValue: number;
  recentAlerts: Array<{
    id: string;
    message: string;
    severity: 'critical' | 'warning' | 'info';
    createdAt: string;
  }>;
  recentProcesses: Array<{
    id: string;
    processCode: string;
    brand: string;
    status: string;
    etd: string | null;
    createdAt: string;
  }>;
}

interface StatusCount {
  status: string;
  label: string;
  count: number;
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

interface EmailLog {
  id: number;
  fromAddress: string;
  subject: string;
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'ignored';
  processCode: string | null;
  attachmentsCount: number;
  createdAt: string;
}

interface EmailLogsResponse {
  data: EmailLog[];
  total: number;
}

const PIE_COLORS = ['#3b82f6', '#8b5cf6', '#ec4899', '#10b981', '#f59e0b', '#ef4444'];

const severityConfig: Record<string, { dot: string; bg: string; text: string; label: string }> = {
  critical: {
    dot: 'bg-red-500',
    bg: 'bg-red-50 border-red-100',
    text: 'text-red-700',
    label: 'Critico',
  },
  warning: {
    dot: 'bg-amber-500',
    bg: 'bg-amber-50 border-amber-100',
    text: 'text-amber-700',
    label: 'Alerta',
  },
  info: {
    dot: 'bg-blue-500',
    bg: 'bg-blue-50 border-blue-100',
    text: 'text-blue-700',
    label: 'Info',
  },
};

function Skeleton({ className }: { className?: string }) {
  return <div className={cn('bg-slate-200/60 rounded-lg animate-pulse', className)} />;
}

function KpiSkeleton() {
  return (
    <div className="rounded-2xl border border-slate-200/80 bg-white p-6 shadow-sm">
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
    <div className="rounded-2xl border border-slate-200/80 bg-white p-7 shadow-sm">
      <Skeleton className="h-5 w-40 mb-6" />
      <Skeleton className={cn(height, 'w-full rounded-xl')} />
    </div>
  );
}

function TableSkeleton() {
  return (
    <div className="rounded-2xl border border-slate-200/80 bg-white shadow-sm overflow-hidden">
      <div className="flex items-center justify-between px-7 py-5 border-b border-slate-100">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-4 w-20" />
      </div>
      <div className="p-7 space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    </div>
  );
}

const kpiConfig = [
  {
    key: 'active',
    label: 'Processos Ativos',
    icon: FileBox,
    gradient: 'from-blue-500 to-blue-700',
    shadowColor: 'shadow-blue-500/25',
    valueColor: 'text-blue-700',
    borderColor: 'border-l-blue-500',
  },
  {
    key: 'overdue',
    label: 'Atrasados',
    icon: AlertTriangle,
    gradient: 'from-red-500 to-red-700',
    shadowColor: 'shadow-red-500/25',
    valueColor: 'text-red-600',
    borderColor: 'border-l-red-500',
  },
  {
    key: 'completed',
    label: 'Concluidos no Mes',
    icon: CheckCircle,
    gradient: 'from-emerald-500 to-emerald-700',
    shadowColor: 'shadow-emerald-500/25',
    valueColor: 'text-emerald-600',
    borderColor: 'border-l-emerald-500',
  },
  {
    key: 'fob',
    label: 'Valor FOB Total',
    icon: DollarSign,
    gradient: 'from-violet-500 to-violet-700',
    shadowColor: 'shadow-violet-500/25',
    valueColor: 'text-violet-700',
    borderColor: 'border-l-violet-500',
  },
];

export function DashboardPage() {
  const navigate = useNavigate();
  const { data: overview, isLoading: loadingOverview } =
    useApiQuery<DashboardOverview>(['dashboard', 'overview'], '/api/dashboard/overview');

  const { data: byStatus, isLoading: loadingStatus } =
    useApiQuery<StatusCount[]>(['dashboard', 'by-status'], '/api/dashboard/by-status');

  const { data: byMonth } =
    useApiQuery<MonthlyTrend[]>(['dashboard', 'by-month'], '/api/dashboard/by-month');

  const { data: fobByBrand } =
    useApiQuery<FobByBrand[]>(['dashboard', 'fob-by-brand'], '/api/dashboard/fob-by-brand');

  const { data: emailLogs, isLoading: loadingEmails } =
    useApiQuery<EmailLogsResponse>(['email-ingestion', 'logs'], '/api/email-ingestion/logs?limit=5');

  const isLoading = loadingOverview || loadingStatus;

  if (isLoading) {
    return (
      <div className="space-y-8">
        {/* Header skeleton */}
        <div>
          <Skeleton className="h-8 w-48 mb-2" />
          <Skeleton className="h-4 w-72" />
        </div>

        {/* KPI skeletons */}
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <KpiSkeleton key={i} />
          ))}
        </div>

        {/* Chart skeletons */}
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <ChartSkeleton />
          </div>
          <ChartSkeleton />
        </div>

        <TableSkeleton />
      </div>
    );
  }

  const kpiValues: Record<string, string | number> = {
    active: overview?.activeProcesses ?? 0,
    overdue: overview?.overdueProcesses ?? 0,
    completed: overview?.completedThisMonth ?? 0,
    fob: formatCurrency(overview?.totalFobValue ?? 0),
  };

  return (
    <div className="space-y-8">
      {/* Page Header */}
      <div>
        <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Dashboard</h2>
        <p className="mt-1 text-sm text-slate-500">
          Visao geral dos processos de importacao
        </p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {kpiConfig.map((card) => {
          const Icon = card.icon;
          const value = kpiValues[card.key];
          const isZero = value === 0;

          return (
            <div
              key={card.key}
              className={cn(
                'group rounded-2xl border border-slate-200/80 bg-white p-6 shadow-sm',
                'hover:shadow-lg hover:border-slate-300/80 transition-all duration-300',
                'border-l-4',
                card.borderColor,
              )}
            >
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm font-medium text-slate-500">{card.label}</p>
                  <p
                    className={cn(
                      'mt-2 text-2xl font-bold tabular-nums tracking-tight',
                      isZero ? 'text-slate-300' : card.valueColor,
                    )}
                  >
                    {value}
                  </p>
                </div>
                <div
                  className={cn(
                    'flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl',
                    'bg-gradient-to-br text-white shadow-lg transition-shadow',
                    card.gradient,
                    card.shadowColor,
                    'group-hover:shadow-xl',
                  )}
                >
                  <Icon className="h-6 w-6" />
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Charts Row 1: Status + Alerts */}
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
        {/* Status Chart */}
        <div className="lg:col-span-2 rounded-2xl border border-slate-200/80 bg-white p-7 shadow-sm">
          <div className="flex items-center gap-3 mb-6">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-blue-700 text-white shadow-md shadow-blue-500/20">
              <BarChart3 className="h-4.5 w-4.5" />
            </div>
            <h3 className="text-base font-bold text-slate-900 tracking-tight">
              Processos por Status
            </h3>
          </div>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={byStatus ?? []} margin={{ bottom: 60 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                <XAxis
                  dataKey="label"
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
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#fff',
                    border: '1px solid #e2e8f0',
                    borderRadius: '12px',
                    boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
                    fontSize: '13px',
                  }}
                />
                <Bar
                  dataKey="count"
                  fill="#3b82f6"
                  radius={[6, 6, 0, 0]}
                  name="Processos"
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Recent Alerts */}
        <div className="rounded-2xl border border-slate-200/80 bg-white p-7 shadow-sm">
          <div className="flex items-center gap-3 mb-6">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-amber-500 to-amber-700 text-white shadow-md shadow-amber-500/20">
              <Bell className="h-4.5 w-4.5" />
            </div>
            <h3 className="text-base font-bold text-slate-900 tracking-tight">
              Alertas Recentes
            </h3>
          </div>
          <div className="space-y-3">
            {(overview?.recentAlerts ?? []).length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-50 mb-3">
                  <Bell className="h-5 w-5 text-slate-300" />
                </div>
                <p className="text-sm font-medium text-slate-400">Nenhum alerta recente</p>
                <p className="text-xs text-slate-300 mt-1">Tudo em ordem por aqui</p>
              </div>
            ) : (
              overview!.recentAlerts.map((alert) => {
                const config = severityConfig[alert.severity] || severityConfig.info;
                return (
                  <div
                    key={alert.id}
                    className={cn(
                      'rounded-xl border p-3.5 transition-colors hover:shadow-sm',
                      config.bg,
                    )}
                  >
                    <div className="flex items-start gap-3">
                      <span
                        className={cn(
                          'mt-1.5 h-2 w-2 shrink-0 rounded-full',
                          config.dot,
                        )}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <span
                            className={cn(
                              'text-[10px] font-bold uppercase tracking-wider',
                              config.text,
                            )}
                          >
                            {config.label}
                          </span>
                        </div>
                        <p className="text-sm text-slate-700 leading-relaxed">
                          {alert.message}
                        </p>
                        <p className="mt-1.5 text-[11px] text-slate-400 font-medium">
                          {formatDate(alert.createdAt)}
                        </p>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* Charts Row 2: Monthly Trend + FOB by Brand */}
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
        {/* Monthly Trend */}
        <div className="lg:col-span-2 rounded-2xl border border-slate-200/80 bg-white p-7 shadow-sm">
          <div className="flex items-center gap-3 mb-6">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-500 to-emerald-700 text-white shadow-md shadow-emerald-500/20">
              <TrendingUp className="h-4.5 w-4.5" />
            </div>
            <h3 className="text-base font-bold text-slate-900 tracking-tight">
              Tendencia Mensal
            </h3>
          </div>
          <div className="h-72">
            {byMonth && byMonth.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={byMonth} margin={{ bottom: 20 }}>
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
                      fontSize: '13px',
                    }}
                  />
                  <Legend
                    iconType="circle"
                    wrapperStyle={{ fontSize: '12px', color: '#64748b' }}
                  />
                  <Line
                    yAxisId="left"
                    type="monotone"
                    dataKey="count"
                    name="Processos"
                    stroke="#3b82f6"
                    strokeWidth={2.5}
                    dot={{ r: 4, fill: '#3b82f6', strokeWidth: 2, stroke: '#fff' }}
                    activeDot={{ r: 6, fill: '#3b82f6', strokeWidth: 2, stroke: '#fff' }}
                  />
                  <Line
                    yAxisId="right"
                    type="monotone"
                    dataKey="fobValue"
                    name="FOB (USD)"
                    stroke="#10b981"
                    strokeWidth={2.5}
                    dot={{ r: 4, fill: '#10b981', strokeWidth: 2, stroke: '#fff' }}
                    activeDot={{ r: 6, fill: '#10b981', strokeWidth: 2, stroke: '#fff' }}
                  />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex flex-col items-center justify-center h-full text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-50 mb-3">
                  <TrendingUp className="h-5 w-5 text-slate-300" />
                </div>
                <p className="text-sm font-medium text-slate-400">Sem dados mensais disponiveis</p>
              </div>
            )}
          </div>
        </div>

        {/* FOB by Brand */}
        <div className="rounded-2xl border border-slate-200/80 bg-white p-7 shadow-sm">
          <div className="flex items-center gap-3 mb-6">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500 to-violet-700 text-white shadow-md shadow-violet-500/20">
              <DollarSign className="h-4.5 w-4.5" />
            </div>
            <h3 className="text-base font-bold text-slate-900 tracking-tight">
              FOB por Marca
            </h3>
          </div>
          <div className="h-72">
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
                    label={({ brand, percent }) =>
                      `${brand} (${(percent * 100).toFixed(0)}%)`
                    }
                  >
                    {fobByBrand.map((_entry, index) => (
                      <Cell
                        key={`cell-${index}`}
                        fill={PIE_COLORS[index % PIE_COLORS.length]}
                      />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#fff',
                      border: '1px solid #e2e8f0',
                      borderRadius: '12px',
                      boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
                      fontSize: '13px',
                    }}
                    formatter={(value: number) => formatCurrency(value)}
                  />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex flex-col items-center justify-center h-full text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-50 mb-3">
                  <DollarSign className="h-5 w-5 text-slate-300" />
                </div>
                <p className="text-sm font-medium text-slate-400">Sem dados de FOB por marca</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Recent Emails */}
      <div className="rounded-2xl border border-slate-200/80 bg-white shadow-sm overflow-hidden">
        <div className="flex items-center justify-between px-7 py-5 border-b border-slate-100">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-indigo-700 text-white shadow-md shadow-indigo-500/20">
              <Mail className="h-4.5 w-4.5" />
            </div>
            <h3 className="text-base font-bold text-slate-900 tracking-tight">
              Processos Recentes via Email
            </h3>
          </div>
        </div>
        {loadingEmails ? (
          <div className="p-7 space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : !emailLogs || emailLogs.data.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-50 mb-4">
              <Mail className="h-6 w-6 text-slate-300" />
            </div>
            <p className="text-sm font-medium text-slate-400">Nenhum email processado recentemente</p>
            <p className="text-xs text-slate-300 mt-1">Emails recebidos aparecerao aqui</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {emailLogs.data.map((log) => {
              const isCompleted = log.status === 'completed';
              const isFailed = log.status === 'failed';
              return (
                <div
                  key={log.id}
                  className={cn(
                    'flex items-center gap-4 px-7 py-3.5',
                    isFailed && 'bg-red-50/40',
                  )}
                >
                  <div className="shrink-0">
                    {isCompleted ? (
                      <CheckCircle className="h-5 w-5 text-green-500" />
                    ) : isFailed ? (
                      <XCircle className="h-5 w-5 text-red-500" />
                    ) : (
                      <Clock className="h-5 w-5 text-amber-500" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-slate-700 truncate">
                      {log.subject}
                    </p>
                    <div className="flex items-center gap-3 mt-0.5 text-xs text-slate-400">
                      <span>{log.fromAddress}</span>
                      <span>{log.attachmentsCount} anexo(s)</span>
                    </div>
                  </div>
                  {log.processCode && (
                    <span className="shrink-0 rounded-full bg-blue-100 px-2.5 py-1 text-xs font-semibold text-blue-700">
                      {log.processCode}
                    </span>
                  )}
                  <span className="shrink-0 text-[11px] text-slate-400 font-medium">
                    {formatDate(log.createdAt)}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Recent Processes */}
      <div className="rounded-2xl border border-slate-200/80 bg-white shadow-sm overflow-hidden">
        <div className="flex items-center justify-between px-7 py-5 border-b border-slate-100">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-slate-600 to-slate-800 text-white shadow-md shadow-slate-500/20">
              <Clock className="h-4.5 w-4.5" />
            </div>
            <h3 className="text-base font-bold text-slate-900 tracking-tight">
              Processos Recentes
            </h3>
          </div>
          <Link
            to="/importacao/processos"
            className="flex items-center gap-1.5 text-sm font-semibold text-blue-600 hover:text-blue-700 transition-colors"
          >
            Ver todos <ArrowRight className="h-4 w-4" />
          </Link>
        </div>

        {(overview?.recentProcesses ?? []).length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-50 mb-4">
              <FileBox className="h-6 w-6 text-slate-300" />
            </div>
            <p className="text-sm font-medium text-slate-400">Nenhum processo recente</p>
            <p className="text-xs text-slate-300 mt-1">Processos criados aparecerao aqui</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full">
              <thead>
                <tr className="bg-slate-50/80">
                  <th className="px-7 py-3.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                    Codigo
                  </th>
                  <th className="px-7 py-3.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                    Marca
                  </th>
                  <th className="px-7 py-3.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                    Status
                  </th>
                  <th className="px-7 py-3.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                    ETD
                  </th>
                  <th className="px-7 py-3.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                    Data Criacao
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {overview!.recentProcesses.map((proc, index) => (
                  <tr
                    key={proc.id}
                    className={cn(
                      'cursor-pointer transition-colors hover:bg-blue-50/50',
                      index % 2 === 1 && 'bg-slate-50/40',
                    )}
                    onClick={() => navigate(`/importacao/processos/${proc.id}`)}
                  >
                    <td className="px-7 py-3.5 text-sm">
                      <Link
                        to={`/importacao/processos/${proc.id}`}
                        className="font-semibold text-blue-600 hover:text-blue-700 transition-colors"
                      >
                        {proc.processCode}
                      </Link>
                    </td>
                    <td className="px-7 py-3.5 text-sm text-slate-700 font-medium capitalize">
                      {proc.brand}
                    </td>
                    <td className="px-7 py-3.5 text-sm">
                      <StatusBadge status={proc.status} />
                    </td>
                    <td className="px-7 py-3.5 text-sm text-slate-500">
                      {proc.etd ? formatDate(proc.etd) : (
                        <span className="text-slate-300">--</span>
                      )}
                    </td>
                    <td className="px-7 py-3.5 text-sm text-slate-500">
                      {formatDate(proc.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
