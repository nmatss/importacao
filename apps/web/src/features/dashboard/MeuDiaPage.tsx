import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  CalendarDays,
  AlertTriangle,
  CheckCircle,
  Clock,
  ArrowRight,
  FileWarning,
  DollarSign,
  Bell,
  Loader2,
  Target,
} from 'lucide-react';
import { useApiQuery } from '@/shared/hooks/useApi';
import { cn, formatDate, formatCurrency } from '@/shared/lib/utils';
import { StatusBadge } from '@/shared/components/StatusBadge';
import { LoadingSpinner } from '@/shared/components/LoadingSpinner';

// ── Types ────────────────────────────────────────────────────────────────

interface SlaData {
  docsOverdue: Array<{
    id: number;
    processCode: string;
    brand: string;
    daysSinceShipment: number;
    assignedUser: string | null;
  }>;
  liUrgent: Array<{
    id: number;
    processCode: string;
    brand: string;
    daysRemaining: number;
    liDeadline: string;
  }>;
  withDivergences: Array<{
    id: number;
    processCode: string;
    brand: string;
    failedCheckCount: number;
  }>;
  pendingFenicia: Array<{
    id: number;
    processCode: string;
    brand: string;
    daysPending: number;
  }>;
  noEspelho: Array<{
    id: number;
    processCode: string;
    brand: string;
  }>;
  pendingCambio: Array<{
    id: number;
    processCode: string;
    brand: string;
  }>;
  pendingNumerario: Array<{
    id: number;
    processCode: string;
    brand: string;
  }>;
  pendingDesembaraco: Array<{
    id: number;
    processCode: string;
    brand: string;
  }>;
}

interface OverviewData {
  activeProcesses: number;
  overdueProcesses: number;
  completedThisMonth: number;
  totalFobValue: number;
  recentAlerts: Array<{
    id: number;
    message: string;
    severity: 'critical' | 'warning' | 'info';
    createdAt: string;
  }>;
}

interface AlertData {
  id: number;
  message: string;
  severity: 'critical' | 'warning' | 'info';
  processCode?: string;
  processId?: number;
  createdAt: string;
}

