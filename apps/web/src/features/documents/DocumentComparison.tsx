import { useMemo, useState } from 'react';
import {
  CheckCircle,
  XCircle,
  AlertTriangle,
  Minus,
  FileText,
  Package,
  Wrench,
} from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useApiQuery } from '@/shared/hooks/useApi';
import { api } from '@/shared/lib/api-client';
import { cn } from '@/shared/lib/utils';
import { LoadingSpinner } from '@/shared/components/LoadingSpinner';
import { getErrorMessage } from '@/shared/utils/errors';
import type { ProcessEvent } from '@/shared/types';

type RowStatus = 'match' | 'warning' | 'divergent' | 'empty';
type DisplayStatus = RowStatus | 'accepted';
type Criticality = 'critical' | 'secondary' | 'info';
type ComparisonFilter = 'all' | 'divergent' | 'warning' | 'accepted' | 'match';

interface AggregateField {
  rowKey?: string;
  label: string;
  invoice: string | null;
  packingList: string | null;
  bl: string | null;
  espelho: string | null;
  status: RowStatus;
  criticality?: Criticality;
  message?: string | null;
}

interface ItemComparison {
  rowKey?: string;
  itemCode: string;
  description: string;
  ncm: string;
  invoiceQty: number | null;
  plQty: number | null;
  espelhoQty: number | null;
  invoiceUnitPrice: number | null;
  invoiceTotal: number | null;
  espelhoUnitPrice: number | null;
  espelhoTotal: number | null;
  invoiceBoxes: number | null;
  plBoxes: number | null;
  espelhoBoxes: number | null;
  invoiceNetWeight: number | null;
  plNetWeight: number | null;
  espelhoNetWeight: number | null;
  invoiceGrossWeight: number | null;
  plGrossWeight: number | null;
  plWeight?: number | null;
  espelhoGrossWeight: number | null;
  isFreeOfCharge?: boolean;
  qtyMatch: boolean | null;
  matched: boolean;
  espelhoMatched: boolean;
  divergence?: string | null;
  status?: RowStatus;
  message?: string | null;
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
  hasEspelho?: boolean;
  aggregateComparison: AggregateField[];
  itemComparison: ItemComparison[];
  unmatchedPlItems: UnmatchedItem[];
  draftBlRevisions?: DraftBlRevision[];
  invoiceConfidence: number | null;
  plConfidence: number | null;
  blConfidence: number | null;
  draftBlConfidence?: number | null;
  espelhoConfidence?: number | null;
}

interface AcceptTarget {
  scope: 'aggregate' | 'item';
  rowKey: string;
  fieldLabel: string;
  itemCode?: string | null;
  previousStatus: RowStatus;
}

function rowKey(scope: 'aggregate' | 'item', value: string | undefined | null, index: number) {
  const slug = String(value || `linha-${index + 1}`)
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
  return `${scope}:${slug || `linha-${index + 1}`}`;
}

function statusLabel(status: DisplayStatus) {
  switch (status) {
    case 'accepted':
      return 'Aceito';
    case 'divergent':
      return 'Falha';
    case 'warning':
      return 'Atencao';
    case 'match':
      return 'Conforme';
    default:
      return '-';
  }
}

function statusClasses(status: DisplayStatus) {
  switch (status) {
    case 'accepted':
      return 'bg-primary-50 text-primary-700 border-primary-200';
    case 'divergent':
      return 'bg-danger-50 text-danger-700 border-danger-200';
    case 'warning':
      return 'bg-amber-50 text-amber-700 border-amber-200';
    case 'match':
      return 'bg-emerald-50 text-emerald-700 border-emerald-200';
    default:
      return 'bg-slate-50 text-slate-500 border-slate-200';
  }
}

function StatusPill({ status }: { status: DisplayStatus }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold',
        statusClasses(status),
      )}
    >
      {statusLabel(status)}
    </span>
  );
}

