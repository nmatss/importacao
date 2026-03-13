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
  Sparkles,
  Hash,
  FileText,
} from 'lucide-react';
import { formatDate, formatCurrency, formatWeight } from '@/shared/lib/utils';
import type { ImportProcess, AiExtractedData } from '@/shared/types';

export interface ProcessInfoCardProps {
  process: ImportProcess;
}

function InfoField({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: string | null | undefined;
  icon?: React.ComponentType<{ className?: string }>;
}) {
  return (
    <div className="flex items-start gap-3 py-2">
      {Icon && (
        <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-50 text-slate-400">
          <Icon className="h-4 w-4" />
        </div>
      )}
      <div className="min-w-0">
        <p className="text-xs font-medium text-slate-400 uppercase tracking-wider">{label}</p>
        <p className="mt-0.5 text-sm font-medium text-slate-800 truncate">{value || '\u2014'}</p>
      </div>
    </div>
  );
}

function AiDataSection({ data }: { data: AiExtractedData }) {
  const fields: Array<{ key: string; label: string; icon: React.ComponentType<{ className?: string }> }> = [
    { key: 'blNumber', label: 'Numero BL', icon: Hash },
    { key: 'invoiceNumber', label: 'Numero Invoice', icon: FileText },
    { key: 'vessel', label: 'Navio', icon: Ship },
    { key: 'shipowner', label: 'Armador', icon: Anchor },
    { key: 'freightAgent', label: 'Agente de Carga', icon: Truck },
    { key: 'originCountry', label: 'Pais Origem', icon: Globe },
    { key: 'originCity', label: 'Cidade Origem', icon: Globe },
    { key: 'consolidation', label: 'Consolidacao', icon: Package },
    { key: 'company', label: 'Empresa', icon: Building },
  ];

  const populated = fields.filter(f => data[f.key]);
  if (populated.length === 0) return null;

  return (
    <div className="mt-6 rounded-xl border border-blue-100 bg-blue-50/30 p-5">
      <div className="flex items-center gap-2 mb-4">
        <Sparkles className="h-4 w-4 text-blue-500" />
        <p className="text-xs font-bold text-blue-700 uppercase tracking-wider">Dados Extraidos (IA / Planilha)</p>
      </div>
      <div className="grid grid-cols-2 gap-x-8 gap-y-1 sm:grid-cols-3 lg:grid-cols-4">
        {populated.map((f) => (
          <InfoField key={f.key} icon={f.icon} label={f.label} value={String(data[f.key])} />
        ))}
      </div>
    </div>
  );
}

export function ProcessInfoCard({ process }: ProcessInfoCardProps) {
  return (
    <div className="rounded-2xl border border-slate-200/80 bg-white shadow-sm overflow-hidden">
      <div className="border-b border-slate-100 bg-slate-50/50 px-7 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-blue-700 text-white shadow-md shadow-blue-200">
            <Package className="h-4.5 w-4.5" />
          </div>
          <h3 className="text-sm font-bold uppercase tracking-wider text-slate-600">
            Informacoes do Processo
          </h3>
        </div>
      </div>
      <div className="p-7">
        <div className="grid grid-cols-2 gap-x-8 gap-y-1 sm:grid-cols-3 lg:grid-cols-4">
          <InfoField icon={Building} label="Exportador" value={process.exporterName} />
          <InfoField icon={User} label="Importador" value={process.importerName} />
          <InfoField icon={Anchor} label="Porto Embarque" value={process.portOfLoading} />
          <InfoField icon={Ship} label="Porto Destino" value={process.portOfDischarge} />
          <InfoField icon={Globe} label="Incoterm" value={process.incoterm} />
          <InfoField
            icon={Banknote}
            label="Valor FOB"
            value={process.totalFobValue != null ? formatCurrency(process.totalFobValue) : null}
          />
          <InfoField
            icon={Truck}
            label="Frete"
            value={process.freightValue != null ? formatCurrency(process.freightValue) : null}
          />
          <InfoField
            icon={Box}
            label="Caixas"
            value={process.totalBoxes != null ? String(process.totalBoxes) : null}
          />
          <InfoField
            icon={Weight}
            label="Peso Liquido"
            value={process.totalNetWeight != null ? formatWeight(process.totalNetWeight) : null}
          />
          <InfoField
            icon={Weight}
            label="Peso Bruto"
            value={process.totalGrossWeight != null ? formatWeight(process.totalGrossWeight) : null}
          />
          <InfoField
            icon={Package}
            label="CBM"
            value={process.totalCbm != null ? `${Number(process.totalCbm).toFixed(3)} m3` : null}
          />
          <InfoField
            icon={Box}
            label="Container"
            value={process.containerType}
          />
          <InfoField
            icon={CalendarDays}
            label="Data Embarque"
            value={process.shipmentDate ? formatDate(process.shipmentDate) : null}
          />
          {process.exporterAddress && (
            <InfoField icon={Building} label="Endereco Exportador" value={process.exporterAddress} />
          )}
          {process.importerAddress && (
            <InfoField icon={User} label="Endereco Importador" value={process.importerAddress} />
          )}
        </div>

        {/* Payment Terms */}
        {process.paymentTerms && (
          <div className="mt-5 rounded-xl border border-slate-100 bg-slate-50/60 p-4">
            <div className="flex items-center gap-2 mb-2">
              <Banknote className="h-4 w-4 text-slate-400" />
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Termos de Pagamento</p>
            </div>
            <p className="text-sm text-slate-700">
              {(process.paymentTerms as Record<string, unknown>).description as string || JSON.stringify(process.paymentTerms)}
            </p>
          </div>
        )}

        {/* Notes */}
        {process.notes && (
          <div className="mt-5 rounded-xl border border-slate-100 bg-slate-50/60 p-4">
            <div className="flex items-center gap-2 mb-2">
              <StickyNote className="h-4 w-4 text-slate-400" />
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Observacoes</p>
            </div>
            <p className="text-sm text-slate-700 whitespace-pre-wrap leading-relaxed">{process.notes}</p>
          </div>
        )}

        {/* AI Extracted Data */}
        {process.aiExtractedData && <AiDataSection data={process.aiExtractedData} />}
      </div>
    </div>
  );
}
