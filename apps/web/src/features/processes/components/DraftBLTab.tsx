import { useState, useEffect, useCallback } from 'react';
import {
  CheckCircle2,
  Clock,
  Upload,
  ChevronDown,
  AlertTriangle,
  AlertCircle,
  Ship,
  Anchor,
  Package,
  Weight,
  DollarSign,
  TreePine,
  Timer,
  FileSearch,
  Loader2,
  Info,
  GitCompareArrows,
  Check,
  X,
} from 'lucide-react';
import { useApiQuery } from '@/shared/hooks/useApi';
import { cn } from '@/shared/lib/utils';
import { DRAFT_BL_CHECKS } from '@/shared/lib/constants';
import { LoadingSpinner } from '@/shared/components/LoadingSpinner';
import { DocumentUpload } from '@/features/documents/DocumentUpload';

// ── Types ──────────────────────────────────────────────────────────────

interface Document {
  id: number;
  fileName: string;
  documentType: string;
  uploadedAt: string;
  aiProcessingStatus: 'pending' | 'processing' | 'completed' | 'failed';
  aiParsedData?: Record<string, any>;
  aiConfidence?: number | null;
}

interface ChecklistState {
  [key: string]: { checked: boolean; timestamp: string | null };
}

interface DraftBLTabProps {
  processId: string;
}

// ── Helpers ────────────────────────────────────────────────────────────

function getStorageKey(processId: string) {
  return `draft-bl-${processId}`;
}

function loadChecklist(processId: string): ChecklistState {
  try {
    const raw = localStorage.getItem(getStorageKey(processId));
    if (raw) return JSON.parse(raw);
  } catch {
    /* ignore */
  }
  const initial: ChecklistState = {};
  for (const check of DRAFT_BL_CHECKS) {
    initial[check.key] = { checked: false, timestamp: null };
  }
  return initial;
}

function saveChecklist(processId: string, state: ChecklistState) {
  localStorage.setItem(getStorageKey(processId), JSON.stringify(state));
}

function getFieldValue(data: Record<string, any> | undefined, key: string): any {
  if (!data) return null;
  const val = data[key];
  if (val && typeof val === 'object' && 'value' in val) return val.value;
  return val ?? null;
}

function getFieldConfidence(data: Record<string, any> | undefined, key: string): number | null {
  if (!data) return null;
  const val = data[key];
  if (val && typeof val === 'object' && 'confidence' in val) return val.confidence;
  return null;
}

