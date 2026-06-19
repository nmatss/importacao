import { FileText, Package, AlertTriangle, Link as LinkIcon, Download } from 'lucide-react';
import { toast } from 'sonner';
import { useApiQuery } from '@/shared/hooks/useApi';
import { LoadingSpinner } from '@/shared/components/LoadingSpinner';
import { ErrorState } from '@/shared/components/ErrorState';
import { cn } from '@/shared/lib/utils';
import { getErrorMessage } from '@/shared/utils/errors';

interface ProformaItem {
  itemCode?: string | null;
  description?: string | null;
  quantity?: number | null;
  unitPrice?: number | null;
  totalPrice?: number | null;
  ncmCode?: string | null;
}

interface ProformaSummary {
  documentId: number;
  filename: string;
  // Download reference returned by the aggregate route (GET /api/documents/:id/file).
  fileUrl?: string | null;
  uploadedAt: string | null;
  confidence: number | null;
  piNumber: string | null;
  invoiceDate: string | null;
  validUntil: string | null;
  currency: string | null;
  totalFobValue: number | null;
  paymentTerms: Record<string, unknown> | null;
  itemCount: number;
  items: ProformaItem[];
  preConsLinked: boolean;
}

interface AggregateData {
  processId: number;
  proformaCount: number;
  totals: { itemCount: number; totalFobValue: number };
  proformas: ProformaSummary[];
}

