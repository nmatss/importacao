import { Link } from 'react-router-dom';
import {
  FileBox,
  AlertTriangle,
  CheckCircle,
  DollarSign,
  ArrowRight,
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

const PIE_COLORS = ['#ec4899', '#8b5cf6', '#3b82f6', '#10b981', '#f59e0b', '#ef4444'];

const severityStyles: Record<string, string> = {
  critical: 'bg-red-100 text-red-700',
  warning: 'bg-amber-100 text-amber-700',
  info: 'bg-blue-100 text-blue-700',
};

const severityLabels: Record<string, string> = {
  critical: 'Crítico',
  warning: 'Alerta',
  info: 'Info',
};

export function DashboardPage() {
  const { data: overview, isLoading: loadingOverview } =
    useApiQuery<DashboardOverview>(['dashboard', 'overview'], '/api/dashboard/overview');

  const { data: byStatus, isLoading: loadingStatus } =
    useApiQuery<StatusCount[]>(['dashboard', 'by-status'], '/api/dashboard/by-status');

  const { data: byMonth } =
    useApiQuery<MonthlyTrend[]>(['dashboard', 'by-month'], '/api/dashboard/by-month');

  const { data: fobByBrand } =
    useApiQuery<FobByBrand[]>(['dashboard', 'fob-by-brand'], '/api/dashboard/fob-by-brand');

  if (loadingOverview || loadingStatus) {
    return <LoadingSpinner size="lg" className="py-24" />;
  }

  const kpiCards = [
    {
      label: 'Processos Ativos',
      value: overview?.activeProcesses ?? 0,
      icon: FileBox,
      color: 'text-gray-700',
      bg: 'bg-gray-50',
    },
    {
      label: 'Atrasados',
      value: overview?.overdueProcesses ?? 0,
      icon: AlertTriangle,
      color: 'text-red-700',
      bg: 'bg-red-50',
    },
    {
      label: 'Concluídos no Mês',
      value: overview?.completedThisMonth ?? 0,
      icon: CheckCircle,
      color: 'text-green-700',
      bg: 'bg-green-50',
    },
    {
      label: 'Valor FOB Total',
      value: formatCurrency(overview?.totalFobValue ?? 0),
      icon: DollarSign,
      color: 'text-blue-700',
      bg: 'bg-blue-50',
    },
  ];

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-gray-900">Dashboard</h2>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {kpiCards.map((card) => (
          <div
            key={card.label}
            className={cn('rounded-lg border border-gray-200 p-5', card.bg)}
          >
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-500">{card.label}</p>
                <p className={cn('mt-1 text-2xl font-semibold', card.color)}>
                  {card.value}
                </p>
              </div>
              <card.icon className={cn('h-8 w-8', card.color)} />
            </div>
          </div>
        ))}
      </div>

      {/* Chart + Alerts */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Status Chart */}
        <div className="lg:col-span-2 rounded-lg border border-gray-200 bg-white p-5">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">
            Processos por Status
          </h3>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={byStatus ?? []} margin={{ bottom: 60 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis
                  dataKey="label"
                  angle={-35}
                  textAnchor="end"
                  fontSize={12}
                  interval={0}
                />
                <YAxis allowDecimals={false} />
                <Tooltip />
                <Bar dataKey="count" fill="#3b82f6" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Recent Alerts */}
        <div className="rounded-lg border border-gray-200 bg-white p-5">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">
            Alertas Recentes
          </h3>
          <div className="space-y-3">
            {(overview?.recentAlerts ?? []).length === 0 ? (
              <p className="text-sm text-gray-500">Nenhum alerta recente.</p>
            ) : (
              overview!.recentAlerts.map((alert) => (
                <div
                  key={alert.id}
                  className="flex items-start gap-3 rounded-lg border border-gray-100 p-3"
                >
                  <span
                    className={cn(
                      'mt-0.5 inline-flex rounded-full px-2 py-0.5 text-xs font-medium',
                      severityStyles[alert.severity],
                    )}
                  >
                    {severityLabels[alert.severity]}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-gray-700">{alert.message}</p>
                    <p className="mt-0.5 text-xs text-gray-400">
                      {formatDate(alert.createdAt)}
                    </p>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Monthly Trend + FOB by Brand Charts (Gap 5) */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Monthly Trend */}
        <div className="lg:col-span-2 rounded-lg border border-gray-200 bg-white p-5">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">
            Tendencia Mensal
          </h3>
          <div className="h-72">
            {byMonth && byMonth.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={byMonth} margin={{ bottom: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="month" fontSize={12} />
                  <YAxis yAxisId="left" allowDecimals={false} />
                  <YAxis yAxisId="right" orientation="right" />
                  <Tooltip />
                  <Legend />
                  <Line
                    yAxisId="left"
                    type="monotone"
                    dataKey="count"
                    name="Processos"
                    stroke="#3b82f6"
                    strokeWidth={2}
                  />
                  <Line
                    yAxisId="right"
                    type="monotone"
                    dataKey="fobValue"
                    name="FOB (USD)"
                    stroke="#10b981"
                    strokeWidth={2}
                  />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <p className="flex h-full items-center justify-center text-sm text-gray-400">
                Sem dados mensais disponiveis.
              </p>
            )}
          </div>
        </div>

        {/* FOB by Brand */}
        <div className="rounded-lg border border-gray-200 bg-white p-5">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">
            FOB por Marca
          </h3>
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
                    formatter={(value: number) =>
                      formatCurrency(value)
                    }
                  />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <p className="flex h-full items-center justify-center text-sm text-gray-400">
                Sem dados de FOB por marca.
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Recent Processes */}
      <div className="rounded-lg border border-gray-200 bg-white">
        <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4">
          <h3 className="text-lg font-semibold text-gray-900">
            Processos Recentes
          </h3>
          <Link
            to="/processos"
            className="flex items-center gap-1 text-sm font-medium text-blue-600 hover:text-blue-700"
          >
            Ver todos <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead>
              <tr className="bg-gray-50">
                <th className="px-5 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                  Código
                </th>
                <th className="px-5 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                  Marca
                </th>
                <th className="px-5 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                  Status
                </th>
                <th className="px-5 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                  ETD
                </th>
                <th className="px-5 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                  Data Criação
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {(overview?.recentProcesses ?? []).map((proc) => (
                <tr
                  key={proc.id}
                  className="hover:bg-gray-50 cursor-pointer transition-colors"
                >
                  <td className="px-5 py-3 text-sm">
                    <Link
                      to={`/processos/${proc.id}`}
                      className="font-medium text-blue-600 hover:text-blue-700"
                    >
                      {proc.processCode}
                    </Link>
                  </td>
                  <td className="px-5 py-3 text-sm text-gray-700 capitalize">
                    {proc.brand}
                  </td>
                  <td className="px-5 py-3 text-sm">
                    <StatusBadge status={proc.status} />
                  </td>
                  <td className="px-5 py-3 text-sm text-gray-500">
                    {proc.etd ? formatDate(proc.etd) : '-'}
                  </td>
                  <td className="px-5 py-3 text-sm text-gray-500">
                    {formatDate(proc.createdAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
