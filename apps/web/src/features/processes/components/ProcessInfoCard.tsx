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
import { isRecord, unwrapAiValue } from '@/shared/lib/ai-values';
import type { ImportProcess, AiExtractedData } from '@/shared/types';

export interface ProcessInfoCardProps {
  process: ImportProcess;
}

type ProcessInfoSource = 'invoice' | 'espelho' | 'processo' | 'bl' | 'packing';

interface Divergence {
  source: ProcessInfoSource;
  value: unknown;
}

interface SourcedValue<T = unknown> {
  value: T | null;
  source: ProcessInfoSource | null;
  /** Outras fontes que trazem valor DIFERENTE do exibido. */
  divergences?: Divergence[];
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
  // Violeta, e nao indigo: o indigo e a cor `primary` do sistema, e o selo
  // ficaria indistinguivel de um elemento de acao.
  packing: {
    label: 'Packing List',
    badge:
      'bg-violet-50 text-violet-700 ring-violet-200 dark:bg-violet-950/40 dark:text-violet-300 dark:ring-violet-800',
    icon: 'bg-violet-50 text-violet-500 dark:bg-violet-950/40 dark:text-violet-300',
  },
  // A planilha Follow Up e a referencia do processo: "quando esta cinza vem da
  // follow-up" (reuniao 11/09). O rotulo dizia "Processo", que nao diz de onde
  // o dado veio, e o selo ficava escondido.
  processo: {
    label: 'Follow-up',
    badge:
      'bg-slate-100 text-slate-600 ring-slate-200 dark:bg-slate-900 dark:text-slate-400 dark:ring-slate-700',
    icon: 'bg-slate-50 text-slate-400 dark:bg-slate-900',
  },
};

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

const FREIGHT_PAYMENT_TERMS = new Set(['PREPAID', 'COLLECT']);

function formatFreight(value: number | string, currency?: string): string {
  const normalizedCurrency = currency?.trim().toUpperCase();
  if (normalizedCurrency && FREIGHT_PAYMENT_TERMS.has(normalizedCurrency)) {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue) || numericValue === 0) return normalizedCurrency;

    const formattedValue = new Intl.NumberFormat('pt-BR', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(numericValue);
    return `${normalizedCurrency} · ${formattedValue} (moeda não informada)`;
  }

  return formatCurrency(value, normalizedCurrency);
}

/**
 * Resumo legivel dos termos de pagamento. Sem `description`, a tela caia num
 * `JSON.stringify` e o usuario final lia `{"days":30,"type":"net"}`; agora as
 * partes conhecidas (extraidas pela IA da invoice/proforma) viram texto e o
 * resto vira um traco.
 */