export function ProformasTab({ processId }: { processId: string }) {
  const { data, isLoading, isError, error, refetch } = useApiQuery<AggregateData>(
    ['proformas-aggregate', processId],
    `/api/documents/process/${processId}/proformas`,
  );

  const downloadProforma = async (pi: ProformaSummary) => {
    if (!pi.fileUrl) return;
    try {
      const token = localStorage.getItem('importacao_token');
      const baseUrl = import.meta.env.VITE_API_URL || '';
      const res = await fetch(`${baseUrl}${pi.fileUrl}?download=1`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        redirect: 'follow',
      });
      if (res.redirected && res.url) {
        window.open(res.url, '_blank', 'noopener,noreferrer');
        return;
      }
      if (!res.ok) throw new Error(`Falha ao baixar Proforma (${res.status})`);
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = window.document.createElement('a');
      a.href = objectUrl;
      a.download = pi.filename || `proforma-${pi.documentId}`;
      window.document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
    } catch (err: unknown) {
      toast.error(getErrorMessage(err));
    }
  };

  if (isLoading) return <LoadingSpinner className="py-8" />;
  if ((isError || error) && !data) {
    return <ErrorState message="Erro ao carregar proformas." onRetry={() => refetch()} />;
  }
  if (!data || data.proformaCount === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <FileText className="h-10 w-10 text-slate-300 dark:text-slate-700 mb-3" />
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Nenhuma Proforma Invoice anexada a este processo.
        </p>
        <p className="text-xs text-slate-400 dark:text-slate-500 mt-1.5">
          Proformas chegam normalmente antes do embarque e ligam o processo a uma linha do Pre-Cons
          via PI number.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {(isError || error) && data && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Falha ao atualizar as proformas. Exibindo a ultima leitura disponivel.
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-4 py-3">
          <p className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">
            Proformas
          </p>
          <p className="text-2xl font-bold text-slate-900 dark:text-slate-100 mt-0.5">
            {data.proformaCount}
          </p>
        </div>
        <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-4 py-3">
          <p className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">
            Itens (soma)
          </p>
          <p className="text-2xl font-bold text-slate-900 dark:text-slate-100 mt-0.5">
            {data.totals.itemCount}
          </p>
        </div>
        <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-4 py-3">
          <p className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">
            FOB Total (PIs)
          </p>
          <p className="text-2xl font-bold text-slate-900 dark:text-slate-100 mt-0.5">
            ${data.totals.totalFobValue.toFixed(2)}
          </p>
        </div>
      </div>

      {data.proformas.map((pi) => (
        <div
          key={pi.documentId}
          className="rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden"
        >
          <div className="bg-slate-50 dark:bg-slate-900 px-4 py-3 border-b border-slate-200 dark:border-slate-700 flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2.5">
              <Package className="h-4 w-4 text-violet-600" />
              <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                {pi.piNumber ?? 'PI sem número'}
              </span>
              {pi.preConsLinked ? (
                <span
                  className="inline-flex items-center gap-1 rounded bg-emerald-100 text-emerald-700 px-1.5 py-0.5 text-[10px] font-semibold uppercase"
                  title="PI bate com linha do Pre-Cons"
                >
                  <LinkIcon className="h-3 w-3" /> Pre-Cons ok
                </span>
              ) : (
                <span
                  className="inline-flex items-center gap-1 rounded bg-amber-100 text-amber-700 px-1.5 py-0.5 text-[10px] font-semibold uppercase"
                  title="PI não encontrada no Pre-Cons"
                >
                  <AlertTriangle className="h-3 w-3" /> sem match
                </span>
              )}
              <span className="text-xs text-slate-500 dark:text-slate-400">{pi.filename}</span>
            </div>
            <div className="flex items-center gap-3 text-xs text-slate-500 dark:text-slate-400">
              {pi.invoiceDate && <span>Data: {pi.invoiceDate}</span>}
              {pi.totalFobValue != null && (
                <span className="font-mono font-medium text-slate-700 dark:text-slate-300">
                  FOB {pi.currency ?? '$'} {Number(pi.totalFobValue).toFixed(2)}
                </span>
              )}
              {pi.confidence != null && (
                <span
                  className={cn(
                    'rounded px-1.5 py-0.5 font-mono',
                    pi.confidence >= 0.8
                      ? 'bg-emerald-100 text-emerald-700'
                      : pi.confidence >= 0.5
                        ? 'bg-amber-100 text-amber-700'
                        : 'bg-danger-100 text-danger-700',
                  )}
                >
                  {(pi.confidence * 100).toFixed(0)}%
                </span>
              )}
              {pi.fileUrl && (
                <button
                  type="button"
                  onClick={() => downloadProforma(pi)}
                  className="inline-flex items-center gap-1 rounded border border-slate-300 dark:border-slate-600 px-2 py-1 font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
                  title="Baixar Proforma"
                >
                  <Download className="h-3.5 w-3.5" />
                  Baixar
                </button>
              )}
            </div>
          </div>

          {pi.items.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="bg-slate-50/40 dark:bg-slate-900/40 text-[11px] uppercase tracking-wider text-slate-400">
                    <th className="px-3 py-2 text-left">Código</th>
                    <th className="px-3 py-2 text-left">Descrição</th>
                    <th className="px-3 py-2 text-left">NCM</th>
                    <th className="px-3 py-2 text-right">Qtd</th>
                    <th className="px-3 py-2 text-right">Unit</th>
                    <th className="px-3 py-2 text-right">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {pi.items.map((it, i) => (
                    <tr
                      key={i}
                      className="border-b last:border-b-0 border-slate-100 dark:border-slate-800"
                    >
                      <td className="px-3 py-2 font-mono text-slate-700 dark:text-slate-300">
                        {it.itemCode || '-'}
                      </td>
                      <td className="px-3 py-2 text-slate-700 dark:text-slate-300 max-w-[300px] truncate">
                        {it.description || '-'}
                      </td>
                      <td className="px-3 py-2 font-mono text-slate-500">{it.ncmCode || '-'}</td>
                      <td className="px-3 py-2 text-right font-mono">{it.quantity ?? '-'}</td>
                      <td className="px-3 py-2 text-right font-mono">
                        {it.unitPrice != null ? `$${Number(it.unitPrice).toFixed(2)}` : '-'}
                      </td>
                      <td className="px-3 py-2 text-right font-mono font-medium">
                        {it.totalPrice != null ? `$${Number(it.totalPrice).toFixed(2)}` : '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="flex items-center gap-2 px-4 py-3 text-xs text-slate-400">
              <AlertTriangle className="h-3.5 w-3.5 text-amber-500 shrink-0" />
              <span>
                {pi.confidence != null && pi.confidence < 0.5
                  ? 'Itens nao extraidos (baixa confianca na leitura). Baixe a Proforma para conferir manualmente.'
                  : 'Itens nao extraidos desta Proforma. Baixe o arquivo para conferir manualmente.'}
              </span>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
