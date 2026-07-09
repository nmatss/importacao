import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  Banknote,
  CalendarClock,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Download,
  ExternalLink,
  Eye,
  FileSpreadsheet,
  FileText,
  Filter,
  LayoutGrid,
  Landmark,
  Link2,
  Loader2,
  RefreshCw,
  Search,
  Settings,
  Table2,
  Unlink,
  X,
} from 'lucide-react';
import { api } from '@/shared/lib/api-client';
import { useApiQuery } from '@/shared/hooks/useApi';
import { useAuth } from '@/shared/hooks/useAuth';
import { EmptyState } from '@/shared/components/EmptyState';
import { ErrorState } from '@/shared/components/ErrorState';
import { LoadingSpinner } from '@/shared/components/LoadingSpinner';
import { cn, formatCurrency } from '@/shared/lib/utils';
import { getErrorMessage } from '@/shared/utils/errors';

const REFRESH_INTERVAL_MS = 10 * 60 * 1000;

/** Debounce a fast-changing value (used for free-text filters). */
function useDebouncedValue<T>(value: T, delayMs = 350): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const handle = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(handle);
  }, [value, delayMs]);
  return debounced;
}

type PaymentStatus = 'open' | 'scheduled' | 'paid' | 'overdue' | 'cancelled' | 'unknown';
type PaymentType =
  | 'deposit'
  | 'deposit_in_advance'
  | 'balance'
  | 'balance_before_shipment'
  | 'balance_after_shipment'
  | 'fee'
  | 'refund'
  | 'other';
type MatchStatus = 'matched' | 'ambiguous' | 'unmatched';

interface SydlePayment {
  id: number;
  externalId: string;
  processId: number | null;
  matchStatus: MatchStatus;
  matchScore: string | null;
  matchReason: string | null;
  sydleProtocol: string | null;
  processCode: string | null;
  purchaseRef: string | null;
  purchaseOrder: string | null;
  proformaNumber: string | null;
  invoiceNumber: string | null;
  supplierName: string | null;
  brand: string | null;
  currency: string;
  purchaseAmount: string | null;
  paidAmount: string | null;
  openAmount: string | null;
  paymentType: PaymentType;
  paymentStatus: PaymentStatus;
  dueDate: string | null;
  invoiceIssuedDate: string | null;
  taskCreatedAt: string | null;
  shipmentDate: string | null;
  paymentDeadlineAfterShipment: number | null;
  exceptionStatus: string | null;
  exceptionReason: string | null;
  paidAt: string | null;
  scheduledAt: string | null;
  exchangeRate: string | null;
  amountBrl: string | null;
  exchangeRateSource?: 'sydle' | null;
  amountBrlSource?: 'sydle' | null;
  bankName: string | null;
  contractNumber: string | null;
  remittanceId: string | null;
  sourceUpdatedAt: string | null;
  syncedAt: string;
  portalProcessCode: string | null;
  portalBrand: string | null;
  logisticStatus: string | null;
  processStatus: string | null;
}

interface SydlePaymentDetail extends SydlePayment {
  sourceSystem: string;
  rawPayload: Record<string, unknown> | null;
  createdAt: string | null;
  updatedAt: string | null;
  processExporter: string | null;
}

// Logistic phase labels — mirror @/shared/lib/constants LOGISTIC_STAGES so the
// report shows "em qual fase o processo está".
const LOGISTIC_PHASES: { key: string; label: string }[] = [
  { key: 'consolidation', label: 'Em Consolidação' },
  { key: 'waiting_shipment', label: 'Ag. Embarque' },
  { key: 'in_transit', label: 'Em Trânsito' },
  { key: 'berthing', label: 'Em Atracação' },
  { key: 'registered', label: 'Registrado' },
  { key: 'customs_inspection', label: 'Conf. Aduaneira' },
  { key: 'port_release', label: 'Lib. Portuária' },
  { key: 'waiting_loading', label: 'Ag. Carregamento' },
  { key: 'traveling_cd', label: 'Em Viagem CD' },
  { key: 'waiting_entry', label: 'Ag. Entrada' },
  { key: 'internalized', label: 'Internalizado' },
];
const phaseLabel = (status: string | null): string =>
  LOGISTIC_PHASES.find((p) => p.key === status)?.label ?? '--';

interface PaginatedResponse {
  data: SydlePayment[];
  pagination: { total: number; page: number; limit: number; pages: number };
}

interface SyncRun {
  id: number;
  status: string;
  trigger: string;
  startedAt: string;
  completedAt: string | null;
  duration: number | null;
  fetched: number | null;
  created: number | null;
  updated: number | null;
  matched: number | null;
  unmatched: number | null;
  errors: number | null;
  errorMessage: string | null;
  metadata: Record<string, unknown> | null;
}

interface SydleCurrencyBreakdown {
  currency: string;
  totalPurchase: number;
  totalPaid: number;
  totalOpen: number;
  records: number;
}

interface SydleSummary {
  totalPurchaseUsd: number;
  totalPaidUsd: number;
  totalOpenUsd: number;
  totalBrl: number;
  currencyBreakdown?: SydleCurrencyBreakdown[];
  records: number;
  matched: number;
  unmatched: number;
  overdue: number;
  dueSoon: number;
  paid: number;
  config: {
    enabled: boolean;
    configured: boolean;
    missing: string[];
    paymentsPath: string;
    pageSize: number;
  };
  lastRun: SyncRun | null;
}

const paymentStatusLabels: Record<PaymentStatus, string> = {
  open: 'Aberto',
  scheduled: 'Agendado',
  paid: 'Pago',
  overdue: 'Vencido',
  cancelled: 'Cancelado',
  unknown: 'Indefinido',
};

const paymentTypeLabels: Record<PaymentType, string> = {
  deposit: 'Deposit',
  deposit_in_advance: 'Deposit in Advance',
  balance: 'Balance',
  balance_before_shipment: 'Balance before Shipment',
  balance_after_shipment: 'Balance after Shipment',
  fee: 'Fee',
  refund: 'Refund',
  other: 'Other',
};

const matchLabels: Record<MatchStatus, string> = {
  matched: 'Conciliado',
  ambiguous: 'Ambíguo',
  unmatched: 'Sem vínculo',
};

const matchReasonLabels: Record<string, string> = {
  process_code: 'Processo',
  process_code_multiple_matches: 'Processo com múltiplos vínculos',
  purchase_ref: 'Referência da compra',
  purchase_order: 'Pedido de compra',
  proforma: 'PI',
  invoice: 'Invoice',
  supplier: 'Beneficiário',
  brand: 'Marca',
  amount: 'Valor',
  no_confident_match: 'Sem evidência suficiente',
};

const syncStatusLabels: Record<string, string> = {
  running: 'Em execução',
  success: 'Concluída',
  partial: 'Parcial',
  failed: 'Falhou',
  skipped: 'Ignorada',
};

function syncStatusLabel(status: string | null | undefined): string {
  if (!status) return 'sem dados';
  return syncStatusLabels[status] ?? status;
}