function summarizePaymentTerms(terms: Record<string, unknown> | null | undefined): string {
  if (!terms) return '--';

  const description = terms.description;
  if (typeof description === 'string' && description.trim() !== '') return description.trim();

  const parts: string[] = [];
  const asPercent = (value: unknown) => (typeof value === 'number' && value > 0 ? value : null);

  const deposit = asPercent(terms.depositPercent);
  if (deposit !== null) parts.push(`${deposit}% de entrada`);

  const balance = asPercent(terms.balancePercent);
  if (balance !== null) parts.push(`${balance}% de saldo`);

  const days = terms.paymentDays;
  if (typeof days === 'number' && days > 0) parts.push(`prazo de ${days} dias`);

  return parts.length > 0 ? parts.join(' · ') : '--';
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

/**
 * Dois valores dizem a MESMA coisa?
 *
 * Numero compara como numero (a invoice traz 101246.01, a planilha
 * '101246.01'); texto compara sem caixa, acento nem espaco sobrando, senao
 * 'SHENZHEN' e 'Shenzhen' apareceriam como divergencia.
 */
function mesmoValor(a: unknown, b: unknown): boolean {
  const left = unwrapAiValue(a);
  const right = unwrapAiValue(b);
  const leftNumber = typeof left === 'object' ? NaN : Number(left);
  const rightNumber = typeof right === 'object' ? NaN : Number(right);
  if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) {
    return Math.abs(leftNumber - rightNumber) < 0.01;
  }
  const normalize = (value: unknown) =>
    String(value ?? '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/gu, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toUpperCase();
  return normalize(left) === normalize(right);
}

/**
 * Primeiro candidato preenchido vence; os demais que discordam viram
 * DIVERGENCIA.
 *
 * A ordem dos candidatos e a decisao da reuniao (11/09): nos campos que a
 * planilha Follow Up tem — fornecedor, portos, FOB, frete, container, CBM, ETD,
 * navio, BL, armador, agente — ela vem PRIMEIRO e o documento so preenche
 * lacuna; nos que ela nao tem — importador, pesos, caixas, numero do container
 * — mandam os documentos, com o packing list na frente. O valor do documento
 * nao e escondido: aparece como divergencia ao lado, e o comparativo continua
 * sendo o lugar de decidir.
 */
function pickValue<T = unknown>(
  candidates: Array<{ source: ProcessInfoSource; value: T | null | undefined }>,
): SourcedValue<T> {
  const preenchidos = candidates.filter((item) => !isEmptyValue(item.value));
  const candidate = preenchidos[0];
  if (!candidate) return { value: null, source: null };

  const divergences: Divergence[] = [];
  for (const outro of preenchidos.slice(1)) {
    if (outro.source === candidate.source) continue;
    if (mesmoValor(outro.value, candidate.value)) continue;
    if (divergences.some((item) => item.source === outro.source)) continue;
    divergences.push({ source: outro.source, value: outro.value });
  }

  return { value: candidate.value as T, source: candidate.source, divergences };
}

/**
 * O espelho AUTO-gerado nao e um espelho.
 *
 * `build-espelho.ts` monta um resumo a partir da propria invoice/PL e grava em
 * `aiExtractedData.espelho` com `generatedBy: 'auto_*'`. A capa mostrava esse
 * resumo com o selo "Espelho" mesmo em processo SEM espelho anexado — inclusive
 * o lixo que veio do BL ("Place of receipt" como navio). O comparativo ja anula
 * esse caso (documents/service.ts); aqui passava direto.
 */
function isEspelhoDerivado(summary: Record<string, unknown> | null | undefined): boolean {
  const generatedBy = summary?.generatedBy;
  return typeof generatedBy === 'string' && generatedBy.startsWith('auto_');
}

function firstEspelhoExporter(aiData: AiExtractedData | null | undefined) {
  const espelho = isRecord(aiData?.espelho) ? aiData?.espelho : null;
  const summary = isRecord(espelho?.summary) ? espelho.summary : espelho;
  if (isEspelhoDerivado(summary)) return null;
  const items = Array.isArray(espelho?.items) ? espelho.items : [];
  const first = items.find((item): item is Record<string, unknown> => isRecord(item));
  return first ? readPath(first, 'fornecedor') : null;
}

function getAiSources(process: ImportProcess) {
  const aiData = process.aiExtractedData as Record<string, unknown> | null | undefined;
  const invoice = isRecord(aiData?.invoice) ? aiData.invoice : null;
  const espelho = isRecord(aiData?.espelho) ? aiData.espelho : null;
  const summaryRaw = isRecord(espelho?.summary) ? espelho.summary : espelho;
  const summary = isEspelhoDerivado(summaryRaw) ? null : summaryRaw;
  // The BL document carries shipping/freight/container fields that are not in
  // the invoice and only reach the espelho summary once it is built. Surface it
  // directly so "Data Embarque / Frete / Container" populate as soon as the BL
  // is extracted (Eduarda 2026-06-19).
  const blRaw = aiData?.ohbl ?? aiData?.draft_bl;
  const bl = isRecord(blRaw) ? blRaw : null;
  // Packing list: fonte de pesos, caixas e CBM por item (decisao D3).
  const packingRaw = aiData?.packing_list;
  const packing = isRecord(packingRaw) ? packingRaw : null;

  return {
    invoice,
    espelhoSummary: summary,
    espelhoExporter: firstEspelhoExporter(process.aiExtractedData),
    bl,
    packing,
  };
}

function InfoField({
  label,
  value,
  icon: Icon,
  source,
  divergences,
}: {
  label: string;
  value: string | null | undefined;
  icon?: React.ComponentType<{ className?: string }>;
  source?: ProcessInfoSource | null;
  /** Fontes que discordam do valor exibido, ja formatadas. */
  divergences?: Array<{ source: ProcessInfoSource; value: string }>;
}) {
  const sourceStyle = source ? sourceStyles[source] : null;
  // O selo aparece para TODA fonte, inclusive a Follow-up: sem ele o operador
  // nao sabia se o numero da capa veio do documento ou da planilha.
  const showSource = Boolean(sourceStyle);

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
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
            {label}
          </p>
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
        {divergences && divergences.length > 0 && value && (
          <p
            className="mt-0.5 truncate text-[11px] font-medium text-amber-700 dark:text-amber-300"
            title="O documento diverge da follow-up; confira no comparativo"
          >
            {divergences
              .map((item) => `${sourceStyles[item.source].label}: ${item.value}`)
              .join(' · ')}
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * Divergencias prontas para a tela, com o MESMO formatador do valor principal
 * (moeda como moeda, peso como peso). So sao mostradas quando quem venceu foi a
 * follow-up: divergencia entre dois documentos e assunto do comparativo.
 */
function formatDivergences(
  data: SourcedValue<unknown>,
  format: (value: unknown) => string | null,
): Array<{ source: ProcessInfoSource; value: string }> {
  if (data.source !== 'processo' || !data.divergences) return [];
  return data.divergences
    .map((item) => ({ source: item.source, value: format(item.value) ?? '' }))
    .filter((item) => item.value !== '');
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

function RegistroAduaneiroSection({ process }: { process: ImportProcess }) {
  const fields: Array<{
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    value: string | null;
  }> = [
    {
      label: 'Valor Aduaneiro',
      icon: Banknote,
      value: process.customsValue != null ? formatCurrency(process.customsValue, 'BRL') : null,
    },
    {
      label: 'Dolar de Registro',
      icon: Banknote,
      value:
        process.registrationDollar != null
          ? Number(process.registrationDollar).toLocaleString('pt-BR', {
              minimumFractionDigits: 4,
              maximumFractionDigits: 6,
            })
          : null,
    },
    {
      label: 'Seguro',
      icon: Banknote,
      value: process.insuranceValue != null ? formatCurrency(process.insuranceValue, 'USD') : null,
    },
    { label: 'Numero DUIMP', icon: FileText, value: process.duimpNumber ?? null },
    {
      label: 'Data de Registro',
      icon: Stamp,
      value: process.registeredAt ? formatDate(process.registeredAt) : null,
    },
    {
      label: 'Desembaraco',
      icon: CalendarDays,
      value: process.customsClearanceAt ? formatDate(process.customsClearanceAt) : null,
    },
    { label: 'Canal RFB', icon: Navigation, value: process.customsChannel ?? null },
  ];

  const populated = fields.filter((field) => !isEmptyValue(field.value));
  if (populated.length === 0) return null;

  return (
    <div className="mt-6 rounded-xl border border-red-100 bg-red-50/30 p-5 dark:border-danger-900/60 dark:bg-danger-950/20">
      <div className="mb-4 flex items-center gap-2">
        <Stamp className="h-4 w-4 text-red-500" />
        <p className="text-xs font-bold uppercase tracking-wider text-red-700 dark:text-danger-300">
          Registro Aduaneiro
        </p>
      </div>
      <div className="grid grid-cols-1 gap-x-8 gap-y-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
        {populated.map((field) => (
          <InfoField
            key={field.label}
            icon={field.icon}
            label={field.label}
            value={field.value}
            source="processo"
          />
        ))}
      </div>
    </div>
  );
}

export function ProcessInfoCard({ process }: ProcessInfoCardProps) {
  const { invoice, espelhoSummary, espelhoExporter, bl, packing } = getAiSources(process);

  // ── Campos que a Follow Up TEM: planilha primeiro, documento preenche
  // lacuna e, quando discorda, aparece como divergencia (decisao D3).
  const exporterName = pickValue<string>([
    { source: 'processo', value: process.exporterName },
    { source: 'invoice', value: readPath(invoice, 'exporterName') as string | null },
    { source: 'espelho', value: espelhoExporter as string | null },
    { source: 'espelho', value: readPath(espelhoSummary, 'exporterName') as string | null },
    { source: 'packing', value: readPath(packing, 'exporterName') as string | null },
  ]);
  const portOfLoading = pickValue<string>([
    { source: 'processo', value: process.portOfLoading },
    { source: 'invoice', value: readPath(invoice, 'portOfLoading') as string | null },
    { source: 'bl', value: readPath(bl, 'portOfLoading') as string | null },
    { source: 'packing', value: readPath(packing, 'portOfLoading') as string | null },
  ]);
  const portOfDischarge = pickValue<string>([
    { source: 'processo', value: process.portOfDischarge },
    { source: 'invoice', value: readPath(invoice, 'portOfDischarge') as string | null },
    { source: 'bl', value: readPath(bl, 'portOfDischarge') as string | null },
    { source: 'packing', value: readPath(packing, 'portOfDischarge') as string | null },
  ]);
  const totalFobValue = pickValue<number | string>([
    { source: 'processo', value: process.totalFobValue },
    { source: 'invoice', value: readPath(invoice, 'totalFobValue') as number | string | null },
    {
      source: 'espelho',
      value: readPath(espelhoSummary, 'totalAmountUsd') as number | string | null,
    },
  ]);
  const freightValue = pickValue<number | string>([
    { source: 'processo', value: process.freightValue },
    {
      source: 'espelho',
      value: readPath(espelhoSummary, 'freightValue') as number | string | null,
    },
    { source: 'bl', value: readPath(bl, 'freightValue') as number | string | null },
    { source: 'invoice', value: readPath(invoice, 'freightValue') as number | string | null },
  ]);
  // Pair the currency with the SAME source that won freightValue, otherwise the
  // value (e.g. invoice freight) could be labelled with a currency from another
  // source (e.g. espelho freightCurrency). Default to no currency when the
  // winning source carries none. A follow-up guarda o frete em USD.
  const freightCurrency =
    freightValue.source === 'invoice'
      ? ((readPath(invoice, 'freightCurrency') as string | null) ?? undefined)
      : freightValue.source === 'espelho'
        ? ((readPath(espelhoSummary, 'freightCurrency') as string | null) ?? undefined)
        : freightValue.source === 'bl'
          ? ((readPath(bl, 'freightCurrency') as string | null) ?? undefined)
          : freightValue.source === 'processo'
            ? 'USD'
            : undefined;
  const totalCbm = pickValue<number | string>([
    { source: 'processo', value: process.totalCbm },
    // Sem CBM na planilha, o packing list e a fonte (D3): o CBM por item esta
    // la, e a reuniao apontou que ele so vinha da invoice.
    { source: 'packing', value: readPath(packing, 'totalCbm') as number | string | null },
    { source: 'invoice', value: readPath(invoice, 'totalCbm') as number | string | null },
    { source: 'espelho', value: readPath(espelhoSummary, 'totalCbm') as number | string | null },
    { source: 'bl', value: readPath(bl, 'totalCbm') as number | string | null },
  ]);
  const containerType = pickValue<string>([
    { source: 'processo', value: process.containerType },
    { source: 'espelho', value: readPath(espelhoSummary, 'containerType') as string | null },
    { source: 'bl', value: readPath(bl, 'containerType') as string | null },
    { source: 'invoice', value: readPath(invoice, 'containerType') as string | null },
  ]);
  // Data de embarque: a planilha tem 'ETD ORIGEM*' (process.etd). Ela nao
  // entrava na capa — so `shipmentDate`, que e NULL em todo processo importado,
  // entao a capa ficava vazia mesmo com a follow-up tendo a data.
  const shipmentDate = pickValue<string>([
    { source: 'processo', value: process.shipmentDate ?? process.etd },
    { source: 'espelho', value: readPath(espelhoSummary, 'shipmentDate') as string | null },
    { source: 'espelho', value: readPath(espelhoSummary, 'etd') as string | null },
    { source: 'bl', value: readPath(bl, 'shipmentDate') as string | null },
    { source: 'bl', value: readPath(bl, 'etd') as string | null },
    { source: 'invoice', value: readPath(invoice, 'shipmentDate') as string | null },
    { source: 'invoice', value: readPath(invoice, 'etd') as string | null },
  ]);

  // ── Campos que a Follow Up NAO tem (conferido nos cabecalhos da aba
  // Processos): importador, pesos, caixas e numero do container. Aqui mandam os
  // documentos, com o packing list na frente para peso/caixa.
  const importerName = pickValue<string>([
    { source: 'invoice', value: readPath(invoice, 'importerName') as string | null },
    { source: 'packing', value: readPath(packing, 'importerName') as string | null },
    { source: 'espelho', value: readPath(espelhoSummary, 'importerName') as string | null },
    { source: 'processo', value: process.importerName },
  ]);
  // Incoterm NAO entra na regra da follow-up: a aba Processos nao tem essa
  // coluna, e `import_processes.incoterm` tem DEFAULT 'FOB' no schema — rotular
  // esse default como "Follow-up" seria dar a um valor inventado a autoridade
  // da planilha. O documento manda; o processo e o ultimo recurso.
  const incoterm = pickValue<string>([
    { source: 'invoice', value: readPath(invoice, 'incoterm') as string | null },
    { source: 'processo', value: process.incoterm },
  ]);
  const totalBoxes = pickValue<number | string>([
    { source: 'packing', value: readPath(packing, 'totalBoxes') as number | string | null },
    { source: 'invoice', value: readPath(invoice, 'totalBoxes') as number | string | null },
    { source: 'espelho', value: readPath(espelhoSummary, 'totalBoxes') as number | string | null },
    { source: 'bl', value: readPath(bl, 'totalBoxes') as number | string | null },
    { source: 'processo', value: process.totalBoxes },
  ]);
  const totalNetWeight = pickValue<number | string>([
    { source: 'packing', value: readPath(packing, 'totalNetWeight') as number | string | null },
    { source: 'invoice', value: readPath(invoice, 'totalNetWeight') as number | string | null },
    {
      source: 'espelho',
      value: readPath(espelhoSummary, 'totalNetWeight') as number | string | null,
    },
    { source: 'processo', value: process.totalNetWeight },
  ]);
  const totalGrossWeight = pickValue<number | string>([
    { source: 'packing', value: readPath(packing, 'totalGrossWeight') as number | string | null },
    { source: 'invoice', value: readPath(invoice, 'totalGrossWeight') as number | string | null },
    {
      source: 'espelho',
      value: readPath(espelhoSummary, 'totalGrossWeight') as number | string | null,
    },
    { source: 'bl', value: readPath(bl, 'totalGrossWeight') as number | string | null },
    { source: 'processo', value: process.totalGrossWeight },
  ]);
  const containerNumber = pickValue<string>([
    { source: 'bl', value: readPath(bl, 'containerNumber') as string | null },
    { source: 'packing', value: readPath(packing, 'containerNumber') as string | null },
    { source: 'espelho', value: readPath(espelhoSummary, 'containerNumber') as string | null },
    { source: 'invoice', value: readPath(invoice, 'containerNumber') as string | null },
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
            divergences={formatDivergences(exporterName, (value) => displayScalar(value))}
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
            divergences={formatDivergences(portOfLoading, (value) => displayScalar(value))}
          />
          <InfoField
            icon={Ship}
            label="Porto Destino"
            value={portOfDischarge.value}
            source={portOfDischarge.source}
            divergences={formatDivergences(portOfDischarge, (value) => displayScalar(value))}
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
            divergences={formatDivergences(totalFobValue, (value) =>
              value != null ? formatCurrency(value as number | string) : null,
            )}
          />
          <InfoField
            icon={Truck}
            label="Frete"
            value={
              freightValue.value != null ? formatFreight(freightValue.value, freightCurrency) : null
            }
            source={freightValue.source}
            divergences={formatDivergences(freightValue, (value) =>
              value != null ? formatCurrency(value as number | string) : null,
            )}
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
            divergences={formatDivergences(totalCbm, (value) =>
              value != null ? `${Number(unwrapAiValue(value)).toFixed(3)} m3` : null,
            )}
          />
          <InfoField
            icon={Box}
            label="Container"
            value={containerType.value}
            source={containerType.source}
            divergences={formatDivergences(containerType, (value) => displayScalar(value))}
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
            divergences={formatDivergences(shipmentDate, (value) => {
              const texto = displayScalar(value);
              return texto ? formatDate(texto) : null;
            })}
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

        {/* Registro Aduaneiro */}
        <RegistroAduaneiroSection process={process} />

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
              {summarizePaymentTerms(process.paymentTerms)}
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
