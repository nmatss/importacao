import { useState, useEffect, useCallback } from 'react';
import { toast } from 'sonner';
import { CertValidationProgress } from '@/features/certificacoes/components/CertValidationProgress';
import { CertStatsCards } from '@/features/certificacoes/components/CertStatsCards';
import {
  startCertValidation,
  fetchCertStats,
  fetchCertValidationStatus,
} from '@/shared/lib/cert-api-client';
import { cn } from '@/shared/lib/utils';
import {
  PlayCircle,
  Loader2,
  ShieldCheck,
  Radio,
  Clock,
  Zap,
  ChevronDown,
  CheckCircle2,
  Sparkles,
  AlertTriangle,
} from 'lucide-react';

interface BrandOption {
  value: string;
  label: string;
  /** `null` = contagem indisponível (falha ao carregar), nunca 0. */
  count: number | null;
}

const DEFAULT_BRANDS: BrandOption[] = [
  { value: '', label: 'Todas as Marcas', count: null },
  { value: 'imaginarium', label: 'Imaginarium', count: null },
  { value: 'puket', label: 'Puket', count: null },
  { value: 'puket_escolares', label: 'Puket Escolares', count: null },
];

/**
 * Uma validação continua rodando no servidor (~17 min) mesmo se o operador sair
 * da página — e o `CertValidationProgress` fecha o stream no unmount. Guardar o
 * run_id permite reabrir o acompanhamento ao voltar; o `/stream` do backend
 * reenvia os eventos desde o início.
 */
const RUN_ID_STORAGE_KEY = 'cert_validation_run_id';

function readStoredRunId(): string | null {
  try {
    return localStorage.getItem(RUN_ID_STORAGE_KEY);
  } catch {
    return null;
  }
}

function storeRunId(runId: string | null) {
  try {
    if (runId) localStorage.setItem(RUN_ID_STORAGE_KEY, runId);
    else localStorage.removeItem(RUN_ID_STORAGE_KEY);
  } catch {
    // localStorage indisponível (modo privado): o acompanhamento simplesmente
    // não sobrevive à navegação.
  }
}