const unifiedColumns = [
  { key: 'sydleProtocol', header: 'Protocolo', width: 'w-[96px]' },
  { key: 'process', header: 'Processo', width: 'w-[140px]' },
  { key: 'phase', header: 'Fase Processo', width: 'w-[150px]' },
  { key: 'purchaseOrder', header: 'PO', width: 'w-[120px]' },
  { key: 'proformaNumber', header: 'PI', width: 'w-[120px]' },
  { key: 'invoiceNumber', header: 'Número Invoice', width: 'w-[150px]' },
  { key: 'supplierName', header: 'Beneficiário', width: 'w-[240px]' },
  { key: 'brand', header: 'Marca', width: 'w-[120px]' },
  { key: 'paymentType', header: 'Tipo de pagamento', width: 'w-[150px]' },
  { key: 'dueDate', header: 'Data de vencimento', width: 'w-[150px]' },
  { key: 'currency', header: 'Moeda de pagamento', width: 'w-[150px]' },
  { key: 'purchaseAmount', header: 'Valor a Pagar', width: 'w-[140px]', align: 'right' },
  { key: 'invoiceIssuedDate', header: 'Data de emissão Invoice/PI', width: 'w-[190px]' },
  { key: 'taskCreatedAt', header: 'Data criação da tarefa', width: 'w-[170px]' },
  { key: 'exceptionStatus', header: 'Exceção', width: 'w-[120px]' },
  { key: 'exceptionReason', header: 'Motivo da exceção', width: 'w-[220px]' },
  { key: 'shipmentDate', header: 'Data de embarque', width: 'w-[140px]' },
  {
    key: 'paymentDeadlineAfterShipment',
    header: 'Prazo para pagamento pós embarque',
    width: 'w-[210px]',
    align: 'right',
  },
  { key: 'paidAmount', header: 'Valor Pago', width: 'w-[130px]', align: 'right' },
  { key: 'openAmount', header: 'Saldo Aberto', width: 'w-[130px]', align: 'right' },
  { key: 'paymentStatus', header: 'Status Pagamento', width: 'w-[150px]' },
  { key: 'paidAt', header: 'Pago Em', width: 'w-[120px]' },
  { key: 'scheduledAt', header: 'Agendado Para', width: 'w-[140px]' },
  { key: 'exchangeRate', header: 'Taxa Câmbio', width: 'w-[120px]', align: 'right' },
  { key: 'exchangeRateSource', header: 'Origem Câmbio', width: 'w-[130px]' },
  { key: 'amountBrl', header: 'Valor BRL', width: 'w-[130px]', align: 'right' },
  { key: 'amountBrlSource', header: 'Origem BRL', width: 'w-[120px]' },
  { key: 'bankName', header: 'Banco', width: 'w-[160px]' },
  { key: 'contractNumber', header: 'Contrato', width: 'w-[130px]' },
  { key: 'remittanceId', header: 'Remessa', width: 'w-[130px]' },
  { key: 'matchStatus', header: 'Conciliação Portal', width: 'w-[150px]' },
  { key: 'matchReason', header: 'Evidência conciliação', width: 'w-[200px]' },
  { key: 'sourceUpdatedAt', header: 'Data da última alteração', width: 'w-[170px]' },
  { key: 'syncedAt', header: 'Sincronizado Em', width: 'w-[170px]' },
] as const;

type UnifiedColumn = (typeof unifiedColumns)[number];
type UnifiedColumnKey = UnifiedColumn['key'];

function sourceLabel(value: SydlePayment['exchangeRateSource'] | SydlePayment['amountBrlSource']) {
  if (value === 'sydle') return 'SYDLE';
  return '--';
}

function matchReasonLabel(value: string | null | undefined): string {
  if (!value) return '--';
  const ambiguous = value.startsWith('ambiguous:');
  const raw = ambiguous ? value.replace(/^ambiguous:/, '') : value;
  const labels = raw
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => matchReasonLabels[part] ?? part);
  if (!labels.length) return '--';
  return `${ambiguous ? 'Ambíguo: ' : ''}${labels.join(' + ')}`;
}

function textOrDash(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return '--';
  return String(value);
}

function reportProcessLabel(row: SydlePayment): string {
  return (
    row.portalProcessCode || row.processCode || row.invoiceNumber || row.proformaNumber || '--'
  );
}

function documentKind(row: SydlePayment): 'PI' | 'INV' | null {
  // O badge marca apenas o fallback: quando a coluna Processo exibe o número
  // do documento por falta de código de processo real. A ordem segue
  // reportProcessLabel (invoice antes de proforma).
  if (row.portalProcessCode || row.processCode) return null;
  if (row.invoiceNumber) return 'INV';
  if (row.proformaNumber) return 'PI';
  return null;
}

function DocumentKindBadge({ kind }: { kind: 'PI' | 'INV' | null }) {
  if (!kind) return null;
  return (
    <span
      className={cn(
        'inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-bold leading-none',
        kind === 'PI'
          ? 'border-fuchsia-200 bg-fuchsia-50 text-fuchsia-700'
          : 'border-primary-200 bg-primary-50 text-primary-700',
      )}
    >
      {kind}
    </span>
  );
}

function unifiedValue(row: SydlePayment, key: UnifiedColumnKey): React.ReactNode {
  switch (key) {
    case 'process':
      return reportProcessLabel(row);
    case 'phase':
      return row.logisticStatus ? phaseLabel(row.logisticStatus) : '--';
    case 'brand':
      return row.brand || row.portalBrand || '--';
    case 'paymentType':
      return paymentTypeLabels[row.paymentType];
    case 'paymentStatus':
      return paymentStatusLabels[row.paymentStatus];
    case 'dueDate':
      return dateLabel(row.dueDate);
    case 'invoiceIssuedDate':
      return dateLabel(row.invoiceIssuedDate);
    case 'taskCreatedAt':
      return dateTimeLabel(row.taskCreatedAt);
    case 'shipmentDate':
      return dateLabel(row.shipmentDate);
    case 'paymentDeadlineAfterShipment':
      return row.paymentDeadlineAfterShipment ?? '--';
    case 'purchaseAmount':
      return money(row.purchaseAmount, row.currency);
    case 'paidAmount':
      return money(row.paidAmount, row.currency);
    case 'openAmount':
      return money(row.openAmount, row.currency);
    case 'paidAt':
      return dateLabel(row.paidAt);
    case 'scheduledAt':
      return dateLabel(row.scheduledAt);
    case 'exchangeRate':
      return row.exchangeRate
        ? Number(row.exchangeRate).toLocaleString('pt-BR', { maximumFractionDigits: 6 })
        : '--';
    case 'exchangeRateSource':
      return sourceLabel(row.exchangeRateSource);
    case 'amountBrl':
      return money(row.amountBrl, 'BRL');
    case 'amountBrlSource':
      return sourceLabel(row.amountBrlSource);
    case 'matchStatus':
      return matchLabels[row.matchStatus];
    case 'matchReason':
      return matchReasonLabel(row.matchReason);
    case 'sourceUpdatedAt':
      return dateTimeLabel(row.sourceUpdatedAt);
    case 'syncedAt':
      return dateTimeLabel(row.syncedAt);
    default:
      return textOrDash(row[key]);
  }
}

function fullCurrency(value: number, currency = 'USD'): string {
  if (!Number.isFinite(value)) value = 0;
  return formatCurrency(value, currency);
}

function money(value: string | number | null, currency = 'USD'): string {
  if (value === null || value === undefined || value === '') return '--';
  const numeric = Number(value);
  return Number.isFinite(numeric) ? formatCurrency(numeric, currency) : '--';
}

