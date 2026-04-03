import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { CertStatusBadge } from '@/features/certificacoes/components/CertStatusBadge';
import { fetchCertProductDetail, verifyCertProduct } from '@/shared/lib/cert-api-client';
import { cn, formatDateTime } from '@/shared/lib/utils';
import {
  ArrowLeft,
  ExternalLink,
  Loader2,
  Package,
  RefreshCw,
  ShieldCheck,
  AlertCircle,
  FileText,
  Sparkles,
  Clock,
  Hash,
  Tag,
  CheckCircle2,
} from 'lucide-react';

export default function CertProdutoDetailPage() {
  const { sku: rawSku } = useParams();
  const sku = decodeURIComponent(rawSku || '');
  const [product, setProduct] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [liveResult, setLiveResult] = useState<any>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetchCertProductDetail(sku)
      .then(setProduct)
      .catch((e) => setError(e.message || 'Erro ao carregar produto'))
      .finally(() => setLoading(false));
  }, [sku]);

  async function handleVerify() {
    if (!product) return;
    setVerifying(true);
    setLiveResult(null);
    try {
      const brandKey = product.brand.toLowerCase().replaceAll(' ', '_');
      const result = await verifyCertProduct(sku, brandKey);
      setLiveResult(result);
    } catch (e: any) {
      setLiveResult({ error: e.message || 'Erro na verificação' });
    } finally {
      setVerifying(false);
    }
  }

  const validation = liveResult || product?.last_validation;

  return (
    <div className="p-5 md:p-7 space-y-6 animate-fade-in">
      {/* Back link */}
      <Link
        to="/certificacoes/produtos"
        className="inline-flex items-center gap-2 text-sm text-slate-500 hover:text-emerald-600 transition-colors font-medium group"
      >
        <ArrowLeft className="w-4 h-4 group-hover:-translate-x-0.5 transition-transform" />
        Voltar para Produtos
      </Link>

      {loading ? (
        <div className="space-y-6">
          <div className="rounded-2xl border border-slate-200/60 bg-white p-7">
            <div className="flex items-start gap-5">
              <div className="w-14 h-14 rounded-2xl bg-slate-100 animate-pulse" />
              <div className="flex-1 space-y-3">
                <div className="h-5 w-64 bg-slate-100 rounded-lg animate-pulse" />
                <div className="h-4 w-40 bg-slate-100 rounded-lg animate-pulse" />
              </div>
            </div>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="h-48 rounded-2xl bg-slate-100 animate-pulse" />
            <div className="h-48 rounded-2xl bg-slate-100 animate-pulse" />
          </div>
        </div>
      ) : error ? (
        <div className="rounded-2xl border border-danger-200/60 bg-white p-10 text-center">
          <div className="inline-flex p-4 rounded-2xl bg-danger-50 mb-4">
            <AlertCircle className="w-8 h-8 text-danger-400" />
          </div>
          <p className="text-sm font-medium text-danger-600">{error}</p>
          <p className="text-xs text-danger-400 mt-1">Tente novamente ou verifique o SKU</p>
        </div>
      ) : product ? (
        <>
          {/* Product Header Card */}
          <div className="rounded-2xl border border-slate-200/60 shadow-sm bg-white overflow-hidden">
            <div className="bg-gradient-to-r from-emerald-600 to-emerald-700 px-7 py-4">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 rounded-xl bg-white/15 backdrop-blur-sm">
                    <Package className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <h2 className="text-lg font-bold text-white leading-tight">{product.name}</h2>
                  </div>
                </div>

                <button
                  onClick={handleVerify}
                  disabled={verifying}
                  className={cn(
                    'flex items-center gap-2.5 px-6 py-2.5 rounded-xl text-sm font-semibold transition-all flex-shrink-0',
                    verifying
                      ? 'bg-white/20 text-white/60 cursor-not-allowed'
                      : 'bg-white text-emerald-700 hover:bg-emerald-50 active:scale-[0.98] shadow-sm',
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

            <div className="px-7 py-5">
              <div className="flex flex-wrap items-center gap-4">
                <div className="flex items-center gap-2 text-sm text-slate-600">
                  <Hash className="w-4 h-4 text-slate-400" />
                  <span className="font-mono font-semibold text-slate-800">{product.sku}</span>
                </div>
                <div className="w-px h-4 bg-slate-200" />
                <div className="flex items-center gap-2 text-sm text-slate-600">
                  <Tag className="w-4 h-4 text-slate-400" />
                  <span>{product.brand}</span>
                </div>
                <div className="w-px h-4 bg-slate-200" />
                <div className="flex items-center gap-2 text-sm text-slate-600">
                  <FileText className="w-4 h-4 text-slate-400" />
                  <span>Linha {product.excel_row}</span>
                </div>
                {validation?.status && (
                  <>
                    <div className="w-px h-4 bg-slate-200" />
                    <CertStatusBadge status={validation.status} />
                  </>
                )}
                {validation?.score != null && (
                  <>
                    <div className="w-px h-4 bg-slate-200" />
                    <span
                      className={cn(
                        'text-xs font-mono font-semibold px-2.5 py-1 rounded-lg',
                        validation.score >= 0.9
                          ? 'text-emerald-700 bg-emerald-50'
                          : validation.score >= 0.6
                            ? 'text-amber-700 bg-amber-50'
                            : 'text-danger-700 bg-danger-50',
                      )}
                    >
                      {(validation.score * 100).toFixed(0)}%
                    </span>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Validation Status Bar */}
          {validation && (
            <div className="rounded-2xl border border-slate-200/60 shadow-sm bg-white p-5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div
                    className={cn(
                      'p-2 rounded-xl',
                      liveResult
                        ? 'bg-gradient-to-br from-emerald-500 to-emerald-700 text-white shadow-sm'
                        : 'bg-slate-100 text-slate-500',
                    )}
                  >
                    <ShieldCheck className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-slate-900">
                      {liveResult ? 'Resultado em Tempo Real' : 'Última Validação'}
                    </h3>
                    {(validation.date || validation.verified_at) && (
                      <div className="flex items-center gap-2 mt-0.5">
                        <Clock className="w-3 h-3 text-slate-400" />
                        <p className="text-xs text-slate-500">
                          {formatDateTime(validation.verified_at || validation.date)}
                        </p>
                        {liveResult && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-emerald-50 text-emerald-700 text-[10px] font-bold uppercase tracking-wider">
                            <CheckCircle2 className="w-2.5 h-2.5" />
                            Ao Vivo
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {validation.url && (
                  <a
                    href={validation.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium text-emerald-700 bg-emerald-50 hover:bg-emerald-100 transition-all"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    Ver no site
                  </a>
                )}
              </div>

              {validation.error && !validation.status && (
                <div className="mt-4 p-4 rounded-xl bg-danger-50 border border-danger-200/60 text-sm text-danger-700 flex items-start gap-3">
                  <AlertCircle className="w-4 h-4 text-danger-500 flex-shrink-0 mt-0.5" />
                  <span>{validation.error}</span>
                </div>
              )}
            </div>
          )}

          {/* Side-by-side Text Comparison */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Expected Text */}
            <div className="rounded-2xl border border-slate-200/60 shadow-sm bg-white overflow-hidden">
              <div className="px-6 py-4 border-b border-slate-100 bg-slate-50/60">
                <div className="flex items-center gap-2.5">
                  <div className="p-1.5 rounded-lg bg-emerald-100">
                    <FileText className="w-3.5 h-3.5 text-emerald-600" />
                  </div>
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-600">
                    Texto Esperado (Planilha)
                  </h4>
                </div>
              </div>
              <div className="p-6 space-y-3">
                {product.ecommerce_description && (
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-500 mb-1.5">
                      Descrição E-commerce
                    </p>
                    <div className="p-4 rounded-xl bg-emerald-50/50 border border-emerald-100/60">
                      <p className="text-sm text-slate-700 whitespace-pre-wrap break-words leading-relaxed">
                        {product.ecommerce_description}
                      </p>
                    </div>
                  </div>
                )}
                <div>
                  {product.ecommerce_description && product.certification_type && (
                    <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">
                      Tipo de Certificação
                    </p>
                  )}
                  <div
                    className={cn(
                      'p-4 rounded-xl min-h-[100px]',
                      product.expected_cert_text || product.certification_type
                        ? 'bg-emerald-50/50 border border-emerald-100/60'
                        : 'bg-slate-50 border border-slate-100',
                    )}
                  >
                    {product.expected_cert_text || product.certification_type ? (
                      <p className="text-sm text-slate-700 whitespace-pre-wrap break-words leading-relaxed">
                        {product.ecommerce_description
                          ? product.certification_type
                          : product.expected_cert_text}
                      </p>
                    ) : (
                      <p className="text-sm text-slate-400 italic">
                        Sem texto de certificação esperado
                      </p>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Actual Text */}
            <div className="rounded-2xl border border-slate-200/60 shadow-sm bg-white overflow-hidden">
              <div className="px-6 py-4 border-b border-slate-100 bg-slate-50/60">
                <div className="flex items-center gap-2.5">
                  <div className="p-1.5 rounded-lg bg-emerald-100">
                    <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
                  </div>
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-600">
                    Texto Encontrado (E-commerce)
                  </h4>
                </div>
              </div>
              <div className="p-6">
                <div
                  className={cn(
                    'p-4 rounded-xl min-h-[100px]',
                    validation?.actual_cert_text
                      ? validation?.status === 'OK'
                        ? 'bg-emerald-50/50 border border-emerald-100/60'
                        : validation?.status === 'INCONSISTENT'
                          ? 'bg-amber-50/50 border border-amber-100/60'
                          : 'bg-danger-50/50 border border-danger-100/60'
                      : 'bg-slate-50 border border-slate-100',
                  )}
                >
                  {validation?.actual_cert_text ? (
                    <p className="text-sm text-slate-700 whitespace-pre-wrap break-words leading-relaxed">
                      {validation.actual_cert_text}
                    </p>
                  ) : (
                    <p className="text-sm text-slate-400 italic">
                      {validation
                        ? 'Nenhum texto de certificação encontrado no site'
                        : 'Execute uma verificação para ver o texto'}
                    </p>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* AI Assessment */}
          {validation?.ai_assessment && (
            <div className="rounded-2xl border border-slate-200/60 shadow-sm bg-white overflow-hidden">
              <div className="px-6 py-4 border-b border-slate-100 bg-gradient-to-r from-violet-50/60 to-violet-50/40">
                <div className="flex items-center gap-2.5">
                  <div className="p-1.5 rounded-lg bg-gradient-to-br from-violet-500 to-violet-600 text-white shadow-sm">
                    <Sparkles className="w-3.5 h-3.5" />
                  </div>
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-600">
                    Avaliação IA
                  </h4>
                </div>
              </div>
              <div className="p-6">
                <p className="text-sm text-slate-700 whitespace-pre-wrap leading-relaxed">
                  {validation.ai_assessment}
                </p>
              </div>
            </div>
          )}

          {/* Error details */}
          {validation?.error && validation.status && (
            <div className="rounded-2xl border border-amber-200/60 shadow-sm bg-white overflow-hidden">
              <div className="px-6 py-4 border-b border-amber-100 bg-amber-50/60">
                <div className="flex items-center gap-2.5">
                  <div className="p-1.5 rounded-lg bg-amber-100">
                    <AlertCircle className="w-3.5 h-3.5 text-amber-600" />
                  </div>
                  <h4 className="text-xs font-bold uppercase tracking-wider text-amber-700">
                    Detalhes do Erro
                  </h4>
                </div>
              </div>
              <div className="p-6">
                <p className="text-sm text-slate-700 leading-relaxed">{validation.error}</p>
              </div>
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}
