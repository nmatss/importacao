import type React from 'react';
import { useState } from 'react';
import { cn } from '@/shared/lib/utils';

// Per-document coverage summary emitted by the backend. Optional: when absent
// we derive an equivalent from the {value,confidence} field data on the client.
interface CoverageSummary {
  readPercent: number;
  effectiveReadPercent?: number;
  trackedMissingFields?: string[];
  trackedTotalWeight?: number;
  trackedFilledWeight?: number;
  totalFields: number;
  filledFields: number;
  missingFields: string[];
  lowConfidenceFields: string[];
}

interface AiExtractionSummaryProps {
  documentType: string;
  data: Record<string, unknown>;
  confidence: number | null;
  // Prefer the backend coverage summary if present; otherwise we fall back to
  // deriving it from the field data below.
  coverage?: CoverageSummary | null;
}

const MIN_OPERATIONAL_CONFIDENCE = 0.4;

// Fields below this per-field confidence are surfaced as "low confidence" in the
// derived (fallback) coverage so the user knows to double-check them.
const LOW_FIELD_CONFIDENCE = 0.5;

// Field label mapping per document type
const FIELD_LABELS: Record<string, Record<string, string>> = {
  invoice: {
    invoiceNumber: 'Nº Invoice',
    invoiceDate: 'Data',
    exporterName: 'Exportador',
    exporterTaxId: 'CNPJ/Tax ID Exportador',
    importerName: 'Importador',
    importerCnpj: 'CNPJ Importador',
    incoterm: 'Incoterm',
    currency: 'Moeda',
    portOfLoading: 'Porto de Embarque',
    portOfDischarge: 'Porto de Descarga',
    shipmentDate: 'Data de Embarque',
    etd: 'ETD',
    shippedOnBoardDate: 'Shipped On Board',
    totalFobValue: 'Valor FOB Total',
    totalBoxes: 'Total Caixas',
    totalNetWeight: 'Peso Líquido (kg)',
    totalGrossWeight: 'Peso Bruto (kg)',
    totalCbm: 'CBM (m³)',
    manufacturerName: 'Fábrica',
    paymentTerms: 'Condições Pgto',
  },
  packing_list: {
    packingListNumber: 'Nº Packing List',
    invoiceNumber: 'Nº Invoice Ref',
    date: 'Data',
    exporterName: 'Exportador',
    exporterTaxId: 'CNPJ/Tax ID Exportador',
    importerName: 'Importador',
    importerCnpj: 'CNPJ Importador',
    portOfLoading: 'Porto de Embarque',
    portOfDischarge: 'Porto de Descarga',
    shipmentDate: 'Data de Embarque',
    etd: 'ETD',
    shippedOnBoardDate: 'Shipped On Board',
    totalBoxes: 'Total Caixas',
    totalNetWeight: 'Peso Líquido (kg)',
    totalGrossWeight: 'Peso Bruto (kg)',
    totalCbm: 'CBM (m³)',
  },
  ohbl: {
    blNumber: 'Nº BL',
    issueDate: 'Data Emissão',
    shipper: 'Shipper',
    consignee: 'Consignee',
    vesselName: 'Navio',
    voyageNumber: 'Viagem',
    portOfLoading: 'Porto Embarque',
    portOfDischarge: 'Porto Destino',
    etd: 'ETD',
    eta: 'ETA',
    shipmentDate: 'Embarque',
    containerNumber: 'Container',
    containerType: 'Tipo Container',
    totalBoxes: 'Total Caixas',
    totalGrossWeight: 'Peso Bruto (kg)',
    totalCbm: 'CBM (m³)',
    freightValue: 'Frete',
    freightCurrency: 'Moeda Frete',
    freeTime: 'Free Time (dias)',
    woodDeclaration: 'Declaração Madeira',
  },
  draft_bl: {
    blNumber: 'Nº BL',
    shipper: 'Shipper',
    consignee: 'Consignee',
    vesselName: 'Navio',
    portOfLoading: 'Porto Embarque',
    portOfDischarge: 'Porto Destino',
    etd: 'ETD',
    eta: 'ETA',
    shipmentDate: 'Embarque',
    containerNumber: 'Container',
    totalBoxes: 'Total Caixas',
    totalGrossWeight: 'Peso Bruto (kg)',
    totalCbm: 'CBM (m³)',
    freeTime: 'Free Time (dias)',
    woodDeclaration: 'Declaração Madeira',
  },
  certificate: {
    certificateType: 'Tipo',
    certificateNumber: 'Nº Certificado',
    issuingAuthority: 'Órgão Emissor',
    issueDate: 'Data Emissão',
    expirationDate: 'Data Validade',
    exporterName: 'Exportador',
    importerName: 'Importador',
    countryOfOrigin: 'País de Origem',
    invoiceReference: 'Ref. Invoice',
  },
};

