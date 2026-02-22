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
    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-blue-700 text-sm font-bold text-white ring-2 ring-white shadow">
      {initials}
    </div>
  );
}

function Skeleton({ className }: { className?: string }) {
  return <div className={cn('bg-slate-200/60 rounded-lg animate-pulse', className)} />;
}

function StatCard({
  value,
  label,
  color,
  loading,
}: {
  value: number;
  label: string;
  color: 'blue' | 'red' | 'emerald' | 'slate';
  loading?: boolean;
}) {
  if (loading) return <Skeleton className="h-[72px]" />;

  const colorMap = {
    blue: 'text-blue-600',
    red: 'text-red-500',
    emerald: 'text-emerald-600',
    slate: 'text-slate-700',
  };

  return (
    <div className="rounded-xl bg-white border border-slate-100 px-4 py-3 text-center shadow-sm">
      <p className={cn('text-2xl font-bold tabular-nums', value === 0 && color !== 'blue' && color !== 'slate' ? 'text-slate-300' : colorMap[color])}>
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
  hoverColor = 'hover:text-blue-600 hover:bg-blue-50',
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
        'flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium text-slate-500 transition-colors',
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
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-slate-100/50">
      {/* Header */}
      <header className="sticky top-0 z-30 bg-white/80 backdrop-blur-xl border-b border-slate-200/60 shadow-sm shadow-slate-100/50">
        <div className="mx-auto max-w-6xl px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src="/logo-unico.png" alt="Uni.co" className="h-9 w-9 rounded-full" />
            <div className="hidden sm:block">
              <p className="text-sm font-bold text-slate-900 leading-none tracking-tight">Uni.co</p>
              <p className="text-[10px] text-slate-400 mt-0.5 font-medium">Sistema Integrado</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {user && (
              <>
                <div className="text-right hidden sm:block mr-1">
                  <p className="text-sm font-semibold text-slate-800 leading-tight">{user.name}</p>
                  <p className="text-[11px] text-slate-400 font-medium">{user.role === 'admin' ? 'Administrador' : 'Analista'}</p>
                </div>
                <UserAvatar name={user.name || 'U'} />
                <div className="w-px h-7 bg-slate-200 mx-1" />
                <button
                  onClick={logout}
                  className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium text-slate-400 hover:bg-red-50 hover:text-red-600 transition-colors"
                >
                  <LogOut className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">Sair</span>
                </button>
              </>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-10">
        {/* Welcome */}
        <section className="mb-10">
          <h1 className="text-3xl font-bold text-slate-900 tracking-tight">
            {getGreeting()}, {firstName}
          </h1>
          <p className="mt-2 text-sm text-slate-500 first-letter:capitalize">
            {formatDatePtBr()}
          </p>

          {/* Summary pills */}
          <div className="mt-5 flex flex-wrap items-center gap-2">
            {importLoading ? (
              <Skeleton className="h-7 w-44 rounded-full" />
            ) : overview ? (
              <>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-50 border border-blue-100 px-3 py-1 text-xs font-semibold text-blue-700">
                  <Activity className="h-3 w-3" />
                  {overview.activeProcesses} processo{overview.activeProcesses !== 1 ? 's' : ''} ativo{overview.activeProcesses !== 1 ? 's' : ''}
                </span>
                {overview.overdueProcesses > 0 && (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-red-50 border border-red-100 px-3 py-1 text-xs font-semibold text-red-600">
                    <AlertTriangle className="h-3 w-3" />
                    {overview.overdueProcesses} atrasado{overview.overdueProcesses !== 1 ? 's' : ''}
                  </span>
                )}
                <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 border border-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700">
                  <TrendingUp className="h-3 w-3" />
                  {overview.completedThisMonth} concluido{overview.completedThisMonth !== 1 ? 's' : ''} no mes
                </span>
              </>
            ) : null}

            {certLoading ? (
              <Skeleton className="h-7 w-40 rounded-full" />
            ) : certStats ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-600">
                <Package className="h-3 w-3" />
                {certStats.total_products} produtos monitorados
              </span>
            ) : null}
          </div>
        </section>

        {/* Module Cards */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Importacao */}
          <div className="group relative bg-white rounded-2xl border border-slate-200/80 shadow-sm hover:shadow-lg hover:border-blue-200/60 transition-all duration-300 overflow-hidden">
            <div className="h-1.5 bg-gradient-to-r from-blue-500 via-blue-600 to-indigo-600" />

            <div className="p-7">
              <div className="flex items-start gap-4 mb-6">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-500 to-blue-700 text-white shadow-lg shadow-blue-500/25 group-hover:shadow-blue-500/40 transition-shadow">
                  <Ship className="h-6 w-6" />
                </div>
                <div className="flex-1 min-w-0">
                  <h2 className="text-lg font-bold text-slate-900">Importacao</h2>
                  <p className="mt-0.5 text-sm text-slate-500">
                    Processos, documentos, validacao, cambios e follow-up
                  </p>
                </div>
              </div>

              {/* Stats grid */}
              <div className="grid grid-cols-3 gap-3 mb-6">
                <StatCard
                  value={overview?.activeProcesses ?? 0}
                  label="Ativos"
                  color="blue"
                  loading={importLoading}
                />
                <StatCard
                  value={overview?.overdueProcesses ?? 0}
                  label="Atrasados"
                  color="red"
                  loading={importLoading}
                />
                <StatCard
                  value={overview?.completedThisMonth ?? 0}
                  label="Concluidos"
                  color="emerald"
                  loading={importLoading}
                />
              </div>

              <Link
                to="/importacao/dashboard"
                className="flex items-center justify-center gap-2 w-full rounded-xl bg-gradient-to-r from-blue-600 to-blue-700 px-4 py-3 text-sm font-semibold text-white hover:from-blue-700 hover:to-blue-800 active:scale-[0.98] transition-all shadow-sm shadow-blue-600/20"
              >
                <BarChart3 className="h-4 w-4" />
                Acessar Dashboard
                <ArrowRight className="h-4 w-4 ml-auto group-hover:translate-x-0.5 transition-transform" />
              </Link>
            </div>

            {/* Quick links */}
            <div className="border-t border-slate-100 bg-slate-50/60 px-5 py-2.5 flex items-center gap-1">
              <QuickLink to="/importacao/processos/novo" icon={Plus} label="Novo" />
              <QuickLink to="/importacao/processos" icon={Eye} label="Processos" />
              <QuickLink to="/importacao/follow-up" icon={CalendarClock} label="Follow-Up" />
            </div>
          </div>

          {/* Certificacoes */}
          <div className="group relative bg-white rounded-2xl border border-slate-200/80 shadow-sm hover:shadow-lg hover:border-emerald-200/60 transition-all duration-300 overflow-hidden">
            <div className="h-1.5 bg-gradient-to-r from-emerald-500 via-emerald-600 to-teal-600" />

            <div className="p-7">
              <div className="flex items-start gap-4 mb-6">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-500 to-emerald-700 text-white shadow-lg shadow-emerald-500/25 group-hover:shadow-emerald-500/40 transition-shadow">
                  <ShieldCheck className="h-6 w-6" />
                </div>
                <div className="flex-1 min-w-0">
                  <h2 className="text-lg font-bold text-slate-900">Certificacoes</h2>
                  <p className="mt-0.5 text-sm text-slate-500">
                    Verificacao INMETRO / ANATEL nos e-commerces
                  </p>
                </div>
              </div>

              {/* Stats grid */}
              <div className="grid grid-cols-3 gap-3 mb-6">
                {certLoading ? (
                  <>
                    <Skeleton className="h-[72px]" />
                    <Skeleton className="h-[72px]" />
                    <Skeleton className="h-[72px]" />
                  </>
                ) : certStats ? (
                  <>
                    <StatCard value={certStats.total_products} label="Produtos" color="slate" />
                    <StatCard value={certStats.ok} label="Conforme" color="emerald" />
                    <StatCard value={problems} label="Pendencias" color="red" />
                  </>
                ) : (
                  <div className="col-span-3 rounded-xl bg-slate-50 border border-slate-100 py-5 text-center text-xs text-slate-400 font-medium">
                    API indisponivel
                  </div>
                )}
              </div>

              <Link
                to="/certificacoes"
                className="flex items-center justify-center gap-2 w-full rounded-xl bg-gradient-to-r from-emerald-600 to-emerald-700 px-4 py-3 text-sm font-semibold text-white hover:from-emerald-700 hover:to-emerald-800 active:scale-[0.98] transition-all shadow-sm shadow-emerald-600/20"
              >
                <ShieldCheck className="h-4 w-4" />
                Acessar Certificacoes
                <ArrowRight className="h-4 w-4 ml-auto group-hover:translate-x-0.5 transition-transform" />
              </Link>
            </div>

            {/* Quick links */}
            <div className="border-t border-slate-100 bg-slate-50/60 px-5 py-2.5 flex items-center gap-1">
              <QuickLink to="/certificacoes/validacao" icon={Play} label="Validar" hoverColor="hover:text-emerald-600 hover:bg-emerald-50" />
              <QuickLink to="/certificacoes/produtos" icon={Package} label="Produtos" hoverColor="hover:text-emerald-600 hover:bg-emerald-50" />
              <QuickLink to="/certificacoes/relatorios" icon={FileBarChart} label="Relatorios" hoverColor="hover:text-emerald-600 hover:bg-emerald-50" />
            </div>
          </div>
        </div>

        {/* Status footer */}
        <footer className="mt-10 rounded-xl border border-slate-200/60 bg-white/60 backdrop-blur-sm px-6 py-3.5 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <span className={cn(
                'h-2 w-2 rounded-full',
                importHealth === null ? 'bg-slate-300 animate-pulse' : importHealth.connected ? 'bg-emerald-500' : 'bg-red-400',
              )} />
              <span className="font-medium">Importacao</span>
              {importHealth && (
                importHealth.connected
                  ? <span className="text-emerald-600">{importHealth.latencyMs}ms</span>
                  : <span className="text-red-500">offline</span>
              )}
            </div>
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <span className={cn(
                'h-2 w-2 rounded-full',
                certHealth === null ? 'bg-slate-300 animate-pulse' : certHealth.connected ? 'bg-emerald-500' : 'bg-red-400',
              )} />
              <span className="font-medium">Certificacoes</span>
              {certHealth && (
                certHealth.connected
                  ? <span className="text-emerald-600">{certHealth.latencyMs}ms</span>
                  : <span className="text-red-500">offline</span>
              )}
            </div>
          </div>
          <p className="text-[11px] text-slate-400 font-medium">
            v1.0.0
          </p>
        </footer>
      </main>
    </div>
  );
}
