import { useState, useEffect } from "react"
import { CertValidationProgress } from "@/features/certificacoes/components/CertValidationProgress"
import { CertStatsCards } from "@/features/certificacoes/components/CertStatsCards"
import { startCertValidation, fetchCertStats } from "@/shared/lib/cert-api-client"
import { cn } from "@/shared/lib/utils"
import { PlayCircle, Loader2, ShieldCheck, Filter, Radio, Clock, Zap } from "lucide-react"

interface BrandOption {
  value: string
  label: string
  count: number
}

const DEFAULT_BRANDS: BrandOption[] = [
  { value: "", label: "Todas as Marcas", count: 0 },
  { value: "imaginarium", label: "Imaginarium", count: 0 },
  { value: "puket", label: "Puket", count: 0 },
  { value: "puket_escolares", label: "Puket Escolares", count: 0 },
]

export default function CertValidacaoPage() {
  const [brand, setBrand] = useState("")
  const [runId, setRunId] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const [summary, setSummary] = useState<any>(null)
  const [error, setError] = useState<string | null>(null)
  const [brands, setBrands] = useState<BrandOption[]>(DEFAULT_BRANDS)

  useEffect(() => {
    fetchCertStats()
      .then((stats: any) => {
        const total = stats.total_products || 0
        const byBrand = stats.brands || {}
        setBrands([
          { value: "", label: "Todas as Marcas", count: total },
          { value: "imaginarium", label: "Imaginarium", count: byBrand.imaginarium || byBrand.Imaginarium || 0 },
          { value: "puket", label: "Puket", count: byBrand.puket || byBrand.Puket || 0 },
          { value: "puket_escolares", label: "Puket Escolares", count: byBrand.puket_escolares || byBrand["Puket Escolares"] || 0 },
        ])
      })
      .catch(() => {
        // Keep defaults on error
      })
  }, [])

  const selectedBrand = brands.find((b) => b.value === brand)
  const productCount = selectedBrand?.count || brands[0]?.count || 0
  const estimatedSeconds = Math.ceil(productCount * 1.5)
  const estimatedMinutes = Math.ceil(estimatedSeconds / 60)

  async function handleStart() {
    setError(null)
    setSummary(null)
    setRunning(true)
    try {
      const res = await startCertValidation({
        brand: brand || undefined,
        source: "sheets",
      })
      setRunId(res.run_id)
    } catch (e: any) {
      setError(e.message || "Erro ao iniciar validacao")
      setRunning(false)
    }
  }

  function handleComplete(sum: any) {
    setSummary(sum)
    setRunning(false)
  }

  return (
    <div className="p-4 md:p-6 space-y-6">
      {/* Real-time Info Banner */}
      <div className="rounded-xl border border-blue-200 bg-blue-50/50">
        <div className="p-4">
          <div className="flex items-start gap-3">
            <div className="p-2 rounded-lg bg-blue-100 text-blue-600 flex-shrink-0">
              <Zap className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2 mb-1">
                <p className="text-sm font-medium text-blue-900">
                  Verificacao em Tempo Real
                </p>
                <span className="inline-flex items-center bg-blue-600 text-white text-[10px] px-1.5 py-0 rounded-full font-medium">
                  <Radio className="w-2.5 h-2.5 mr-1" />
                  Live
                </span>
              </div>
              <p className="text-xs text-blue-700/80">
                A verificacao consulta os sites em TEMPO REAL via API VTEX. Cada produto e verificado
                individualmente, comparando o texto de certificacao no site com o valor esperado na planilha.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Controls */}
      <div className="rounded-xl border border-slate-200 bg-white">
        <div className="p-6">
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
            <div className="flex items-center gap-2">
              <Filter className="w-4 h-4 text-slate-500" />
              <select
                value={brand}
                onChange={(e) => setBrand(e.target.value)}
                disabled={running}
                className="px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {brands.map((b) => (
                  <option key={b.value} value={b.value}>
                    {b.label} ({b.count})
                  </option>
                ))}
              </select>
            </div>

            <button
              onClick={handleStart}
              disabled={running}
              className={cn(
                "flex items-center gap-2 px-6 py-2.5 rounded-lg text-sm font-medium text-white transition-colors",
                running
                  ? "bg-slate-400 cursor-not-allowed"
                  : "bg-blue-600 hover:bg-blue-700"
              )}
            >
              {running ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Validando...
                </>
              ) : (
                <>
                  <PlayCircle className="w-4 h-4" />
                  Iniciar Validacao
                </>
              )}
            </button>

            <div className="flex items-center gap-2 text-xs text-slate-500 ml-auto">
              <Clock className="w-3.5 h-3.5" />
              <span>Tempo estimado: ~{estimatedMinutes} min ({productCount} produtos)</span>
            </div>
          </div>

          {error && (
            <div className="mt-4 p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
              {error}
            </div>
          )}
        </div>
      </div>

      {/* Progress */}
      {runId && <CertValidationProgress runId={runId} onComplete={handleComplete} />}

      {/* Summary */}
      {summary && (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-emerald-600" />
            <h2 className="text-lg font-semibold text-slate-900">
              Resultado da Validacao
            </h2>
          </div>
          <CertStatsCards
            data={{
              total: summary.total || 0,
              ok: summary.ok || 0,
              missing: summary.missing || 0,
              inconsistent: summary.inconsistent || 0,
              not_found: summary.not_found || 0,
            }}
          />
          {summary.report_file && (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50">
              <div className="p-4">
                <p className="text-sm text-emerald-700">
                  Relatorio gerado: <span className="font-mono font-medium">{summary.report_file}</span>
                </p>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
