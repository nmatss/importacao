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
  CheckCircle2,
  XCircle,
  Clock,
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
    <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-blue-700 text-xs font-bold text-white shadow-sm">
      {initials}
    </div>
  );
}

function SkeletonBlock({ className }: { className?: string }) {
  return <div className={cn('bg-slate-100 rounded-md animate-pulse', className)} />;
}

function HealthDot({ status }: { status: HealthStatus | null }) {
  if (!status) return <span className="h-2 w-2 rounded-full bg-slate-300 animate-pulse" />;
  return (
    <span
      className={cn(
        'h-2 w-2 rounded-full',
        status.connected ? 'bg-emerald-500' : 'bg-red-400',
      )}
    />
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
    <div className="min-h-screen bg-slate-50/80">
      {/* ---- Header ---- */}
      <header className="sticky top-0 z-30 bg-white/80 backdrop-blur-md border-b border-slate-200/60">
        <div className="mx-auto max-w-6xl px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src="/logo-unico.png" alt="Uni.co" className="h-8 w-8 rounded-full ring-1 ring-slate-200" />
            <div className="hidden sm:block">
              <p className="text-sm font-semibold text-slate-900 leading-none">Uni.co</p>
              <p className="text-[10px] text-slate-400 mt-0.5">Sistema Integrado</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {user && (
              <>
                <div className="text-right hidden sm:block mr-1">
                  <p className="text-sm font-medium text-slate-800 leading-tight">{user.name}</p>
                  <p className="text-[11px] text-slate-400">{user.role}</p>
                </div>
                <UserAvatar name={user.name || 'U'} />
                <div className="w-px h-6 bg-slate-200 mx-1" />
                <button
                  onClick={logout}
                  className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-700 transition-colors"
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
        {/* ---- Welcome ---- */}
        <section className="mb-10">
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
            {getGreeting()}, {firstName}
          </h1>
          <p className="mt-1.5 text-sm text-slate-500 first-letter:capitalize">
            {formatDatePtBr()}
          </p>

          {/* Summary pills */}
          <div className="mt-4 flex flex-wrap items-center gap-2">
            {importLoading ? (
              <SkeletonBlock className="h-7 w-44" />
            ) : overview ? (
              <>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700">
                  <Activity className="h-3 w-3" />
                  {overview.activeProcesses} processo{overview.activeProcesses !== 1 ? 's' : ''} ativo{overview.activeProcesses !== 1 ? 's' : ''}
                </span>
                {overview.overdueProcesses > 0 && (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-red-50 px-3 py-1 text-xs font-medium text-red-600">
                    <AlertTriangle className="h-3 w-3" />
                    {overview.overdueProcesses} atrasado{overview.overdueProcesses !== 1 ? 's' : ''}
                  </span>
                )}
                <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700">
                  <TrendingUp className="h-3 w-3" />
                  {overview.completedThisMonth} concluido{overview.completedThisMonth !== 1 ? 's' : ''} no mes
                </span>
              </>
            ) : null}

            {certLoading ? (
              <SkeletonBlock className="h-7 w-40" />
            ) : certStats ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">
                <Package className="h-3 w-3" />
                {certStats.total_products} produtos monitorados
              </span>
            ) : null}
          </div>
        </section>

        {/* ---- Module Cards ---- */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Importacao */}
          <div className="group relative bg-white rounded-2xl border border-slate-200/80 shadow-sm hover:shadow-md transition-all duration-200 overflow-hidden">
            {/* Top accent bar */}
            <div className="h-1 bg-gradient-to-r from-blue-500 to-blue-600" />

            <div className="p-6">
              {/* Title row */}
              <div className="flex items-start gap-4">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-600 group-hover:bg-blue-100 transition-colors">
                  <FileBox className="h-5 w-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <h2 className="text-base font-semibold text-slate-900">Importacao</h2>
                  <p className="mt-0.5 text-sm text-slate-500 leading-snug">
                    Processos, documentos, validacao, cambios e follow-up
                  </p>
                </div>
              </div>

              {/* Stats */}
              <div className="mt-5 grid grid-cols-3 gap-3">
                {importLoading ? (
                  <>
                    <SkeletonBlock className="h-16 rounded-xl" />
                    <SkeletonBlock className="h-16 rounded-xl" />
                    <SkeletonBlock className="h-16 rounded-xl" />
                  </>
                ) : overview ? (
                  <>
                    <div className="rounded-xl bg-slate-50 px-3 py-3 text-center">
                      <p className="text-xl font-bold text-blue-600">{overview.activeProcesses}</p>
                      <p className="text-[11px] text-slate-500 mt-0.5">Ativos</p>
                    </div>
                    <div className="rounded-xl bg-slate-50 px-3 py-3 text-center">
                      <p className={cn('text-xl font-bold', overview.overdueProcesses > 0 ? 'text-red-500' : 'text-slate-400')}>
                        {overview.overdueProcesses}
                      </p>
                      <p className="text-[11px] text-slate-500 mt-0.5">Atrasados</p>
                    </div>
                    <div className="rounded-xl bg-slate-50 px-3 py-3 text-center">
                      <p className="text-xl font-bold text-emerald-600">{overview.completedThisMonth}</p>
                      <p className="text-[11px] text-slate-500 mt-0.5">Concluidos</p>
                    </div>
                  </>
                ) : (
                  <div className="col-span-3 rounded-xl bg-slate-50 py-4 text-center text-xs text-slate-400">
                    Sem dados disponiveis
                  </div>
                )}
              </div>

              {/* CTA */}
              <Link
                to="/importacao/dashboard"
                className="mt-5 flex items-center justify-center gap-2 w-full rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700 active:bg-blue-800 transition-colors"
              >
                Acessar Modulo
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>

            {/* Quick links */}
            <div className="border-t border-slate-100 bg-slate-50/50 px-6 py-3 flex items-center gap-5">
              <Link to="/importacao/processos/novo" className="flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-blue-600 transition-colors">
                <Plus className="h-3.5 w-3.5" />
                Novo Processo
              </Link>
              <Link to="/importacao/processos" className="flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-blue-600 transition-colors">
                <Eye className="h-3.5 w-3.5" />
                Ver Processos
              </Link>
              <Link to="/importacao/follow-up" className="flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-blue-600 transition-colors">
                <CalendarClock className="h-3.5 w-3.5" />
                Follow-Up
              </Link>
            </div>
          </div>

          {/* Certificacoes */}
          <div className="group relative bg-white rounded-2xl border border-slate-200/80 shadow-sm hover:shadow-md transition-all duration-200 overflow-hidden">
            {/* Top accent bar */}
            <div className="h-1 bg-gradient-to-r from-emerald-500 to-emerald-600" />

            <div className="p-6">
              {/* Title row */}
              <div className="flex items-start gap-4">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600 group-hover:bg-emerald-100 transition-colors">
                  <ShieldCheck className="h-5 w-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <h2 className="text-base font-semibold text-slate-900">Certificacoes</h2>
                  <p className="mt-0.5 text-sm text-slate-500 leading-snug">
                    Verificacao INMETRO/ANATEL nos e-commerces Puket e Imaginarium
                  </p>
                </div>
              </div>

              {/* Stats */}
              <div className="mt-5 grid grid-cols-3 gap-3">
                {certLoading ? (
                  <>
                    <SkeletonBlock className="h-16 rounded-xl" />
                    <SkeletonBlock className="h-16 rounded-xl" />
                    <SkeletonBlock className="h-16 rounded-xl" />
                  </>
                ) : certStats ? (
                  <>
                    <div className="rounded-xl bg-slate-50 px-3 py-3 text-center">
                      <p className="text-xl font-bold text-slate-700">{certStats.total_products}</p>
                      <p className="text-[11px] text-slate-500 mt-0.5">Produtos</p>
                    </div>
                    <div className="rounded-xl bg-slate-50 px-3 py-3 text-center">
                      <p className="text-xl font-bold text-emerald-600">{certStats.ok}</p>
                      <p className="text-[11px] text-slate-500 mt-0.5">Conforme</p>
                    </div>
                    <div className="rounded-xl bg-slate-50 px-3 py-3 text-center">
                      <p className={cn('text-xl font-bold', problems > 0 ? 'text-red-500' : 'text-slate-400')}>
                        {problems}
                      </p>
                      <p className="text-[11px] text-slate-500 mt-0.5">Pendencias</p>
                    </div>
                  </>
                ) : (
                  <div className="col-span-3 rounded-xl bg-slate-50 py-4 text-center text-xs text-slate-400">
                    API indisponivel
                  </div>
                )}
              </div>

              {/* CTA */}
              <Link
                to="/certificacoes"
                className="mt-5 flex items-center justify-center gap-2 w-full rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-emerald-700 active:bg-emerald-800 transition-colors"
              >
                Acessar Modulo
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>

            {/* Quick links */}
            <div className="border-t border-slate-100 bg-slate-50/50 px-6 py-3 flex items-center gap-5">
              <Link to="/certificacoes/validacao" className="flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-emerald-600 transition-colors">
                <Play className="h-3.5 w-3.5" />
                Nova Validacao
              </Link>
              <Link to="/certificacoes/produtos" className="flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-emerald-600 transition-colors">
                <Package className="h-3.5 w-3.5" />
                Produtos
              </Link>
              <Link to="/certificacoes/relatorios" className="flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-emerald-600 transition-colors">
                <FileBarChart className="h-3.5 w-3.5" />
                Relatorios
              </Link>
            </div>
          </div>
        </div>

        {/* ---- Status Footer ---- */}
        <footer className="mt-10 rounded-xl border border-slate-200/60 bg-white px-5 py-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-5">
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <HealthDot status={importHealth} />
              <span>
                Importacao{' '}
                {importHealth ? (
                  importHealth.connected ? (
                    <span className="text-emerald-600 font-medium">{importHealth.latencyMs}ms</span>
                  ) : (
                    <span className="text-red-500 font-medium">offline</span>
                  )
                ) : (
                  <span className="text-slate-400">...</span>
                )}
              </span>
            </div>
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <HealthDot status={certHealth} />
              <span>
                Certificacoes{' '}
                {certHealth ? (
                  certHealth.connected ? (
                    <span className="text-emerald-600 font-medium">{certHealth.latencyMs}ms</span>
                  ) : (
                    <span className="text-red-500 font-medium">offline</span>
                  )
                ) : (
                  <span className="text-slate-400">...</span>
                )}
              </span>
            </div>
          </div>
          <p className="text-[11px] text-slate-400">
            v1.0.0
          </p>
        </footer>
      </main>
    </div>
  );
}
