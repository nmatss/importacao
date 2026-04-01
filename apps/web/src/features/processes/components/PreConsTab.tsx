import { Package, AlertTriangle, CheckCircle2, XCircle } from 'lucide-react';
import { useApiQuery } from '@/shared/hooks/useApi';
import { cn } from '@/shared/lib/utils';
import { LoadingSpinner } from '@/shared/components/LoadingSpinner';

interface PreConsItem {
  id: number;
  processCode: string | null;
  productName: string | null;
  itemCode: string | null;
  quantity: number | null;
  agreedPrice: string | null;
  ncmCode: string | null;
  amount: string | null;
  cbm: string | null;
  etd: string | null;
  eta: string | null;
  cargoReadyDate: string | null;
  piNumber: string | null;
  ean13: string | null;
  color: string | null;
  collection: string | null;
  portOfLoading: string | null;
  supplier: string | null;
  sheetName: string | null;
}

interface Divergence {
  processCode: string;
  field: string;
  preConsValue: string;
  systemValue: string;
  severity: 'info' | 'warning' | 'critical';
}

const fieldLabels: Record<string, string> = {
  totalFobValue: 'Valor FOB Total',
  totalCbm: 'CBM Total',
  etd: 'ETD',
};

function formatCurrency(value: string | null): string {
  if (!value) return '--';
  const num = Number(value);
  if (isNaN(num)) return '--';
  return num.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

export function PreConsTab({ processCode }: { processId: string; processCode: string }) {
  const {
    data: items,
    isLoading,
    isError,
  } = useApiQuery<PreConsItem[]>(
    ['pre-cons-process', processCode],
    `/api/pre-cons/process/${encodeURIComponent(processCode)}`,
  );

  const { data: allDivergences } = useApiQuery<Divergence[]>(
    ['pre-cons-divergences'],
    '/api/pre-cons/divergences',
    { staleTime: 60_000 },
  );

  const divergences = allDivergences?.filter((d) => d.processCode === processCode) ?? [];

  if (isLoading) return <LoadingSpinner className="py-8" />;

  if (isError) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-3">
        <XCircle className="h-8 w-8 text-red-300" />
        <p className="text-sm text-red-500 font-medium">
          Erro ao carregar dados de Pre-Conferencia.
        </p>
      </div>
    );
  }

  if (!items || items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-3">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100">
          <Package className="h-6 w-6 text-slate-300" />
        </div>
        <p className="text-sm text-slate-400 font-medium">
          Nenhum dado de Pre-Conferencia para este processo.
        </p>
        <p className="text-xs text-slate-400">
          Os dados aparecem apos o sync da planilha Pre_Cons (KIOM).
        </p>
      </div>
    );
  }

  const totalQty = items.reduce((sum, i) => sum + (i.quantity ?? 0), 0);
  const totalAmount = items.reduce((sum, i) => sum + (Number(i.amount) || 0), 0);
  const totalCbm = items.reduce((sum, i) => sum + (Number(i.cbm) || 0), 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-bold text-slate-800">Pre-Conferencia (KIOM)</h3>
        {divergences.length === 0 ? (
          <span className="inline-flex items-center gap-1.5 rounded-lg bg-green-50 px-3 py-1.5 text-xs font-semibold text-green-700 border border-green-200">
            <CheckCircle2 className="h-3.5 w-3.5" />
            Sem divergencias
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 rounded-lg bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-700 border border-amber-200">
            <AlertTriangle className="h-3.5 w-3.5" />
            {divergences.length} divergencia{divergences.length > 1 ? 's' : ''}
          </span>
        )}
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="rounded-xl border border-slate-200/80 bg-slate-50/50 p-3">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Itens</p>
          <p className="mt-1 text-lg font-bold text-slate-800">{items.length}</p>
        </div>
        <div className="rounded-xl border border-slate-200/80 bg-slate-50/50 p-3">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Qtd Total</p>
          <p className="mt-1 text-lg font-bold text-slate-800">
            {totalQty.toLocaleString('pt-BR')}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200/80 bg-slate-50/50 p-3">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
            Valor Total
          </p>
          <p className="mt-1 text-lg font-bold text-slate-800">
            {totalAmount.toLocaleString('en-US', { style: 'currency', currency: 'USD' })}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200/80 bg-slate-50/50 p-3">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">CBM Total</p>
          <p className="mt-1 text-lg font-bold text-slate-800">{totalCbm.toFixed(2)}</p>
        </div>
      </div>

      {/* Divergences for this process */}
      {divergences.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50/50 p-3 space-y-2">
          <h4 className="text-xs font-bold text-amber-800 uppercase tracking-wider">
            Divergencias
          </h4>
          {divergences.map((d, i) => (
            <div key={i} className="flex items-center gap-2 text-sm">
              <span
                className={cn(
                  'inline-flex rounded-md px-2 py-0.5 text-xs font-semibold',
                  d.severity === 'critical'
                    ? 'bg-red-100 text-red-700'
                    : d.severity === 'warning'
                      ? 'bg-amber-100 text-amber-700'
                      : 'bg-blue-100 text-blue-700',
                )}
              >
                {d.severity}
              </span>
              <span className="text-slate-700">
                {fieldLabels[d.field] || d.field}: Pre-Cons{' '}
                <strong className="text-slate-900">{d.preConsValue}</strong> vs Sistema{' '}
                <strong className="text-slate-900">{d.systemValue}</strong>
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Items table */}
      <div className="overflow-x-auto rounded-xl border border-slate-200/80">
        <table className="min-w-full divide-y divide-slate-100 text-sm">
          <thead className="bg-slate-50/80">
            <tr>
              <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                Produto
              </th>
              <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                Cod. Item
              </th>
              <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase tracking-wider text-slate-500">
                Qtd
              </th>
              <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase tracking-wider text-slate-500">
                Preco Unit.
              </th>
              <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase tracking-wider text-slate-500">
                Valor
              </th>
              <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                NCM
              </th>
              <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase tracking-wider text-slate-500">
                CBM
              </th>
              <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                EAN
              </th>
              <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                Cor
              </th>
              <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                PI
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {items.map((item) => (
              <tr key={item.id} className="hover:bg-slate-50/50 transition-colors">
                <td
                  className="px-3 py-2 text-slate-700 max-w-[180px] truncate"
                  title={item.productName ?? ''}
                >
                  {item.productName || '--'}
                </td>
                <td className="px-3 py-2 font-mono text-xs text-slate-600">
                  {item.itemCode || '--'}
                </td>
                <td className="px-3 py-2 text-right font-mono text-slate-700">
                  {item.quantity?.toLocaleString('pt-BR') ?? '--'}
                </td>
                <td className="px-3 py-2 text-right font-mono text-slate-600">
                  {item.agreedPrice ? `$${Number(item.agreedPrice).toFixed(2)}` : '--'}
                </td>
                <td className="px-3 py-2 text-right font-mono font-semibold text-slate-800">
                  {formatCurrency(item.amount)}
                </td>
                <td className="px-3 py-2 font-mono text-xs text-slate-600">
                  {item.ncmCode || '--'}
                </td>
                <td className="px-3 py-2 text-right font-mono text-slate-600">
                  {item.cbm ? Number(item.cbm).toFixed(3) : '--'}
                </td>
                <td className="px-3 py-2 font-mono text-xs text-slate-500">{item.ean13 || '--'}</td>
                <td className="px-3 py-2 text-slate-600">{item.color || '--'}</td>
                <td className="px-3 py-2 text-slate-600">{item.piNumber || '--'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