function dateLabel(value: string | null): string {
  if (!value) return '--';
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (dateOnly) {
    const [, year, month, day] = dateOnly;
    return `${day}/${month}/${year}`;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '--';
  return parsed.toLocaleDateString('pt-BR');
}

function dateTimeLabel(value: string | Date | null | undefined): string {
  if (!value) return '--';
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) return '--';
  const parts = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(parsed);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? '';
  return `${get('day')}/${get('month')}/${get('year')} ${get('hour')}:${get('minute')}`;
}

function statusClass(status: PaymentStatus): string {
  switch (status) {
    case 'paid':
      return 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200/70';
    case 'overdue':
      return 'bg-danger-50 text-danger-700 ring-1 ring-danger-200/70';
    case 'scheduled':
      return 'bg-primary-50 text-primary-700 ring-1 ring-primary-200/70';
    case 'cancelled':
      return 'bg-slate-100 text-slate-600 ring-1 ring-slate-200/70';
    case 'open':
      return 'bg-amber-50 text-amber-700 ring-1 ring-amber-200/70';
    default:
      return 'bg-slate-100 text-slate-600 ring-1 ring-slate-200/70';
  }
}

function matchClass(status: MatchStatus): string {
  switch (status) {
    case 'matched':
      return 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200/70';
    case 'ambiguous':
      return 'bg-amber-50 text-amber-700 ring-1 ring-amber-200/70';
    default:
      return 'bg-danger-50 text-danger-700 ring-1 ring-danger-200/70';
  }
}

function Badge({ children, className }: { children: React.ReactNode; className: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold',
        className,
      )}
    >
      {children}
    </span>
  );
}

