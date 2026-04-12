import type React from 'react';
import { cn } from '@/shared/lib/utils';

interface AiExtractionSummaryProps {
  documentType: string;
  data: Record<string, unknown>;
  confidence: number | null;
}

// Field label mapping per document type
const FIELD_LABELS: Record<string, Record<string, string>> = {
  invoice: {
    invoiceNumber: 'Nº Fatura',
    invoiceDate: 'Data',
    exporterName: 'Exportador',
    importerName: 'Importador',
    incoterm: 'Incoterm',
    currency: 'Moeda',
    portOfLoading: 'Porto Embarque',
    portOfDischarge: 'Porto Destino',
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
    importerName: 'Importador',
    totalBoxes: 'Total Caixas',
    totalNetWeight: 'Peso Líquido (kg)',
    totalGrossWeight: 'Peso Bruto (kg)',
    totalCbm: 'CBM (m³)',
  },
  ohbl: {
    blNumber: 'Nº BL',
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
  ohbl: ['blNumber', 'vesselName', 'containerNumber', 'shipmentDate', 'eta', 'portOfDischarge'],
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
    return JSON.stringify(val);
  }
  return String(val);
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

export function AiExtractionSummary({ documentType, data, confidence }: AiExtractionSummaryProps) {
  const labels = FIELD_LABELS[documentType] || FIELD_LABELS.invoice;
  const priority = PRIORITY_FIELDS[documentType] || [];

  // Separate priority fields from secondary
  const allEntries = Object.entries(data).filter(
    ([key]) => key !== 'items' && key !== 'ncmList' && key !== 'cargoDescription',
  );

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
              return (
                <div
                  key={idx}
                  className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-400"
                >
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
              );
            })}
            {items.length > 10 ? (
              <p className="text-[10px] text-slate-400 pt-1">+{items.length - 10} itens...</p>
            ) : null}
          </div>
        </div>
      ) : null}

      {/* NCM list (Draft BL) */}
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
