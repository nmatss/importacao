import {
  CheckCircle,
  XCircle,
  AlertTriangle,
  Minus,
  FileText,
  Package,
  History,
} from 'lucide-react';
import { useApiQuery } from '@/shared/hooks/useApi';
import { cn } from '@/shared/lib/utils';
import { LoadingSpinner } from '@/shared/components/LoadingSpinner';

interface AggregateField {
  label: string;
  invoice: string | null;
  packingList: string | null;
  bl: string | null;
  status: 'match' | 'divergent' | 'empty';
}

interface ItemComparison {
  itemCode: string;
  description: string;
  ncm: string;
  invoiceQty: number;
  plQty: number | null;
  invoiceUnitPrice: number;
  invoiceTotal: number;
  invoiceBoxes: number | null;
  plBoxes: number | null;
  invoiceNetWeight: number | null;
  plNetWeight: number | null;
  invoiceGrossWeight: number | null;
  plGrossWeight: number | null;
  qtyMatch: boolean | null;
  matched: boolean;
}

interface UnmatchedItem {
  itemCode: string;
  description: string;
  quantity: number;
  source: string;
}

interface DraftBlRevision {
  field: string;
  label: string;
  draftValue: string | null;
  finalValue: string | null;
  isRevised: boolean;
}

interface ComparisonData {
  hasInvoice: boolean;
  hasPackingList: boolean;
  hasBl: boolean;
  hasDraftBl?: boolean;
  aggregateComparison: AggregateField[];
  itemComparison: ItemComparison[];
  unmatchedPlItems: UnmatchedItem[];
  draftBlRevisions?: DraftBlRevision[];
  invoiceConfidence: number | null;
  plConfidence: number | null;
  blConfidence: number | null;
  draftBlConfidence?: number | null;
}

function DocBadge({
  label,
  available,
  confidence,
}: {
  label: string;
  available: boolean;
  confidence: number | null;
}) {
  return (
    <div
      className={cn(
        'flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium border',
        available
          ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
          : 'bg-slate-50 border-slate-200 text-slate-400',
      )}
    >
      {available ? <CheckCircle className="h-4 w-4" /> : <Minus className="h-4 w-4" />}
      {label}
      {confidence != null && (
        <span
          className={cn(
            'ml-1 text-xs font-mono rounded-md px-1.5 py-0.5',
            confidence >= 0.8
              ? 'bg-emerald-100 text-emerald-700'
              : confidence >= 0.6
                ? 'bg-amber-100 text-amber-700'
                : 'bg-danger-100 text-danger-700',
          )}
        >
          {(confidence * 100).toFixed(0)}%
        </span>
      )}
    </div>
  );
}

function StatusCell({
  value,
  status,
}: {
  value: string | null;
  status?: 'match' | 'divergent' | 'empty';
}) {
  if (!value) return <td className="px-3 py-2.5 text-sm text-slate-300 font-mono">-</td>;
  return (
    <td
      className={cn(
        'px-3 py-2.5 text-sm font-mono',
        status === 'divergent' ? 'text-danger-700 font-semibold bg-danger-50/50' : 'text-slate-700',
      )}
    >
      {value}
    </td>
  );
}

