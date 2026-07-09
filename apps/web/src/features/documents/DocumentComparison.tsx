import { useMemo, useState } from 'react';
import {
  CheckCircle,
  XCircle,
  AlertTriangle,
  Minus,
  FileText,
  Package,
  Wrench,
  Pencil,
  Save,
} from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useApiQuery } from '@/shared/hooks/useApi';
import { api } from '@/shared/lib/api-client';
import { cn } from '@/shared/lib/utils';
import { VALIDATION_CHECK_NAMES } from '@/shared/lib/constants';
import { LoadingSpinner } from '@/shared/components/LoadingSpinner';
import { ErrorState } from '@/shared/components/ErrorState';
import { getErrorMessage } from '@/shared/utils/errors';
import type { ProcessEvent } from '@/shared/types';

type RowStatus = 'match' | 'warning' | 'divergent' | 'empty';
type DisplayStatus = RowStatus | 'accepted';
type Criticality = 'critical' | 'secondary' | 'info';
type ComparisonFilter = 'all' | 'divergent' | 'warning' | 'accepted' | 'match';
type ComparisonSourceColumn = 'invoice' | 'packingList' | 'bl' | 'espelho' | 'system';

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
  overrides?: ComparisonFieldOverride[];
}

interface ComparisonFieldOverride {
  id: number;
  rowKey: string;
  fieldLabel: string;
  sourceColumn: ComparisonSourceColumn;
  valueText: string | null;
  note: string | null;
  editedAt: string;
  editedBy: number | null;
  editedByName?: string | null;
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
  invoiceManufacturer?: string | null;
  plManufacturer?: string | null;
  espelhoManufacturer?: string | null;
  manufacturerMatch?: boolean | null;
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
  weightRatioStatus?: RowStatus;
  weightRatioMessage?: string | null;
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

interface ExtractionCoverageSummary {
  readPercent: number;
  effectiveReadPercent?: number;
  trackedMissingFields?: string[];
  missingFields: string[];
  lowConfidenceFields: string[];
}

interface ComparisonData {
  hasInvoice: boolean;
  hasPackingList: boolean;
  hasBl: boolean;
  hasFinalBl?: boolean;
  hasOperationalBl?: boolean;
  operationalBlSource?: 'ohbl' | 'draft_bl' | null;
  hasDraftBl?: boolean;
  hasEspelho?: boolean;
  aggregateComparison: AggregateField[];
  itemComparison: ItemComparison[];
  unmatchedPlItems: UnmatchedItem[];
  supplierFooterAliases?: string[];
  espelhoSuppliers?: string[];
  // Symmetric direction: items present on the Invoice with no match on the
  // Packing List. Optional so older comparison payloads still render.
  unmatchedInvoiceItems?: UnmatchedItem[];
  draftBlRevisions?: DraftBlRevision[];
  invoiceConfidence: number | null;
  plConfidence: number | null;
  blConfidence: number | null;
  finalBlConfidence?: number | null;
  draftBlConfidence?: number | null;
  espelhoConfidence?: number | null;
  extractionCoverage?: {
    invoice?: ExtractionCoverageSummary | null;
    packingList?: ExtractionCoverageSummary | null;
    bl?: ExtractionCoverageSummary | null;
    draftBl?: ExtractionCoverageSummary | null;
  };
}

interface ValidationCheck {
  id: number;
  checkName: string;
  status: 'passed' | 'failed' | 'warning' | 'skipped';
  expectedValue?: string | null;
  actualValue?: string | null;
  documentsCompared?: string | null;
  message?: string | null;
  dataSource?: string | null;
}

interface ValidationReport {
  systemDataAvailable?: boolean;
  crossDocumentChecks: ValidationCheck[];
  systemChecks: ValidationCheck[];
}

interface AcceptTarget {
  scope: 'aggregate' | 'item';
  rowKey: string;
  fieldLabel: string;
  itemCode?: string | null;
  previousStatus: RowStatus;
}

interface EditTarget {
  rowKey: string;
  fieldLabel: string;
  sourceColumn: ComparisonSourceColumn;
  currentValue: string | null;
}

const COVERAGE_LABELS: Record<string, string> = {
  invoice: 'Invoice',
  packingList: 'Packing List',
  bl: 'BL Final',
  draftBl: 'Draft BL',
};

function ExtractionCoveragePanel({ coverage }: { coverage: ComparisonData['extractionCoverage'] }) {
  if (!coverage) return null;
  const rows = Object.entries(coverage)
    .filter(([, value]) => value != null)
    .map(([key, value]) => {
      const summary = value as ExtractionCoverageSummary;
      const missing = summary.trackedMissingFields?.length
        ? summary.trackedMissingFields
        : summary.missingFields;
      const percent =
        typeof summary.effectiveReadPercent === 'number'
          ? summary.effectiveReadPercent
          : summary.readPercent;
      return {
        key,
        label: COVERAGE_LABELS[key] ?? key,
        percent,
        missing,
        lowConfidence: summary.lowConfidenceFields,
      };
    })
    .filter((row) => row.percent < 100 || row.missing.length > 0 || row.lowConfidence.length > 0);

  if (rows.length === 0) return null;

  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="font-semibold">Diagnostico da extracao documental</p>
          <p className="mt-0.5 text-xs leading-5 text-amber-800">
            Revise campos nao lidos ou de baixa confianca antes de aceitar divergencias, gerar
            espelho ou sincronizar Follow-Up.
          </p>
          <div className="mt-2 grid gap-2 md:grid-cols-2">
            {rows.map((row) => (
              <div key={row.key} className="rounded-md bg-white/70 px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold">{row.label}</span>
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold">
                    {row.percent}%
                  </span>
                </div>
                <p className="mt-1 text-[11px] text-amber-800">
                  {row.missing.length > 0
                    ? `Nao lidos: ${row.missing.slice(0, 5).join(', ')}${row.missing.length > 5 ? '...' : ''}`
                    : 'Campos obrigatorios lidos.'}
                </p>
                {row.lowConfidence.length > 0 ? (
                  <p className="mt-0.5 text-[11px] text-amber-800">
                    Baixa confianca: {row.lowConfidence.slice(0, 5).join(', ')}
                    {row.lowConfidence.length > 5 ? '...' : ''}
                  </p>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
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

function normalizeLabelKey(value: string | undefined | null) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function normalizeSupplierValue(value: string | undefined | null) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '');
}

function supplierValuesMatch(a: string, b: string) {
  const left = normalizeSupplierValue(a);
  const right = normalizeSupplierValue(b);
  if (!left || !right) return false;
  return left === right || left.includes(right) || right.includes(left);
}

const SYSTEM_CHECK_BY_AGGREGATE_LABEL: Record<string, string> = {
  'total-fob-usd': 'invoice-value-vs-fup',
  frete: 'freight-vs-fup',
  'cbm-m3': 'cbm-vs-fup',
  'tipo-container': 'container-type-vs-fup',
};

const HIDDEN_CROSS_DOCUMENT_CHECKS = new Set([
  'manufacturer-completeness',
  'supplier-address-match',
  'payment-terms-check',
  'certificate-completeness',
  'weight-ratio-check',
  'item-level-match',
  'unit-type-validation',
]);

const SOURCE_LABELS: Record<ComparisonSourceColumn, string> = {
  invoice: 'PDF',
  packingList: 'PDF',
  bl: 'PDF',
  espelho: 'Excel',
  system: 'Sistema',
};

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

function StatusCell({
  value,
  status,
  sourceLabel,
  edited,
  onEdit,
}: {
  value: string | null;
  status?: DisplayStatus;
  sourceLabel?: string;
  edited?: boolean;
  onEdit?: () => void;
}) {
  const content = value || '-';
  return (
    <td
      className={cn(
        'px-3 py-2.5 text-sm font-mono',
        !value && 'text-slate-300 dark:text-slate-600',
        status === 'accepted'
          ? 'text-primary-700 dark:text-primary-300 font-medium bg-primary-50/40 dark:bg-primary-950/20'
          : status === 'divergent'
            ? 'text-danger-700 dark:text-danger-400 font-semibold bg-danger-50/50 dark:bg-danger-950/30'
            : status === 'warning'
              ? 'text-amber-700 dark:text-amber-400 font-medium bg-amber-50/40 dark:bg-amber-950/20'
              : 'text-slate-700 dark:text-slate-300',
      )}
    >
      <div className="flex min-w-[110px] items-start justify-between gap-2">
        <div className="min-w-0">
          <span className="break-words">{content}</span>
          {(sourceLabel || edited) && (
            <div className="mt-1 flex flex-wrap gap-1">
              {sourceLabel && (
                <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-slate-500 dark:bg-slate-700 dark:text-slate-300">
                  {sourceLabel}
                </span>
              )}
              {edited && (
                <span className="rounded bg-primary-50 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-primary-700">
                  editado
                </span>
              )}
            </div>
          )}
        </div>
        {onEdit && (
          <button
            type="button"
            onClick={onEdit}
            className="rounded-md p-1 text-slate-300 hover:bg-slate-100 hover:text-primary-600"
            aria-label="Editar valor do comparativo"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </td>
  );
}

// Per-source value cell stacking INV/PL/Esp. Used for net/gross weight (2
// decimals) and, with digits=0, for box counts which are whole numbers.
function WeightCell({
  invoice,
  pl,
  espelho,
  hasEspelho,
  digits = 2,
}: {
  invoice: number | null | undefined;
  pl: number | null | undefined;
  espelho: number | null | undefined;
  hasEspelho: boolean;
  digits?: number;
}) {
  const parts: Array<{ key: string; label: string; value: number | null | undefined }> = [
    { key: 'inv', label: 'INV', value: invoice },
    { key: 'pl', label: 'PL', value: pl },
  ];
  if (hasEspelho) parts.push({ key: 'esp', label: 'Esp', value: espelho });
  const visible = parts.filter((p) => p.value != null);
  if (visible.length === 0) {
    return <td className="px-3 py-2 text-right font-mono text-slate-300 dark:text-slate-600">-</td>;
  }
  return (
    <td className="px-3 py-2 text-right font-mono text-slate-600 dark:text-slate-400 whitespace-nowrap">
      <div className="flex flex-col items-end gap-0.5">
        {visible.map((p) => (
          <span key={p.key}>
            <span className="text-[9px] uppercase text-slate-400 mr-1">{p.label}</span>
            {formatNumber(p.value, digits)}
          </span>
        ))}
      </div>
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

const checkLabel = (name: string) =>
  VALIDATION_CHECK_NAMES.find((c) => c.value === name)?.description ?? name;

function checkRowStatus(status: ValidationCheck['status']): RowStatus {
  switch (status) {
    case 'failed':
      return 'divergent';
    case 'warning':
      return 'warning';
    case 'passed':
      return 'match';
    default:
      return 'empty';
  }
}

function highestStatus(...statuses: RowStatus[]): RowStatus {
  if (statuses.includes('divergent')) return 'divergent';
  if (statuses.includes('warning')) return 'warning';
  if (statuses.includes('match')) return 'match';
  return 'empty';
}

export function DocumentComparison({ processId }: { processId: string }) {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<ComparisonFilter>('all');
  const [acceptTarget, setAcceptTarget] = useState<AcceptTarget | null>(null);
  const [acceptNote, setAcceptNote] = useState('');
  const [acceptingKey, setAcceptingKey] = useState<string | null>(null);
  const [editTarget, setEditTarget] = useState<EditTarget | null>(null);
  const [editValue, setEditValue] = useState('');
  const [editNote, setEditNote] = useState('');
  const [editingKey, setEditingKey] = useState<string | null>(null);

  const { data, isLoading, isError, error, refetch } = useApiQuery<ComparisonData>(
    ['doc-comparison', processId],
    `/api/documents/process/${processId}/comparison`,
  );
  const { data: processEvents } = useApiQuery<ProcessEvent[]>(
    ['process-events', processId],
    `/api/processes/${processId}/events?limit=200`,
  );
  // Absorbs the standalone "Cruzamento entre Documentos" and "Documentos vs
  // Sistema" panels (removed from FupComparisonPanel) into this consolidated
  // comparison. We read the cross_document checks and the system_vs_document
  // values inline so only one comparison remains.
  const { data: report } = useApiQuery<ValidationReport>(
    ['validation-report', processId],
    `/api/validation/${processId}/report`,
  );

  const systemDataAvailable = report?.systemDataAvailable ?? false;

  // Map system (Sydle) values by validation key and by normalized labels. Real
  // aggregate labels are "Total FOB (USD)", "Frete", "CBM (m3)", etc., while
  // validation labels are "Valor Invoice vs Sistema", so label-only matching
  // leaves the Sistema column empty in production data.
  const systemCheckByLabel = useMemo(() => {
    const map = new Map<string, ValidationCheck>();
    for (const check of report?.systemChecks ?? []) {
      const value = check.expectedValue;
      if (value == null || value === '') continue;
      map.set(check.checkName, check);
      map.set(normalizeLabelKey(checkLabel(check.checkName)), check);
    }
    return map;
  }, [report?.systemChecks]);

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
          const aggregateLabelKey = normalizeLabelKey(field.label);
          const systemCheckName = SYSTEM_CHECK_BY_AGGREGATE_LABEL[aggregateLabelKey];
          const systemCheck =
            (systemCheckName ? systemCheckByLabel.get(systemCheckName) : null) ??
            systemCheckByLabel.get(aggregateLabelKey) ??
            null;
          const systemStatus = systemCheck ? checkRowStatus(systemCheck.status) : 'empty';
          const status = highestStatus(field.status, systemStatus);
          const displayStatus: DisplayStatus = accepted ? 'accepted' : status;
          const systemOverride = field.overrides?.find((item) => item.sourceColumn === 'system');
          // Override existente vale mesmo com valueText null (célula limpa).
          const system = systemOverride
            ? systemOverride.valueText
            : (systemCheck?.expectedValue ?? null);
          const message =
            systemStatus !== 'empty' && systemStatus !== 'match'
              ? (systemCheck?.message ?? field.message)
              : field.message;
          return { ...field, rowKey: key, status, displayStatus, accepted, system, message };
        }),
    [acceptedByRow, data?.aggregateComparison, systemCheckByLabel],
  );

  // Cross-document validation checks (the old "Cruzamento entre Documentos"
  // panel) absorbed as extra rows. Skip any whose label already appears as an
  // aggregate field so we never duplicate a field the aggregate already shows.
  const crossDocumentRows = useMemo(() => {
    const existingLabels = new Set(
      (data?.aggregateComparison ?? []).map((f) => f.label.trim().toLowerCase()),
    );
    return (report?.crossDocumentChecks ?? [])
      .filter((check) => !HIDDEN_CROSS_DOCUMENT_CHECKS.has(check.checkName))
      .map((check) => {
        const label = checkLabel(check.checkName);
        const status = checkRowStatus(check.status);
        const key = `cross:${check.checkName}:${check.id}`;
        const accepted = acceptedByRow.get(key);
        const displayStatus: DisplayStatus = accepted ? 'accepted' : status;
        return {
          rowKey: key,
          label,
          expected: check.expectedValue ?? null,
          actual: check.actualValue ?? null,
          message: check.message ?? null,
          status,
          displayStatus,
          accepted,
          normalizedLabel: label.trim().toLowerCase(),
        };
      })
      .filter((row) => row.status !== 'empty' && !existingLabels.has(row.normalizedLabel));
  }, [acceptedByRow, data?.aggregateComparison, report?.crossDocumentChecks]);

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

  const filteredCrossDocumentRows = useMemo(
    () => crossDocumentRows.filter((row) => passesFilter(row.displayStatus, filter)),
    [crossDocumentRows, filter],
  );

  const filteredItemRows = useMemo(
    () => itemRows.filter((row) => passesFilter(row.displayStatus, filter)),
    [filter, itemRows],
  );

  const counts = useMemo(() => {
    const rows = [...aggregateRows, ...crossDocumentRows, ...itemRows];
    return {
      all: rows.length,
      match: rows.filter((row) => row.displayStatus === 'match').length,
      warning: rows.filter((row) => row.displayStatus === 'warning').length,
      divergent: rows.filter((row) => row.displayStatus === 'divergent').length,
      accepted: rows.filter((row) => row.displayStatus === 'accepted').length,
    };
  }, [aggregateRows, crossDocumentRows, itemRows]);

  const manufacturerRows = useMemo(
    () =>
      itemRows
        .filter(
          (item) =>
            item.invoiceManufacturer ||
            item.plManufacturer ||
            item.espelhoManufacturer ||
            item.manufacturerMatch === false,
        )
        .map((item) => ({
          rowKey: item.rowKey,
          itemCode: item.itemCode,
          description: item.description,
          invoice: item.invoiceManufacturer ?? null,
          packingList: item.plManufacturer ?? null,
          espelho: item.espelhoManufacturer ?? null,
          status:
            item.manufacturerMatch === false
              ? ('warning' as const)
              : item.invoiceManufacturer || item.plManufacturer || item.espelhoManufacturer
                ? ('match' as const)
                : ('empty' as const),
        })),
    [itemRows],
  );

  const supplierAliasSummary = useMemo(() => {
    const aliases = data?.supplierFooterAliases ?? [];
    const espelhoSuppliers = data?.espelhoSuppliers ?? [];
    if (aliases.length === 0 && espelhoSuppliers.length === 0) return null;

    const aliasesMissingInEspelho = aliases.filter(
      (alias) => !espelhoSuppliers.some((supplier) => supplierValuesMatch(alias, supplier)),
    );
    const espelhoMissingInAliases =
      aliases.length === 0
        ? espelhoSuppliers
        : espelhoSuppliers.filter(
            (supplier) => !aliases.some((alias) => supplierValuesMatch(alias, supplier)),
          );
    const status: RowStatus =
      aliases.length > 0 &&
      espelhoSuppliers.length > 0 &&
      aliasesMissingInEspelho.length === 0 &&
      espelhoMissingInAliases.length === 0
        ? 'match'
        : 'warning';

    return {
      aliases,
      espelhoSuppliers,
      aliasesMissingInEspelho,
      espelhoMissingInAliases,
      status,
    };
  }, [data?.espelhoSuppliers, data?.supplierFooterAliases]);

  const missingComparisonDocs = useMemo(() => {
    if (!data) return [];
    const hasOperationalBl = data.hasOperationalBl ?? data.hasBl;
    return [
      !data.hasInvoice ? 'Invoice' : null,
      !data.hasPackingList ? 'Packing List' : null,
      !hasOperationalBl ? 'Bill of Lading ou Draft BL' : null,
      !data.hasEspelho ? 'Espelho' : null,
    ].filter(Boolean) as string[];
  }, [data]);
  const hasBackgroundError = Boolean((isError || error) && data);

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

  const startEditingField = (target: EditTarget) => {
    setEditTarget(target);
    setEditValue(target.currentValue ?? '');
    setEditNote('');
  };

  const submitFieldEdit = async () => {
    if (!editTarget) return;
    const key = `${editTarget.rowKey}:${editTarget.sourceColumn}`;
    setEditingKey(key);
    try {
      await api.patch(`/api/documents/process/${processId}/comparison/field`, {
        rowKey: editTarget.rowKey,
        fieldLabel: editTarget.fieldLabel,
        sourceColumn: editTarget.sourceColumn,
        value: editValue.trim() || null,
        note: editNote.trim() || null,
      });
      toast.success('Valor editado no comparativo');
      setEditTarget(null);
      setEditValue('');
      setEditNote('');
      queryClient.invalidateQueries({ queryKey: ['doc-comparison', processId] });
      queryClient.invalidateQueries({ queryKey: ['process-events', processId] });
    } catch (err: unknown) {
      toast.error(getErrorMessage(err));
    } finally {
      setEditingKey(null);
    }
  };

  const renderAcceptanceCell = (target: AcceptTarget, accepted?: ProcessEvent) => {
    if (accepted) {
      const note = accepted.description?.trim() || null;
      return (
        <div
          className="group relative space-y-1 text-xs text-primary-700"
          title={note ?? undefined}
        >
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
          {note && (
            <div
              role="tooltip"
              className="pointer-events-none absolute left-0 top-full z-20 mt-1 hidden w-max max-w-[260px] rounded-md border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 px-2.5 py-1.5 text-[11px] font-normal text-slate-700 dark:text-slate-200 shadow-lg group-hover:block group-focus-within:block"
            >
              <span className="font-semibold text-slate-500 dark:text-slate-400">
                Justificativa:
              </span>{' '}
              {note}
            </div>
          )}
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

  if ((isError || error) && !data) {
    return (
      <ErrorState message="Erro ao carregar comparativo documental." onRetry={() => refetch()} />
    );
  }

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
        <DocBadge
          label="Bill of Lading"
          available={data.hasFinalBl ?? (data.operationalBlSource !== 'draft_bl' && data.hasBl)}
          confidence={
            (data.hasFinalBl ?? (data.operationalBlSource !== 'draft_bl' && data.hasBl))
              ? (data.finalBlConfidence ?? data.blConfidence)
              : null
          }
        />
        {data.hasDraftBl && (
          <DocBadge
            label={data.operationalBlSource === 'draft_bl' ? 'Draft BL (operacional)' : 'Draft BL'}
            available={true}
            confidence={data.draftBlConfidence ?? null}
          />
        )}
        <DocBadge
          label="Espelho"
          available={!!data.hasEspelho}
          confidence={data.espelhoConfidence ?? null}
        />
      </div>

      <ExtractionCoveragePanel coverage={data.extractionCoverage} />

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

      {hasBackgroundError && (
        <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <p>Falha ao atualizar o comparativo. Exibindo a ultima leitura disponivel.</p>
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
        <div className="bg-slate-50 dark:bg-slate-900 px-4 py-3 border-b border-slate-200 dark:border-slate-600 flex items-center justify-between gap-2">
          <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <FileText className="h-4 w-4 text-primary-600" />
            Comparativo Geral - Invoice vs Packing List vs BL vs Espelho vs Sistema
          </h4>
          {!systemDataAvailable && (
            <span className="text-[11px] font-normal text-slate-400 dark:text-slate-500">
              sem dados do sistema
            </span>
          )}
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
                <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-amber-500">
                  Sistema
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
                  <StatusCell
                    value={field.invoice}
                    status={field.displayStatus}
                    sourceLabel={SOURCE_LABELS.invoice}
                    edited={field.overrides?.some((item) => item.sourceColumn === 'invoice')}
                    onEdit={() =>
                      startEditingField({
                        rowKey: field.rowKey,
                        fieldLabel: field.label,
                        sourceColumn: 'invoice',
                        currentValue: field.invoice,
                      })
                    }
                  />
                  <StatusCell
                    value={field.packingList}
                    status={field.displayStatus}
                    sourceLabel={SOURCE_LABELS.packingList}
                    edited={field.overrides?.some((item) => item.sourceColumn === 'packingList')}
                    onEdit={() =>
                      startEditingField({
                        rowKey: field.rowKey,
                        fieldLabel: field.label,
                        sourceColumn: 'packingList',
                        currentValue: field.packingList,
                      })
                    }
                  />
                  <StatusCell
                    value={field.bl}
                    status={field.displayStatus}
                    sourceLabel={SOURCE_LABELS.bl}
                    edited={field.overrides?.some((item) => item.sourceColumn === 'bl')}
                    onEdit={() =>
                      startEditingField({
                        rowKey: field.rowKey,
                        fieldLabel: field.label,
                        sourceColumn: 'bl',
                        currentValue: field.bl,
                      })
                    }
                  />
                  <StatusCell
                    value={field.espelho}
                    status={field.displayStatus}
                    sourceLabel={SOURCE_LABELS.espelho}
                    edited={field.overrides?.some((item) => item.sourceColumn === 'espelho')}
                    onEdit={() =>
                      startEditingField({
                        rowKey: field.rowKey,
                        fieldLabel: field.label,
                        sourceColumn: 'espelho',
                        currentValue: field.espelho,
                      })
                    }
                  />
                  {systemDataAvailable ? (
                    <StatusCell
                      value={field.system}
                      status={field.displayStatus}
                      sourceLabel={SOURCE_LABELS.system}
                      edited={field.overrides?.some((item) => item.sourceColumn === 'system')}
                      onEdit={() =>
                        startEditingField({
                          rowKey: field.rowKey,
                          fieldLabel: field.label,
                          sourceColumn: 'system',
                          currentValue: field.system,
                        })
                      }
                    />
                  ) : (
                    <td className="px-3 py-2.5 text-xs text-slate-300 dark:text-slate-600 italic">
                      sem dados do sistema
                    </td>
                  )}
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
              {filteredCrossDocumentRows.map((row) => (
                <tr
                  key={row.rowKey}
                  className={cn(
                    'border-b last:border-b-0',
                    row.displayStatus === 'accepted'
                      ? 'bg-primary-50/30 dark:bg-primary-950/20'
                      : row.status === 'divergent'
                        ? 'bg-danger-50/30 dark:bg-danger-950/20'
                        : row.status === 'warning'
                          ? 'bg-amber-50/30 dark:bg-amber-950/20'
                          : '',
                  )}
                >
                  <td className="px-3 py-2.5">
                    {row.displayStatus === 'accepted' && (
                      <Wrench className="h-4 w-4 text-primary-500" />
                    )}
                    {row.displayStatus === 'match' && (
                      <CheckCircle className="h-4 w-4 text-emerald-500" />
                    )}
                    {row.displayStatus === 'warning' && (
                      <AlertTriangle className="h-4 w-4 text-amber-500" />
                    )}
                    {row.displayStatus === 'divergent' && (
                      <XCircle className="h-4 w-4 text-danger-500" />
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-sm font-medium text-slate-800 dark:text-slate-100">
                    <div className="flex items-center gap-1.5">
                      <span>{row.label}</span>
                      <span
                        title="Cruzamento entre documentos (Invoice, Packing List e BL)"
                        className="inline-flex items-center rounded bg-slate-100 dark:bg-slate-700 px-1 py-0.5 text-[9px] font-semibold uppercase text-slate-500"
                      >
                        cruzamento
                      </span>
                    </div>
                  </td>
                  {/*
                    Cross-document checks compare a derived expected value against
                    what was found, not a per-document value. Render them as an
                    explicit Esperado/Encontrado pair spanning the
                    Invoice/PL/BL/Espelho/Sistema columns so a reader does not
                    misread them under the document-specific headers.
                  */}
                  <td className="px-3 py-2.5" colSpan={5}>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                      <span className="inline-flex items-center gap-1.5">
                        <span className="text-[9px] font-semibold uppercase tracking-wider text-slate-400">
                          Esperado
                        </span>
                        <span className="font-mono text-slate-700 dark:text-slate-300">
                          {row.expected ?? '-'}
                        </span>
                      </span>
                      <span className="inline-flex items-center gap-1.5">
                        <span className="text-[9px] font-semibold uppercase tracking-wider text-slate-400">
                          Encontrado
                        </span>
                        <span
                          className={cn(
                            'font-mono',
                            row.displayStatus === 'divergent'
                              ? 'text-danger-700 dark:text-danger-400 font-semibold'
                              : row.displayStatus === 'warning'
                                ? 'text-amber-700 dark:text-amber-400 font-medium'
                                : row.displayStatus === 'accepted'
                                  ? 'text-primary-700 dark:text-primary-300 font-medium'
                                  : 'text-slate-700 dark:text-slate-300',
                          )}
                        >
                          {row.actual ?? '-'}
                        </span>
                      </span>
                    </div>
                  </td>
                  <td className="px-3 py-2.5">
                    <StatusPill status={row.displayStatus} />
                  </td>
                  <td className="px-3 py-2.5 text-xs text-slate-600 dark:text-slate-400 min-w-[220px]">
                    {row.message ?? '-'}
                  </td>
                  <td className="px-3 py-2.5">
                    {renderAcceptanceCell(
                      {
                        scope: 'aggregate',
                        rowKey: row.rowKey,
                        fieldLabel: row.label,
                        previousStatus: row.status,
                      },
                      row.accepted,
                    )}
                  </td>
                </tr>
              ))}
              {filteredAggregateRows.length === 0 && filteredCrossDocumentRows.length === 0 && (
                <tr>
                  <td colSpan={10} className="px-3 py-8 text-center text-sm text-slate-400">
                    Nenhuma linha no filtro selecionado.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {(data.itemComparison ?? []).length > 0 && (
        <div className="rounded-xl border border-slate-200 dark:border-slate-600 overflow-hidden">
          <div className="bg-slate-50 dark:bg-slate-900 px-4 py-3 border-b border-slate-200 dark:border-slate-600">
            <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <Package className="h-4 w-4 text-violet-600" />
              Comparativo por Item - Invoice vs Packing List vs Espelho
            </h4>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              {(data.itemComparison ?? []).filter((i) => i.matched).length} de{' '}
              {(data.itemComparison ?? []).length} itens encontrados no Packing List
              {data.hasEspelho
                ? ` · ${(data.itemComparison ?? []).filter((i) => i.espelhoMatched).length} no Espelho`
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
                  <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                    Fabricante
                  </th>
                  <th className="px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                    Caixas
                  </th>
                  <th className="px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                    Peso Liquido
                  </th>
                  <th className="px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                    Peso Bruto
                  </th>
                  <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                    Proporcao Peso
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
                    <td className="px-3 py-2 text-xs text-slate-600 dark:text-slate-400 min-w-[180px]">
                      <div className="space-y-0.5">
                        {[
                          ['INV', item.invoiceManufacturer],
                          ['PL', item.plManufacturer],
                          ['Esp', item.espelhoManufacturer],
                        ].map(([label, value]) =>
                          value ? (
                            <div key={label} className="flex items-center gap-1">
                              <span className="rounded bg-slate-100 px-1 py-0.5 text-[9px] font-bold uppercase text-slate-500 dark:bg-slate-700">
                                {label}
                              </span>
                              <span className="truncate">{value}</span>
                            </div>
                          ) : null,
                        )}
                        {item.manufacturerMatch === false && (
                          <span className="inline-flex rounded bg-amber-50 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-amber-700">
                            revisar
                          </span>
                        )}
                      </div>
                    </td>
                    <WeightCell
                      invoice={item.invoiceBoxes}
                      pl={item.plBoxes}
                      espelho={item.espelhoBoxes}
                      hasEspelho={!!data.hasEspelho}
                      digits={0}
                    />
                    <WeightCell
                      invoice={item.invoiceNetWeight}
                      pl={item.plNetWeight}
                      espelho={item.espelhoNetWeight}
                      hasEspelho={!!data.hasEspelho}
                    />
                    <WeightCell
                      invoice={item.invoiceGrossWeight}
                      pl={item.plGrossWeight ?? item.plWeight}
                      espelho={item.espelhoGrossWeight}
                      hasEspelho={!!data.hasEspelho}
                    />
                    <td className="px-3 py-2 text-xs text-slate-600 dark:text-slate-400 min-w-[160px]">
                      {item.weightRatioMessage ? (
                        <span
                          className={cn(
                            'rounded px-1.5 py-0.5 font-semibold',
                            item.weightRatioStatus === 'divergent'
                              ? 'bg-danger-50 text-danger-700'
                              : 'bg-amber-50 text-amber-700',
                          )}
                        >
                          {item.weightRatioMessage}
                        </span>
                      ) : (
                        <span className="text-slate-300">ok</span>
                      )}
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
                    <td colSpan={18} className="px-3 py-8 text-center text-sm text-slate-400">
                      Nenhum item no filtro selecionado.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {supplierAliasSummary && (
        <div className="rounded-xl border border-slate-200 dark:border-slate-600 overflow-hidden">
          <div className="bg-slate-50 dark:bg-slate-900 px-4 py-3 border-b border-slate-200 dark:border-slate-600">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                  <FileText className="h-4 w-4 text-emerald-600" />
                  Rodape da Invoice x Espelho
                </h4>
                <p className="mt-0.5 text-xs text-slate-500">
                  Apelidos de fabricantes/fornecedores extraidos da Invoice comparados com o
                  Espelho.
                </p>
              </div>
              <StatusPill status={supplierAliasSummary.status} />
            </div>
          </div>
          <div className="grid gap-4 p-4 md:grid-cols-2">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                Apelidos no rodape da Invoice
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {supplierAliasSummary.aliases.length > 0 ? (
                  supplierAliasSummary.aliases.map((alias) => (
                    <span
                      key={alias}
                      className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700"
                    >
                      {alias}
                    </span>
                  ))
                ) : (
                  <span className="text-sm text-slate-400">Nao extraido</span>
                )}
              </div>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                Fornecedores no Espelho
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {supplierAliasSummary.espelhoSuppliers.length > 0 ? (
                  supplierAliasSummary.espelhoSuppliers.map((supplier) => (
                    <span
                      key={supplier}
                      className="rounded-full border border-cyan-200 bg-cyan-50 px-2 py-1 text-xs font-medium text-cyan-700"
                    >
                      {supplier}
                    </span>
                  ))
                ) : (
                  <span className="text-sm text-slate-400">Nao extraido</span>
                )}
              </div>
            </div>
          </div>
          {(supplierAliasSummary.aliasesMissingInEspelho.length > 0 ||
            supplierAliasSummary.espelhoMissingInAliases.length > 0) && (
            <div className="border-t border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950/30">
              {supplierAliasSummary.aliasesMissingInEspelho.length > 0 && (
                <p>
                  No rodape e nao no Espelho:{' '}
                  {supplierAliasSummary.aliasesMissingInEspelho.join(', ')}
                </p>
              )}
              {supplierAliasSummary.espelhoMissingInAliases.length > 0 && (
                <p>
                  No Espelho e nao no rodape:{' '}
                  {supplierAliasSummary.espelhoMissingInAliases.join(', ')}
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {manufacturerRows.length > 0 && (
        <div className="rounded-xl border border-slate-200 dark:border-slate-600 overflow-hidden">
          <div className="bg-slate-50 dark:bg-slate-900 px-4 py-3 border-b border-slate-200 dark:border-slate-600">
            <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <FileText className="h-4 w-4 text-emerald-600" />
              Conferencia de Fabricantes
            </h4>
            <p className="mt-0.5 text-xs text-slate-500">
              Conferencia por item entre Invoice, Packing List e Espelho.
            </p>
          </div>
          <div className="overflow-x-auto max-h-[360px] overflow-y-auto">
            <table className="min-w-[780px] w-full text-sm">
              <thead>
                <tr className="sticky top-0 bg-white shadow-[0_1px_3px_0_rgba(0,0,0,0.06)] dark:bg-slate-800">
                  <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                    Item
                  </th>
                  <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-primary-500">
                    Invoice
                  </th>
                  <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-violet-500">
                    Packing List
                  </th>
                  <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-cyan-500">
                    Espelho
                  </th>
                  <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody>
                {manufacturerRows.map((row) => (
                  <tr key={row.rowKey} className="border-t border-slate-100 dark:border-slate-700">
                    <td className="px-3 py-2">
                      <p className="font-mono text-xs text-slate-700 dark:text-slate-300">
                        {row.itemCode || '--'}
                      </p>
                      <p className="mt-0.5 max-w-[240px] truncate text-xs text-slate-400">
                        {row.description || '--'}
                      </p>
                    </td>
                    <td className="px-3 py-2 text-slate-700 dark:text-slate-300">
                      {row.invoice || '--'}
                    </td>
                    <td className="px-3 py-2 text-slate-700 dark:text-slate-300">
                      {row.packingList || '--'}
                    </td>
                    <td className="px-3 py-2 text-slate-700 dark:text-slate-300">
                      {row.espelho || '--'}
                    </td>
                    <td className="px-3 py-2">
                      <StatusPill status={row.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/*
        Single unified "sem correspondencia" section covering BOTH directions
        (PL-without-Invoice and Invoice-without-PL). Keeping both lists in one
        quadro preserves a single source of truth instead of scattering a second
        panel elsewhere.
      */}
      {((data.unmatchedPlItems ?? []).length > 0 ||
        (data.unmatchedInvoiceItems?.length ?? 0) > 0) && (
        <div className="rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50/30 dark:bg-amber-950/20 overflow-hidden">
          <div className="bg-amber-50 dark:bg-amber-950/30 px-4 py-3 border-b border-amber-200 dark:border-amber-800">
            <h4 className="text-sm font-semibold text-amber-800 flex items-center gap-2">
              <AlertTriangle className="h-4 w-4" />
              Itens sem correspondencia entre Invoice e Packing List
            </h4>
          </div>
          <div className="divide-y divide-amber-200 dark:divide-amber-800">
            {(data.unmatchedPlItems ?? []).length > 0 && (
              <UnmatchedItemsTable
                title={`Itens no Packing List sem correspondencia na Invoice (${(data.unmatchedPlItems ?? []).length})`}
                items={data.unmatchedPlItems ?? []}
              />
            )}
            {(data.unmatchedInvoiceItems?.length ?? 0) > 0 && (
              <UnmatchedItemsTable
                title={`Itens na Invoice sem correspondencia no Packing List (${data.unmatchedInvoiceItems?.length})`}
                items={data.unmatchedInvoiceItems ?? []}
              />
            )}
          </div>
        </div>
      )}

      {editTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="fixed inset-0" onClick={() => setEditTarget(null)} />
          <div className="relative z-10 w-full max-w-lg rounded-xl border border-slate-200 bg-white p-5 shadow-xl dark:border-slate-700 dark:bg-slate-800">
            <div className="mb-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                Editar comparativo
              </p>
              <h4 className="mt-1 text-base font-bold text-slate-900 dark:text-slate-100">
                {editTarget.fieldLabel} · {SOURCE_LABELS[editTarget.sourceColumn]}
              </h4>
            </div>
            <div className="space-y-3">
              <div>
                <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-400">
                  Valor
                </label>
                <textarea
                  value={editValue}
                  onChange={(event) => setEditValue(event.target.value)}
                  rows={3}
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-400">
                  Observacao
                </label>
                <textarea
                  value={editNote}
                  onChange={(event) => setEditNote(event.target.value)}
                  rows={2}
                  placeholder="Motivo da edicao"
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
                />
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setEditTarget(null)}
                className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={submitFieldEdit}
                disabled={editingKey === `${editTarget.rowKey}:${editTarget.sourceColumn}`}
                className="inline-flex items-center gap-2 rounded-lg bg-primary-600 px-3 py-2 text-sm font-semibold text-white hover:bg-primary-700 disabled:opacity-50"
              >
                {editingKey === `${editTarget.rowKey}:${editTarget.sourceColumn}` ? (
                  <LoadingSpinner size="sm" />
                ) : (
                  <Save className="h-4 w-4" />
                )}
                Salvar edicao
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Renders one direction of unmatched items. Both PL->Invoice and Invoice->PL
// lists share this table so the markup stays in sync.
function UnmatchedItemsTable({ title, items }: { title: string; items: UnmatchedItem[] }) {
  return (
    <div>
      <div className="px-4 py-2 bg-amber-50/60 dark:bg-amber-950/20">
        <h5 className="text-xs font-semibold uppercase tracking-wider text-amber-700">{title}</h5>
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
            {items.map((item, i) => (
              <tr key={i} className="border-b last:border-b-0">
                <td className="px-3 py-2 font-mono text-amber-800">{item.itemCode || '-'}</td>
                <td className="px-3 py-2 text-amber-800">{item.description || '-'}</td>
                <td className="px-3 py-2 text-right font-mono text-amber-800">{item.quantity}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
