import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  FileBox,
  ShieldCheck,
  LogOut,
  ArrowRight,
  Package,
  Play,
  FileBarChart,
  CalendarClock,
  Plus,
  Eye,
  Activity,
  TrendingUp,
  AlertTriangle,
  Ship,
  BarChart3,
} from 'lucide-react';
import { useAuth } from '@/shared/hooks/useAuth';
import { useApiQuery } from '@/shared/hooks/useApi';
import { cn } from '@/shared/lib/utils';
import { fetchCertStats, checkCertApiHealth } from '@/shared/lib/cert-api-client';

interface DashboardOverview {
  activeProcesses: number;
  overdueProcesses: number;
  completedThisMonth: number;
}

interface CertStats {
  total_products: number;
  ok: number;
  missing: number;
  inconsistent: number;
}

interface HealthStatus {
  connected: boolean;
  latencyMs: number;
}

function getGreeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Bom dia';
  if (h < 18) return 'Boa tarde';
  return 'Boa noite';
}

function formatDatePtBr(): string {
  return new Date().toLocaleDateString('pt-BR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

function UserAvatar({ name }: { name: string }) {
  const initials = name
    .split(' ')
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();
  return (
    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-primary-500 to-primary-600 text-[11px] font-bold text-white shadow-sm">
      {initials}
    </div>
  );
}

function Skeleton({ className }: { className?: string }) {
  return <div className={cn('bg-slate-200/50 rounded-lg animate-pulse', className)} />;
}

function StatCard({
  value,
  label,
  color,
  loading,
}: {
  value: number;
  label: string;
  color: 'primary' | 'danger' | 'emerald' | 'slate';
  loading?: boolean;
}) {
  if (loading) return <Skeleton className="h-[68px]" />;

  const colorMap = {
    primary: 'text-primary-600',
    danger: 'text-danger-500',
    emerald: 'text-emerald-600',
    slate: 'text-slate-700',
  };

  return (
    <div className="rounded-xl bg-slate-50 border border-slate-100 px-4 py-3 text-center">
      <p
        className={cn(
          'text-xl font-bold tabular-nums',
          value === 0 && color !== 'primary' && color !== 'slate'
            ? 'text-slate-300'
            : colorMap[color],
        )}
      >
        {value}
      </p>
      <p className="text-[11px] text-slate-500 mt-0.5 font-medium">{label}</p>
    </div>
  );
}

function QuickLink({
  to,
  icon: Icon,
  label,
  hoverColor = 'hover:text-primary-600 hover:bg-primary-50',
}: {
  to: string;
  icon: typeof Plus;
  label: string;
  hoverColor?: string;
}) {
  return (
    <Link
      to={to}
      className={cn(
        'flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-medium text-slate-500 transition-colors',
        hoverColor,
      )}
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
    </Link>
  );
}

export function PortalPage() {
  const { user, logout } = useAuth();
  const [certStats, setCertStats] = useState<CertStats | null>(null);
  const [certLoading, setCertLoading] = useState(true);
  const [importHealth, setImportHealth] = useState<HealthStatus | null>(null);
  const [certHealth, setCertHealth] = useState<HealthStatus | null>(null);

  const { data: overview, isLoading: importLoading } = useApiQuery<DashboardOverview>(
    ['portal', 'overview'],
    '/api/dashboard/overview',
  );

  useEffect(() => {
    fetchCertStats()
      .then((data: any) => {
        const run = data?.last_run;
        setCertStats({
          total_products: data?.total_products || 0,
          ok: run?.ok || 0,
          missing: run?.missing || 0,
          inconsistent: run?.inconsistent || 0,
        });
      })
      .catch(() => setCertStats(null))
      .finally(() => setCertLoading(false));

    async function checkImportHealth() {
      const start = performance.now();
      try {
        const res = await fetch('/api/health');
        setImportHealth({ connected: res.ok, latencyMs: Math.round(performance.now() - start) });
      } catch {
        setImportHealth({ connected: false, latencyMs: Math.round(performance.now() - start) });
      }
    }

    checkImportHealth();
    checkCertApiHealth().then(setCertHealth);
  }, []);

  const problems = (certStats?.missing || 0) + (certStats?.inconsistent || 0);
  const firstName = user?.name?.split(' ')[0] || '';

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <header className="sticky top-0 z-30 bg-white border-b border-slate-200/60">
        <div className="mx-auto max-w-6xl px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-sidebar-900">
              <img src="/logo-unico.png" alt="Uni.co" className="h-6 w-6 rounded" />
            </div>
            <div className="hidden sm:block">
              <p className="text-sm font-bold text-slate-900 leading-none tracking-tight">Uni.co</p>
              <p className="text-[10px] text-slate-400 mt-0.5 font-medium">Sistema Integrado</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {user && (
              <>
                <div className="text-right hidden sm:block mr-1">
                  <p className="text-sm font-medium text-slate-700 leading-tight">{user.name}</p>
                  <p className="text-[11px] text-slate-400">
                    {user.role === 'admin' ? 'Administrador' : 'Analista'}
                  </p>
                </div>
                <UserAvatar name={user.name || 'U'} />
                <div className="w-px h-5 bg-slate-200 mx-1" />
                <button
                  onClick={logout}
                  className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-400 hover:bg-danger-50 hover:text-danger-600 transition-colors"
                >
                  <LogOut className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">Sair</span>
                </button>
              </>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-8">
        {/* Welcome */}
        <section className="mb-8">
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
            {getGreeting()}, {firstName}
          </h1>
          <p className="mt-1 text-sm text-slate-500 first-letter:capitalize">{formatDatePtBr()}</p>

          {/* Summary pills */}
          <div className="mt-4 flex flex-wrap items-center gap-2">
            {importLoading ? (
              <Skeleton className="h-7 w-44 rounded-full" />
            ) : overview ? (
              <>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-primary-50 border border-primary-100 px-3 py-1 text-xs font-medium text-primary-700">
                  <Activity className="h-3 w-3" />
                  {overview.activeProcesses} processo{overview.activeProcesses !== 1 ? 's' : ''}{' '}
                  ativo{overview.activeProcesses !== 1 ? 's' : ''}
                </span>
                {overview.overdueProcesses > 0 && (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-danger-50 border border-danger-100 px-3 py-1 text-xs font-medium text-danger-600">
                    <AlertTriangle className="h-3 w-3" />
                    {overview.overdueProcesses} atrasado{overview.overdueProcesses !== 1 ? 's' : ''}
                  </span>
                )}
                <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 border border-emerald-100 px-3 py-1 text-xs font-medium text-emerald-700">
                  <TrendingUp className="h-3 w-3" />
                  {overview.completedThisMonth} concluído
                  {overview.completedThisMonth !== 1 ? 's' : ''} no mês
                </span>
              </>
            ) : null}

            {certLoading ? (
              <Skeleton className="h-7 w-40 rounded-full" />
            ) : certStats ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 border border-slate-200 px-3 py-1 text-xs font-medium text-slate-600">
                <Package className="h-3 w-3" />
                {certStats.total_products} produtos monitorados
              </span>
            ) : null}
          </div>
        </section>

        {/* Module Cards */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Importacao */}
          <div className="group relative bg-white rounded-2xl border border-slate-200/60 hover:border-primary-200/60 transition-all duration-300 overflow-hidden shadow-sm hover:shadow-md">
            <div className="h-1 bg-gradient-to-r from-primary-500 to-primary-600" />

            <div className="p-6">
              <div className="flex items-start gap-4 mb-5">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary-50 text-primary-600">
                  <Ship className="h-5 w-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <h2 className="text-base font-bold text-slate-900">Importação</h2>
                  <p className="mt-0.5 text-sm text-slate-500">
                    Processos, documentos, validação, câmbios e follow-up
                  </p>
                </div>
              </div>

              {/* Stats grid */}
              <div className="grid grid-cols-3 gap-3 mb-5">
                <StatCard
                  value={overview?.activeProcesses ?? 0}
                  label="Ativos"
                  color="primary"
                  loading={importLoading}
                />
                <StatCard
                  value={overview?.overdueProcesses ?? 0}
                  label="Atrasados"
                  color="danger"
                  loading={importLoading}
                />
                <StatCard
                  value={overview?.completedThisMonth ?? 0}
                  label="Concluídos"
                  color="emerald"
                  loading={importLoading}
                />
              </div>

              <Link
                to="/importacao/dashboard"
                className="flex items-center justify-center gap-2 w-full rounded-xl bg-primary-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-primary-700 active:scale-[0.98] transition-all shadow-sm"
              >
                <BarChart3 className="h-4 w-4" />
                Acessar Dashboard
                <ArrowRight className="h-4 w-4 ml-auto opacity-60 group-hover:translate-x-0.5 transition-transform" />
              </Link>
            </div>

            {/* Quick links */}
            <div className="border-t border-slate-100 bg-slate-50/50 px-5 py-2 flex items-center gap-1">
              <QuickLink to="/importacao/processos/novo" icon={Plus} label="Novo" />
              <QuickLink to="/importacao/processos" icon={Eye} label="Processos" />
              <QuickLink to="/importacao/follow-up" icon={CalendarClock} label="Follow-Up" />
            </div>
          </div>

          {/* Certificacoes */}
          <div className="group relative bg-white rounded-2xl border border-slate-200/60 hover:border-emerald-200/60 transition-all duration-300 overflow-hidden shadow-sm hover:shadow-md">
            <div className="h-1 bg-gradient-to-r from-emerald-500 to-emerald-600" />

            <div className="p-6">
              <div className="flex items-start gap-4 mb-5">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
                  <ShieldCheck className="h-5 w-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <h2 className="text-base font-bold text-slate-900">Certificações</h2>
                  <p className="mt-0.5 text-sm text-slate-500">
                    Verificação INMETRO / ANATEL nos e-commerces
                  </p>
                </div>
              </div>

              {/* Stats grid */}
              <div className="grid grid-cols-3 gap-3 mb-5">
                {certLoading ? (
                  <>
                    <Skeleton className="h-[68px]" />
                    <Skeleton className="h-[68px]" />
                    <Skeleton className="h-[68px]" />
                  </>
                ) : certStats ? (
                  <>
                    <StatCard value={certStats.total_products} label="Produtos" color="slate" />
                    <StatCard value={certStats.ok} label="Conforme" color="emerald" />
                    <StatCard value={problems} label="Pendências" color="danger" />
                  </>
                ) : (
                  <div className="col-span-3 rounded-xl bg-slate-50 border border-slate-100 py-5 text-center text-xs text-slate-400 font-medium">
                    API indisponível
                  </div>
                )}
              </div>

              <Link
                to="/certificacoes"
                className="flex items-center justify-center gap-2 w-full rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-emerald-700 active:scale-[0.98] transition-all shadow-sm"
              >
                <ShieldCheck className="h-4 w-4" />
                Acessar Certificações
                <ArrowRight className="h-4 w-4 ml-auto opacity-60 group-hover:translate-x-0.5 transition-transform" />
              </Link>
            </div>

            {/* Quick links */}
            <div className="border-t border-slate-100 bg-slate-50/50 px-5 py-2 flex items-center gap-1">
              <QuickLink
                to="/certificacoes/validacao"
                icon={Play}
                label="Validar"
                hoverColor="hover:text-emerald-600 hover:bg-emerald-50"
              />
              <QuickLink
                to="/certificacoes/produtos"
                icon={Package}
                label="Produtos"
                hoverColor="hover:text-emerald-600 hover:bg-emerald-50"
              />
              <QuickLink
                to="/certificacoes/relatorios"
                icon={FileBarChart}
                label="Relatórios"
                hoverColor="hover:text-emerald-600 hover:bg-emerald-50"
              />
            </div>
          </div>
        </div>

        {/* Status footer */}
        <footer className="mt-8 rounded-xl border border-slate-200/60 bg-white px-6 py-3 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <span
                className={cn(
                  'h-2 w-2 rounded-full',
                  importHealth === null
                    ? 'bg-slate-300 animate-pulse'
                    : importHealth.connected
                      ? 'bg-emerald-500'
                      : 'bg-danger-500',
                )}
              />
              <span className="font-medium">Importação</span>
              {importHealth &&
                (importHealth.connected ? (
                  <span className="text-emerald-600">{importHealth.latencyMs}ms</span>
                ) : (
                  <span className="text-danger-500">offline</span>
                ))}
            </div>
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <span
                className={cn(
                  'h-2 w-2 rounded-full',
                  certHealth === null
                    ? 'bg-slate-300 animate-pulse'
                    : certHealth.connected
                      ? 'bg-emerald-500'
                      : 'bg-danger-500',
                )}
              />
              <span className="font-medium">Certificações</span>
              {certHealth &&
                (certHealth.connected ? (
                  <span className="text-emerald-600">{certHealth.latencyMs}ms</span>
                ) : (
                  <span className="text-danger-500">offline</span>
                ))}
            </div>
          </div>
          <p className="text-[11px] text-slate-400 font-medium">v1.0.0</p>
        </footer>
      </main>
    </div>
  );
}
