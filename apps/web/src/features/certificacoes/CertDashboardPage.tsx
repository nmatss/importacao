import { useEffect, useState } from "react"
import { Link } from "react-router-dom"
import { CertStatsCards } from "@/features/certificacoes/components/CertStatsCards"
import { CertBrandChart } from "@/features/certificacoes/components/CertBrandChart"
import { fetchCertStats, fetchCertReports, fetchCertReportDetail, checkCertApiHealth } from "@/shared/lib/cert-api-client"
import { formatDateTime, relativeTime, cn, certStatusColor } from "@/shared/lib/utils"
import {
  PlayCircle,
  FileBarChart,
  Clock,
  TrendingUp,
  AlertTriangle,
  XCircle,
  ArrowRight,
  BarChart3,
  Activity,
} from "lucide-react"
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts"

interface CertStats {
  total_products: number;
  last_run: {
    date: string;
    total: number;
    ok: number;
    missing: number;
    inconsistent: number;
    not_found: number;
  } | null;
  by_brand: Array<{
    brand: string;
    ok: number;
    missing: number;
    inconsistent: number;
    not_found: number;
  }>;
}

interface CertReportFile {
  filename: string;
  date?: string;
  size_bytes?: number;
}

interface CertProblemProduct {
  sku: string;
  name: string;
  status: string;
  brand?: string;
}

const PIE_COLORS = {
  OK: "#10b981",
  MISSING: "#ef4444",
  INCONSISTENT: "#f59e0b",
  NOT_FOUND: "#94a3b8",
}

function Skeleton({ className }: { className?: string }) {
  return <div className={cn('bg-slate-200/60 rounded-lg animate-pulse', className)} />
}

function DashboardSkeleton() {
  return (
    <div className="space-y-8">
      <div>
        <Skeleton className="h-8 w-48 mb-2" />
        <Skeleton className="h-4 w-72" />
      </div>
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-2xl border border-slate-200/80 bg-white p-6 shadow-sm">
            <div className="flex items-start justify-between">
              <div className="space-y-3 flex-1">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-8 w-20" />
              </div>
              <Skeleton className="h-12 w-12 rounded-2xl" />
            </div>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
        <div className="rounded-2xl border border-slate-200/80 bg-white p-7 shadow-sm">
          <Skeleton className="h-5 w-40 mb-6" />
          <Skeleton className="h-56 w-full rounded-xl" />
        </div>
        <div className="rounded-2xl border border-slate-200/80 bg-white p-7 shadow-sm">
          <Skeleton className="h-5 w-40 mb-6" />
          <Skeleton className="h-56 w-full rounded-xl" />
        </div>
      </div>
    </div>
  )
}