export function DocumentComparison({ processId }: { processId: string }) {
  const { data, isLoading } = useApiQuery<ComparisonData>(
    ['doc-comparison', processId],
    `/api/documents/process/${processId}/comparison`,
  );

  if (isLoading) return <LoadingSpinner className="py-8" />;

  if (!data) {
    return (
      <div className="flex flex-col items-center justify-center py-10 text-center">
        <Package className="h-8 w-8 text-slate-300 mb-2" />
        <p className="text-sm text-slate-400">Nenhum dado disponivel para comparacao.</p>
      </div>
    );
  }

  const divergentCount = data.aggregateComparison.filter((f) => f.status === 'divergent').length;
  const matchCount = data.aggregateComparison.filter((f) => f.status === 'match').length;

  return (
    <div className="space-y-6">
      {/* Document availability */}
      <div className="flex flex-wrap gap-3">
        <DocBadge label="Invoice" available={data.hasInvoice} confidence={data.invoiceConfidence} />
        <DocBadge
          label="Packing List"
          available={data.hasPackingList}
          confidence={data.plConfidence}
        />
        <DocBadge label="Bill of Lading" available={data.hasBl} confidence={data.blConfidence} />
        {data.hasDraftBl && (
          <DocBadge
            label="Draft BL"
            available={true}
            confidence={data.draftBlConfidence ?? null}
          />
        )}
      </div>

      {/* Summary badges */}
      <div className="flex items-center gap-4 text-sm">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-3 py-1 font-medium text-emerald-700">
          <CheckCircle className="h-3.5 w-3.5" /> {matchCount} campos ok
        </span>
        {divergentCount > 0 && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-danger-100 px-3 py-1 font-medium text-danger-700">
            <XCircle className="h-3.5 w-3.5" /> {divergentCount} divergencias
          </span>
        )}
      </div>

      {/* Aggregate comparison table */}
      <div className="rounded-xl border border-slate-200 overflow-hidden">
        <div className="bg-slate-50 px-4 py-3 border-b border-slate-200">
          <h4 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
            <FileText className="h-4 w-4 text-primary-600" />
            Comparativo Geral - Invoice vs Packing List vs BL
          </h4>
        </div>
        <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
          <table className="min-w-full">
            <thead>
              <tr className="bg-slate-50/50 sticky top-0 z-10 bg-white shadow-[0_1px_3px_0_rgba(0,0,0,0.06)]">
                <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400 w-8"></th>
                <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  Campo
                </th>
                <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-primary-500">
                  Invoice
                </th>
                <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-violet-500">
                  Packing List
                </th>
                <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-emerald-500">
                  BL
                </th>
              </tr>
            </thead>
            <tbody>
              {data.aggregateComparison
                .filter((f) => f.status !== 'empty')
                .map((field, i) => (
                  <tr
                    key={i}
                    className={cn(
                      'border-b last:border-b-0',
                      field.status === 'divergent' ? 'bg-danger-50/30' : '',
                    )}
                  >
                    <td className="px-3 py-2.5">
                      {field.status === 'match' && (
                        <CheckCircle className="h-4 w-4 text-emerald-500" />
                      )}
                      {field.status === 'divergent' && (
                        <XCircle className="h-4 w-4 text-danger-500" />
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-sm font-medium text-slate-800">
                      {field.label}
                    </td>
                    <StatusCell value={field.invoice} status={field.status} />
                    <StatusCell value={field.packingList} status={field.status} />
                    <StatusCell value={field.bl} status={field.status} />
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Draft BL vs Final BL revisions */}
      {data.draftBlRevisions && data.draftBlRevisions.length > 0 && (
        <div className="rounded-xl border border-violet-200 bg-violet-50/20 overflow-hidden">
          <div className="bg-violet-50 px-4 py-3 border-b border-violet-200 flex items-center gap-2">
            <History className="h-4 w-4 text-violet-600" />
            <h4 className="text-sm font-semibold text-violet-900">
              Revisado — Draft BL vs BL Final
            </h4>
            <span className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-violet-100 px-2.5 py-0.5 text-xs font-medium text-violet-700">
              {data.draftBlRevisions.length} campo(s) alterado(s)
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="bg-violet-50/50">
                  <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-violet-500">
                    Campo
                  </th>
                  <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                    Draft BL
                  </th>
                  <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-emerald-500">
                    BL Final
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.draftBlRevisions.map((rev, i) => (
                  <tr key={i} className="border-b last:border-b-0">
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-2">
                        <span className="inline-flex items-center rounded-md bg-violet-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-violet-700">
                          Revisado
                        </span>
                        <span className="text-sm font-medium text-slate-800">{rev.label}</span>
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-sm font-mono text-slate-500 line-through">
                      {rev.draftValue ?? '—'}
                    </td>
                    <td className="px-3 py-2.5 text-sm font-mono text-emerald-700 font-semibold">
                      {rev.finalValue ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Item-level comparison */}
      {data.itemComparison.length > 0 && (
        <div className="rounded-xl border border-slate-200 overflow-hidden">
          <div className="bg-slate-50 px-4 py-3 border-b border-slate-200">
            <h4 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
              <Package className="h-4 w-4 text-violet-600" />
              Comparativo por Item - Invoice vs Packing List
            </h4>
            <p className="text-xs text-slate-500 mt-0.5">
              {data.itemComparison.filter((i) => i.matched).length} de {data.itemComparison.length}{' '}
              itens encontrados no Packing List
            </p>
          </div>
          <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="bg-slate-50/50 sticky top-0 z-10 bg-white shadow-[0_1px_3px_0_rgba(0,0,0,0.06)]">
                  <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400 w-8"></th>
                  <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                    Codigo
                  </th>
                  <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                    Descricao
                  </th>
                  <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                    NCM
                  </th>
                  <th className="px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-wider text-primary-500">
                    Qtd INV
                  </th>
                  <th className="px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-wider text-violet-500">
                    Qtd PL
                  </th>
                  <th className="px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                    Unit Price
                  </th>
                  <th className="px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                    Total
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.itemComparison.map((item, i) => (
                  <tr
                    key={i}
                    className={cn(
                      'border-b last:border-b-0',
                      !item.matched
                        ? 'bg-amber-50/50'
                        : item.qtyMatch === false
                          ? 'bg-danger-50/30'
                          : '',
                    )}
                  >
                    <td className="px-3 py-2">
                      {!item.matched ? (
                        <AlertTriangle className="h-4 w-4 text-amber-500" />
                      ) : item.qtyMatch === false ? (
                        <XCircle className="h-4 w-4 text-danger-500" />
                      ) : (
                        <CheckCircle className="h-4 w-4 text-emerald-500" />
                      )}
                    </td>
                    <td className="px-3 py-2 font-mono text-slate-700">{item.itemCode || '-'}</td>
                    <td className="px-3 py-2 text-slate-700 max-w-[200px] truncate">
                      {item.description || '-'}
                    </td>
                    <td className="px-3 py-2 font-mono text-slate-600">{item.ncm || '-'}</td>
                    <td className="px-3 py-2 text-right font-mono text-primary-700">
                      {item.invoiceQty ?? '-'}
                    </td>
                    <td
                      className={cn(
                        'px-3 py-2 text-right font-mono',
                        item.qtyMatch === false
                          ? 'text-danger-700 font-semibold'
                          : 'text-violet-700',
                      )}
                    >
                      {item.plQty ?? '-'}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-slate-600">
                      {item.invoiceUnitPrice != null
                        ? `$${Number(item.invoiceUnitPrice).toFixed(2)}`
                        : '-'}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-slate-800 font-medium">
                      {item.invoiceTotal != null ? `$${Number(item.invoiceTotal).toFixed(2)}` : '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Unmatched PL items */}
      {data.unmatchedPlItems.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50/30 overflow-hidden">
          <div className="bg-amber-50 px-4 py-3 border-b border-amber-200">
            <h4 className="text-sm font-semibold text-amber-800 flex items-center gap-2">
              <AlertTriangle className="h-4 w-4" />
              Itens no Packing List sem correspondencia na Invoice ({data.unmatchedPlItems.length})
            </h4>
          </div>
          <div className="overflow-x-auto max-h-[400px] overflow-y-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="bg-amber-50/50 sticky top-0 z-10 bg-amber-50 shadow-[0_1px_3px_0_rgba(0,0,0,0.06)]">
                  <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-amber-600">
                    Codigo
                  </th>
                  <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-amber-600">
                    Descricao
                  </th>
                  <th className="px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-wider text-amber-600">
                    Quantidade
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.unmatchedPlItems.map((item, i) => (
                  <tr key={i} className="border-b last:border-b-0">
                    <td className="px-3 py-2 font-mono text-amber-800">{item.itemCode || '-'}</td>
                    <td className="px-3 py-2 text-amber-800">{item.description || '-'}</td>
                    <td className="px-3 py-2 text-right font-mono text-amber-800">
                      {item.quantity}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