interface PaginatedAlerts {
  data: AlertData[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

// ── Component ────────────────────────────────────────────────────────────

export function MeuDiaPage() {
  const { data: slaData, isLoading: slaLoading } = useApiQuery<SlaData>(
    ['dashboard', 'sla'],
    '/api/dashboard/sla',
  );

  const { data: overview, isLoading: overviewLoading } = useApiQuery<OverviewData>(
    ['dashboard', 'overview'],
    '/api/dashboard/overview',
  );

  const { data: alertsResponse, isLoading: alertsLoading } = useApiQuery<PaginatedAlerts>(
    ['alerts'],
    '/api/alerts?limit=10',
  );
  const alerts = Array.isArray(alertsResponse)
    ? alertsResponse
    : Array.isArray((alertsResponse as any)?.data)
      ? (alertsResponse as PaginatedAlerts).data
      : [];

  const isLoading = slaLoading || overviewLoading || alertsLoading;

  const pendingTasks = useMemo(() => {
    if (!slaData) return [];

    const tasks: Array<{
      id: string;
      title: string;
      description: string;
      priority: 'critical' | 'high' | 'medium';
      link: string;
      count: number;
    }> = [];

    if (slaData.docsOverdue?.length > 0) {
      tasks.push({
        id: 'docs-overdue',
        title: 'Documentos Pendentes',
        description: 'Processos com documentos atrasados',
        priority: 'critical',
        link: '/importacao/processos?status=draft',
        count: slaData.docsOverdue.length,
      });
    }

    if (slaData.liUrgent?.length > 0) {
      tasks.push({
        id: 'li-urgent',
        title: 'LIs Urgentes',
        description: 'Licencas de importacao com prazo proximo',
        priority: 'critical',
        link: '/importacao/lis',
        count: slaData.liUrgent.length,
      });
    }

    if (slaData.withDivergences?.length > 0) {
      tasks.push({
        id: 'divergences',
        title: 'Divergencias a Resolver',
        description: 'Processos com falhas na validacao',
        priority: 'high',
        link: '/importacao/processos?status=validating',
        count: slaData.withDivergences.length,
      });
    }

    if (slaData.noEspelho?.length > 0) {
      tasks.push({
        id: 'no-espelho',
        title: 'Aguardando Espelho',
        description: 'Processos validados sem espelho gerado',
        priority: 'medium',
        link: '/importacao/processos?status=validated',
        count: slaData.noEspelho.length,
      });
    }

    if (slaData.pendingFenicia?.length > 0) {
      tasks.push({
        id: 'pending-fenicia',
        title: 'Pendente Envio Fenicia',
        description: 'Espelhos prontos aguardando envio',
        priority: 'medium',
        link: '/importacao/processos?status=espelho_generated',
        count: slaData.pendingFenicia.length,
      });
    }

    if (slaData.pendingCambio?.length > 0) {
      tasks.push({
        id: 'pending-cambio',
        title: 'Cambio Pendente',
        description: 'Processos aguardando operacao cambial',
        priority: 'medium',
        link: '/importacao/cambios',
        count: slaData.pendingCambio.length,
      });
    }

    if (slaData.pendingNumerario?.length > 0) {
      tasks.push({
        id: 'pending-numerario',
        title: 'Numerario Pendente',
        description: 'Processos aguardando numerario',
        priority: 'medium',
        link: '/importacao/numerario',
        count: slaData.pendingNumerario.length,
      });
    }

    if (slaData.pendingDesembaraco?.length > 0) {
      tasks.push({
        id: 'pending-desembaraco',
        title: 'Desembaraco Pendente',
        description: 'Processos aguardando desembaraco',
        priority: 'medium',
        link: '/importacao/desembaraco',
        count: slaData.pendingDesembaraco.length,
      });
    }

    return tasks.sort((a, b) => {
      const priorityOrder = { critical: 0, high: 1, medium: 2 };
      return priorityOrder[a.priority] - priorityOrder[b.priority];
    });
  }, [slaData]);

  const criticalAlerts = useMemo(() => {
    if (!Array.isArray(alerts)) return [];
    return alerts.filter((a) => a.severity === 'critical').slice(0, 5);
  }, [alerts]);

  const today = new Date().toLocaleDateString('pt-BR', {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });

  if (isLoading) {
    return <LoadingSpinner />;
  }

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 mb-6">
        <div>
          <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100 tracking-tight">
            Meu Dia
          </h2>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400 capitalize">{today}</p>
        </div>
        <div className="flex items-center gap-2">
          <CalendarDays className="h-5 w-5 text-primary-600" />
          <span className="text-sm font-medium text-primary-600 hidden sm:inline">
            Cockpit Pessoal
          </span>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5 stagger-children">
        <SummaryCard
          icon={<Target className="h-5 w-5 text-primary-600" />}
          label="Processos Ativos"
          value={overview?.activeProcesses ?? 0}
          bgColor="bg-primary-50 dark:bg-primary-950/40"
        />
        <SummaryCard
          icon={<AlertTriangle className="h-5 w-5 text-danger-600" />}
          label="Atrasados"
          value={overview?.overdueProcesses ?? 0}
          bgColor="bg-danger-50 dark:bg-danger-950/40"
        />
        <SummaryCard
          icon={<CheckCircle className="h-5 w-5 text-emerald-600" />}
          label="Concluidos no Mes"
          value={overview?.completedThisMonth ?? 0}
          bgColor="bg-emerald-50 dark:bg-emerald-950/40"
        />
        <SummaryCard
          icon={<DollarSign className="h-5 w-5 text-amber-600" />}
          label="Valor FOB Total"
          value={formatCurrency(overview?.totalFobValue ?? 0)}
          bgColor="bg-amber-50 dark:bg-amber-950/40"
        />
      </div>

      {/* Main content grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Pending Tasks - 2 columns */}
        <div className="lg:col-span-2 space-y-4">
          <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100 flex items-center gap-2">
            <Clock className="h-5 w-5 text-slate-400" />
            Tarefas Pendentes
            {pendingTasks.length > 0 && (
              <span className="inline-flex items-center justify-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-danger-100 text-danger-700 ring-1 ring-danger-200/60">
                {pendingTasks.length}
              </span>
            )}
          </h3>

          {pendingTasks.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-emerald-300 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-950/30 p-8 text-center">
              <CheckCircle className="h-8 w-8 text-emerald-500 mx-auto mb-2" />
              <p className="text-sm font-medium text-emerald-700 dark:text-emerald-400">
                Nenhuma pendencia para hoje!
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {pendingTasks.map((task) => (
                <Link
                  key={task.id}
                  to={task.link}
                  className={cn(
                    'block rounded-2xl border p-4 transition-all hover:shadow-md',
                    task.priority === 'critical'
                      ? 'border-danger-200 dark:border-danger-800 bg-danger-50 dark:bg-danger-950/40 hover:border-danger-300'
                      : task.priority === 'high'
                        ? 'border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 hover:border-amber-300'
                        : 'border-slate-200/60 dark:border-slate-700/60 bg-white dark:bg-slate-800 hover:border-primary-300',
                  )}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div
                        className={cn(
                          'flex items-center justify-center h-10 w-10 rounded-lg text-sm font-bold',
                          task.priority === 'critical'
                            ? 'bg-danger-100 dark:bg-danger-900/50 text-danger-700 dark:text-danger-400'
                            : task.priority === 'high'
                              ? 'bg-amber-100 dark:bg-amber-900/50 text-amber-700 dark:text-amber-400'
                              : 'bg-primary-100 dark:bg-primary-900/50 text-primary-700 dark:text-primary-400',
                        )}
                      >
                        {task.count}
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                          {task.title}
                        </p>
                        <p className="text-[11px] text-slate-400">{task.description}</p>
                      </div>
                    </div>
                    <ArrowRight className="h-4 w-4 text-slate-400" />
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>

        {/* Alerts sidebar - 1 column */}
        <div className="space-y-4">
          <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100 flex items-center gap-2">
            <Bell className="h-5 w-5 text-slate-400" />
            Alertas Recentes
          </h3>

          <div className="rounded-2xl border border-slate-200/60 bg-white dark:bg-slate-800 dark:border-slate-700/60 divide-y divide-slate-100 dark:divide-slate-700">
            {!alerts || alerts.length === 0 ? (
              <div className="p-6 text-center">
                <Bell className="h-6 w-6 text-slate-300 mx-auto mb-2" />
                <p className="text-sm text-slate-400">Nenhum alerta recente</p>
              </div>
            ) : (
              alerts.slice(0, 8).map((alert) => (
                <div key={alert.id} className="p-3 flex items-start gap-3">
                  <div
                    className={cn(
                      'mt-0.5 h-2 w-2 rounded-full flex-shrink-0',
                      alert.severity === 'critical'
                        ? 'bg-danger-500'
                        : alert.severity === 'warning'
                          ? 'bg-amber-500'
                          : 'bg-primary-500',
                    )}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-slate-600 dark:text-slate-400 truncate">
                      {alert.message}
                    </p>
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      {formatDate(alert.createdAt)}
                    </p>
                  </div>
                </div>
              ))
            )}
          </div>

          {alerts && alerts.length > 0 && (
            <Link
              to="/importacao/alertas"
              className="block text-center text-sm text-primary-600 hover:text-primary-700 font-medium transition-colors"
            >
              Ver todos os alertas
            </Link>
          )}

          {/* Urgent LIs */}
          {slaData?.liUrgent && slaData.liUrgent.length > 0 && (
            <>
              <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100 flex items-center gap-2 pt-2">
                <FileWarning className="h-5 w-5 text-amber-500" />
                LIs com Prazo Critico
              </h3>
              <div className="rounded-2xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 divide-y divide-amber-100 dark:divide-amber-800">
                {slaData.liUrgent.slice(0, 5).map((li) => (
                  <Link
                    key={li.id}
                    to={`/importacao/processos/${li.id}`}
                    className="block p-3 hover:bg-amber-100 transition-colors"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-slate-900 dark:text-slate-100">
                        {li.processCode}
                      </span>
                      <span className="text-[11px] font-medium text-danger-600">
                        {li.daysRemaining}d restantes
                      </span>
                    </div>
                  </Link>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Helper Components ───────────────────────────────────────────────────

function SummaryCard({
  icon,
  label,
  value,
  bgColor,
}: {
  icon: React.ReactNode;
  label: string;
  value: number | string;
  bgColor: string;
}) {
  return (
    <div
      className={cn(
        'rounded-2xl border border-slate-200/60 dark:border-slate-700/60 p-5 shadow-sm',
        bgColor,
      )}
    >
      <div className="flex items-center gap-3">
        {icon}
        <div>
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
            {label}
          </p>
          <p className="text-base sm:text-xl font-bold text-slate-900 dark:text-slate-100 truncate">
            {value}
          </p>
        </div>
      </div>
    </div>
  );
}
