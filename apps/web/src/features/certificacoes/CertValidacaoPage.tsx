import { useState, useEffect } from 'react';
import { CertValidationProgress } from '@/features/certificacoes/components/CertValidationProgress';
import { CertStatsCards } from '@/features/certificacoes/components/CertStatsCards';
import { startCertValidation, fetchCertStats } from '@/shared/lib/cert-api-client';
import { cn } from '@/shared/lib/utils';
import {
  PlayCircle,
  Loader2,
  ShieldCheck,
  Radio,
  Clock,
  Zap,
  ChevronDown,
  FileText,
  CheckCircle2,
  Sparkles,
} from 'lucide-react';

interface BrandOption {
  value: string;
  label: string;
  count: number;
}

const DEFAULT_BRANDS: BrandOption[] = [
  { value: '', label: 'Todas as Marcas', count: 0 },
  { value: 'imaginarium', label: 'Imaginarium', count: 0 },
  { value: 'puket', label: 'Puket', count: 0 },
  { value: 'puket_escolares', label: 'Puket Escolares', count: 0 },
];

export default function CertValidacaoPage() {
  const [brand, setBrand] = useState('');
  const [runId, setRunId] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [summary, setSummary] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [brands, setBrands] = useState<BrandOption[]>(DEFAULT_BRANDS);

  useEffect(() => {
    fetchCertStats()
      .then((stats: any) => {
        const total = stats.total_products || 0;
        // by_brand is an array: [{brand, ok, missing, inconsistent, not_found}, ...]
        const byBrandArr: Array<{
          brand: string;
          ok: number;
          missing: number;
          inconsistent: number;
          not_found: number;
        }> = stats.by_brand || [];
        const brandCounts: Record<string, number> = {};
        for (const b of byBrandArr) {
          const key = (b.brand || '').toLowerCase().replace(/\s+/g, '_');
          brandCounts[key] =
            (b.ok || 0) + (b.missing || 0) + (b.inconsistent || 0) + (b.not_found || 0);
        }
        setBrands([
          { value: '', label: 'Todas as Marcas', count: total },
          { value: 'imaginarium', label: 'Imaginarium', count: brandCounts['imaginarium'] || 0 },
          { value: 'puket', label: 'Puket', count: brandCounts['puket'] || 0 },
          {
            value: 'puket_escolares',
            label: 'Puket Escolares',
            count: brandCounts['puket_escolares'] || 0,
          },
        ]);
      })
      .catch(() => {
        // Keep defaults on error
      });
  }, []);

  const selectedBrand = brands.find((b) => b.value === brand);
  const productCount = selectedBrand?.count || brands[0]?.count || 0;
  const estimatedSeconds = Math.ceil(productCount * 1.5);
  const estimatedMinutes = Math.ceil(estimatedSeconds / 60);

  async function handleStart() {
    setError(null);
    setSummary(null);
    setRunning(true);
    try {
      const res = await startCertValidation({
        brand: brand || undefined,
        source: 'sheets',
      });
      setRunId(res.run_id);
    } catch (e: any) {
      setError(e.message || 'Erro ao iniciar validação');
      setRunning(false);
    }
  }

  function handleComplete(sum: any) {
    setSummary(sum);
    setRunning(false);
  }

  return (
    <div className="p-5 md:p-7 space-y-6">
      {/* Real-time Info Banner */}
      <div className="rounded-2xl border border-emerald-200/60 bg-gradient-to-r from-emerald-50/80 to-teal-50/60 overflow-hidden">
        <div className="p-5">
          <div className="flex items-start gap-4">
            <div className="p-3 rounded-2xl bg-gradient-to-br from-emerald-500 to-emerald-700 text-white shadow-sm flex-shrink-0">
              <Zap className="w-5 h-5" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2.5 mb-1.5">
                <h3 className="text-sm font-semibold text-emerald-900">
                  Verificação em Tempo Real
                </h3>
                <span className="inline-flex items-center gap-1 bg-gradient-to-r from-emerald-600 to-emerald-700 text-white text-[10px] px-2 py-0.5 rounded-lg font-semibold shadow-sm">
                  <Radio className="w-2.5 h-2.5 animate-pulse" />
                  Ao Vivo
                </span>
              </div>
              <p className="text-sm text-emerald-700/80 leading-relaxed">
                A verificação consulta os sites em TEMPO REAL via API VTEX. Cada produto é
                verificado individualmente, comparando o texto de certificação no site com o valor
                esperado na planilha.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Controls Card */}
      <div className="rounded-2xl border border-slate-200/60 shadow-sm bg-white">
        <div className="p-6 md:p-7">
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-5">
            {/* Brand Selector */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-slate-500 uppercase tracking-wider">
                Marca
              </label>
              <div className="relative">
                <select
                  value={brand}
                  onChange={(e) => setBrand(e.target.value)}
                  disabled={running}
                  className="appearance-none pl-4 pr-10 py-2.5 rounded-xl border border-slate-200 bg-white text-sm text-slate-700 font-medium focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 focus:outline-none transition-all disabled:bg-slate-50 disabled:text-slate-400 cursor-pointer min-w-[200px]"
                >
                  {brands.map((b) => (
                    <option key={b.value} value={b.value}>
                      {b.label} ({b.count})
                    </option>
                  ))}
                </select>
                <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
              </div>
            </div>

            {/* Start Button */}
            <div className="flex flex-col gap-1.5 sm:mt-0">
              <label className="text-xs font-medium text-transparent select-none">_</label>
              <button
                onClick={handleStart}
                disabled={running}
                className={cn(
                  'flex items-center gap-2.5 px-7 py-2.5 rounded-xl text-sm font-semibold text-white transition-all shadow-sm',
                  running
                    ? 'bg-slate-300 cursor-not-allowed shadow-none'
                    : 'bg-gradient-to-r from-emerald-600 to-emerald-700 hover:from-emerald-700 hover:to-emerald-800 active:scale-[0.98] shadow-sm',
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
                    Iniciar Validação
                  </>
                )}
              </button>
            </div>

            {/* Estimated time */}
            <div className="flex items-center gap-2 text-sm text-slate-500 sm:ml-auto bg-slate-50 px-4 py-2.5 rounded-xl">
              <Clock className="w-4 h-4 text-slate-400" />
              <span>
                ~{estimatedMinutes} min
                <span className="text-slate-400 mx-1">|</span>
                {productCount} produtos
              </span>
            </div>
          </div>

          {error && (
            <div className="mt-5 p-4 rounded-xl bg-danger-50 border border-danger-200/80 text-sm text-danger-700 flex items-start gap-3">
              <div className="p-1 rounded-lg bg-danger-100 flex-shrink-0 mt-0.5">
                <Sparkles className="w-3.5 h-3.5 text-danger-500" />
              </div>
              <span>{error}</span>
            </div>
          )}
        </div>
      </div>

      {/* Progress */}
      {runId && <CertValidationProgress runId={runId} onComplete={handleComplete} />}

      {/* Summary */}
      {summary && (
        <div className="space-y-6">
          <div className="rounded-2xl border border-emerald-200/60 bg-gradient-to-r from-emerald-50/50 to-white p-6">
            <div className="flex items-center gap-3 mb-6">
              <div className="p-2.5 rounded-xl bg-gradient-to-br from-emerald-500 to-emerald-700 text-white shadow-sm">
                <ShieldCheck className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-slate-900">Resultado da Validação</h2>
                <p className="text-sm text-slate-500">Verificação concluída com sucesso</p>
              </div>
              <div className="ml-auto">
                <div className="flex items-center gap-1.5 text-emerald-700 bg-emerald-100 px-3 py-1.5 rounded-lg text-xs font-semibold">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Completo
                </div>
              </div>
            </div>

            <CertStatsCards
              data={{
                total: summary.total || 0,
                ok: summary.ok || 0,
                inconsistent: summary.inconsistent || 0,
                not_found: (summary.not_found || 0) + (summary.missing || 0),
              }}
            />
          </div>

          {summary.report_file && (
            <div className="rounded-2xl border border-emerald-200/60 bg-emerald-50/50 overflow-hidden">
              <div className="p-5 flex items-center gap-4">
                <div className="p-2.5 rounded-xl bg-emerald-100 flex-shrink-0">
                  <FileText className="w-5 h-5 text-emerald-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-emerald-800">
                    Relatório gerado com sucesso
                  </p>
                  <p className="text-xs font-mono text-emerald-600/80 mt-0.5 truncate">
                    {summary.report_file}
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