function formatNumber(value: number | null | undefined, digits = 2) {
  if (value == null || Number.isNaN(Number(value))) return '-';
  return Number(value).toLocaleString('pt-BR', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function formatMoney(value: number | null | undefined) {
  if (value == null || Number.isNaN(Number(value))) return '-';
  return `$${formatNumber(value, 2)}`;
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
          : 'bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-600 text-slate-400',
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

function StatusCell({ value, status }: { value: string | null; status?: DisplayStatus }) {
  if (!value)
    return <td className="px-3 py-2.5 text-sm text-slate-300 dark:text-slate-600 font-mono">-</td>;
  return (
    <td
      className={cn(
        'px-3 py-2.5 text-sm font-mono',
        status === 'accepted'
          ? 'text-primary-700 dark:text-primary-300 font-medium bg-primary-50/40 dark:bg-primary-950/20'
          : status === 'divergent'
            ? 'text-danger-700 dark:text-danger-400 font-semibold bg-danger-50/50 dark:bg-danger-950/30'
            : status === 'warning'
              ? 'text-amber-700 dark:text-amber-400 font-medium bg-amber-50/40 dark:bg-amber-950/20'
              : 'text-slate-700 dark:text-slate-300',
      )}
    >
      {value}
    </td>
  );
}

function acceptanceEventRowKey(event: ProcessEvent): string | null {
  const rowKey = event.metadata?.rowKey;
  return typeof rowKey === 'string' ? rowKey : null;
}

function deriveItemStatus(item: ItemComparison, hasEspelho: boolean): RowStatus {
  if (item.status) return item.status;
  if (item.isFreeOfCharge) return 'warning';
  if (!item.matched || (hasEspelho && !item.espelhoMatched)) return 'warning';
  if (item.qtyMatch === false) return 'divergent';
  return 'match';
}

function deriveItemMessage(item: ItemComparison, status: RowStatus) {
  if (item.message) return item.message;
  if (item.isFreeOfCharge)
    return 'Diferença explicada por item FOC/desconto identificado na Invoice';
  if (status === 'match') return 'Item conforme entre os documentos disponiveis.';
  if (item.divergence) return item.divergence;
  return status === 'warning'
    ? 'Atencao operacional; revisar ou aceitar.'
    : 'Divergencia entre documentos.';
}

function passesFilter(status: DisplayStatus, filter: ComparisonFilter) {
  return filter === 'all' || status === filter;
}

export function DocumentComparison({ processId }: { processId: string }) {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<ComparisonFilter>('all');
  const [acceptTarget, setAcceptTarget] = useState<AcceptTarget | null>(null);
  const [acceptNote, setAcceptNote] = useState('');
  const [acceptingKey, setAcceptingKey] = useState<string | null>(null);

  const { data, isLoading } = useApiQuery<ComparisonData>(
    ['doc-comparison', processId],
    `/api/documents/process/${processId}/comparison`,
  );
  const { data: processEvents } = useApiQuery<ProcessEvent[]>(
    ['process-events', processId],
    `/api/processes/${processId}/events?limit=200`,
  );

  const acceptedByRow = useMemo(() => {
    const map = new Map<string, ProcessEvent>();
    for (const event of processEvents ?? []) {
      if (event.eventType !== 'comparison_acceptance') continue;
      const key = acceptanceEventRowKey(event);
      if (key && !map.has(key)) map.set(key, event);
    }
    return map;
  }, [processEvents]);

  const aggregateRows = useMemo(
    () =>
      (data?.aggregateComparison ?? [])
        .filter((field) => field.status !== 'empty')
        .map((field, index) => {
          const key = field.rowKey ?? rowKey('aggregate', field.label, index);
          const accepted = acceptedByRow.get(key);
          const displayStatus: DisplayStatus = accepted ? 'accepted' : field.status;
          return { ...field, rowKey: key, displayStatus, accepted };
        }),
    [acceptedByRow, data?.aggregateComparison],
  );

  const itemRows = useMemo(
    () =>
      (data?.itemComparison ?? []).map((item, index) => {
        const key = item.rowKey ?? rowKey('item', item.itemCode || item.description, index);
        const status = deriveItemStatus(item, !!data?.hasEspelho);
        const accepted = acceptedByRow.get(key);
        const displayStatus: DisplayStatus = accepted ? 'accepted' : status;
        return {
          ...item,
          rowKey: key,
          status,
          displayStatus,
          accepted,
          message: deriveItemMessage(item, status),
        };
      }),
    [acceptedByRow, data?.hasEspelho, data?.itemComparison],
  );

  const filteredAggregateRows = useMemo(
    () => aggregateRows.filter((row) => passesFilter(row.displayStatus, filter)),
    [aggregateRows, filter],
  );

  const filteredItemRows = useMemo(
    () => itemRows.filter((row) => passesFilter(row.displayStatus, filter)),
    [filter, itemRows],
  );

  const counts = useMemo(() => {
    const rows = [...aggregateRows, ...itemRows];
    return {
      all: rows.length,
      match: rows.filter((row) => row.displayStatus === 'match').length,
      warning: rows.filter((row) => row.displayStatus === 'warning').length,
      divergent: rows.filter((row) => row.displayStatus === 'divergent').length,
      accepted: rows.filter((row) => row.displayStatus === 'accepted').length,
    };
  }, [aggregateRows, itemRows]);

  const missingComparisonDocs = useMemo(() => {
    if (!data) return [];
    return [
      !data.hasInvoice ? 'Invoice' : null,
      !data.hasPackingList ? 'Packing List' : null,
      !data.hasBl ? 'Bill of Lading' : null,
      !data.hasEspelho ? 'Espelho' : null,
    ].filter(Boolean) as string[];
  }, [data]);

  const submitAcceptance = async () => {
    if (!acceptTarget) return;
    const note = acceptNote.trim();
    if (!note) {
      toast.error('Informe uma justificativa para o aceite.');
      return;
    }
    setAcceptingKey(acceptTarget.rowKey);
    try {
      await api.post(`/api/documents/process/${processId}/comparison/accept`, {
        ...acceptTarget,
        resolution_note: note,
      });
      toast.success('Aceite registrado no historico');
      setAcceptTarget(null);
      setAcceptNote('');
      queryClient.invalidateQueries({ queryKey: ['process-events', processId] });
      queryClient.invalidateQueries({ queryKey: ['doc-comparison', processId] });
    } catch (err: unknown) {
      toast.error(getErrorMessage(err));
    } finally {
      setAcceptingKey(null);
    }
  };

  const renderAcceptanceCell = (target: AcceptTarget, accepted?: ProcessEvent) => {
    if (accepted) {
      return (
        <div className="space-y-1 text-xs text-primary-700">
          <div className="inline-flex items-center gap-1 rounded bg-primary-50 px-2 py-1 font-medium">
            <Wrench className="h-3 w-3" />
            Aceito
          </div>
          <div className="text-slate-500 dark:text-slate-400">
            {accepted.userName ? `${accepted.userName} · ` : ''}
            {new Date(accepted.createdAt).toLocaleString('pt-BR', {
              day: '2-digit',
              month: '2-digit',
              year: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
            })}
          </div>
        </div>
      );
    }

    if (target.previousStatus === 'match' || target.previousStatus === 'empty') {
      return <span className="text-xs text-slate-300">-</span>;
    }

    if (acceptTarget?.rowKey === target.rowKey) {
      return (
        <div className="min-w-[240px] space-y-2">
          <textarea
            value={acceptNote}
            onChange={(event) => setAcceptNote(event.target.value)}
            rows={2}
            autoFocus
            placeholder="Justificativa do aceite"
            className="w-full rounded-lg border border-slate-200 dark:border-slate-600 px-2.5 py-1.5 text-xs text-slate-800 dark:text-slate-100 focus:border-primary-400 focus:ring-2 focus:ring-primary-100 outline-none"
          />
          <div className="flex items-center gap-2">
            <button
              onClick={submitAcceptance}
              disabled={acceptingKey === target.rowKey || !acceptNote.trim()}
              className="inline-flex items-center gap-1 rounded-md bg-primary-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-primary-700 disabled:opacity-50"
            >
              {acceptingKey === target.rowKey ? (
                <LoadingSpinner size="sm" />
              ) : (
                <Wrench className="h-3 w-3" />
              )}
              Confirmar
            </button>
            <button
              onClick={() => {
                setAcceptTarget(null);
                setAcceptNote('');
              }}
              className="text-xs font-medium text-slate-500 hover:text-slate-700"
            >
              Cancelar
            </button>
          </div>
        </div>
      );
    }

    return (
      <button
        onClick={() => {
          setAcceptTarget(target);
          setAcceptNote('');
        }}
        className="inline-flex items-center gap-1 rounded-md border border-primary-200 bg-primary-50 px-2.5 py-1 text-xs font-medium text-primary-700 hover:bg-primary-100"
      >
        <Wrench className="h-3 w-3" />
        Aceitar
      </button>
    );
  };

  if (isLoading) return <LoadingSpinner className="py-8" />;

  if (!data) {
    return (
      <div className="flex flex-col items-center justify-center py-10 text-center">
        <Package className="h-8 w-8 text-slate-300 mb-2" />
        <p className="text-sm text-slate-400">Nenhum dado disponivel para comparacao.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-3">
        <DocBadge label="Invoice" available={data.hasInvoice} confidence={data.invoiceConfidence} />
        <DocBadge
          label="Packing List"
          available={data.hasPackingList}
          confidence={data.plConfidence}
        />
        <DocBadge label="Bill of Lading" available={data.hasBl} confidence={data.blConfidence} />
        {data.hasDraftBl && (
          <DocBadge label="Draft BL" available={true} confidence={data.draftBlConfidence ?? null} />
        )}
        <DocBadge
          label="Espelho"
          available={!!data.hasEspelho}
          confidence={data.espelhoConfidence ?? null}
        />
      </div>

      {missingComparisonDocs.length > 0 && (
        <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <p className="font-semibold">Comparativo parcial</p>
            <p className="mt-0.5 text-xs leading-5">
              {missingComparisonDocs.join(', ')} ausente ou sem extracao valida. Reenvie ou
              reprocesse o documento para liberar os campos e itens dependentes.
            </p>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {[
          { key: 'all' as const, label: 'Todos', count: counts.all },
          { key: 'divergent' as const, label: 'Falhas', count: counts.divergent },
          { key: 'warning' as const, label: 'Atencoes', count: counts.warning },
          { key: 'accepted' as const, label: 'Aceitos', count: counts.accepted },
          { key: 'match' as const, label: 'Conformes', count: counts.match },
        ].map(({ key, label, count }) => (
          <button
            key={key}
            onClick={() => setFilter(key)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors',
              filter === key
                ? 'bg-primary-600 text-white'
                : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-200',
            )}
          >
            {label}
            <span
              className={cn(
                'rounded-full px-1.5 py-0.5 text-[10px] font-bold',
                filter === key
                  ? 'bg-white/20 text-white'
                  : 'bg-slate-200 dark:bg-slate-600 text-slate-500 dark:text-slate-400',
              )}
            >
              {count}
            </span>
          </button>
        ))}
      </div>

      <div className="flex items-center gap-4 text-sm">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-3 py-1 font-medium text-emerald-700">
          <CheckCircle className="h-3.5 w-3.5" /> {counts.match} conformes
        </span>
        {counts.warning > 0 && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-3 py-1 font-medium text-amber-700">
            <AlertTriangle className="h-3.5 w-3.5" /> {counts.warning} atencoes
          </span>
        )}
        {counts.divergent > 0 && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-danger-100 px-3 py-1 font-medium text-danger-700">
            <XCircle className="h-3.5 w-3.5" /> {counts.divergent} falhas
          </span>
        )}
      </div>

      <div className="rounded-xl border border-slate-200 dark:border-slate-600 overflow-hidden">
        <div className="bg-slate-50 dark:bg-slate-900 px-4 py-3 border-b border-slate-200 dark:border-slate-600">
          <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <FileText className="h-4 w-4 text-primary-600" />
            Comparativo Geral - Invoice vs Packing List vs BL vs Espelho
          </h4>
        </div>
        <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
          <table className="min-w-full">
            <thead>
              <tr className="bg-slate-50/50 dark:bg-slate-900/50 sticky top-0 z-10 bg-white dark:bg-slate-800 shadow-[0_1px_3px_0_rgba(0,0,0,0.06)]">
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
                <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-cyan-500">
                  Espelho
                </th>
                <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  Status
                </th>
                <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  Mensagem
                </th>
                <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  Acao
                </th>
              </tr>
            </thead>
            <tbody>
              {filteredAggregateRows.map((field) => (
                <tr
                  key={field.rowKey}
                  className={cn(
                    'border-b last:border-b-0',
                    field.displayStatus === 'accepted'
                      ? 'bg-primary-50/30 dark:bg-primary-950/20'
                      : field.status === 'divergent'
                        ? 'bg-danger-50/30 dark:bg-danger-950/20'
                        : field.status === 'warning'
                          ? 'bg-amber-50/30 dark:bg-amber-950/20'
                          : '',
                  )}
                >
                  <td className="px-3 py-2.5">
                    {field.displayStatus === 'accepted' && (
                      <Wrench className="h-4 w-4 text-primary-500" />
                    )}
                    {field.displayStatus === 'match' && (
                      <CheckCircle className="h-4 w-4 text-emerald-500" />
                    )}
                    {field.displayStatus === 'warning' && (
                      <AlertTriangle className="h-4 w-4 text-amber-500" />
                    )}
                    {field.displayStatus === 'divergent' && (
                      <XCircle className="h-4 w-4 text-danger-500" />
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-sm font-medium text-slate-800 dark:text-slate-100">
                    <div className="flex items-center gap-1.5">
                      <span>{field.label}</span>
                      {field.criticality === 'secondary' && (
                        <span
                          title="Campo secundario - divergencia registrada como atencao"
                          className="inline-flex items-center rounded bg-slate-100 dark:bg-slate-700 px-1 py-0.5 text-[9px] font-semibold uppercase text-slate-600 dark:text-slate-400"
                        >
                          secundario
                        </span>
                      )}
                      {field.criticality === 'info' && (
                        <span
                          title="Campo informativo - nao e comparado entre documentos"
                          className="inline-flex items-center rounded bg-slate-100 dark:bg-slate-700 px-1 py-0.5 text-[9px] font-semibold uppercase text-slate-500"
                        >
                          info
                        </span>
                      )}
                    </div>
                  </td>
                  <StatusCell value={field.invoice} status={field.displayStatus} />
                  <StatusCell value={field.packingList} status={field.displayStatus} />
                  <StatusCell value={field.bl} status={field.displayStatus} />
                  <StatusCell value={field.espelho} status={field.displayStatus} />
                  <td className="px-3 py-2.5">
                    <StatusPill status={field.displayStatus} />
                  </td>
                  <td className="px-3 py-2.5 text-xs text-slate-600 dark:text-slate-400 min-w-[220px]">
                    {field.message ?? '-'}
                  </td>
                  <td className="px-3 py-2.5">
                    {renderAcceptanceCell(
                      {
                        scope: 'aggregate',
                        rowKey: field.rowKey,
                        fieldLabel: field.label,
                        previousStatus: field.status,
                      },
                      field.accepted,
                    )}
                  </td>
                </tr>
              ))}
              {filteredAggregateRows.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-3 py-8 text-center text-sm text-slate-400">
                    Nenhuma linha no filtro selecionado.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {data.itemComparison.length > 0 && (
        <div className="rounded-xl border border-slate-200 dark:border-slate-600 overflow-hidden">
          <div className="bg-slate-50 dark:bg-slate-900 px-4 py-3 border-b border-slate-200 dark:border-slate-600">
            <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <Package className="h-4 w-4 text-violet-600" />
              Comparativo por Item - Invoice vs Packing List vs Espelho
            </h4>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              {data.itemComparison.filter((i) => i.matched).length} de {data.itemComparison.length}{' '}
              itens encontrados no Packing List
              {data.hasEspelho
                ? ` · ${data.itemComparison.filter((i) => i.espelhoMatched).length} no Espelho`
                : ''}
            </p>
          </div>
          <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="bg-slate-50/50 dark:bg-slate-900/50 sticky top-0 z-10 bg-white dark:bg-slate-800 shadow-[0_1px_3px_0_rgba(0,0,0,0.06)]">
                  <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400 w-8"></th>
                  <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                    SKU/Codigo
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
                  <th className="px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-wider text-cyan-500">
                    Qtd Espelho
                  </th>
                  <th className="px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                    Unit INV
                  </th>
                  <th className="px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                    Total INV
                  </th>
                  <th className="px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                    Peso PL
                  </th>
                  <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                    Divergencia
                  </th>
                  <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                    Status
                  </th>
                  <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                    Mensagem
                  </th>
                  <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                    Acao
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredItemRows.map((item) => (
                  <tr
                    key={item.rowKey}
                    className={cn(
                      'border-b last:border-b-0',
                      item.displayStatus === 'accepted'
                        ? 'bg-primary-50/30 dark:bg-primary-950/20'
                        : item.status === 'divergent'
                          ? 'bg-danger-50/30 dark:bg-danger-950/20'
                          : item.status === 'warning'
                            ? 'bg-amber-50/30 dark:bg-amber-950/20'
                            : '',
                    )}
                  >
                    <td className="px-3 py-2">
                      {item.displayStatus === 'accepted' ? (
                        <Wrench className="h-4 w-4 text-primary-500" />
                      ) : item.status === 'warning' ? (
                        <AlertTriangle className="h-4 w-4 text-amber-500" />
                      ) : item.status === 'divergent' ? (
                        <XCircle className="h-4 w-4 text-danger-500" />
                      ) : (
                        <CheckCircle className="h-4 w-4 text-emerald-500" />
                      )}
                    </td>
                    <td className="px-3 py-2 font-mono text-slate-700 dark:text-slate-300">
                      <div className="flex items-center gap-1.5">
                        {item.itemCode || '-'}
                        {item.isFreeOfCharge && (
                          <span className="inline-flex items-center rounded bg-violet-100 px-1 py-0.5 text-[9px] font-semibold uppercase text-violet-700">
                            FOC
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-slate-700 dark:text-slate-300 max-w-[220px] truncate">
                      {item.description || '-'}
                    </td>
                    <td className="px-3 py-2 font-mono text-slate-600 dark:text-slate-400">
                      {item.ncm || '-'}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-primary-700">
                      {formatNumber(item.invoiceQty, 0)}
                    </td>
                    <td
                      className={cn(
                        'px-3 py-2 text-right font-mono',
                        item.status === 'divergent'
                          ? 'text-danger-700 font-semibold'
                          : 'text-violet-700',
                      )}
                    >
                      {formatNumber(item.plQty, 0)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-cyan-700">
                      {formatNumber(item.espelhoQty, 0)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-slate-600 dark:text-slate-400">
                      {formatMoney(item.invoiceUnitPrice)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-slate-800 dark:text-slate-100 font-medium">
                      {formatMoney(item.invoiceTotal)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-slate-600 dark:text-slate-400">
                      {formatNumber(item.plWeight ?? item.plGrossWeight ?? item.plNetWeight)}
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-600 dark:text-slate-400 min-w-[180px]">
                      {item.divergence || '-'}
                    </td>
                    <td className="px-3 py-2">
                      <StatusPill status={item.displayStatus} />
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-600 dark:text-slate-400 min-w-[240px]">
                      {item.message || '-'}
                    </td>
                    <td className="px-3 py-2">
                      {renderAcceptanceCell(
                        {
                          scope: 'item',
                          rowKey: item.rowKey,
                          fieldLabel: 'Comparativo por item',
                          itemCode: item.itemCode,
                          previousStatus: item.status,
                        },
                        item.accepted,
                      )}
                    </td>
                  </tr>
                ))}
                {filteredItemRows.length === 0 && (
                  <tr>
                    <td colSpan={14} className="px-3 py-8 text-center text-sm text-slate-400">
                      Nenhum item no filtro selecionado.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {data.unmatchedPlItems.length > 0 && (
        <div className="rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50/30 dark:bg-amber-950/20 overflow-hidden">
          <div className="bg-amber-50 dark:bg-amber-950/30 px-4 py-3 border-b border-amber-200 dark:border-amber-800">
            <h4 className="text-sm font-semibold text-amber-800 flex items-center gap-2">
              <AlertTriangle className="h-4 w-4" />
              Itens no Packing List sem correspondencia na Invoice ({data.unmatchedPlItems.length})
            </h4>
          </div>
          <div className="overflow-x-auto max-h-[400px] overflow-y-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="bg-amber-50/50 dark:bg-amber-950/30 sticky top-0 z-10 bg-amber-50 dark:bg-amber-950/30 shadow-[0_1px_3px_0_rgba(0,0,0,0.06)]">
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