// Priority fields shown first (key fields per doc type)
const PRIORITY_FIELDS: Record<string, string[]> = {
  invoice: [
    'invoiceNumber',
    'invoiceDate',
    'exporterName',
    'totalFobValue',
    'currency',
    'incoterm',
  ],
  packing_list: ['packingListNumber', 'exporterName', 'totalBoxes', 'totalGrossWeight', 'totalCbm'],
  ohbl: [
    'blNumber',
    'vesselName',
    'containerNumber',
    'shipmentDate',
    'eta',
    'portOfDischarge',
    // Wood declaration is a mandatory compliance field on the BL Final too — keep
    // it in the highlighted grid, not buried among the secondary fields.
    'woodDeclaration',
  ],
  draft_bl: ['blNumber', 'vesselName', 'containerNumber', 'freeTime', 'woodDeclaration', 'eta'],
  certificate: ['certificateType', 'certificateNumber', 'issuingAuthority', 'expirationDate'],
};

function extractValue(val: unknown): { value: unknown; confidence: number | null } {
  if (val && typeof val === 'object' && 'value' in (val as Record<string, unknown>)) {
    const obj = val as { value: unknown; confidence?: number };
    return { value: obj.value, confidence: obj.confidence ?? null };
  }
  return { value: val, confidence: null };
}

// Translate a raw field key (possibly an item path like "items[2].quantity")
// into a friendly PT-BR label, falling back to the document's label map and
// finally the raw key so nothing is ever shown as an opaque token.
function friendlyFieldLabel(key: string, labels: Record<string, string>): string {
  const itemMatch = key.match(/^items\[(\d+)\]\.(.+)$/);
  if (itemMatch) {
    const [, idx, sub] = itemMatch;
    return `Item ${Number(idx) + 1} · ${labels[sub] || sub}`;
  }
  if (key === '_contract') return 'Consistência geral';
  return labels[key] || key;
}

// Derive a coverage summary from the existing {value,confidence} field data when
// the backend does not provide one. Counts the displayable top-level fields,
// flags empty ones as "missing" and the low-confidence ones separately.
function deriveCoverage(
  entries: [string, unknown][],
  data: Record<string, unknown>,
): CoverageSummary {
  // Cargo description is a real (often required) field; count it too.
  const cargo = data.cargoDescription;
  const all: [string, unknown][] =
    cargo !== undefined ? [...entries, ['cargoDescription', cargo]] : entries;

  const missingFields: string[] = [];
  const lowConfidenceFields: string[] = [];
  let filledFields = 0;

  for (const [key, val] of all) {
    const { value, confidence: fieldConf } = extractValue(val);
    const isEmpty =
      value === null ||
      value === undefined ||
      value === '' ||
      (Array.isArray(value) && value.length === 0);
    if (isEmpty) {
      missingFields.push(key);
      continue;
    }
    filledFields += 1;
    if (fieldConf != null && fieldConf < LOW_FIELD_CONFIDENCE) {
      lowConfidenceFields.push(key);
    }
  }

  const totalFields = all.length;
  const readPercent = totalFields > 0 ? Math.round((filledFields / totalFields) * 100) : 0;
  return { readPercent, totalFields, filledFields, missingFields, lowConfidenceFields };
}

