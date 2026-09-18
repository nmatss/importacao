import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { AlertTriangle, ExternalLink, Loader2, PlayCircle, Store } from 'lucide-react';
import { cn, formatDateTime } from '@/shared/lib/utils';
import { getErrorMessage } from '@/shared/utils/errors';
import {
  fetchMarketplaceAudit,
  fetchMarketplaceItems,
  startMarketplaceAudit,
  type CertMarketplaceItem,
  type MarketplaceAuditState,
  type MarketplaceVerdict,
} from '@/shared/lib/cert-api-client';

/**
 * Auditoria dos quebra-cabeças vendidos por sellers terceiros na loja
 * Imaginarium (reunião 11/09/2026, item 6): "trazer todos e dizer se está ok
 * ou não". A situação reflete só a EVIDÊNCIA publicada no site. A regra de
 * dispensa para 500 peças ou mais foi citada na reunião, mas NÃO aprovada: a
 * tela não pode afirmá-la e a contagem de peças é apenas informativa.
 */

const VERDICT_META: Record<
  MarketplaceVerdict,
  { label: string; help: string; cls: string; dot: string }
> = {
  NAO_OK: {
    label: 'Não conforme',
    help: 'O site não informa o certificado: nenhuma especificação ou descrição cita o Inmetro',
    cls: 'bg-danger-100 text-danger-700 dark:bg-danger-900/40 dark:text-danger-300',
    dot: 'bg-danger-500',
  },
  REVISAR: {
    label: 'Revisar',
    help: 'Informação incompleta (texto sem número de registro) ou declaração de dispensa feita pelo seller — conferir',
    cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
    dot: 'bg-amber-500',
  },
  OK: {
    label: 'Conforme',
    help: 'O site informa o certificado com número de registro (autenticidade não verificada)',
    cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
    dot: 'bg-emerald-500',
  },
  NAO_EXIGE: {
    label: 'Não exige',
    help: 'Veredito de execuções antigas. A auditoria atual nunca dispensa um item por conta própria',
    cls: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
    dot: 'bg-slate-400',
  },
};

// A ordem coloca primeiro o que precisa de ação.
const VERDICT_ORDER: MarketplaceVerdict[] = ['NAO_OK', 'REVISAR', 'OK', 'NAO_EXIGE'];

// Vereditos que a auditoria atribui hoje. "Não exige" só aparece como filtro se
// uma execução antiga o tiver: um chip eterno em (0) sugeriria que a dispensa
// por contagem de peças está em vigor.
const ALWAYS_VISIBLE: ReadonlySet<MarketplaceVerdict> = new Set(['NAO_OK', 'REVISAR', 'OK']);

const POLL_MS = 3000;

/**
 * Uma execução sem linha gravada não aparece na lista: a tela continuaria
 * mostrando a auditoria anterior como "última". O aviso fica na página (o toast
 * some) até a próxima execução.
 */
function auditNotice(state: MarketplaceAuditState): string | null {
  if (state.status === 'error') {
    return (
      state.message ??
      `A auditoria falhou (${state.error ?? 'erro desconhecido'}). Nada foi gravado: a lista abaixo continua sendo a da auditoria anterior.`
    );
  }
  if ((state.total ?? 0) === 0) {
    return `A auditoria leu ${state.scanned ?? 0} produto(s) e não encontrou item de seller terceiro com estoque. Nada foi gravado: a lista abaixo continua sendo a da auditoria anterior.`;
  }
  return null;
}

function VerdictBadge({ verdict }: { verdict: MarketplaceVerdict }) {
  const meta = VERDICT_META[verdict] ?? VERDICT_META.REVISAR;
  return (
    <span
      title={meta.help}
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap',
        meta.cls,
      )}
    >
      {meta.label}
    </span>
  );
}