export default function CertValidacaoPage() {
  const [brand, setBrand] = useState('');
  const [runId, setRunId] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [summary, setSummary] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [brands, setBrands] = useState<BrandOption[]>(DEFAULT_BRANDS);
  const [brandsError, setBrandsError] = useState(false);
  const [resumed, setResumed] = useState(false);

  const loadBrandCounts = useCallback(async () => {
    try {
      const stats: any = await fetchCertStats();
      const total = stats.total_products ?? null;
      // by_brand is an array: [{brand, ok, inconsistent, not_found, never_validated}, ...]
      const byBrandArr: Array<{
        brand: string;
        ok?: number;
        missing?: number;
        inconsistent?: number;
        not_found?: number;
        never_validated?: number;
      }> = stats.by_brand || [];
      const brandCounts: Record<string, number> = {};
      for (const b of byBrandArr) {
        const key = (b.brand || '').toLowerCase().replace(/\s+/g, '_');
        // `never_validated` saiu de `not_found` no backend: sem somá-lo, a
        // contagem por marca fica MENOR que o universo a validar.
        brandCounts[key] =
          (b.ok || 0) +
          (b.missing || 0) +
          (b.inconsistent || 0) +
          (b.not_found || 0) +
          (b.never_validated || 0);
      }
      setBrands([
        { value: '', label: 'Todas as Marcas', count: total },
        { value: 'imaginarium', label: 'Imaginarium', count: brandCounts['imaginarium'] ?? 0 },
        { value: 'puket', label: 'Puket', count: brandCounts['puket'] ?? 0 },
        {
          value: 'puket_escolares',
          label: 'Puket Escolares',
          count: brandCounts['puket_escolares'] ?? 0,
        },
      ]);
      setBrandsError(false);
    } catch {
      // "Falhou" não é "zero produtos": manter contagem nula e avisar.
      setBrands(DEFAULT_BRANDS);
      setBrandsError(true);
    }
  }, []);

  useEffect(() => {
    loadBrandCounts();
  }, [loadBrandCounts]);

  // Reabre o acompanhamento de uma validação que ficou rodando no servidor.
  useEffect(() => {
    const stored = readStoredRunId();
    if (!stored) return;
    let cancelled = false;
    fetchCertValidationStatus(stored)
      .then((status) => {
        if (cancelled) return;
        if (status.status === 'running') {
          setRunId(stored);
          setRunning(true);
          setResumed(true);
        } else {
          storeRunId(null);
        }
      })
      .catch(() => {
        // Run já expirou do store em memória do backend (ou sumiu): nada a
        // retomar.
        if (!cancelled) storeRunId(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const selectedBrand = brands.find((b) => b.value === brand);
  const productCount = selectedBrand?.count ?? brands[0]?.count ?? null;
  const estimatedMinutes =
    productCount !== null ? Math.ceil(Math.ceil(productCount * 1.5) / 60) : null;

  async function handleStart() {
    setError(null);
    setSummary(null);
    setResumed(false);
    setRunning(true);
    try {
      const res = await startCertValidation({
        brand: brand || undefined,
        source: 'sheets',
      });
      setRunId(res.run_id);
      storeRunId(res.run_id);
    } catch (e: any) {
      setError(e.message || 'Erro ao iniciar validação');
      setRunning(false);
    }
  }

  function handleComplete(sum: any) {
    setSummary(sum);
    setRunning(false);
    setResumed(false);
    storeRunId(null);
  }

  return (
    // Sem `p-5 md:p-7`: o <main> do AppLayout já aplica `p-4 lg:p-6`.
    <div className="space-y-6 animate-fade-in">
      {/* Real-time Info Banner */}
      <div className="rounded-2xl border border-emerald-200/60 bg-gradient-to-r from-emerald-50/80 to-teal-50/60 dark:from-emerald-950/40 dark:to-teal-950/40 overflow-hidden dark:border-emerald-700/50">
        <div className="p-5">
          <div className="flex flex-col items-start gap-4 sm:flex-row">
            <div className="p-3 rounded-2xl bg-gradient-to-br from-emerald-500 to-emerald-700 text-white shadow-sm flex-shrink-0">
              <Zap className="w-5 h-5" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap items-center gap-2.5 mb-1.5">
                <h3 className="text-sm font-semibold text-emerald-900 dark:text-emerald-300">
                  Verificação em Tempo Real
                </h3>
                <span className="inline-flex items-center gap-1 bg-gradient-to-r from-emerald-600 to-emerald-700 text-white text-[10px] px-2 py-0.5 rounded-lg font-semibold shadow-sm">
                  <Radio className="w-2.5 h-2.5 animate-pulse" />
                  Ao Vivo
                </span>
              </div>
              {/* O texto dizia apenas "consulta os sites em tempo real" e omitia
                  que a ação também ressincroniza planilha e estoque
                  (`source: 'sheets'` -> sync_sheets_to_db + sync_stock_all). */}
              <p className="text-sm text-emerald-700/80 leading-relaxed dark:text-emerald-300">
                Ao iniciar, a rotina primeiro <strong>ressincroniza a planilha</strong> (Google
                Sheets) e o <strong>estoque completo</strong> (WMS/e-commerce) e só então consulta
                os sites em TEMPO REAL via API VTEX, produto a produto, comparando o texto de
                certificação no site com o valor esperado na planilha. Por isso a execução altera
                dados do painel além do resultado da verificação.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Controls Card */}
      <div className="rounded-2xl border border-slate-200/60 dark:border-slate-700/60 shadow-sm bg-white dark:bg-slate-800">
        <div className="p-6 md:p-7">
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-5">
            {/* Brand Selector */}
            <div className="flex flex-col gap-1.5">
              <label
                htmlFor="cert-validacao-brand"
                className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider"
              >
                Marca
              </label>
              <div className="relative">
                <select
                  id="cert-validacao-brand"
                  value={brand}
                  onChange={(e) => setBrand(e.target.value)}
                  disabled={running}
                  className="appearance-none pl-4 pr-10 py-2.5 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-sm text-slate-700 dark:text-slate-300 font-medium focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 focus:outline-none transition-all disabled:bg-slate-50 disabled:text-slate-400 cursor-pointer min-w-[200px]"
                >
                  {brands.map((b) => (
                    <option key={b.value} value={b.value}>
                      {b.label}
                      {b.count !== null ? ` (${b.count})` : ''}
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
            <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400 sm:ml-auto bg-slate-50 dark:bg-slate-900 px-4 py-2.5 rounded-xl">
              <Clock className="w-4 h-4 text-slate-400" />
              {productCount !== null ? (
                <span>
                  ~{estimatedMinutes} min
                  <span className="text-slate-500 dark:text-slate-400 mx-1">|</span>
                  {productCount} produtos
                </span>
              ) : (
                <span>Estimativa indisponível</span>
              )}
            </div>
          </div>

          {brandsError && (
            <div
              role="alert"
              className="mt-5 flex flex-col gap-3 rounded-xl border border-danger-200/80 bg-danger-50 p-4 text-sm text-danger-700 sm:flex-row sm:items-center sm:justify-between dark:border-danger-900/50 dark:bg-danger-900/20 dark:text-danger-300"
            >
              <span className="flex items-start gap-3">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                Não foi possível carregar a contagem de produtos por marca. A validação ainda pode
                ser iniciada.
              </span>
              <button
                type="button"
                onClick={loadBrandCounts}
                className="shrink-0 rounded-lg border border-danger-200 bg-white px-3 py-1.5 text-xs font-semibold text-danger-700 transition-colors hover:bg-danger-100 dark:border-danger-800 dark:bg-slate-800 dark:text-danger-300 dark:hover:bg-danger-950/30"
              >
                Tentar novamente
              </button>
            </div>
          )}

          {resumed && (
            <div className="mt-5 rounded-xl border border-emerald-200/80 bg-emerald-50 p-4 text-sm text-emerald-800 dark:border-emerald-900/50 dark:bg-emerald-900/20 dark:text-emerald-200">
              Retomando o acompanhamento de uma validação que já estava em andamento no servidor.
            </div>
          )}

          {error && (
            <div className="mt-5 p-4 rounded-xl bg-danger-50 border border-danger-200/80 text-sm text-danger-700 flex items-start gap-3 dark:bg-danger-950/30 dark:border-danger-700/50 dark:text-danger-300">
              <div className="p-1 rounded-lg bg-danger-100 flex-shrink-0 mt-0.5 dark:bg-danger-950/30">
                <Sparkles className="w-3.5 h-3.5 text-danger-500" />
              </div>
              <span>{error}</span>
            </div>
          )}
        </div>
      </div>

      {/* Progress */}
      {runId && (
        <CertValidationProgress
          runId={runId}
          onComplete={handleComplete}
          onError={(message) => {
            // Destrava o botão "Validar" — antes o erro do stream deixava
            // running=true para sempre (auditoria 2026-07-17).
            setRunning(false);
            setResumed(false);
            storeRunId(null);
            toast.error(message || 'A validação falhou. Tente novamente.');
          }}
        />
      )}

      {/* Summary */}
      {summary && (
        <div className="space-y-6">
          <div className="rounded-2xl border border-emerald-200/60 bg-gradient-to-r from-emerald-50/50 to-white dark:from-emerald-950/40 dark:to-slate-800 p-6 dark:border-emerald-700/50">
            <div className="flex items-center gap-3 mb-6">
              <div className="p-2.5 rounded-xl bg-gradient-to-br from-emerald-500 to-emerald-700 text-white shadow-sm">
                <ShieldCheck className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">
                  Resultado da Validação
                </h2>
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  Verificação concluída com sucesso
                </p>
              </div>
              <div className="ml-auto">
                <div className="flex items-center gap-1.5 text-emerald-700 bg-emerald-100 px-3 py-1.5 rounded-lg text-xs font-semibold dark:text-emerald-300 dark:bg-emerald-950/30">
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
          {/* Removido o bloco "Relatório gerado com sucesso": o evento `complete`
              do backend carrega apenas {total, ok, missing, inconsistent,
              not_found} — nunca `report_file`. Era código morto. Os relatórios
              ficam em /certificacoes/relatorios. */}
        </div>
      )}
    </div>
  );
}