export default function CertDashboardPage() {
  const [stats, setStats] = useState<CertStats | null>(null)
  const [reports, setReports] = useState<CertReportFile[]>([])
  const [loading, setLoading] = useState(true)
  const [apiOnline, setApiOnline] = useState(false)
  const [problemProducts, setProblemProducts] = useState<CertProblemProduct[]>([])

  useEffect(() => {
    Promise.all([
      fetchCertStats().catch(() => null),
      fetchCertReports().catch(() => []),
      checkCertApiHealth(),
    ]).then(([s, r, health]) => {
      setStats(s)
      setApiOnline(health.connected)
      const reportList: CertReportFile[] = Array.isArray(r) ? r : []
      setReports(reportList.filter((f) => f.filename?.endsWith('.xlsx')).slice(0, 5))

      // Load problem products from the latest JSON report
      const jsonReport = reportList.find((f) => f.filename?.endsWith('.json'))
      if (jsonReport?.filename) {
        fetchCertReportDetail(jsonReport.filename)
          .then((data) => {
            const raw = data as Record<string, unknown>
            const items: CertProblemProduct[] = Array.isArray(data) ? data : (raw?.products || raw?.results || []) as CertProblemProduct[]
            const problems = items
              .filter((p) => p.status === "MISSING" || p.status === "INCONSISTENT")
              .slice(0, 10)
            setProblemProducts(problems)
          })
          .catch(() => {})
      }

      setLoading(false)
    })
  }, [])

  const lastRun = stats?.last_run
  const okRate = lastRun && lastRun.total > 0
    ? ((lastRun.ok / lastRun.total) * 100).toFixed(1)
    : null
  const okRateNum = okRate ? parseFloat(okRate) : 0

  const pieData = lastRun
    ? [
        { name: "OK", value: lastRun.ok || 0 },
        { name: "Missing", value: lastRun.missing || 0 },
        { name: "Inconsistente", value: lastRun.inconsistent || 0 },
        { name: "Nao Encontrado", value: lastRun.not_found || 0 },
      ].filter((d) => d.value > 0)
    : []

  if (loading) {
    return <DashboardSkeleton />
  }

  return (
    <div className="space-y-8">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Dashboard</h2>
          <p className="mt-1 text-sm text-slate-500">
            Visao geral das certificacoes de produtos
          </p>
        </div>

        <div className="flex items-center gap-3">
          {/* API Status */}
          <div className={cn(
            "flex items-center gap-2.5 px-4 py-2 rounded-xl text-xs font-semibold border transition-colors",
            apiOnline
              ? "bg-emerald-50 text-emerald-700 border-emerald-200/80"
              : "bg-red-50 text-red-700 border-red-200/80"
          )}>
            <span className="relative flex h-2 w-2">
              <span className={cn(
                "absolute inline-flex h-full w-full rounded-full opacity-75",
                apiOnline ? "bg-emerald-400 animate-ping" : "bg-red-400"
              )} />
              <span className={cn(
                "relative inline-flex h-2 w-2 rounded-full",
                apiOnline ? "bg-emerald-500" : "bg-red-500"
              )} />
            </span>
            {apiOnline ? "Sistema Online" : "Sistema Offline"}
          </div>

          {/* Conformance Rate Badge */}
          {okRate && (
            <div className="flex items-center gap-2 px-4 py-2 rounded-xl bg-white border border-slate-200/80 shadow-sm">
              <TrendingUp className="w-4 h-4 text-emerald-500" />
              <span className="text-sm font-bold text-emerald-600">{okRate}%</span>
              <span className="text-xs text-slate-500">conformidade</span>
            </div>
          )}

          {/* Last run */}
          {lastRun?.date && (
            <div className="hidden md:flex items-center gap-2 px-4 py-2 rounded-xl bg-white border border-slate-200/80 shadow-sm text-xs text-slate-500">
              <Clock className="w-3.5 h-3.5 text-slate-400" />
              <span>{formatDateTime(lastRun.date)}</span>
              <span className="px-1.5 py-0.5 rounded-md bg-slate-100 text-slate-600 font-medium text-[10px]">
                {relativeTime(lastRun.date)}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Stats Cards */}
      <CertStatsCards
        loading={loading}
        data={
          lastRun
            ? {
                total: lastRun.total || 0,
                ok: lastRun.ok || 0,
                missing: lastRun.missing || 0,
                inconsistent: lastRun.inconsistent || 0,
                not_found: lastRun.not_found || 0,
              }
            : { total: stats?.total_products || 0, ok: 0, missing: 0, inconsistent: 0, not_found: 0 }
        }
      />

      {/* Charts Row */}
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
        {/* Status Distribution Pie Chart */}
        <div className="rounded-2xl border border-slate-200/80 bg-white p-7 shadow-sm">
          <div className="flex items-center gap-3 mb-6">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-500 to-emerald-700 text-white shadow-md shadow-emerald-500/20">
              <BarChart3 className="h-4 w-4" />
            </div>
            <h3 className="text-base font-bold text-slate-900 tracking-tight">
              Distribuicao de Status
            </h3>
          </div>
          {pieData.length > 0 ? (
            <div className="flex items-center gap-6">
              <div className="relative">
                <ResponsiveContainer width={180} height={180}>
                  <PieChart>
                    <Pie
                      data={pieData}
                      cx="50%"
                      cy="50%"
                      innerRadius={55}
                      outerRadius={80}
                      paddingAngle={3}
                      dataKey="value"
                      stroke="none"
                    >
                      {pieData.map((entry, i) => (
                        <Cell
                          key={i}
                          fill={
                            entry.name === "OK" ? PIE_COLORS.OK :
                            entry.name === "Missing" ? PIE_COLORS.MISSING :
                            entry.name === "Inconsistente" ? PIE_COLORS.INCONSISTENT :
                            PIE_COLORS.NOT_FOUND
                          }
                        />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{
                        backgroundColor: "#ffffff",
                        color: "#1e293b",
                        border: "1px solid #e2e8f0",
                        borderRadius: "12px",
                        boxShadow: "0 4px 6px -1px rgba(0, 0, 0, 0.1)",
                        fontSize: "12px",
                      }}
                    />
                  </PieChart>
                </ResponsiveContainer>
                {/* Center rate */}
                {okRate && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                    <span className={cn(
                      "text-xl font-bold",
                      okRateNum >= 80 ? "text-emerald-600" : okRateNum >= 50 ? "text-amber-600" : "text-red-600"
                    )}>
                      {okRate}%
                    </span>
                    <span className="text-[10px] text-slate-400 font-medium">conforme</span>
                  </div>
                )}
              </div>
              <div className="flex-1 space-y-3">
                {pieData.map((d) => {
                  const color = d.name === "OK" ? PIE_COLORS.OK :
                    d.name === "Missing" ? PIE_COLORS.MISSING :
                    d.name === "Inconsistente" ? PIE_COLORS.INCONSISTENT :
                    PIE_COLORS.NOT_FOUND
                  const total = pieData.reduce((acc, v) => acc + v.value, 0)
                  const pct = total > 0 ? ((d.value / total) * 100).toFixed(0) : "0"
                  return (
                    <div key={d.name} className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-2.5">
                        <span
                          className="w-3 h-3 rounded-md shrink-0"
                          style={{ backgroundColor: color }}
                        />
                        <span className="text-slate-600 font-medium">{d.name}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-slate-900 tabular-nums">{d.value}</span>
                        <span className="text-[11px] text-slate-400 font-medium tabular-nums w-10 text-right">{pct}%</span>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-48 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-50 mb-3">
                <BarChart3 className="h-5 w-5 text-slate-300" />
              </div>
              <p className="text-sm font-medium text-slate-400">Nenhum dado disponivel</p>
              <p className="text-xs text-slate-300 mt-1">Execute uma validacao para ver os resultados</p>
            </div>
          )}
        </div>

        {/* Brand Chart */}
        <div className="rounded-2xl border border-slate-200/80 bg-white p-7 shadow-sm">
          <div className="flex items-center gap-3 mb-6">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500 to-violet-700 text-white shadow-md shadow-violet-500/20">
              <Activity className="h-4 w-4" />
            </div>
            <h3 className="text-base font-bold text-slate-900 tracking-tight">
              Resultados por Marca
            </h3>
          </div>
          <CertBrandChart data={stats?.by_brand} />
        </div>
      </div>

      {/* Bottom Row */}
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
        {/* Products with Problems */}
        <div className="rounded-2xl border border-slate-200/80 bg-white shadow-sm overflow-hidden">
          <div className="flex items-center justify-between px-7 py-5 border-b border-slate-100">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-amber-500 to-amber-700 text-white shadow-md shadow-amber-500/20">
                <AlertTriangle className="h-4 w-4" />
              </div>
              <h3 className="text-base font-bold text-slate-900 tracking-tight">
                Produtos com Problemas
              </h3>
            </div>
            {problemProducts.length > 0 && (
              <Link
                to="/certificacoes/produtos?status=MISSING,INCONSISTENT"
                className="flex items-center gap-1.5 text-sm font-semibold text-emerald-600 hover:text-emerald-700 transition-colors"
              >
                Ver todos <ArrowRight className="h-4 w-4" />
              </Link>
            )}
          </div>
          <div className="px-7 py-5">
            {problemProducts.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-50 mb-3">
                  <AlertTriangle className="h-5 w-5 text-slate-300" />
                </div>
                <p className="text-sm font-medium text-slate-400">
                  {loading ? "Carregando..." : "Nenhum problema encontrado"}
                </p>
                <p className="text-xs text-slate-300 mt-1">Todos os produtos estao em conformidade</p>
              </div>
            ) : (
              <div className="space-y-1">
                {problemProducts.map((p, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between py-2.5 px-3 rounded-xl hover:bg-slate-50 transition-all duration-200 group"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className={cn(
                        "flex h-7 w-7 shrink-0 items-center justify-center rounded-lg",
                        p.status === "MISSING"
                          ? "bg-red-50 text-red-500"
                          : "bg-amber-50 text-amber-500"
                      )}>
                        {p.status === "MISSING" ? (
                          <XCircle className="w-3.5 h-3.5" />
                        ) : (
                          <AlertTriangle className="w-3.5 h-3.5" />
                        )}
                      </div>
                      <span className="text-xs font-mono text-slate-400 shrink-0">{p.sku}</span>
                      <span className="text-sm text-slate-700 truncate font-medium group-hover:text-slate-900 transition-colors">{p.name}</span>
                    </div>
                    <span className={cn(
                      "text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-lg shrink-0",
                      certStatusColor(p.status)
                    )}>
                      {p.status}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Quick Actions & Recent Reports */}
        <div className="space-y-8">
          {/* Quick Actions */}
          <div className="rounded-2xl border border-slate-200/80 bg-white p-7 shadow-sm">
            <h3 className="text-base font-bold text-slate-900 tracking-tight mb-5">
              Acoes Rapidas
            </h3>
            <div className="grid grid-cols-2 gap-4">
              <Link
                to="/certificacoes/validacao"
                className="group flex items-center gap-4 p-5 rounded-2xl border border-slate-200/80 hover:border-emerald-300 hover:bg-emerald-50/50 hover:shadow-md transition-all duration-300"
              >
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-500 to-emerald-700 text-white shadow-md shadow-emerald-500/20 group-hover:shadow-lg group-hover:shadow-emerald-500/30 transition-shadow">
                  <PlayCircle className="w-5 h-5" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-slate-900">Nova Validacao</p>
                  <p className="text-xs text-slate-500 mt-0.5">Verificar todos</p>
                </div>
              </Link>
              <Link
                to="/certificacoes/relatorios"
                className="group flex items-center gap-4 p-5 rounded-2xl border border-slate-200/80 hover:border-emerald-300 hover:bg-emerald-50/50 hover:shadow-md transition-all duration-300"
              >
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-slate-600 to-slate-800 text-white shadow-md shadow-slate-500/20 group-hover:shadow-lg group-hover:shadow-slate-500/30 transition-shadow">
                  <FileBarChart className="w-5 h-5" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-slate-900">Relatorios</p>
                  <p className="text-xs text-slate-500 mt-0.5">Historico completo</p>
                </div>
              </Link>
            </div>
          </div>

          {/* Recent Reports */}
          <div className="rounded-2xl border border-slate-200/80 bg-white shadow-sm overflow-hidden">
            <div className="flex items-center gap-3 px-7 py-5 border-b border-slate-100">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-slate-600 to-slate-800 text-white shadow-md shadow-slate-500/20">
                <Clock className="h-4 w-4" />
              </div>
              <h3 className="text-base font-bold text-slate-900 tracking-tight">
                Ultimas Validacoes
              </h3>
            </div>
            <div className="px-7 py-5">
              {reports.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-10 text-center">
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-50 mb-3">
                    <Clock className="h-5 w-5 text-slate-300" />
                  </div>
                  <p className="text-sm font-medium text-slate-400">Nenhuma validacao realizada</p>
                  <p className="text-xs text-slate-300 mt-1">Resultados aparecerao aqui</p>
                </div>
              ) : (
                <div className="space-y-1">
                  {reports.map((r, i) => (
                    <div key={i} className="flex items-center justify-between py-2.5 px-3 rounded-xl hover:bg-slate-50 transition-all duration-200">
                      <div className="flex items-center gap-3">
                        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-slate-100">
                          <FileBarChart className="w-3.5 h-3.5 text-slate-400" />
                        </div>
                        <span className="text-sm text-slate-700 font-medium">{r.filename}</span>
                      </div>
                      <span className="text-xs text-slate-400 font-medium tabular-nums">
                        {r.date ? formatDateTime(r.date) : ""}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