function formatValue(val: unknown, key: string): string {
  if (val === null || val === undefined || val === '') return '—';
  if (typeof val === 'boolean') return val ? 'Sim' : 'Não';
  if (typeof val === 'number') {
    if (key.includes('Weight') || key.includes('Cbm') || key === 'totalCbm')
      return val.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (key.includes('Value') || key.includes('Price') || key === 'freightValue')
      return val.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return val.toLocaleString('pt-BR');
  }
  if (typeof val === 'object') {
    if (key === 'paymentTerms') {
      const pt = val as Record<string, unknown>;
      const parts = [];
      if (pt.depositPercent) parts.push(`${pt.depositPercent}% depósito`);
      if (pt.balancePercent) parts.push(`${pt.balancePercent}% saldo`);
      if (pt.paymentDays) parts.push(`${pt.paymentDays} dias`);
      return parts.length > 0 ? parts.join(', ') : pt.description ? String(pt.description) : '—';
    }
    if (Array.isArray(val)) return `${val.length} itens`;
    const record = val as Record<string, unknown>;
    if (typeof record.description === 'string' && record.description.trim()) {
      return record.description;
    }
    const filled = Object.values(record).filter(
      (nested) => nested !== null && nested !== undefined && nested !== '',
    );
    return filled.length > 0 ? `${filled.length} campos preenchidos` : '—';
  }
  return String(val);
}