function formatTimestamp(ts: string | null): string | null {
  if (!ts) return null;
  const d = new Date(ts);
  if (isNaN(d.getTime())) return null;
  return d.toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// ── Section A: Upload / View Draft ─────────────────────────────────────

function DraftUploadSection({
  draftDoc,
  processId,
}: {
  draftDoc: Document | null;
  processId: string;
}) {
  const [showUpload, setShowUpload] = useState(!draftDoc);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
          <FileSearch className="h-4 w-4 text-violet-500" />
          Draft BL
        </h3>
        {draftDoc && (
          <button
            onClick={() => setShowUpload(!showUpload)}
            className="text-xs text-slate-400 hover:text-slate-600 flex items-center gap-1"
          >
            <Upload className="h-3 w-3" />
            {showUpload ? 'Ocultar upload' : 'Enviar novo'}
            <ChevronDown
              className={cn('h-3 w-3 transition-transform', showUpload && 'rotate-180')}
            />
          </button>
        )}
      </div>

      {draftDoc ? (
        <div className="rounded-lg border border-violet-200 bg-violet-50/50 px-4 py-3">
          <div className="flex items-center gap-3">
            <span className="inline-flex shrink-0 rounded border border-violet-200 bg-violet-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-violet-700">
              DRAFT
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-slate-800">{draftDoc.fileName}</p>
              <div className="mt-0.5 flex items-center gap-2 text-xs text-slate-500">
                <span>{new Date(draftDoc.uploadedAt).toLocaleDateString('pt-BR')}</span>
                {draftDoc.aiProcessingStatus === 'processing' && (
                  <span className="inline-flex items-center gap-1 text-primary-500">
                    <Loader2 className="h-3 w-3 animate-spin" /> Processando IA...
                  </span>
                )}
                {draftDoc.aiProcessingStatus === 'completed' && (
                  <span className="inline-flex items-center gap-1 text-emerald-600">
                    <CheckCircle2 className="h-3 w-3" /> Dados extraidos
                  </span>
                )}
                {draftDoc.aiProcessingStatus === 'failed' && (
                  <span className="inline-flex items-center gap-1 text-danger-500">
                    <AlertTriangle className="h-3 w-3" /> Erro na extracao
                  </span>
                )}
                {draftDoc.aiConfidence != null && (
                  <span
                    className={cn(
                      'rounded-full px-2 py-0.5 text-[10px] font-medium',
                      draftDoc.aiConfidence >= 0.8
                        ? 'bg-emerald-50 text-emerald-700'
                        : draftDoc.aiConfidence >= 0.5
                          ? 'bg-amber-50 text-amber-700'
                          : 'bg-danger-50 text-danger-700',
                    )}
                  >
                    {Math.round(draftDoc.aiConfidence * 100)}%
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="rounded-lg border-2 border-dashed border-violet-200 bg-violet-50/30 px-4 py-6 text-center">
          <FileSearch className="mx-auto h-8 w-8 text-violet-300" />
          <p className="mt-2 text-sm text-slate-500">Nenhum Draft BL enviado</p>
          <p className="text-xs text-slate-400">Envie o rascunho do BL abaixo</p>
        </div>
      )}

      {(showUpload || !draftDoc) && (
        <div className="mt-2">
          <DocumentUpload processId={processId} />
        </div>
      )}
    </div>
  );
}

// ── Section B: Conference Checklist ────────────────────────────────────

function ConferenceChecklist({ processId }: { processId: string }) {
  const [checklist, setChecklist] = useState<ChecklistState>(() => loadChecklist(processId));

  useEffect(() => {
    setChecklist(loadChecklist(processId));
  }, [processId]);

  const toggleCheck = useCallback(
    (key: string) => {
      setChecklist((prev) => {
        const current = prev[key];
        const updated = {
          ...prev,
          [key]: {
            checked: !current?.checked,
            timestamp: !current?.checked ? new Date().toISOString() : null,
          },
        };
        saveChecklist(processId, updated);
        return updated;
      });
    },
    [processId],
  );

  const completedCount = DRAFT_BL_CHECKS.filter((c) => checklist[c.key]?.checked).length;
  const totalChecks = DRAFT_BL_CHECKS.length;
  const progressPct = Math.round((completedCount / totalChecks) * 100);

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
        <CheckCircle2 className="h-4 w-4 text-violet-500" />
        Conferencia do Draft BL
      </h3>

      {/* Progress bar */}
      <div className="flex items-center gap-4 rounded-lg bg-slate-50 px-4 py-3">
        <div className="flex-1">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-medium text-slate-500">Progresso</span>
            <span className="text-xs font-semibold text-slate-500">
              {completedCount}/{totalChecks} itens ({progressPct}%)
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-slate-200">
            <div
              className={cn(
                'h-full rounded-full transition-all duration-500',
                progressPct === 100
                  ? 'bg-emerald-500'
                  : progressPct > 50
                    ? 'bg-violet-500'
                    : 'bg-amber-500',
              )}
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>
      </div>

      {/* Checklist items */}
      <div className="space-y-1">
        {DRAFT_BL_CHECKS.map((check, index) => {
          const state = checklist[check.key];
          const isChecked = state?.checked ?? false;
          const timestamp = formatTimestamp(state?.timestamp ?? null);

          return (
            <button
              key={check.key}
              type="button"
              onClick={() => toggleCheck(check.key)}
              className={cn(
                'group flex w-full items-center gap-3 rounded-lg border px-4 py-3 text-left transition-all',
                isChecked
                  ? 'border-emerald-200 bg-emerald-50/50 hover:bg-emerald-50'
                  : 'border-slate-150 bg-white hover:bg-slate-50 hover:border-slate-200',
              )}
            >
              <span
                className={cn(
                  'flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold',
                  isChecked ? 'bg-emerald-500 text-white' : 'bg-slate-200 text-slate-500',
                )}
              >
                {isChecked ? <CheckCircle2 className="h-3.5 w-3.5" /> : String(index + 1)}
              </span>

              <div className="min-w-0 flex-1">
                <p
                  className={cn(
                    'text-sm font-medium',
                    isChecked ? 'text-emerald-700' : 'text-slate-700',
                  )}
                >
                  {check.label}
                </p>
                <p className="text-xs text-slate-400 truncate">{check.description}</p>
              </div>

              <div className="shrink-0 text-right">
                {isChecked && timestamp ? (
                  <span className="inline-flex items-center gap-1 text-[11px] text-emerald-600">
                    <Clock className="h-3 w-3" />
                    {timestamp}
                  </span>
                ) : (
                  <span className="text-[11px] text-slate-300 group-hover:text-slate-400">
                    Clique para conferir
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Section C: AI Extracted Data ───────────────────────────────────────

interface ExtractedFieldProps {
  label: string;
  value: any;
  confidence?: number | null;
  icon?: React.ElementType;
  warning?: string | null;
}

function ExtractedField({ label, value, confidence, icon: Icon, warning }: ExtractedFieldProps) {
  const displayValue = value != null && value !== '' ? String(value) : '--';
  const isPlaceholder = displayValue === '--';

  return (
    <div
      className={cn(
        'rounded-lg border px-3 py-2.5',
        warning ? 'border-amber-200 bg-amber-50/50' : 'border-slate-100 bg-white',
      )}
    >
      <div className="flex items-center gap-1.5 mb-1">
        {Icon && <Icon className="h-3.5 w-3.5 text-slate-400" />}
        <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
          {label}
        </span>
        {confidence != null && (
          <span
            className={cn(
              'ml-auto rounded-full px-1.5 py-0.5 text-[9px] font-medium',
              confidence >= 0.8
                ? 'bg-emerald-50 text-emerald-600'
                : confidence >= 0.5
                  ? 'bg-amber-50 text-amber-600'
                  : 'bg-danger-50 text-danger-600',
            )}
          >
            {Math.round(confidence * 100)}%
          </span>
        )}
      </div>
      <p
        className={cn(
          'text-sm font-medium truncate',
          isPlaceholder ? 'text-slate-300 italic' : 'text-slate-800',
        )}
      >
        {displayValue}
      </p>
      {warning && (
        <p className="mt-1 text-[11px] text-amber-600 flex items-center gap-1">
          <AlertCircle className="h-3 w-3 shrink-0" />
          {warning}
        </p>
      )}
    </div>
  );
}

function AIExtractedData({ draftDoc }: { draftDoc: Document | null }) {
  if (!draftDoc || draftDoc.aiProcessingStatus !== 'completed' || !draftDoc.aiParsedData) {
    return (
      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
          <Info className="h-4 w-4 text-violet-500" />
          Dados Extraidos pela IA
        </h3>
        <div className="rounded-lg border border-slate-100 bg-slate-50/50 px-4 py-8 text-center">
          {!draftDoc ? (
            <p className="text-sm text-slate-400">Envie um Draft BL para ver os dados extraidos</p>
          ) : draftDoc.aiProcessingStatus === 'processing' ? (
            <div className="flex flex-col items-center gap-2">
              <Loader2 className="h-6 w-6 text-violet-400 animate-spin" />
              <p className="text-sm text-slate-400">Processando com IA...</p>
            </div>
          ) : (
            <p className="text-sm text-slate-400">Extracao IA nao disponivel</p>
          )}
        </div>
      </div>
    );
  }

  const data = draftDoc.aiParsedData;
  const woodDeclaration = getFieldValue(data, 'woodDeclaration');
  const freeTime = getFieldValue(data, 'freeTime');
  const ncmList = getFieldValue(data, 'ncmList');

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
        <Info className="h-4 w-4 text-violet-500" />
        Dados Extraidos pela IA
      </h3>

      {/* Critical warnings */}
      {woodDeclaration === false && (
        <div className="flex items-center gap-2 rounded-lg border border-danger-200 bg-danger-50 px-4 py-2.5">
          <AlertTriangle className="h-4 w-4 text-danger-500 shrink-0" />
          <div>
            <p className="text-sm font-medium text-danger-700">
              Declaracao de Madeira NAO encontrada
            </p>
            <p className="text-xs text-danger-500">
              A declaracao de madeira e obrigatoria. Solicite ao agente de carga.
            </p>
          </div>
        </div>
      )}

      {(freeTime == null || freeTime === '') && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5">
          <Timer className="h-4 w-4 text-amber-500 shrink-0" />
          <div>
            <p className="text-sm font-medium text-amber-700">Free Time nao informado</p>
            <p className="text-xs text-amber-500">
              Verifique se o free time negociado consta no BL.
            </p>
          </div>
        </div>
      )}

      {/* Main fields grid */}
      <div className="grid grid-cols-2 gap-2">
        <ExtractedField
          label="Embarcador / Shipper"
          value={getFieldValue(data, 'shipper')}
          confidence={getFieldConfidence(data, 'shipper')}
          icon={Package}
        />
        <ExtractedField
          label="Consignee"
          value={getFieldValue(data, 'consignee')}
          confidence={getFieldConfidence(data, 'consignee')}
          icon={Package}
        />
        <ExtractedField
          label="Porto Embarque"
          value={getFieldValue(data, 'portOfLoading')}
          confidence={getFieldConfidence(data, 'portOfLoading')}
          icon={Anchor}
        />
        <ExtractedField
          label="Porto Destino"
          value={getFieldValue(data, 'portOfDischarge')}
          confidence={getFieldConfidence(data, 'portOfDischarge')}
          icon={Anchor}
        />
        <ExtractedField
          label="Navio"
          value={getFieldValue(data, 'vesselName')}
          confidence={getFieldConfidence(data, 'vesselName')}
          icon={Ship}
        />
        <ExtractedField
          label="Container"
          value={getFieldValue(data, 'containerNumber')}
          confidence={getFieldConfidence(data, 'containerNumber')}
          icon={Package}
        />
        <ExtractedField
          label="Peso Bruto (kg)"
          value={getFieldValue(data, 'totalGrossWeight')}
          confidence={getFieldConfidence(data, 'totalGrossWeight')}
          icon={Weight}
        />
        <ExtractedField
          label="CBM (m3)"
          value={getFieldValue(data, 'totalCbm')}
          confidence={getFieldConfidence(data, 'totalCbm')}
          icon={Package}
        />
        <ExtractedField
          label="Frete"
          value={(() => {
            const val = getFieldValue(data, 'freightValue');
            const cur = getFieldValue(data, 'freightCurrency');
            if (val != null && cur) return `${cur} ${val}`;
            if (val != null) return val;
            if (cur) return cur;
            return null;
          })()}
          confidence={getFieldConfidence(data, 'freightValue')}
          icon={DollarSign}
        />
        <ExtractedField
          label="Free Time"
          value={freeTime != null ? `${freeTime} dias` : null}
          confidence={getFieldConfidence(data, 'freeTime')}
          icon={Timer}
          warning={freeTime == null ? 'Nao informado' : null}
        />
        <ExtractedField
          label="Declaracao de Madeira"
          value={woodDeclaration === true ? 'Sim' : woodDeclaration === false ? 'Nao' : null}
          confidence={getFieldConfidence(data, 'woodDeclaration')}
          icon={TreePine}
          warning={woodDeclaration === false ? 'OBRIGATORIO - Nao encontrada' : null}
        />
        <ExtractedField
          label="Total Caixas"
          value={getFieldValue(data, 'totalBoxes')}
          confidence={getFieldConfidence(data, 'totalBoxes')}
          icon={Package}
        />
      </div>

      {/* NCM List */}
      {Array.isArray(ncmList) && ncmList.length > 0 && (
        <div className="rounded-lg border border-slate-100 bg-white px-3 py-2.5">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1.5">
            NCMs encontrados ({ncmList.length})
          </p>
          <div className="flex flex-wrap gap-1.5">
            {ncmList.map((ncm: string, i: number) => (
              <span
                key={i}
                className="inline-flex rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-mono font-medium text-slate-700"
              >
                {ncm}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Cargo description */}
      {getFieldValue(data, 'cargoDescription') && (
        <div className="rounded-lg border border-slate-100 bg-white px-3 py-2.5">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1">
            Descricao da Carga
          </p>
          <p className="text-xs text-slate-600 whitespace-pre-wrap line-clamp-6">
            {getFieldValue(data, 'cargoDescription')}
          </p>
        </div>
      )}
    </div>
  );
}

// ── Section D: Documento Revisado ──────────────────────────────────────

const COMPARISON_FIELDS: { key: string; label: string }[] = [
  { key: 'shipper', label: 'Shipper' },
  { key: 'consignee', label: 'Consignee' },
  { key: 'portOfLoading', label: 'Porto Embarque' },
  { key: 'portOfDischarge', label: 'Porto Destino' },
  { key: 'vesselName', label: 'Navio' },
  { key: 'containerNumber', label: 'Container' },
  { key: 'totalGrossWeight', label: 'Peso Bruto' },
  { key: 'totalCbm', label: 'CBM' },
  { key: 'freightValue', label: 'Frete Valor' },
  { key: 'freightCurrency', label: 'Frete Moeda' },
  { key: 'freeTime', label: 'Free Time' },
  { key: 'woodDeclaration', label: 'Declaracao Madeira' },
  { key: 'totalBoxes', label: 'Total Caixas' },
  { key: 'cargoDescription', label: 'Descricao Carga' },
];

function computeDifferences(
  draftData: Record<string, any> | undefined,
  revisadoData: Record<string, any> | undefined,
): { key: string; label: string; draftValue: string; revisadoValue: string; changed: boolean }[] {
  return COMPARISON_FIELDS.map((field) => {
    const draftVal = getFieldValue(draftData, field.key);
    const revisadoVal = getFieldValue(revisadoData, field.key);
    const draftStr = draftVal != null && draftVal !== '' ? String(draftVal) : '--';
    const revisadoStr = revisadoVal != null && revisadoVal !== '' ? String(revisadoVal) : '--';
    return {
      key: field.key,
      label: field.label,
      draftValue: draftStr,
      revisadoValue: revisadoStr,
      changed: draftStr !== revisadoStr,
    };
  });
}

function RevisadoSection({ draftDocs, processId }: { draftDocs: Document[]; processId: string }) {
  const [showUpload, setShowUpload] = useState(false);

  const originalDoc = draftDocs.length >= 2 ? draftDocs[0] : null;
  const revisadoDoc = draftDocs.length >= 2 ? draftDocs[draftDocs.length - 1] : null;
  const hasRevisado = originalDoc !== null && revisadoDoc !== null;

  const differences =
    hasRevisado &&
    originalDoc.aiProcessingStatus === 'completed' &&
    revisadoDoc.aiProcessingStatus === 'completed' &&
    originalDoc.aiParsedData &&
    revisadoDoc.aiParsedData
      ? computeDifferences(originalDoc.aiParsedData, revisadoDoc.aiParsedData)
      : null;

  const changedCount = differences?.filter((d) => d.changed).length ?? 0;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
          <GitCompareArrows className="h-4 w-4 text-violet-500" />
          Documento Revisado
        </h3>
        <button
          onClick={() => setShowUpload(!showUpload)}
          className="text-xs text-slate-400 hover:text-slate-600 flex items-center gap-1"
        >
          <Upload className="h-3 w-3" />
          {showUpload ? 'Ocultar upload' : 'Enviar Documento Revisado'}
          <ChevronDown className={cn('h-3 w-3 transition-transform', showUpload && 'rotate-180')} />
        </button>
      </div>

      {hasRevisado ? (
        <div className="space-y-3">
          {/* Revisado document info */}
          <div className="rounded-lg border border-emerald-200 bg-emerald-50/50 px-4 py-3">
            <div className="flex items-center gap-3">
              <span className="inline-flex shrink-0 rounded border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-emerald-700">
                REVISADO
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-slate-800">
                  {revisadoDoc.fileName}
                </p>
                <div className="mt-0.5 flex items-center gap-2 text-xs text-slate-500">
                  <span>{new Date(revisadoDoc.uploadedAt).toLocaleDateString('pt-BR')}</span>
                  {revisadoDoc.aiProcessingStatus === 'processing' && (
                    <span className="inline-flex items-center gap-1 text-primary-500">
                      <Loader2 className="h-3 w-3 animate-spin" /> Processando IA...
                    </span>
                  )}
                  {revisadoDoc.aiProcessingStatus === 'completed' && (
                    <span className="inline-flex items-center gap-1 text-emerald-600">
                      <CheckCircle2 className="h-3 w-3" /> Dados extraidos
                    </span>
                  )}
                  {revisadoDoc.aiProcessingStatus === 'failed' && (
                    <span className="inline-flex items-center gap-1 text-danger-500">
                      <AlertTriangle className="h-3 w-3" /> Erro na extracao
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Comparison table */}
          {differences && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-xs text-slate-500">
                <span className="font-medium">Comparativo Draft vs Revisado</span>
                {changedCount > 0 ? (
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
                    {changedCount} {changedCount === 1 ? 'alteracao' : 'alteracoes'}
                  </span>
                ) : (
                  <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                    Sem alteracoes
                  </span>
                )}
              </div>

              <div className="overflow-hidden rounded-lg border border-slate-200">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-slate-50 text-left">
                      <th className="px-3 py-2 font-semibold text-slate-500">Campo</th>
                      <th className="px-3 py-2 font-semibold text-slate-500">Draft</th>
                      <th className="px-3 py-2 font-semibold text-slate-500">Revisado</th>
                      <th className="px-3 py-2 font-semibold text-slate-500 text-center w-20">
                        Status
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {differences.map((diff) => (
                      <tr
                        key={diff.key}
                        className={cn(diff.changed ? 'bg-amber-50/50' : 'bg-white')}
                      >
                        <td className="px-3 py-2 font-medium text-slate-700">{diff.label}</td>
                        <td className="px-3 py-2 text-slate-600 max-w-[150px] truncate">
                          {diff.draftValue}
                        </td>
                        <td
                          className={cn(
                            'px-3 py-2 max-w-[150px] truncate',
                            diff.changed ? 'text-amber-700 font-medium' : 'text-slate-600',
                          )}
                        >
                          {diff.revisadoValue}
                        </td>
                        <td className="px-3 py-2 text-center">
                          {diff.changed ? (
                            <span className="inline-flex items-center gap-1 text-amber-600">
                              <X className="h-3 w-3" />
                              Alterado
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-emerald-600">
                              <Check className="h-3 w-3" />
                              OK
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="rounded-lg border-2 border-dashed border-slate-200 bg-slate-50/30 px-4 py-6 text-center">
          <GitCompareArrows className="mx-auto h-8 w-8 text-slate-300" />
          <p className="mt-2 text-sm text-slate-500">Nenhum documento revisado</p>
          <p className="text-xs text-slate-400">
            Envie a versao revisada do Draft BL apos a conferencia
          </p>
        </div>
      )}

      {showUpload && (
        <div className="mt-2">
          <DocumentUpload processId={processId} />
        </div>
      )}
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────

export function DraftBLTab({ processId }: DraftBLTabProps) {
  const { data: documents, isLoading } = useApiQuery<Document[]>(
    ['documents', processId],
    `/api/documents/process/${processId}`,
    {
      refetchInterval: (query) => {
        const docs = query.state.data;
        if (!docs) return false;
        const hasDraftProcessing = docs.some(
          (d) =>
            d.documentType === 'draft_bl' &&
            (d.aiProcessingStatus === 'processing' || d.aiProcessingStatus === 'pending'),
        );
        return hasDraftProcessing ? 5000 : false;
      },
    },
  );

  if (isLoading) {
    return <LoadingSpinner className="py-8" />;
  }

  // All draft_bl documents sorted by upload date (oldest first)
  const allDraftDocs = (documents ?? [])
    .filter((d) => d.documentType === 'draft_bl')
    .sort((a, b) => new Date(a.uploadedAt).getTime() - new Date(b.uploadedAt).getTime());

  // First draft_bl is the original, shown in sections A and C
  const draftDoc = allDraftDocs.length > 0 ? allDraftDocs[0] : null;

  return (
    <div className="space-y-6">
      {/* Section A: Upload / View Draft */}
      <DraftUploadSection draftDoc={draftDoc} processId={processId} />

      {/* Divider */}
      <div className="border-t border-slate-100" />

      {/* Section B: Conference Checklist */}
      <ConferenceChecklist processId={processId} />

      {/* Divider */}
      <div className="border-t border-slate-100" />

      {/* Section C: AI Extracted Data */}
      <AIExtractedData draftDoc={draftDoc} />

      {/* Divider */}
      <div className="border-t border-slate-100" />

      {/* Section D: Documento Revisado */}
      <RevisadoSection draftDocs={allDraftDocs} processId={processId} />
    </div>
  );
}
