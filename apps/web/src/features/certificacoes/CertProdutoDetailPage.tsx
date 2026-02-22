import { useEffect, useState } from "react"
import { useParams, Link } from "react-router-dom"
import { CertStatusBadge } from "@/features/certificacoes/components/CertStatusBadge"
import { fetchCertProductDetail, verifyCertProduct } from "@/shared/lib/cert-api-client"
import { cn, formatDateTime } from "@/shared/lib/utils"
import {
  ArrowLeft,
  ExternalLink,
  Loader2,
  Package,
  RefreshCw,
  ShieldCheck,
  AlertCircle,
} from "lucide-react"

export default function CertProdutoDetailPage() {
  const { sku: rawSku } = useParams()
  const sku = decodeURIComponent(rawSku || "")
  const [product, setProduct] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [verifying, setVerifying] = useState(false)
  const [liveResult, setLiveResult] = useState<any>(null)

  useEffect(() => {
    setLoading(true)
    setError(null)
    fetchCertProductDetail(sku)
      .then(setProduct)
      .catch((e) => setError(e.message || "Erro ao carregar produto"))
      .finally(() => setLoading(false))
  }, [sku])

  async function handleVerify() {
    if (!product) return
    setVerifying(true)
    setLiveResult(null)
    try {
      const brandKey = product.brand.toLowerCase().replaceAll(" ", "_")
      const result = await verifyCertProduct(sku, brandKey)
      setLiveResult(result)
    } catch (e: any) {
      setLiveResult({ error: e.message || "Erro na verificacao" })
    } finally {
      setVerifying(false)
    }
  }

  const validation = liveResult || product?.last_validation

  return (
    <div className="p-4 md:p-6 space-y-4">
      {/* Back link */}
      <Link
        to="/certificacoes/produtos"
        className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-blue-600 transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        Voltar para Produtos
      </Link>

      {loading ? (
        <div className="space-y-4">
          <div className="h-32 w-full bg-slate-200 rounded-xl animate-pulse" />
          <div className="h-64 w-full bg-slate-200 rounded-xl animate-pulse" />
        </div>
      ) : error ? (
        <div className="bg-white rounded-xl border border-red-200 p-8 text-center">
          <AlertCircle className="w-10 h-10 text-red-400 mx-auto mb-3" />
          <p className="text-sm text-red-600">{error}</p>
        </div>
      ) : product ? (
        <>
          {/* Product info card */}
          <div className="bg-white rounded-xl border border-slate-200 p-6">
            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
              <div className="flex items-start gap-4">
                <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-blue-50 flex-shrink-0">
                  <Package className="w-6 h-6 text-blue-600" />
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-slate-900">
                    {product.name}
                  </h2>
                  <div className="flex flex-wrap items-center gap-3 mt-1.5 text-sm text-slate-500">
                    <span className="font-mono font-medium text-slate-700">
                      {product.sku}
                    </span>
                    <span className="w-1 h-1 rounded-full bg-slate-300" />
                    <span>{product.brand}</span>
                    <span className="w-1 h-1 rounded-full bg-slate-300" />
                    <span>Linha {product.excel_row}</span>
                  </div>
                </div>
              </div>

              <button
                onClick={handleVerify}
                disabled={verifying}
                className={cn(
                  "flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium text-white transition-colors flex-shrink-0",
                  verifying
                    ? "bg-slate-400 cursor-not-allowed"
                    : "bg-blue-600 hover:bg-blue-700"
                )}
              >
                {verifying ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Verificando...
                  </>
                ) : (
                  <>
                    <RefreshCw className="w-4 h-4" />
                    Verificar Agora
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Validation result */}
          {validation && (
            <div className="bg-white rounded-xl border border-slate-200 p-6 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="w-5 h-5 text-slate-600" />
                  <h3 className="text-sm font-semibold text-slate-900">
                    {liveResult ? "Resultado ao Vivo" : "Ultima Validacao"}
                  </h3>
                </div>
                <div className="flex items-center gap-3">
                  {validation.status && <CertStatusBadge status={validation.status} />}
                  {validation.score != null && (
                    <span className="text-sm font-mono font-medium text-slate-600">
                      {(validation.score * 100).toFixed(0)}%
                    </span>
                  )}
                </div>
              </div>

              {(validation.date || validation.verified_at) && (
                <p className="text-xs text-slate-500">
                  {liveResult ? "Verificado em: " : "Data: "}
                  {formatDateTime(validation.verified_at || validation.date)}
                  {liveResult && (
                    <span className="ml-2 inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 text-[10px] font-medium">
                      LIVE
                    </span>
                  )}
                </p>
              )}

              {validation.url && (
                <a
                  href={validation.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-sm text-blue-600 hover:text-blue-800 transition-colors"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  Ver produto no site
                </a>
              )}

              {validation.error && !validation.status && (
                <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
                  {validation.error}
                </div>
              )}
            </div>
          )}

          {/* Side-by-side text comparison */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="bg-white rounded-xl border border-slate-200 p-5">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-3">
                Texto Esperado (Planilha)
              </h4>
              <div className="p-3 rounded-lg bg-slate-50 min-h-[80px]">
                {product.expected_cert_text ? (
                  <p className="text-sm text-slate-700 whitespace-pre-wrap break-words">
                    {product.expected_cert_text}
                  </p>
                ) : (
                  <p className="text-sm text-slate-400 italic">
                    Sem texto de certificacao esperado
                  </p>
                )}
              </div>
            </div>

            <div className="bg-white rounded-xl border border-slate-200 p-5">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-3">
                Texto Encontrado (E-commerce)
              </h4>
              <div className="p-3 rounded-lg bg-slate-50 min-h-[80px]">
                {validation?.actual_cert_text ? (
                  <p className="text-sm text-slate-700 whitespace-pre-wrap break-words">
                    {validation.actual_cert_text}
                  </p>
                ) : (
                  <p className="text-sm text-slate-400 italic">
                    {validation
                      ? "Nenhum texto de certificacao encontrado no site"
                      : "Execute uma verificacao para ver o texto"}
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* AI Assessment */}
          {validation?.ai_assessment && (
            <div className="bg-white rounded-xl border border-slate-200 p-5">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-3">
                Avaliacao IA
              </h4>
              <p className="text-sm text-slate-700 whitespace-pre-wrap">
                {validation.ai_assessment}
              </p>
            </div>
          )}

          {/* Error details */}
          {validation?.error && validation.status && (
            <div className="bg-white rounded-xl border border-amber-200 p-5">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-amber-600 mb-2">
                Detalhes do Erro
              </h4>
              <p className="text-sm text-slate-700">
                {validation.error}
              </p>
            </div>
          )}
        </>
      ) : null}
    </div>
  )
}