// Dedicated cargo description block with expand/collapse so the full description
// is available without polluting the compact summary grid.
function CargoDescriptionBlock({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const isLong = text.length > 200 || text.split('\n').length > 4;

  return (
    <div className="rounded-lg border border-slate-100 dark:border-slate-700 bg-slate-50/50 px-3 py-2">
      <p className="text-[10px] font-semibold uppercase text-slate-400 mb-1">Descrição da Carga</p>
      <p
        className={cn(
          'text-xs text-slate-600 dark:text-slate-400 whitespace-pre-wrap',
          isLong && !expanded && 'line-clamp-4',
        )}
      >
        {text}
      </p>
      {isLong ? (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-1 text-[11px] font-medium text-violet-600 hover:text-violet-700"
        >
          {expanded ? 'Ver menos' : 'Ver mais'}
        </button>
      ) : null}
    </div>
  );
}

function FieldConfidence({ confidence }: { confidence: number | null }) {
  if (confidence === null) return null;
  const pct = Math.round(confidence * 100);
  return (
    <span
      className={cn(
        'ml-1 text-[9px] font-medium',
        pct >= 80 ? 'text-emerald-500' : pct >= 50 ? 'text-amber-500' : 'text-danger-400',
      )}
    >
      {pct}%
    </span>
  );
}

// Compact, non-alarming coverage header that directly answers "leu só X% e
// ficou sem puxar alguns campos": shows the read percentage and an inline,
// expandable list of the fields that were NOT read (missing) plus the
// low-confidence ones, so the user knows exactly what to complete manually.
function CoverageHeader({
  coverage,
  labels,
}: {
  coverage: CoverageSummary;
  labels: Record<string, string>;
}) {
  const [expanded, setExpanded] = useState(false);
  const {
    readPercent,
    effectiveReadPercent,
    missingFields,
    lowConfidenceFields,
    trackedMissingFields,
  } = coverage;
  const missingForReview =
    trackedMissingFields && trackedMissingFields.length > 0 ? trackedMissingFields : missingFields;
  const toReview = missingForReview.length + lowConfidenceFields.length;
  const displayedReadPercent =
    typeof effectiveReadPercent === 'number' && Number.isFinite(effectiveReadPercent)
      ? effectiveReadPercent
      : readPercent;

  // A full read with nothing to flag does not deserve its own banner.
  if (displayedReadPercent >= 100 && toReview === 0) return null;

  const tone =
    displayedReadPercent >= 90
      ? 'border-emerald-100 bg-emerald-50/60 text-emerald-700'
      : displayedReadPercent >= 60
        ? 'border-amber-100 bg-amber-50/60 text-amber-700'
        : 'border-amber-200 bg-amber-50 text-amber-800';

  const readLabel = coverage.effectiveReadPercent == null ? 'Leu' : 'Leu (ponderado)';

  return (
    <div className={cn('rounded-lg border px-3 py-2 text-xs', tone)}>
      <div className="flex items-center justify-between gap-2">
        <span>
          <strong>
            {readLabel} {displayedReadPercent}% dos campos.
          </strong>{' '}
          {toReview > 0
            ? `${toReview} ${toReview === 1 ? 'campo precisa' : 'campos precisam'} de revisão manual.`
            : 'Nenhum campo pendente.'}
        </span>
        {toReview > 0 ? (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="shrink-0 font-medium underline-offset-2 hover:underline"
            aria-expanded={expanded}
          >
            {expanded ? 'Ocultar' : 'Ver campos'}
          </button>
        ) : null}
      </div>

      {expanded && toReview > 0 ? (
        <div className="mt-2 space-y-1.5">
          <p className="text-[11px] opacity-80">
            Ação: revisar o documento original, reenviar arquivo legível ou reprocessar a extração
            antes de usar estes dados no espelho, validação ou Follow-Up.
          </p>
          {missingForReview.length > 0 ? (
            <div>
              <span className="text-[10px] font-semibold uppercase tracking-wider opacity-70">
                Não lidos ({missingForReview.length})
              </span>
              <div className="mt-0.5 flex flex-wrap gap-1">
                {missingForReview.map((key) => (
                  <span
                    key={key}
                    className="rounded bg-white/70 dark:bg-slate-800/70 px-1.5 py-0.5 text-[11px] font-medium"
                  >
                    {friendlyFieldLabel(key, labels)}
                  </span>
                ))}
              </div>
            </div>
          ) : null}
          {lowConfidenceFields.length > 0 ? (
            <div>
              <span className="text-[10px] font-semibold uppercase tracking-wider opacity-70">
                Baixa confiança ({lowConfidenceFields.length})
              </span>
              <div className="mt-0.5 flex flex-wrap gap-1">
                {lowConfidenceFields.map((key) => (
                  <span
                    key={key}
                    className="rounded bg-white/70 dark:bg-slate-800/70 px-1.5 py-0.5 text-[11px] font-medium"
                  >
                    {friendlyFieldLabel(key, labels)}
                  </span>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function renderSecondaryFields(
  entries: [string, unknown][],
  labels: Record<string, string>,
): React.ReactNode {
  if (entries.length === 0) return null;
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1">
      {entries.map(([key, val]) => {
        const { value, confidence: fieldConf } = extractValue(val);
        if (value === null || value === undefined || value === '') return null;
        return (
          <div key={key} className="min-w-0">
            <span className="text-[10px] text-slate-400">{labels[key] || key}</span>
            <p className="text-xs text-slate-600 dark:text-slate-400 truncate">
              {formatValue(value, key)}
              <FieldConfidence confidence={fieldConf} />
            </p>
          </div>
        );
      })}
    </div>
  );
}

export function AiExtractionSummary({
  documentType,
  data,
  confidence,
  coverage,
}: AiExtractionSummaryProps) {
  const labels = FIELD_LABELS[documentType] || FIELD_LABELS.invoice;
  const priority = PRIORITY_FIELDS[documentType] || [];
  const lowDocumentConfidence = confidence != null && confidence < MIN_OPERATIONAL_CONFIDENCE;

  // Separate priority fields from secondary
  const allEntries = Object.entries(data).filter(
    ([key]) =>
      key !== 'items' && key !== 'ncmList' && key !== 'cargoDescription' && !key.startsWith('_'), // meta do harness (_trust) não é campo exibível
  );

  // Prefer the backend coverage summary; otherwise derive it from the field data.
  const effectiveCoverage = coverage ?? deriveCoverage(allEntries, data);

  const priorityEntries = priority
    .map((key) => {
      const entry = allEntries.find(([k]) => k === key);
      return entry ? entry : null;
    })
    .filter(Boolean) as [string, unknown][];

  const secondaryEntries: [string, unknown][] = allEntries.filter(
    ([key]) => !priority.includes(key),
  );

  const items = data.items as Record<string, unknown>[] | undefined;
  const ncmList = data.ncmList as unknown;
  const cargoDescription = extractValue(data.cargoDescription).value;
  const hasNoData = allEntries.every(([, val]) => {
    const { value } = extractValue(val);
    return value === null || value === '' || value === 0;
  });

  if (hasNoData) {
    return (
      <div className="rounded-lg border border-danger-100 bg-danger-50/50 px-3 py-2.5 text-xs text-danger-600">
        <strong>Documento não reconhecido</strong> — A IA não conseguiu extrair dados deste
        documento. Verifique se é o tipo correto ou reprocesse.
      </div>
    );
  }

  return (
    <div className="space-y-2.5">
      <CoverageHeader coverage={effectiveCoverage} labels={labels} />

      {lowDocumentConfidence && (
        <div className="rounded-lg border border-danger-100 bg-danger-50/70 px-3 py-2 text-xs text-danger-700">
          <strong>Baixa confiança</strong> — extração com {Math.round(confidence * 100)}%, abaixo do
          piso operacional. Use estes dados apenas para revisão manual.
        </div>
      )}

      {/* Key fields */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1.5">
        {priorityEntries.map(([key, val]) => {
          const { value, confidence: fieldConf } = extractValue(val);
          return (
            <div key={key} className="min-w-0">
              <span className="text-[10px] font-medium text-slate-400 uppercase tracking-wider">
                {labels[key] || key}
              </span>
              <p className="text-sm font-semibold text-slate-800 dark:text-slate-100 truncate">
                {formatValue(value, key)}
                <FieldConfidence confidence={fieldConf} />
              </p>
            </div>
          );
        })}
      </div>

      {/* Secondary fields */}
      {renderSecondaryFields(secondaryEntries, labels)}

      {/* Items summary */}
      {items && items.length > 0 ? (
        <div className="rounded-lg border border-slate-100 dark:border-slate-700 bg-slate-50/50 px-3 py-2">
          <p className="text-[10px] font-semibold uppercase text-slate-400 mb-1">
            Itens ({items.length})
          </p>
          <div className="max-h-32 overflow-y-auto space-y-0.5">
            {items.slice(0, 10).map((item, idx) => {
              const code = extractValue(item.itemCode || item.code).value;
              const desc = extractValue(item.description).value;
              const qty = extractValue(item.quantity).value;
              const unit = extractValue(item.unitType || item.unit).value;
              // Secondary per-item attributes (only rendered when present) so the
              // EAN/cor/tamanho/peso/NCM the user reported as "missing" are visible
              // without cluttering the primary line.
              const ean = extractValue(item.ean).value;
              const color = extractValue(item.color).value;
              const size = extractValue(item.size).value;
              const netWeight = extractValue(item.netWeight).value;
              const grossWeight = extractValue(item.grossWeight).value;
              const ncm = extractValue(item.ncmCode || item.ncm).value;
              const chips: Array<{ label: string; value: string }> = [];
              if (ean) chips.push({ label: 'EAN', value: String(ean) });
              if (color) chips.push({ label: 'Cor', value: String(color) });
              if (size) chips.push({ label: 'Tam', value: String(size) });
              if (netWeight != null && netWeight !== '')
                chips.push({
                  label: 'Líq',
                  value: `${Number(netWeight).toLocaleString('pt-BR')} kg`,
                });
              if (grossWeight != null && grossWeight !== '')
                chips.push({
                  label: 'Bruto',
                  value: `${Number(grossWeight).toLocaleString('pt-BR')} kg`,
                });
              if (ncm) chips.push({ label: 'NCM', value: String(ncm) });
              return (
                <div key={idx} className="text-xs text-slate-600 dark:text-slate-400">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-slate-400 w-5 text-right">{idx + 1}.</span>
                    {code ? (
                      <span className="font-medium text-slate-700 dark:text-slate-300">
                        {String(code)}
                      </span>
                    ) : null}
                    <span className="truncate flex-1">{desc ? String(desc) : '—'}</span>
                    {qty != null && (
                      <span className="shrink-0 font-medium">
                        {Number(qty).toLocaleString('pt-BR')} {unit ? String(unit) : ''}
                      </span>
                    )}
                  </div>
                  {chips.length > 0 ? (
                    <div className="ml-7 mt-0.5 flex flex-wrap gap-1">
                      {chips.map((chip) => (
                        <span
                          key={chip.label}
                          className="rounded bg-slate-100 dark:bg-slate-700/50 px-1.5 py-0.5 text-[10px] text-slate-500 dark:text-slate-400"
                        >
                          <span className="text-slate-400 dark:text-slate-500">{chip.label}</span>{' '}
                          {chip.value}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>
              );
            })}
            {items.length > 10 ? (
              <p className="text-[10px] text-slate-400 pt-1">+{items.length - 10} itens...</p>
            ) : null}
          </div>
        </div>
      ) : null}

      {/* Cargo description — dedicated block (was filtered out of the summary) */}
      {cargoDescription != null && cargoDescription !== '' ? (
        <CargoDescriptionBlock text={String(cargoDescription)} />
      ) : null}

      {/* NCM list — shown as a dedicated highlight for both Draft BL and BL Final (ohbl) */}
      {ncmList != null ? (
        <div className="text-xs text-slate-500 dark:text-slate-400">
          <span className="font-medium">NCMs:</span>{' '}
          {Array.isArray(extractValue(ncmList).value)
            ? (extractValue(ncmList).value as string[]).join(', ')
            : '—'}
        </div>
      ) : null}
    </div>
  );
}
