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

  const pieData = lastRun
    ? [
        { name: "OK", value: lastRun.ok || 0 },
        { name: "Missing", value: lastRun.missing || 0 },
        { name: "Inconsistente", value: lastRun.inconsistent || 0 },
        { name: "Nao Encontrado", value: lastRun.not_found || 0 },
      ].filter((d) => d.value > 0)
    : []

  return (
    <div className="p-4 md:p-6 space-y-6">
      {/* Health + Last Run Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className={cn(
            "flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium",
            apiOnline
              ? "bg-emerald-50 text-emerald-700"
              : "bg-red-50 text-red-700"
          )}>
            <span className={cn(
              "w-2 h-2 rounded-full",
              apiOnline ? "bg-emerald-500 animate-pulse" : "bg-red-500"
            )} />
            {apiOnline ? "Sistema Online" : "Sistema Offline"}
          </div>

          {okRate && (
            <div className="flex items-center gap-1.5 text-sm text-slate-600">
              <TrendingUp className="w-4 h-4 text-emerald-500" />
              <span className="font-semibold text-emerald-600">{okRate}%</span>
              <span>conformidade</span>
            </div>
          )}
        </div>

        {lastRun?.date && (
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <Clock className="w-3.5 h-3.5" />
            <span>Ultima verificacao: {formatDateTime(lastRun.date)}</span>
            <span className="text-[10px] px-1.5 py-0 rounded-full bg-slate-100 text-slate-600 font-medium">
              {relativeTime(lastRun.date)}
            </span>
          </div>
        )}
      </div>

      {/* Stats */}
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

      <div className="grid md:grid-cols-2 gap-6">
        {/* Status Distribution Pie Chart */}
        <div className="rounded-xl border border-slate-200 bg-white">
          <div className="p-4 pb-2">
            <h3 className="text-sm font-semibold text-slate-900">
              Distribuicao de Status
            </h3>
          </div>
          <div className="p-4">
            {pieData.length > 0 ? (
              <div className="flex items-center gap-4">
                <ResponsiveContainer width="50%" height={200}>
                  <PieChart>
                    <Pie
                      data={pieData}
                      cx="50%"
                      cy="50%"
                      innerRadius={50}
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
                        borderRadius: "8px",
                        fontSize: "12px",
                      }}
                    />
                  </PieChart>
                </ResponsiveContainer>
                <div className="flex-1 space-y-2">
                  {pieData.map((d) => (
                    <div key={d.name} className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-2">
                        <span
                          className="w-3 h-3 rounded-sm"
                          style={{
                            backgroundColor:
                              d.name === "OK" ? PIE_COLORS.OK :
                              d.name === "Missing" ? PIE_COLORS.MISSING :
                              d.name === "Inconsistente" ? PIE_COLORS.INCONSISTENT :
                              PIE_COLORS.NOT_FOUND,
                          }}
                        />
                        <span className="text-slate-600">{d.name}</span>
                      </div>
                      <span className="font-medium text-slate-900">{d.value}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-center h-48 text-sm text-slate-400">
                Nenhum dado disponivel
              </div>
            )}
          </div>
        </div>

        {/* Brand Chart */}
        <div className="rounded-xl border border-slate-200 bg-white">
          <div className="p-4 pb-2">
            <h3 className="text-sm font-semibold text-slate-900">
              Resultados por Marca
            </h3>
          </div>
          <div className="p-4">
            <CertBrandChart data={stats?.by_brand} />
          </div>
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        {/* Products with Problems */}
        <div className="rounded-xl border border-slate-200 bg-white">
          <div className="p-4 pb-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-500" />
                Produtos com Problemas
              </h3>
              {problemProducts.length > 0 && (
                <Link
                  to="/certificacoes/produtos?status=MISSING,INCONSISTENT"
                  className="text-xs text-blue-600 hover:text-blue-700 flex items-center gap-1"
                >
                  Ver todos <ArrowRight className="w-3 h-3" />
                </Link>
              )}
            </div>
          </div>
          <div className="p-4">
            {problemProducts.length === 0 ? (
              <p className="text-sm text-slate-400 py-6 text-center">
                {loading ? "Carregando..." : "Nenhum problema encontrado"}
              </p>
            ) : (
              <div className="space-y-1.5">
                {problemProducts.map((p, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between py-2 px-2 rounded-lg hover:bg-slate-50 transition-colors"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      {p.status === "MISSING" ? (
                        <XCircle className="w-3.5 h-3.5 text-red-500 flex-shrink-0" />
                      ) : (
                        <AlertTriangle className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" />
                      )}
                      <span className="text-xs font-mono text-slate-500 flex-shrink-0">{p.sku}</span>
                      <span className="text-sm text-slate-700 truncate">{p.name}</span>
                    </div>
                    <span className={cn("text-[10px] font-medium px-1.5 py-0.5 rounded", certStatusColor(p.status))}>
                      {p.status}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Quick Actions & Recent Reports */}
        <div className="space-y-6">
          {/* Quick Actions */}
          <div className="rounded-xl border border-slate-200 bg-white">
            <div className="p-4 pb-3">
              <h3 className="text-sm font-semibold text-slate-900">
                Acoes Rapidas
              </h3>
            </div>
            <div className="p-4">
              <div className="grid grid-cols-2 gap-3">
                <Link
                  to="/certificacoes/validacao"
                  className="flex items-center gap-3 p-4 rounded-lg border border-slate-200 hover:border-blue-300 hover:bg-blue-50/50 transition-colors"
                >
                  <PlayCircle className="w-5 h-5 text-blue-600" />
                  <div>
                    <p className="text-sm font-medium text-slate-900">Nova Validacao</p>
                    <p className="text-xs text-slate-500">Verificar todos os produtos</p>
                  </div>
                </Link>
                <Link
                  to="/certificacoes/relatorios"
                  className="flex items-center gap-3 p-4 rounded-lg border border-slate-200 hover:border-blue-300 hover:bg-blue-50/50 transition-colors"
                >
                  <FileBarChart className="w-5 h-5 text-emerald-600" />
                  <div>
                    <p className="text-sm font-medium text-slate-900">Relatorios</p>
                    <p className="text-xs text-slate-500">Ver historico completo</p>
                  </div>
                </Link>
              </div>
            </div>
          </div>

          {/* Recent Reports */}
          <div className="rounded-xl border border-slate-200 bg-white">
            <div className="p-4 pb-3">
              <h3 className="text-sm font-semibold text-slate-900">
                Ultimas Validacoes
              </h3>
            </div>
            <div className="p-4">
              {reports.length === 0 ? (
                <p className="text-sm text-slate-400 py-4 text-center">Nenhuma validacao realizada</p>
              ) : (
                <div className="space-y-2">
                  {reports.map((r, i) => (
                    <div key={i} className="flex items-center justify-between py-2 border-b border-slate-100 last:border-0">
                      <div className="flex items-center gap-2">
                        <Clock className="w-3.5 h-3.5 text-slate-400" />
                        <span className="text-sm text-slate-700">{r.filename}</span>
                      </div>
                      <span className="text-xs text-slate-500">{r.date ? formatDateTime(r.date) : ""}</span>
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