function KpiCard({
  label,
  value,
  icon: Icon,
  tone,
  title,
}: {
  label: string;
  value: string | number;
  icon: typeof Banknote;
  tone: 'blue' | 'green' | 'amber' | 'red' | 'slate';
  title?: string;
}) {
  const toneClass = {
    blue: 'bg-primary-50 text-primary-700 ring-primary-200/70',
    green: 'bg-emerald-50 text-emerald-700 ring-emerald-200/70',
    amber: 'bg-amber-50 text-amber-700 ring-amber-200/70',
    red: 'bg-danger-50 text-danger-700 ring-danger-200/70',
    slate: 'bg-slate-100 text-slate-700 ring-slate-200/70',
  }[tone];

  return (
    <div className="rounded-lg border border-slate-200/70 bg-white p-4 shadow-sm dark:border-slate-700/70 dark:bg-slate-800">
      <div className="flex items-center gap-3 min-w-0">
        <span
          className={cn(
            'flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ring-1',
            toneClass,
          )}
        >
          <Icon className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">{label}</p>
          <p
            title={title}
            className="text-base font-bold leading-tight tabular-nums text-slate-900 dark:text-slate-100"
          >
            {value}
          </p>
        </div>
      </div>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  const empty = value === null || value === undefined || value === '';
  return (
    <div className="flex justify-between gap-4 border-b border-slate-100 py-1.5 text-sm last:border-0 dark:border-slate-700/50">
      <span className="shrink-0 text-slate-500 dark:text-slate-400">{label}</span>
      <span className="break-words text-right font-medium text-slate-800 dark:text-slate-100">
        {empty ? <span className="text-slate-400">--</span> : value}
      </span>
    </div>
  );
}

function DetailSection({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon?: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-slate-200 p-4 dark:border-slate-700">
      <h4 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
        {Icon && <Icon className="h-3.5 w-3.5" />}
        {title}
      </h4>
      <div>{children}</div>
    </section>
  );
}

function PaymentDetailDrawer({ paymentId, onClose }: { paymentId: number; onClose: () => void }) {
  const { data, isLoading, isError, refetch } = useApiQuery<SydlePaymentDetail>(
    ['sydle-payment', String(paymentId)],
    `/api/sydle/payments-report/${paymentId}`,
  );

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end"
      role="dialog"
      aria-modal="true"
      aria-labelledby="sydle-payment-drawer-title"
    >
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative flex h-full w-full max-w-xl flex-col bg-white shadow-2xl dark:bg-slate-800">
        <header className="flex items-center justify-between border-b border-slate-200 px-5 py-4 dark:border-slate-700">
          <div className="min-w-0">
            <h3
              id="sydle-payment-drawer-title"
              className="text-base font-semibold text-slate-900 dark:text-slate-100"
            >
              Detalhe da compra / pagamento
            </h3>
            <p className="truncate text-xs text-slate-500 dark:text-slate-400">
              {data?.purchaseRef || data?.externalId || `#${paymentId}`}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700"
          >
            <X className="h-5 w-5" />
          </button>
        </header>
        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          {isLoading ? (
            <div className="flex justify-center py-12">
              <LoadingSpinner />
            </div>
          ) : isError || !data ? (
            <ErrorState message="Falha ao carregar o detalhe da compra." onRetry={refetch} />
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <Badge className={statusClass(data.paymentStatus)}>
                  {paymentStatusLabels[data.paymentStatus]}
                </Badge>
                <Badge className={matchClass(data.matchStatus)}>
                  {matchLabels[data.matchStatus]}
                </Badge>
                {data.logisticStatus && (
                  <span className="inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600 dark:bg-slate-700 dark:text-slate-200">
                    {phaseLabel(data.logisticStatus)}
                  </span>
                )}
              </div>

              <DetailSection title="Compra" icon={FileText}>
                <DetailRow
                  label="Processo"
                  value={
                    data.processId ? (
                      <Link
                        to={`/importacao/processos/${data.processId}`}
                        className="inline-flex items-center gap-1 text-primary-700 hover:underline dark:text-primary-300"
                      >
                        {data.portalProcessCode || data.processCode}
                        <ExternalLink className="h-3.5 w-3.5" />
                      </Link>
                    ) : (
                      data.processCode
                    )
                  }
                />
                <DetailRow
                  label="Fase do processo"
                  value={data.logisticStatus ? phaseLabel(data.logisticStatus) : null}
                />
                <DetailRow label="Protocolo SYDLE" value={data.sydleProtocol} />
                <DetailRow label="Referencia da compra" value={data.purchaseRef} />
                <DetailRow label="Pedido (PO)" value={data.purchaseOrder} />
                <DetailRow label="Proforma (PI)" value={data.proformaNumber} />
                <DetailRow label="Invoice" value={data.invoiceNumber} />
                <DetailRow label="Fornecedor" value={data.supplierName} />
                <DetailRow label="Marca" value={data.brand || data.portalBrand} />
              </DetailSection>

              <DetailSection title="Pagamento" icon={Banknote}>
                <DetailRow label="Moeda" value={data.currency} />
                <DetailRow
                  label="Valor da compra"
                  value={money(data.purchaseAmount, data.currency)}
                />
                <DetailRow label="Pago" value={money(data.paidAmount, data.currency)} />
                <DetailRow label="Em aberto" value={money(data.openAmount, data.currency)} />
                <DetailRow label="Tipo" value={paymentTypeLabels[data.paymentType]} />
                <DetailRow label="Status" value={paymentStatusLabels[data.paymentStatus]} />
                <DetailRow label="Vencimento" value={dateLabel(data.dueDate)} />
                <DetailRow label="Emissão Invoice/PI" value={dateLabel(data.invoiceIssuedDate)} />
                <DetailRow label="Criação da tarefa" value={dateTimeLabel(data.taskCreatedAt)} />
                <DetailRow label="Embarque" value={dateLabel(data.shipmentDate)} />
                <DetailRow
                  label="Prazo pós-embarque"
                  value={
                    data.paymentDeadlineAfterShipment != null
                      ? `${data.paymentDeadlineAfterShipment} dia(s)`
                      : null
                  }
                />
                <DetailRow label="Exceção" value={data.exceptionStatus} />
                <DetailRow label="Motivo da exceção" value={data.exceptionReason} />
                <DetailRow label="Pago em" value={dateLabel(data.paidAt)} />
                <DetailRow label="Agendado para" value={dateLabel(data.scheduledAt)} />
              </DetailSection>

              <DetailSection title="Cambio e banco" icon={Landmark}>
                <DetailRow
                  label="Taxa de cambio"
                  value={
                    data.exchangeRate ? (
                      <span>
                        {Number(data.exchangeRate).toLocaleString('pt-BR', {
                          maximumFractionDigits: 6,
                        })}
                      </span>
                    ) : null
                  }
                />
                <DetailRow
                  label="Valor em BRL"
                  value={data.amountBrl ? <span>{money(data.amountBrl, 'BRL')}</span> : null}
                />
                <DetailRow label="Banco" value={data.bankName} />
                <DetailRow label="Contrato" value={data.contractNumber} />
                <DetailRow label="Remessa" value={data.remittanceId} />
                {!data.bankName && !data.contractNumber && !data.remittanceId && (
                  <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
                    Dados bancários, contrato e remessa da SYDLE ainda não disponíveis — o acesso de
                    leitura às classes financeiras está pendente de liberação pela SYDLE.
                  </p>
                )}
              </DetailSection>

              <DetailSection title="Conciliacao" icon={Link2}>
                <DetailRow label="Status" value={matchLabels[data.matchStatus]} />
                <DetailRow
                  label="Confiança"
                  value={
                    data.matchScore != null
                      ? `${(Number(data.matchScore) * 100).toFixed(1)}%`
                      : null
                  }
                />
                <DetailRow label="Evidência" value={matchReasonLabel(data.matchReason)} />
              </DetailSection>

              <DetailSection title="Origem e auditoria">
                <DetailRow label="External ID" value={data.externalId} />
                <DetailRow label="Sistema" value={data.sourceSystem} />
                <DetailRow
                  label="Atualizado na SYDLE"
                  value={dateTimeLabel(data.sourceUpdatedAt)}
                />
                <DetailRow label="Sincronizado em" value={dateTimeLabel(data.syncedAt)} />
                <DetailRow label="Criado em" value={dateTimeLabel(data.createdAt)} />
              </DetailSection>

              {data.rawPayload && (
                <details className="rounded-lg border border-slate-200 dark:border-slate-700">
                  <summary className="cursor-pointer px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    Payload bruto (SYDLE)
                  </summary>
                  <pre className="max-h-80 overflow-auto border-t border-slate-200 bg-slate-50 p-3 text-[11px] leading-snug text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
                    {JSON.stringify(data.rawPayload, null, 2)}
                  </pre>
                </details>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export function SydlePaymentsPage() {
  const queryClient = useQueryClient();
  const { user, getToken } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [supplier, setSupplier] = useState('');
  const [brand, setBrand] = useState('');
  const [currency, setCurrency] = useState('');
  const [logisticStatus, setLogisticStatus] = useState('');
  const [dueBucket, setDueBucket] = useState('');
  const [paymentStatus, setPaymentStatus] = useState('');
  const [paymentType, setPaymentType] = useState('');
  const [matchStatus, setMatchStatus] = useState('');
  const [dueFrom, setDueFrom] = useState('');
  const [dueTo, setDueTo] = useState('');
  const [updatedFrom, setUpdatedFrom] = useState('');
  const [updatedTo, setUpdatedTo] = useState('');
  const [sortBy, setSortBy] = useState<
    'dueDate' | 'sourceUpdatedAt' | 'purchaseAmount' | 'paidAmount' | 'openAmount' | 'supplierName'
  >('dueDate');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
  const [syncing, setSyncing] = useState(false);
  const [exporting, setExporting] = useState<'csv' | 'xlsx' | 'pdf' | null>(null);
  const [viewMode, setViewMode] = useState<'table' | 'cards'>('table');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const limit = 50;

  // Debounce the free-text filters so we don't fire a request per keystroke.
  const debouncedSearch = useDebouncedValue(search, 350);
  const debouncedSupplier = useDebouncedValue(supplier, 350);

  function toggleSort(column: typeof sortBy) {
    if (sortBy === column) {
      setSortOrder((current) => (current === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortBy(column);
      setSortOrder('asc');
    }
    setPage(1);
  }

  const queryParams = useMemo(() => {
    const params = new URLSearchParams();
    params.set('page', String(page));
    params.set('limit', String(limit));
    params.set('sortBy', sortBy);
    params.set('sortOrder', sortOrder);
    if (debouncedSearch) params.set('search', debouncedSearch);
    if (debouncedSupplier) params.set('supplier', debouncedSupplier);
    if (brand) params.set('brand', brand);
    if (currency) params.set('currency', currency);
    if (logisticStatus) params.set('logisticStatus', logisticStatus);
    if (dueBucket) params.set('dueBucket', dueBucket);
    if (paymentStatus) params.set('paymentStatus', paymentStatus);
    if (paymentType) params.set('paymentType', paymentType);
    if (matchStatus) params.set('matchStatus', matchStatus);
    if (dueFrom) params.set('dueFrom', dueFrom);
    if (dueTo) params.set('dueTo', dueTo);
    if (updatedFrom) params.set('updatedFrom', updatedFrom);
    if (updatedTo) params.set('updatedTo', updatedTo);
    return params;
  }, [
    brand,
    currency,
    logisticStatus,
    dueBucket,
    dueFrom,
    dueTo,
    matchStatus,
    page,
    paymentStatus,
    paymentType,
    debouncedSearch,
    debouncedSupplier,
    sortBy,
    sortOrder,
    updatedFrom,
    updatedTo,
  ]);

  const summaryParams = useMemo(() => {
    const params = new URLSearchParams(queryParams);
    params.delete('page');
    params.delete('limit');
    return params;
  }, [queryParams]);

  const reportUrl = `/api/sydle/payments-report?${queryParams.toString()}`;
  const summaryUrl = `/api/sydle/payments-report/summary?${summaryParams.toString()}`;

  const {
    data: report,
    isLoading,
    error,
    refetch,
  } = useApiQuery<PaginatedResponse>(['sydle-payments', queryParams.toString()], reportUrl, {
    enabled: Boolean(user),
    refetchInterval: user ? REFRESH_INTERVAL_MS : false,
  });

  const { data: summary } = useApiQuery<SydleSummary>(
    ['sydle-payments-summary', summaryParams.toString()],
    summaryUrl,
    { enabled: Boolean(user), refetchInterval: user ? REFRESH_INTERVAL_MS : false },
  );

  const { data: syncRuns } = useApiQuery<SyncRun[]>(
    ['sydle-sync-runs'],
    '/api/sydle/sync-runs?limit=5',
    { enabled: isAdmin, refetchInterval: isAdmin ? REFRESH_INTERVAL_MS : false },
  );

  const rows = report?.data ?? [];
  const pagination = report?.pagination;
  const hasFilters =
    search ||
    supplier ||
    brand ||
    currency ||
    logisticStatus ||
    dueBucket ||
    paymentStatus ||
    paymentType ||
    matchStatus ||
    dueFrom ||
    dueTo ||
    updatedFrom ||
    updatedTo;

  function resetPageAnd(setter: (value: string) => void, value: string) {
    setter(value);
    setPage(1);
  }

  function clearFilters() {
    setSearch('');
    setSupplier('');
    setBrand('');
    setCurrency('');
    setLogisticStatus('');
    setDueBucket('');
    setPaymentStatus('');
    setPaymentType('');
    setMatchStatus('');
    setDueFrom('');
    setDueTo('');
    setUpdatedFrom('');
    setUpdatedTo('');
    setPage(1);
  }

  async function handleSyncNow() {
    setSyncing(true);
    try {
      const result = await api.post<SyncRun>('/api/sydle/sync-now');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['sydle-payments'] }),
        queryClient.invalidateQueries({ queryKey: ['sydle-payments-summary'] }),
        queryClient.invalidateQueries({ queryKey: ['sydle-sync-runs'] }),
      ]);
      toast.success(
        result.status === 'skipped'
          ? 'Sincronização SYDLE ignorada: configuração pendente.'
          : 'Sincronização SYDLE concluída.',
      );
    } catch (err: unknown) {
      toast.error(getErrorMessage(err));
    } finally {
      setSyncing(false);
    }
  }

  async function handleExport(format: 'csv' | 'xlsx' | 'pdf') {
    setExporting(format);
    try {
      const params = new URLSearchParams(summaryParams);
      const baseUrl = import.meta.env.VITE_API_URL || '';
      const response = await fetch(
        `${baseUrl}/api/sydle/payments-report/export.${format}?${params.toString()}`,
        {
          headers: {
            Authorization: `Bearer ${getToken() ?? ''}`,
          },
        },
      );
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `sydle-compras-pagamentos-${new Date().toISOString().slice(0, 10)}.${format}`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      toast.success(`Relatório SYDLE exportado em ${format.toUpperCase()}.`);
    } catch (err: unknown) {
      toast.error(getErrorMessage(err));
    } finally {
      setExporting(null);
    }
  }

  if (isLoading && !report) {
    return <LoadingSpinner className="py-24" size="lg" />;
  }

  if (error) {
    const msg = getErrorMessage(error);
    const isForbidden = /403|forbidden|permiss/i.test(msg);
    return (
      <ErrorState
        message={
          isForbidden
            ? 'Acesso negado ao relatório SYDLE. A credencial de integração pode ter expirado ou perdido permissão — verifique SYDLE_USER/SYDLE_PASSWORD ou contate o administrador.'
            : `Erro ao carregar relatório SYDLE. ${msg}`
        }
        onRetry={() => refetch()}
      />
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary-50 text-primary-700 ring-1 ring-primary-200/70">
              <Banknote className="h-5 w-5" />
            </span>
            <div>
              <h2 className="text-xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
                Compras e Pagamentos Internacionais
              </h2>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                Relatório financeiro sincronizado da SYDLE a cada 10 minutos.
              </p>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => handleExport('csv')}
            disabled={exporting !== null || !rows.length}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm transition-colors hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
          >
            {exporting === 'csv' ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Download className="h-4 w-4" />
            )}
            CSV
          </button>
          <button
            type="button"
            onClick={() => handleExport('xlsx')}
            disabled={exporting !== null || !rows.length}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm transition-colors hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
          >
            {exporting === 'xlsx' ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <FileSpreadsheet className="h-4 w-4" />
            )}
            Excel
          </button>
          <button
            type="button"
            onClick={() => handleExport('pdf')}
            disabled={exporting !== null || !rows.length}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm transition-colors hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
          >
            {exporting === 'pdf' ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <FileText className="h-4 w-4" />
            )}
            PDF
          </button>
          {isAdmin && (
            <button
              type="button"
              onClick={handleSyncNow}
              disabled={syncing}
              className="inline-flex items-center gap-2 rounded-lg bg-primary-600 px-3 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-primary-700 disabled:opacity-50"
            >
              {syncing ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
              {syncing ? 'Sincronizando' : 'Sincronizar'}
            </button>
          )}
        </div>
      </div>

      {isAdmin && summary && !summary.config.configured && (
        <div className="flex flex-col gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <Settings className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <p className="font-semibold">Integração SYDLE aguardando configuração</p>
              <p className="mt-0.5">
                Pendentes: {summary.config.missing.join(', ') || 'contrato da SYDLE'}.
              </p>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <KpiCard
          label="Comprado USD"
          value={fullCurrency(summary?.totalPurchaseUsd ?? 0)}
          icon={Banknote}
          tone="blue"
        />
        <KpiCard
          label="Pago USD"
          value={fullCurrency(summary?.totalPaidUsd ?? 0)}
          icon={CheckCircle2}
          tone="green"
        />
        <KpiCard
          label="Aberto USD"
          value={fullCurrency(summary?.totalOpenUsd ?? 0)}
          icon={CalendarClock}
          tone="amber"
        />
        <KpiCard
          label="Vencidos"
          value={summary?.overdue ?? 0}
          icon={AlertTriangle}
          tone={(summary?.overdue ?? 0) > 0 ? 'red' : 'slate'}
        />
        <KpiCard
          label="Conciliados"
          value={`${summary?.matched ?? 0}/${summary?.records ?? 0}`}
          icon={Link2}
          tone="green"
        />
        <KpiCard
          label="Abertos 7 dias"
          value={summary?.dueSoon ?? 0}
          icon={CalendarClock}
          tone="amber"
        />
      </div>

      {summary && summary.records > 0 && (summary.totalBrl ?? 0) === 0 && (
        <div className="flex items-start gap-3 rounded-lg border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-800 dark:border-sky-900/50 dark:bg-sky-950/30 dark:text-sky-200">
          <Landmark className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <p className="font-semibold">Bloco financeiro da SYDLE pendente de liberação</p>
            <p className="mt-0.5">
              Banco, contrato de câmbio e remessa vivem em classes da SYDLE sem acesso de leitura
              (403). Câmbio/BRL só aparecem quando a própria SYDLE fornece esses campos.
            </p>
          </div>
        </div>
      )}

      {/* Per-currency breakdown: the KPIs above only total USD, so any EUR/CNY
          (or other) payments would otherwise be invisible in the report. */}
      {(summary?.currencyBreakdown?.filter((c) => c.currency !== 'USD').length ?? 0) > 0 && (
        <div className="rounded-lg border border-slate-200/70 bg-white p-4 shadow-sm dark:border-slate-700/70 dark:bg-slate-800">
          <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-200">
            <Banknote className="h-4 w-4" />
            Totais por moeda
          </div>
          <div className="flex flex-wrap gap-3 text-xs">
            {summary?.currencyBreakdown?.map((c) => (
              <div
                key={c.currency}
                className="rounded-md border border-slate-200 px-3 py-2 dark:border-slate-700"
              >
                <span className="font-semibold text-slate-700 dark:text-slate-200">
                  {c.currency}
                </span>{' '}
                <span className="text-slate-500 dark:text-slate-400">
                  Comprado {c.totalPurchase.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} ·
                  Aberto {c.totalOpen.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} ·{' '}
                  {c.records} parcela(s)
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="rounded-lg border border-slate-200/70 bg-white p-4 shadow-sm dark:border-slate-700/70 dark:bg-slate-800">
        <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-200">
          <Filter className="h-4 w-4" />
          Filtros
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-10">
          <label className="xl:col-span-2">
            <span className="mb-1 block text-xs font-medium text-slate-500">Busca</span>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                value={search}
                onChange={(event) => resetPageAnd(setSearch, event.target.value)}
                className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm text-slate-700 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                placeholder="Processo, protocolo, PI, invoice..."
              />
            </div>
          </label>
          <label className="xl:col-span-2">
            <span className="mb-1 block text-xs font-medium text-slate-500">Fornecedor</span>
            <input
              value={supplier}
              onChange={(event) => resetPageAnd(setSupplier, event.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
              placeholder="Nome do fornecedor"
            />
          </label>
          <label>
            <span className="mb-1 block text-xs font-medium text-slate-500">Marca</span>
            <select
              value={brand}
              onChange={(event) => resetPageAnd(setBrand, event.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
            >
              <option value="">Todas</option>
              <option value="puket">Puket</option>
              <option value="imaginarium">Imaginarium</option>
            </select>
          </label>
          <label>
            <span className="mb-1 block text-xs font-medium text-slate-500">Status</span>
            <select
              value={paymentStatus}
              onChange={(event) => resetPageAnd(setPaymentStatus, event.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
            >
              <option value="">Todos</option>
              {Object.entries(paymentStatusLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="mb-1 block text-xs font-medium text-slate-500">Tipo</span>
            <select
              value={paymentType}
              onChange={(event) => resetPageAnd(setPaymentType, event.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
            >
              <option value="">Todos</option>
              {Object.entries(paymentTypeLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="mb-1 block text-xs font-medium text-slate-500">Conciliação</span>
            <select
              value={matchStatus}
              onChange={(event) => resetPageAnd(setMatchStatus, event.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
            >
              <option value="">Todas</option>
              {Object.entries(matchLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="xl:col-span-2">
            <span className="mb-1 block text-xs font-medium text-slate-500">Fase do processo</span>
            <select
              value={logisticStatus}
              onChange={(event) => resetPageAnd(setLogisticStatus, event.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
            >
              <option value="">Todas</option>
              {LOGISTIC_PHASES.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="mb-1 block text-xs font-medium text-slate-500">Moeda</span>
            <input
              value={currency}
              onChange={(event) => resetPageAnd(setCurrency, event.target.value.toUpperCase())}
              maxLength={3}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm uppercase text-slate-700 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
              placeholder="USD"
            />
          </label>
          <label>
            <span className="mb-1 block text-xs font-medium text-slate-500">Venc. início</span>
            <input
              type="date"
              value={dueFrom}
              onChange={(event) => resetPageAnd(setDueFrom, event.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
            />
          </label>
          <label>
            <span className="mb-1 block text-xs font-medium text-slate-500">Venc. fim</span>
            <input
              type="date"
              value={dueTo}
              onChange={(event) => resetPageAnd(setDueTo, event.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
            />
          </label>
          <label>
            <span className="mb-1 block text-xs font-medium text-slate-500">Atual. início</span>
            <input
              type="date"
              value={updatedFrom}
              onChange={(event) => resetPageAnd(setUpdatedFrom, event.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
            />
          </label>
          <label>
            <span className="mb-1 block text-xs font-medium text-slate-500">Atual. fim</span>
            <input
              type="date"
              value={updatedTo}
              onChange={(event) => resetPageAnd(setUpdatedTo, event.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
            />
          </label>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-slate-500">Vencimento:</span>
          {(
            [
              { key: 'overdue', label: 'Vencidos' },
              { key: 'due7', label: 'Vence em 7 dias' },
              { key: 'due30', label: 'Vence em 30 dias' },
            ] as const
          ).map((b) => (
            <button
              key={b.key}
              type="button"
              onClick={() => resetPageAnd(setDueBucket, dueBucket === b.key ? '' : b.key)}
              className={
                dueBucket === b.key
                  ? 'rounded-full bg-primary-600 px-3 py-1 text-xs font-semibold text-white'
                  : 'rounded-full border border-slate-200 px-3 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-900'
              }
            >
              {b.label}
            </button>
          ))}
        </div>
        {hasFilters && (
          <button
            type="button"
            onClick={clearFilters}
            className="mt-3 inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold text-primary-700 hover:bg-primary-50 dark:text-primary-300 dark:hover:bg-primary-950/30"
          >
            <X className="h-4 w-4" />
            Limpar filtros
          </button>
        )}
      </div>

      <div className="flex flex-col gap-2 rounded-lg border border-slate-200/70 bg-white px-4 py-3 text-sm text-slate-600 shadow-sm dark:border-slate-700/70 dark:bg-slate-800 dark:text-slate-300 sm:flex-row sm:items-center sm:justify-between">
        <span>
          Última sync:{' '}
          <strong className="text-slate-900 dark:text-slate-100">
            {summary?.lastRun?.startedAt
              ? dateTimeLabel(summary.lastRun.startedAt)
              : 'sem execução'}
          </strong>
        </span>
        <span>
          Status:{' '}
          <strong className="text-slate-900 dark:text-slate-100">
            {syncStatusLabel(summary?.lastRun?.status)}
          </strong>
        </span>
      </div>

      <div className="flex flex-col gap-3 rounded-lg border border-slate-200/70 bg-white px-4 py-3 shadow-sm dark:border-slate-700/70 dark:bg-slate-800 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">
            Visão do relatório
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {pagination?.total ?? rows.length} registro(s) no filtro atual
          </p>
        </div>
        <div className="inline-flex w-fit rounded-lg border border-slate-200 bg-slate-50 p-1 dark:border-slate-700 dark:bg-slate-900">
          <button
            type="button"
            onClick={() => setViewMode('table')}
            className={cn(
              'inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-semibold transition-colors',
              viewMode === 'table'
                ? 'bg-white text-primary-700 shadow-sm dark:bg-slate-800 dark:text-primary-300'
                : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200',
            )}
          >
            <Table2 className="h-4 w-4" />
            Tabela
          </button>
          <button
            type="button"
            onClick={() => setViewMode('cards')}
            className={cn(
              'inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-semibold transition-colors',
              viewMode === 'cards'
                ? 'bg-white text-primary-700 shadow-sm dark:bg-slate-800 dark:text-primary-300'
                : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200',
            )}
          >
            <LayoutGrid className="h-4 w-4" />
            Cards
          </button>
        </div>
      </div>

      {!rows.length ? (
        <EmptyState
          icon={Unlink}
          title="Nenhum pagamento SYDLE encontrado"
          description={
            hasFilters
              ? 'Nenhum registro atende aos filtros atuais.'
              : 'A sincronização ainda não trouxe dados ou a integração está aguardando configuração.'
          }
        />
      ) : (
        <>
          <div
            className={cn(
              'overflow-hidden rounded-lg border border-slate-200/70 bg-white shadow-sm dark:border-slate-700/70 dark:bg-slate-800',
              viewMode === 'table' ? 'block' : 'hidden',
            )}
          >
            <div className="overflow-x-auto">
              <table className="min-w-[1800px] w-full divide-y divide-slate-200 dark:divide-slate-700">
                <thead className="sticky top-0 z-10 bg-slate-50 dark:bg-slate-900">
                  <tr>
                    {(
                      [
                        { label: 'Processo' },
                        { label: 'Fase' },
                        { label: 'Compra' },
                        { label: 'Fornecedor', sort: 'supplierName' },
                        { label: 'Tipo' },
                        { label: 'Status' },
                        { label: 'Valor', sort: 'purchaseAmount' },
                        { label: 'Pago', sort: 'paidAmount' },
                        { label: 'Saldo', sort: 'openAmount' },
                        { label: 'Vencimento', sort: 'dueDate' },
                        { label: 'Câmbio/BRL' },
                        { label: 'Banco' },
                        { label: 'Contrato' },
                        { label: 'Conciliação' },
                        { label: 'Atualização', sort: 'sourceUpdatedAt' },
                      ] as const
                    ).map((col) => (
                      <th
                        key={col.label}
                        className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400"
                      >
                        {'sort' in col && col.sort ? (
                          <button
                            type="button"
                            onClick={() => toggleSort(col.sort)}
                            className="inline-flex items-center gap-1 hover:text-slate-800 dark:hover:text-slate-200"
                          >
                            {col.label}
                            <span className="text-slate-400">
                              {sortBy === col.sort ? (sortOrder === 'asc' ? '▲' : '▼') : '↕'}
                            </span>
                          </button>
                        ) : (
                          col.label
                        )}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                  {rows.map((row) => {
                    const referenceLabel = reportProcessLabel(row);
                    const kind = documentKind(row);
                    return (
                      <tr
                        key={row.id}
                        onClick={() => setSelectedId(row.id)}
                        title="Ver detalhes da compra"
                        className="cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-900/60"
                      >
                        <td className="px-4 py-3 text-sm font-semibold text-slate-900 dark:text-slate-100">
                          {row.processId ? (
                            <Link
                              to={`/importacao/processos/${row.processId}`}
                              onClick={(e) => e.stopPropagation()}
                              className="inline-flex items-center gap-1.5 text-primary-700 hover:underline dark:text-primary-300"
                            >
                              {referenceLabel}
                              <ExternalLink className="h-3.5 w-3.5" />
                            </Link>
                          ) : (
                            <span className="inline-flex items-center gap-1.5">
                              <span>{referenceLabel}</span>
                              <DocumentKindBadge kind={kind} />
                            </span>
                          )}
                          {row.processId && (
                            <span className="ml-1.5 inline-flex align-middle">
                              <DocumentKindBadge kind={kind} />
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-sm text-slate-700 dark:text-slate-300">
                          {row.logisticStatus ? (
                            <span className="inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600 dark:bg-slate-700 dark:text-slate-200">
                              {phaseLabel(row.logisticStatus)}
                            </span>
                          ) : (
                            <span className="text-xs text-slate-400">--</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-sm text-slate-700 dark:text-slate-300">
                          <div className="font-medium">
                            {row.purchaseRef || row.purchaseOrder || '--'}
                          </div>
                          <div className="text-xs text-slate-400">
                            PI {row.proformaNumber || '--'} · INV {row.invoiceNumber || '--'}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-sm text-slate-700 dark:text-slate-300">
                          <div className="max-w-[260px] truncate">{row.supplierName || '--'}</div>
                          <div className="text-xs uppercase text-slate-400">
                            {row.brand || row.portalBrand || '--'}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-sm text-slate-700 dark:text-slate-300">
                          {paymentTypeLabels[row.paymentType]}
                        </td>
                        <td className="px-4 py-3">
                          <Badge className={statusClass(row.paymentStatus)}>
                            {paymentStatusLabels[row.paymentStatus]}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 text-sm font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                          {money(row.purchaseAmount, row.currency)}
                        </td>
                        <td className="px-4 py-3 text-sm tabular-nums text-slate-700 dark:text-slate-300">
                          {money(row.paidAmount, row.currency)}
                        </td>
                        <td className="px-4 py-3 text-sm tabular-nums text-slate-700 dark:text-slate-300">
                          {money(row.openAmount, row.currency)}
                        </td>
                        <td className="px-4 py-3 text-sm text-slate-700 dark:text-slate-300">
                          {dateLabel(row.dueDate)}
                        </td>
                        <td className="px-4 py-3 text-sm tabular-nums text-slate-700 dark:text-slate-300">
                          <div>
                            {row.exchangeRate
                              ? `Taxa ${Number(row.exchangeRate).toLocaleString('pt-BR', { maximumFractionDigits: 4 })}`
                              : '--'}
                          </div>
                          <div className="text-xs text-slate-400">
                            {money(row.amountBrl, 'BRL')}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-sm text-slate-700 dark:text-slate-300">
                          <div className="max-w-[180px] truncate">{row.bankName || '--'}</div>
                          <div className="text-xs text-slate-400">
                            {row.paidAt
                              ? `Pago ${dateLabel(row.paidAt)}`
                              : row.scheduledAt
                                ? `Ag. ${dateLabel(row.scheduledAt)}`
                                : '--'}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-sm text-slate-700 dark:text-slate-300">
                          <div className="max-w-[150px] truncate">{row.contractNumber || '--'}</div>
                          <div className="text-xs text-slate-400">
                            Remessa {row.remittanceId || '--'}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <Badge className={matchClass(row.matchStatus)}>
                            {matchLabels[row.matchStatus]}
                          </Badge>
                          {row.matchReason && (
                            <div
                              className="mt-1 max-w-[220px] truncate text-xs text-slate-500 dark:text-slate-400"
                              title={row.matchReason}
                            >
                              {matchReasonLabel(row.matchReason)}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3 text-xs text-slate-500 dark:text-slate-400">
                          <div className="flex items-center justify-between gap-2">
                            <div>
                              <div>SYDLE {dateTimeLabel(row.sourceUpdatedAt)}</div>
                              <div>Portal {dateTimeLabel(row.syncedAt)}</div>
                            </div>
                            <Eye className="h-4 w-4 shrink-0 text-slate-400" />
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                {summary && (
                  <tfoot className="border-t-2 border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-900">
                    <tr className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                      <td
                        colSpan={6}
                        className="px-4 py-3 text-right text-xs uppercase tracking-wider text-slate-500"
                      >
                        Totais USD · filtro atual ({summary.records})
                      </td>
                      <td className="px-4 py-3 tabular-nums">
                        {fullCurrency(summary.totalPurchaseUsd)}
                      </td>
                      <td className="px-4 py-3 tabular-nums">
                        {fullCurrency(summary.totalPaidUsd)}
                      </td>
                      <td className="px-4 py-3 tabular-nums">
                        {fullCurrency(summary.totalOpenUsd)}
                      </td>
                      <td colSpan={2} className="px-4 py-3 text-xs font-normal text-slate-500">
                        {summary.totalBrl > 0 && `BRL ${fullCurrency(summary.totalBrl, 'BRL')}`}
                      </td>
                      <td colSpan={4} />
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>

          <div className={cn('space-y-3', viewMode === 'cards' ? 'block' : 'hidden')}>
            {rows.map((row) => {
              const referenceLabel = reportProcessLabel(row);
              const kind = documentKind(row);
              return (
                <div
                  key={row.id}
                  onClick={() => setSelectedId(row.id)}
                  className="cursor-pointer rounded-lg border border-slate-200/70 bg-white p-4 shadow-sm dark:border-slate-700/70 dark:bg-slate-800"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold text-slate-900 dark:text-slate-100">
                        <span className="inline-flex min-w-0 items-center gap-1.5">
                          <span className="truncate">
                            {referenceLabel || row.purchaseRef || row.externalId}
                          </span>
                          <DocumentKindBadge kind={kind} />
                        </span>
                      </p>
                      <p className="mt-0.5 truncate text-xs text-slate-500">
                        {row.supplierName || '--'}
                      </p>
                    </div>
                    <Badge className={statusClass(row.paymentStatus)}>
                      {paymentStatusLabels[row.paymentStatus]}
                    </Badge>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <span className="block text-xs text-slate-500">Compra</span>
                      <span className="font-medium text-slate-800 dark:text-slate-200">
                        {row.purchaseRef || row.purchaseOrder || '--'}
                      </span>
                    </div>
                    <div>
                      <span className="block text-xs text-slate-500">Tipo</span>
                      <span className="font-medium text-slate-800 dark:text-slate-200">
                        {paymentTypeLabels[row.paymentType]}
                      </span>
                    </div>
                    <div>
                      <span className="block text-xs text-slate-500">Valor</span>
                      <span className="font-semibold text-slate-900 dark:text-slate-100">
                        {money(row.purchaseAmount, row.currency)}
                      </span>
                    </div>
                    <div>
                      <span className="block text-xs text-slate-500">Pago</span>
                      <span className="font-semibold text-slate-900 dark:text-slate-100">
                        {money(row.paidAmount, row.currency)}
                      </span>
                    </div>
                    <div>
                      <span className="block text-xs text-slate-500">Saldo</span>
                      <span className="font-semibold text-slate-900 dark:text-slate-100">
                        {money(row.openAmount, row.currency)}
                      </span>
                    </div>
                    <div>
                      <span className="block text-xs text-slate-500">Vencimento</span>
                      <span className="font-medium text-slate-800 dark:text-slate-200">
                        {dateLabel(row.dueDate)}
                      </span>
                    </div>
                    <div>
                      <span className="block text-xs text-slate-500">BRL</span>
                      <span className="font-medium text-slate-800 dark:text-slate-200">
                        {money(row.amountBrl, 'BRL')}
                      </span>
                    </div>
                    <div>
                      <span className="block text-xs text-slate-500">Banco</span>
                      <span className="font-medium text-slate-800 dark:text-slate-200">
                        {row.bankName || '--'}
                      </span>
                    </div>
                    <div>
                      <span className="block text-xs text-slate-500">Contrato</span>
                      <span className="font-medium text-slate-800 dark:text-slate-200">
                        {row.contractNumber || row.remittanceId || '--'}
                      </span>
                    </div>
                  </div>
                  {row.matchReason && (
                    <p className="mt-3 line-clamp-2 text-xs text-slate-500">
                      Evidência: {matchReasonLabel(row.matchReason)}
                    </p>
                  )}
                  <p className="mt-2 text-xs text-slate-500">
                    SYDLE {dateTimeLabel(row.sourceUpdatedAt)} · Portal{' '}
                    {dateTimeLabel(row.syncedAt)}
                  </p>
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                    <Badge className={matchClass(row.matchStatus)}>
                      {matchLabels[row.matchStatus]}
                    </Badge>
                    {row.processId && (
                      <Link
                        to={`/importacao/processos/${row.processId}`}
                        onClick={(e) => e.stopPropagation()}
                        className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary-700 dark:text-primary-300"
                      >
                        Abrir processo
                        <ExternalLink className="h-3.5 w-3.5" />
                      </Link>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <section className="overflow-hidden rounded-lg border border-slate-200/70 bg-white shadow-sm dark:border-slate-700/70 dark:bg-slate-800">
            <header className="flex flex-col gap-2 border-b border-slate-200 bg-slate-50 px-4 py-3 dark:border-slate-700 dark:bg-slate-900 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-2">
                <FileSpreadsheet className="h-4 w-4 text-primary-600 dark:text-primary-300" />
                <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                  Visão unificada SYDLE
                </h3>
              </div>
              <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                {rows.length} de {pagination?.total ?? rows.length} registro(s)
              </span>
            </header>
            <div className="overflow-x-auto">
              <table className="min-w-[5600px] w-full table-fixed divide-y divide-slate-200 text-xs dark:divide-slate-700">
                <thead className="sticky top-0 z-10 bg-slate-100 dark:bg-slate-900">
                  <tr>
                    {unifiedColumns.map((column) => {
                      const alignRight = 'align' in column && column.align === 'right';
                      return (
                        <th
                          key={column.key}
                          className={cn(
                            'px-3 py-2 text-left font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400',
                            column.width,
                            alignRight && 'text-right',
                          )}
                        >
                          {column.header}
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                  {rows.map((row) => (
                    <tr
                      key={`unified-${row.id}`}
                      onClick={() => setSelectedId(row.id)}
                      title="Ver detalhes da compra"
                      className="cursor-pointer odd:bg-white even:bg-slate-50/70 hover:bg-primary-50/60 dark:odd:bg-slate-800 dark:even:bg-slate-900/50 dark:hover:bg-primary-950/20"
                    >
                      {unifiedColumns.map((column) => {
                        const alignRight = 'align' in column && column.align === 'right';
                        const cellValue = unifiedValue(row, column.key);
                        const title =
                          typeof cellValue === 'string' || typeof cellValue === 'number'
                            ? String(cellValue)
                            : undefined;
                        return (
                          <td
                            key={`${row.id}-${column.key}`}
                            title={title}
                            className={cn(
                              'px-3 py-2 align-top text-slate-700 dark:text-slate-300',
                              column.width,
                              alignRight && 'text-right tabular-nums',
                            )}
                          >
                            <span className="block truncate">{cellValue}</span>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      {pagination && pagination.pages > 1 && (
        <div className="flex items-center justify-between rounded-lg border border-slate-200/70 bg-white px-4 py-3 text-sm shadow-sm dark:border-slate-700/70 dark:bg-slate-800">
          <span className="text-slate-500">
            Página {pagination.page} de {pagination.pages} · {pagination.total} registros
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPage((current) => Math.max(1, current - 1))}
              disabled={page <= 1}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-2 font-semibold text-slate-700 disabled:opacity-50 dark:border-slate-700 dark:text-slate-200"
            >
              <ChevronLeft className="h-4 w-4" />
              Anterior
            </button>
            <button
              type="button"
              onClick={() => setPage((current) => Math.min(pagination.pages, current + 1))}
              disabled={page >= pagination.pages}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-2 font-semibold text-slate-700 disabled:opacity-50 dark:border-slate-700 dark:text-slate-200"
            >
              Próxima
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {syncRuns?.length ? (
        <div className="rounded-lg border border-slate-200/70 bg-white p-4 shadow-sm dark:border-slate-700/70 dark:bg-slate-800">
          <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">
            Histórico recente de sync
          </h3>
          <div className="mt-3 grid gap-2">
            {syncRuns.map((run) => (
              <div
                key={run.id}
                className="flex flex-col gap-1 rounded-lg bg-slate-50 px-3 py-2 text-sm dark:bg-slate-900 sm:flex-row sm:items-center sm:justify-between"
              >
                <span className="font-medium text-slate-800 dark:text-slate-200">
                  #{run.id} · {syncStatusLabel(run.status)} · {dateTimeLabel(run.startedAt)}
                </span>
                <span className="text-xs text-slate-500">
                  {run.fetched ?? 0} lidos · {run.created ?? 0} novos · {run.updated ?? 0}{' '}
                  atualizados · {run.errors ?? 0} erros
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {selectedId != null && (
        <PaymentDetailDrawer paymentId={selectedId} onClose={() => setSelectedId(null)} />
      )}
    </div>
  );
}