export default function CertMarketplacePage() {
  const [items, setItems] = useState<CertMarketplaceItem[]>([]);
  const [summary, setSummary] = useState<Partial<Record<MarketplaceVerdict, number>>>({});
  const [checkedAt, setCheckedAt] = useState<string | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [verdict, setVerdict] = useState<MarketplaceVerdict | ''>('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [auditing, setAuditing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const pollTimer = useRef<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchMarketplaceItems({ verdict: verdict || undefined });
      setItems(data.items);
      setSummary(data.summary);
      setCheckedAt(data.checked_at);
      setRunId(data.run_id);
      setLoadError(null);
    } catch (err) {
      // "Vazio" e "indisponível" são coisas diferentes.
      setLoadError(getErrorMessage(err));
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [verdict]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(
    () => () => {
      if (pollTimer.current) window.clearTimeout(pollTimer.current);
    },
    [],
  );

  async function handleAudit() {
    setAuditing(true);
    setNotice(null);
    try {
      const { run_id } = await startMarketplaceAudit();
      const poll = async () => {
        try {
          const state = await fetchMarketplaceAudit(run_id);
          if (state.status === 'running') {
            pollTimer.current = window.setTimeout(poll, POLL_MS);
            return;
          }
          setAuditing(false);
          const problem = auditNotice(state);
          setNotice(problem);
          if (state.status === 'error') {
            toast.error(problem ?? 'A auditoria falhou.');
            return;
          }
          const unverified = state.unverified ?? 0;
          if (problem) {
            toast.warning(problem);
          } else if (unverified > 0) {
            toast.warning(
              `Auditoria concluída, mas ${unverified} produto(s) vieram malformados do site e não puderam ser verificados.`,
            );
          } else {
            toast.success(`Auditoria concluída: ${state.total ?? 0} item(ns) de seller terceiro.`);
          }
          await load();
        } catch (err) {
          setAuditing(false);
          toast.error(getErrorMessage(err));
        }
      };
      pollTimer.current = window.setTimeout(poll, POLL_MS);
    } catch (err) {
      setAuditing(false);
      toast.error(getErrorMessage(err));
    }
  }

  const total = VERDICT_ORDER.reduce((acc, v) => acc + (summary[v] ?? 0), 0);

  return (
    <div className="animate-fade-in space-y-5">
      <div className="flex flex-wrap items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
          <Store className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100">
            Marketplace — quebra-cabeças
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Quebra-cabeças de sellers terceiros na loja Imaginarium. A situação mostra se o site
            informa o certificado do Inmetro de cada produto.
          </p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            A quantidade de peças é apenas informativa: a regra de dispensa para 500 peças ou mais
            aguarda aprovação do time fiscal e não é aplicada aqui.
          </p>
        </div>
        <button
          type="button"
          onClick={handleAudit}
          disabled={auditing}
          className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-emerald-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {auditing ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <PlayCircle className="h-4 w-4" />
          )}
          {auditing ? 'Auditando…' : 'Rodar auditoria'}
        </button>
      </div>

      {notice && (
        <div
          role="status"
          className="flex items-start gap-2 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-700/50 dark:bg-amber-900/20 dark:text-amber-200"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{notice}</span>
        </div>
      )}

      {loadError && (
        <div
          role="alert"
          className="flex flex-col gap-3 rounded-2xl border border-danger-200 bg-danger-50 px-4 py-3 text-sm text-danger-700 sm:flex-row sm:items-center sm:justify-between dark:border-danger-700/50 dark:bg-danger-950/30 dark:text-danger-300"
        >
          <span>{loadError}</span>
          <button
            type="button"
            onClick={load}
            className="rounded-lg border border-danger-200 bg-white px-3 py-1.5 text-xs font-semibold text-danger-700 transition-colors hover:bg-danger-100 dark:border-danger-800 dark:bg-danger-950/40 dark:text-danger-300"
          >
            Tentar novamente
          </button>
        </div>
      )}

      <div className="rounded-2xl border border-slate-200/60 bg-white p-4 shadow-sm dark:border-slate-700/60 dark:bg-slate-800">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setVerdict('')}
            aria-pressed={verdict === ''}
            className={cn(
              'flex items-center gap-2 rounded-xl px-3.5 py-2 text-xs font-semibold transition-all',
              verdict === ''
                ? 'bg-slate-900 text-white shadow-sm dark:bg-slate-100 dark:text-slate-900'
                : 'border border-slate-200/60 bg-slate-50 text-slate-600 hover:bg-slate-100 dark:border-slate-700/60 dark:bg-slate-900 dark:text-slate-400',
            )}
          >
            Todos ({total})
          </button>
          {VERDICT_ORDER.filter((v) => ALWAYS_VISIBLE.has(v) || (summary[v] ?? 0) > 0).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setVerdict(v)}
              aria-pressed={verdict === v}
              title={VERDICT_META[v].help}
              className={cn(
                'flex items-center gap-2 rounded-xl px-3.5 py-2 text-xs font-semibold transition-all',
                verdict === v
                  ? 'bg-slate-900 text-white shadow-sm dark:bg-slate-100 dark:text-slate-900'
                  : 'border border-slate-200/60 bg-slate-50 text-slate-600 hover:bg-slate-100 dark:border-slate-700/60 dark:bg-slate-900 dark:text-slate-400',
              )}
            >
              <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', VERDICT_META[v].dot)} />
              {VERDICT_META[v].label} ({summary[v] ?? 0})
            </button>
          ))}
        </div>
        <p className="mt-3 border-t border-slate-100 pt-3 text-xs text-slate-500 dark:border-slate-700 dark:text-slate-400">
          {checkedAt
            ? `Última auditoria: ${formatDateTime(checkedAt)}`
            : runId
              ? 'Auditoria registrada sem data de verificação.'
              : 'Nenhuma auditoria executada ainda.'}
        </p>
        <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
          A auditoria lê só o texto da página (especificações e descrição do produto). Selo ou
          número que aparece apenas em imagem não é detectável e sai como “Não conforme”: abra o
          produto antes de cobrar o seller.
        </p>
      </div>

      <div className="overflow-hidden rounded-2xl border border-slate-200/60 bg-white shadow-sm dark:border-slate-700/60 dark:bg-slate-800">
        {loading ? (
          <p className="px-5 py-6 text-center text-sm text-slate-500 dark:text-slate-400">
            Carregando…
          </p>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
            <AlertTriangle className="h-7 w-7 text-slate-300" />
            <p className="text-sm font-semibold text-slate-500 dark:text-slate-400">
              {runId ? 'Nenhum item com esta situação na última auditoria' : 'Nenhum item auditado'}
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {runId
                ? 'A auditoria já rodou: escolha outra situação para ver os itens.'
                : 'Rode a auditoria para ler a categoria na loja.'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px]">
              <thead>
                <tr className="border-b border-slate-200/60 bg-slate-50 dark:border-slate-700/60 dark:bg-slate-900">
                  <th className="px-5 py-3.5 text-left text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    Produto
                  </th>
                  <th
                    title="Informativo: a quantidade de peças não altera a situação"
                    className="px-4 py-3.5 text-right text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400"
                  >
                    Peças
                  </th>
                  <th className="px-5 py-3.5 text-left text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    Seller
                  </th>
                  <th className="px-5 py-3.5 text-left text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    Situação
                  </th>
                  <th className="px-5 py-3.5 text-left text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    Certificação no site
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-700/80">
                {items.map((item) => (
                  <tr key={item.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/60">
                    <td className="max-w-[320px] px-5 py-3.5 text-sm text-slate-700 dark:text-slate-300">
                      {item.url ? (
                        <a
                          href={item.url}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-start gap-1 hover:text-emerald-600 dark:hover:text-emerald-300"
                        >
                          <span className="break-words">{item.name}</span>
                          <ExternalLink className="mt-0.5 h-3 w-3 shrink-0" />
                        </a>
                      ) : (
                        <span className="break-words">{item.name}</span>
                      )}
                    </td>
                    <td className="px-4 py-3.5 text-right text-sm tabular-nums text-slate-600 dark:text-slate-400">
                      {/* "peças desconhecidas" não pode virar zero. */}
                      {item.pieces ?? '—'}
                    </td>
                    <td className="px-5 py-3.5 text-xs text-slate-600 dark:text-slate-400">
                      {item.seller_name || item.seller_id || '—'}
                    </td>
                    <td className="px-5 py-3.5">
                      <div className="flex flex-col gap-1">
                        <VerdictBadge verdict={item.verdict} />
                        {item.reason && (
                          <span className="text-[11px] leading-tight text-slate-500 dark:text-slate-400">
                            {item.reason}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="max-w-[260px] px-5 py-3.5 text-xs text-slate-600 dark:text-slate-400">
                      {item.cert_text || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
