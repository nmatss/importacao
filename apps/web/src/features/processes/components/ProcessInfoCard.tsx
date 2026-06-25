import {
  Package,
  Building,
  User,
  Anchor,
  Ship,
  Globe,
  Banknote,
  Truck,
  Box,
  Weight,
  CalendarDays,
  StickyNote,
  FileText,
  Search,
  Stamp,
  Navigation,
} from 'lucide-react';
import { cn, formatDate, formatCurrency, formatWeight } from '@/shared/lib/utils';
import type { ImportProcess, AiExtractedData } from '@/shared/types';

export interface ProcessInfoCardProps {
  process: ImportProcess;
}

type ProcessInfoSource = 'invoice' | 'espelho' | 'processo' | 'bl';

interface SourcedValue<T = unknown> {
  value: T | null;
  source: ProcessInfoSource | null;
}

const sourceStyles: Record<ProcessInfoSource, { label: string; badge: string; icon: string }> = {
  invoice: {
    label: 'Invoice',
    badge:
      'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-800',
    icon: 'bg-emerald-50 text-emerald-500 dark:bg-emerald-950/40 dark:text-emerald-300',
  },
  espelho: {
    label: 'Espelho',
    badge:
      'bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:ring-amber-800',
    icon: 'bg-amber-50 text-amber-500 dark:bg-amber-950/40 dark:text-amber-300',
  },
  bl: {
    label: 'BL',
    badge:
      'bg-sky-50 text-sky-700 ring-sky-200 dark:bg-sky-950/40 dark:text-sky-300 dark:ring-sky-800',
    icon: 'bg-sky-50 text-sky-500 dark:bg-sky-950/40 dark:text-sky-300',
  },
  processo: {
    label: 'Processo',
    badge:
      'bg-slate-100 text-slate-600 ring-slate-200 dark:bg-slate-900 dark:text-slate-400 dark:ring-slate-700',
    icon: 'bg-slate-50 text-slate-400 dark:bg-slate-900',
  },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function unwrapAiValue(value: unknown): unknown {
  if (isRecord(value) && 'value' in value) return value.value;
  return value;
}

function isEmptyValue(value: unknown) {
  const unwrapped = unwrapAiValue(value);
  return unwrapped == null || unwrapped === '';
}

function displayScalar(value: unknown): string | null {
  const unwrapped = unwrapAiValue(value);
  if (unwrapped == null || unwrapped === '') return null;
  if (Array.isArray(unwrapped)) return `${unwrapped.length} itens`;
  if (typeof unwrapped === 'object') {
    if (isRecord(unwrapped)) {
      if (typeof unwrapped.description === 'string' && unwrapped.description.trim()) {
        return unwrapped.description;
      }
      const filled = Object.entries(unwrapped).filter(([, nested]) => !isEmptyValue(nested));
      return filled.length > 0 ? `${filled.length} campos` : null;
    }
    return null;
  }
  return String(unwrapped);
}

function readPath(source: Record<string, unknown> | null | undefined, ...path: string[]) {
  let current: unknown = source;
  for (const key of path) {
    if (!isRecord(current)) return null;
    current = current[key];
  }
  const unwrapped = unwrapAiValue(current);
  return isEmptyValue(unwrapped) ? null : unwrapped;
}

function pickValue<T = unknown>(
  candidates: Array<{ source: ProcessInfoSource; value: T | null | undefined }>,
): SourcedValue<T> {
  const candidate = candidates.find((item) => !isEmptyValue(item.value));
  return candidate
    ? { value: candidate.value as T, source: candidate.source }
    : { value: null, source: null };
}

function firstEspelhoExporter(aiData: AiExtractedData | null | undefined) {
  const espelho = isRecord(aiData?.espelho) ? aiData?.espelho : null;
  const items = Array.isArray(espelho?.items) ? espelho.items : [];
  const first = items.find((item): item is Record<string, unknown> => isRecord(item));
  return first ? readPath(first, 'fornecedor') : null;
}

function getAiSources(process: ImportProcess) {
  const aiData = process.aiExtractedData as Record<string, unknown> | null | undefined;
  const invoice = isRecord(aiData?.invoice) ? aiData.invoice : null;
  const espelho = isRecord(aiData?.espelho) ? aiData.espelho : null;
  const summary = isRecord(espelho?.summary) ? espelho.summary : espelho;
  // The BL document carries shipping/freight/container fields that are not in
  // the invoice and only reach the espelho summary once it is built. Surface it
  // directly so "Data Embarque / Frete / Container" populate as soon as the BL
  // is extracted (Eduarda 2026-06-19).
  const blRaw = aiData?.ohbl ?? aiData?.draft_bl;
  const bl = isRecord(blRaw) ? blRaw : null;

  return {
    invoice,
    espelhoSummary: summary,
    espelhoExporter: firstEspelhoExporter(process.aiExtractedData),
    bl,
  };
}

function InfoField({
  label,
  value,
  icon: Icon,
  source,
}: {
  label: string;
  value: string | null | undefined;
  icon?: React.ComponentType<{ className?: string }>;
  source?: ProcessInfoSource | null;
}) {
  const sourceStyle = source ? sourceStyles[source] : null;
  const showSource = source === 'invoice' || source === 'espelho' || source === 'bl';

  return (
    <div className="flex items-start gap-3 py-2">
      {Icon && (
        <div
          className={cn(
            'mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg',
            sourceStyle?.icon ?? sourceStyles.processo.icon,
          )}
        >
          <Icon className="h-4 w-4" />
        </div>
      )}
      <div className="min-w-0">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <p className="text-xs font-medium text-slate-400 uppercase tracking-wider">{label}</p>
          {showSource && sourceStyle && (
            <span
              className={cn(
                'rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ring-1',
                sourceStyle.badge,
              )}
              title={`Fonte: ${sourceStyle.label}`}
            >
              {sourceStyle.label}
            </span>
          )}
        </div>
        <p className="mt-0.5 text-sm font-medium text-slate-800 dark:text-slate-100 truncate">
          {value || '\u2014'}
        </p>
      </div>
    </div>
  );
}

function LogisticaSection({ process }: { process: ImportProcess }) {
  const { espelhoSummary } = getAiSources(process);
  const shippingLine = pickValue<string>([
    { source: 'espelho', value: readPath(espelhoSummary, 'shippingLine') as string | null },
    { source: 'processo', value: process.shippingLine },
  ]);
  const vesselName = pickValue<string>([{ source: 'processo', value: process.vesselName }]);
  const blNumber = pickValue<string>([{ source: 'processo', value: process.blNumber }]);
  const freightAgent = pickValue<string>([{ source: 'processo', value: process.freightAgent }]);
  const diNumber = pickValue<string>([{ source: 'processo', value: process.diNumber }]);
  const customsChannel = pickValue<string>([{ source: 'processo', value: process.customsChannel }]);
  const inspectionType = pickValue<string>([{ source: 'processo', value: process.inspectionType }]);

  const fields: Array<{
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    data: SourcedValue<string>;
  }> = [
    { label: 'Navio', icon: Ship, data: vesselName },
    { label: 'Numero BL', icon: FileText, data: blNumber },
    { label: 'Armador / Cia Maritima', icon: Anchor, data: shippingLine },
    { label: 'Agente de Carga', icon: Truck, data: freightAgent },
    { label: 'Numero DI', icon: Stamp, data: diNumber },
    { label: 'Canal Aduaneiro', icon: Navigation, data: customsChannel },
    { label: 'Tipo de Inspecao', icon: Search, data: inspectionType },
  ];

  const populated = fields.filter((f) => !isEmptyValue(f.data.value));
  if (populated.length === 0) return null;

  return (
    <div className="mt-6 rounded-xl border border-primary-100 dark:border-primary-800 bg-primary-50/30 dark:bg-primary-950/30 p-5">
      <div className="flex items-center gap-2 mb-4">
        <Ship className="h-4 w-4 text-primary-500" />
        <p className="text-xs font-bold text-primary-700 dark:text-primary-400 uppercase tracking-wider">
          Logistica
        </p>
      </div>
      <div className="grid grid-cols-1 gap-x-8 gap-y-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
        {populated.map((f) => (
          <InfoField
            key={f.label}
            icon={f.icon}
            label={f.label}
            value={displayScalar(f.data.value)}
            source={f.data.source}
          />
        ))}
      </div>
    </div>
  );
}

export function ProcessInfoCard({ process }: ProcessInfoCardProps) {
  const { invoice, espelhoSummary, espelhoExporter, bl } = getAiSources(process);

  const exporterName = pickValue<string>([
    { source: 'invoice', value: readPath(invoice, 'exporterName') as string | null },
    { source: 'espelho', value: espelhoExporter as string | null },
    { source: 'espelho', value: readPath(espelhoSummary, 'exporterName') as string | null },
    { source: 'processo', value: process.exporterName },
  ]);
  const importerName = pickValue<string>([
    { source: 'invoice', value: readPath(invoice, 'importerName') as string | null },
    { source: 'espelho', value: readPath(espelhoSummary, 'importerName') as string | null },
    { source: 'processo', value: process.importerName },
  ]);
  const portOfLoading = pickValue<string>([
    { source: 'invoice', value: readPath(invoice, 'portOfLoading') as string | null },
    { source: 'bl', value: readPath(bl, 'portOfLoading') as string | null },
    { source: 'processo', value: process.portOfLoading },
  ]);
  const portOfDischarge = pickValue<string>([
    { source: 'invoice', value: readPath(invoice, 'portOfDischarge') as string | null },
    { source: 'bl', value: readPath(bl, 'portOfDischarge') as string | null },
    { source: 'processo', value: process.portOfDischarge },
  ]);
  const incoterm = pickValue<string>([
    { source: 'invoice', value: readPath(invoice, 'incoterm') as string | null },
    { source: 'processo', value: process.incoterm },
  ]);
  const totalFobValue = pickValue<number | string>([
    { source: 'invoice', value: readPath(invoice, 'totalFobValue') as number | string | null },
    {
      source: 'espelho',
      value: readPath(espelhoSummary, 'totalAmountUsd') as number | string | null,
    },
    { source: 'processo', value: process.totalFobValue },
  ]);
  const freightValue = pickValue<number | string>([
    {
      source: 'espelho',
      value: readPath(espelhoSummary, 'freightValue') as number | string | null,
    },
    { source: 'bl', value: readPath(bl, 'freightValue') as number | string | null },
    { source: 'invoice', value: readPath(invoice, 'freightValue') as number | string | null },
    { source: 'processo', value: process.freightValue },
  ]);
  // Pair the currency with the SAME source that won freightValue, otherwise the
  // value (e.g. invoice freight) could be labelled with a currency from another
  // source (e.g. espelho freightCurrency). Default to no currency when the
  // winning source carries none.
  const freightCurrency =
    freightValue.source === 'invoice'
      ? ((readPath(invoice, 'freightCurrency') as string | null) ?? undefined)
      : freightValue.source === 'espelho'
        ? ((readPath(espelhoSummary, 'freightCurrency') as string | null) ?? undefined)
        : freightValue.source === 'bl'
          ? ((readPath(bl, 'freightCurrency') as string | null) ?? undefined)
          : undefined;
  const totalBoxes = pickValue<number | string>([
    { source: 'invoice', value: readPath(invoice, 'totalBoxes') as number | string | null },
    { source: 'espelho', value: readPath(espelhoSummary, 'totalBoxes') as number | string | null },
    { source: 'bl', value: readPath(bl, 'totalBoxes') as number | string | null },
    { source: 'processo', value: process.totalBoxes },
  ]);
  const totalNetWeight = pickValue<number | string>([
    { source: 'invoice', value: readPath(invoice, 'totalNetWeight') as number | string | null },
    {
      source: 'espelho',
      value: readPath(espelhoSummary, 'totalNetWeight') as number | string | null,
    },
    { source: 'processo', value: process.totalNetWeight },
  ]);
  const totalGrossWeight = pickValue<number | string>([
    { source: 'invoice', value: readPath(invoice, 'totalGrossWeight') as number | string | null },
    {
      source: 'espelho',
      value: readPath(espelhoSummary, 'totalGrossWeight') as number | string | null,
    },
    { source: 'bl', value: readPath(bl, 'totalGrossWeight') as number | string | null },
    { source: 'processo', value: process.totalGrossWeight },
  ]);
  const totalCbm = pickValue<number | string>([
    { source: 'invoice', value: readPath(invoice, 'totalCbm') as number | string | null },
    { source: 'espelho', value: readPath(espelhoSummary, 'totalCbm') as number | string | null },
    { source: 'bl', value: readPath(bl, 'totalCbm') as number | string | null },
    { source: 'processo', value: process.totalCbm },
  ]);
  const containerType = pickValue<string>([
    { source: 'espelho', value: readPath(espelhoSummary, 'containerType') as string | null },
    { source: 'bl', value: readPath(bl, 'containerType') as string | null },
    { source: 'invoice', value: readPath(invoice, 'containerType') as string | null },
    { source: 'processo', value: process.containerType },
  ]);
  const containerNumber = pickValue<string>([
    { source: 'espelho', value: readPath(espelhoSummary, 'containerNumber') as string | null },
    { source: 'bl', value: readPath(bl, 'containerNumber') as string | null },
    { source: 'invoice', value: readPath(invoice, 'containerNumber') as string | null },
  ]);
  const shipmentDate = pickValue<string>([
    { source: 'espelho', value: readPath(espelhoSummary, 'shipmentDate') as string | null },
    { source: 'espelho', value: readPath(espelhoSummary, 'etd') as string | null },
    { source: 'bl', value: readPath(bl, 'shipmentDate') as string | null },
    { source: 'bl', value: readPath(bl, 'etd') as string | null },
    { source: 'invoice', value: readPath(invoice, 'shipmentDate') as string | null },
    { source: 'invoice', value: readPath(invoice, 'etd') as string | null },
    { source: 'processo', value: process.shipmentDate },
  ]);
  const exporterAddress = pickValue<string>([
    { source: 'invoice', value: readPath(invoice, 'exporterAddress') as string | null },
    { source: 'processo', value: process.exporterAddress },
  ]);
  const importerAddress = pickValue<string>([
    { source: 'invoice', value: readPath(invoice, 'importerAddress') as string | null },
    { source: 'espelho', value: readPath(espelhoSummary, 'importerAddress') as string | null },
    { source: 'processo', value: process.importerAddress },
  ]);

  return (
    <div className="rounded-2xl border border-slate-200/60 bg-white dark:bg-slate-800 dark:border-slate-700/60 shadow-sm overflow-hidden">
      <div className="border-b border-slate-100 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-900/50 px-4 py-3 sm:px-7 sm:py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-primary-500 to-primary-700 text-white shadow-sm">
            <Package className="h-4.5 w-4.5" />
          </div>
          <h3 className="text-sm font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400">
            Informacoes do Processo
          </h3>
        </div>
      </div>
      <div className="p-4 sm:p-7">
        <div className="grid grid-cols-1 gap-x-8 gap-y-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
          <InfoField
            icon={Building}
            label="Exportador"
            value={exporterName.value}
            source={exporterName.source}
          />
          <InfoField
            icon={User}
            label="Importador"
            value={importerName.value}
            source={importerName.source}
          />
          <InfoField
            icon={Anchor}
            label="Porto Embarque"
            value={portOfLoading.value}
            source={portOfLoading.source}
          />
          <InfoField
            icon={Ship}
            label="Porto Destino"
            value={portOfDischarge.value}
            source={portOfDischarge.source}
          />
          <InfoField
            icon={Globe}
            label="Incoterm"
            value={incoterm.value}
            source={incoterm.source}
          />
          <InfoField
            icon={Banknote}
            label="Valor FOB"
            value={totalFobValue.value != null ? formatCurrency(totalFobValue.value) : null}
            source={totalFobValue.source}
          />
          <InfoField
            icon={Truck}
            label="Frete"
            value={
              freightValue.value != null
                ? formatCurrency(freightValue.value, freightCurrency)
                : null
            }
            source={freightValue.source}
          />
          <InfoField
            icon={Box}
            label="Caixas"
            value={displayScalar(totalBoxes.value)}
            source={totalBoxes.source}
          />
          <InfoField
            icon={Weight}
            label="Peso Liquido"
            value={totalNetWeight.value != null ? formatWeight(totalNetWeight.value) : null}
            source={totalNetWeight.source}
          />
          <InfoField
            icon={Weight}
            label="Peso Bruto"
            value={totalGrossWeight.value != null ? formatWeight(totalGrossWeight.value) : null}
            source={totalGrossWeight.source}
          />
          <InfoField
            icon={Package}
            label="CBM"
            value={totalCbm.value != null ? `${Number(totalCbm.value).toFixed(3)} m3` : null}
            source={totalCbm.source}
          />
          <InfoField
            icon={Box}
            label="Container"
            value={containerType.value}
            source={containerType.source}
          />
          {containerNumber.value && (
            <InfoField
              icon={Box}
              label="Numero Container"
              value={containerNumber.value}
              source={containerNumber.source}
            />
          )}
          <InfoField
            icon={CalendarDays}
            label="Data Embarque"
            value={shipmentDate.value ? formatDate(shipmentDate.value) : null}
            source={shipmentDate.source}
          />
          {exporterAddress.value && (
            <InfoField
              icon={Building}
              label="Endereco Exportador"
              value={exporterAddress.value}
              source={exporterAddress.source}
            />
          )}
          {importerAddress.value && (
            <InfoField
              icon={User}
              label="Endereco Importador"
              value={importerAddress.value}
              source={importerAddress.source}
            />
          )}
        </div>

        {/* Logistica */}
        <LogisticaSection process={process} />

        {/* Payment Terms */}
        {process.paymentTerms && (
          <div className="mt-5 rounded-xl border border-slate-100 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-900/60 p-4">
            <div className="flex items-center gap-2 mb-2">
              <Banknote className="h-4 w-4 text-slate-400" />
              <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                Termos de Pagamento
              </p>
            </div>
            <p className="text-sm text-slate-700 dark:text-slate-300">
              {((process.paymentTerms as Record<string, unknown>).description as string) ||
                JSON.stringify(process.paymentTerms)}
            </p>
          </div>
        )}

        {/* Notes */}
        {process.notes && (
          <div className="mt-5 rounded-xl border border-slate-100 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-900/60 p-4">
            <div className="flex items-center gap-2 mb-2">
              <StickyNote className="h-4 w-4 text-slate-400" />
              <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                Observacoes
              </p>
            </div>
            <p className="text-sm text-slate-700 dark:text-slate-300 whitespace-pre-wrap leading-relaxed">
              {process.notes}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
