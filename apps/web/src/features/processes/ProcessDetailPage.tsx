import { useState } from 'react';
import { useParams, useNavigate, Navigate } from 'react-router-dom';
import {
  ArrowLeft,
  Edit,
  FileText,
  ClipboardCheck,
  FileSpreadsheet,
  DollarSign,
  CalendarDays,
  MessageSquare,
  CheckCircle,
  ExternalLink,
  XCircle,
  FileEdit,
  ShieldCheck,
  Sparkles,
  Send,
  Clock,
  Flag,
  Package,
  Anchor,
  Ship,
  Weight,
  Box,
  Globe,
  User,
  Building,
  Banknote,
  StickyNote,
  Truck,
  GitCompareArrows,
  Mail,
  AlertTriangle,
  Info,
  Paperclip,
  Hash,
  BadgeCheck,
  CircleDot,
  Timer,
  BarChart3,
} from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useApiQuery } from '@/shared/hooks/useApi';
import { cn, formatDate, formatCurrency, formatWeight, formatDateTime, relativeTime } from '@/shared/lib/utils';
import { StatusBadge } from '@/shared/components/StatusBadge';
import { LoadingSpinner } from '@/shared/components/LoadingSpinner';
import { DocumentUpload } from '@/features/documents/DocumentUpload';
import { DocumentList } from '@/features/documents/DocumentList';
import { DocumentComparison } from '@/features/documents/DocumentComparison';
import { ValidationChecklist } from '@/features/validation/ValidationChecklist';
import { FupComparisonPanel } from '@/features/validation/FupComparisonPanel';
import { EspelhoPreview } from '@/features/espelhos/EspelhoPreview';

// ── Types ──────────────────────────────────────────────────────────────

interface AiExtractedData {
  blNumber?: string;
  vessel?: string;
  shipowner?: string;
  freightAgent?: string;
  originCountry?: string;
  originCity?: string;
  destinationPort?: string;
  invoiceNumber?: string;
  packingListNumber?: string;
  consolidation?: string;
  company?: string;
  [key: string]: unknown;
}

interface FollowUp {
  id: number;
  processId: number;
  documentsReceivedAt: string | null;
  preInspectionAt: string | null;
  ncmVerifiedAt: string | null;
  espelhoGeneratedAt: string | null;
  sentToFeniciaAt: string | null;
  liSubmittedAt: string | null;
  liApprovedAt: string | null;
  liDeadline: string | null;
  overallProgress: number;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

interface Process {
  id: number;
  processCode: string;
  brand: string;
  status: string;
  incoterm: string | null;
  portOfLoading: string | null;
  portOfDischarge: string | null;
  etd: string | null;
  eta: string | null;
  shipmentDate: string | null;
  exporterName: string | null;
  exporterAddress: string | null;
  importerName: string | null;
  importerAddress: string | null;
  totalFobValue: string | null;
  freightValue: string | null;
  totalBoxes: number | null;
  totalNetWeight: string | null;
  totalGrossWeight: string | null;
  totalCbm: string | null;
  containerType: string | null;
  hasLiItems: boolean;
  hasCertification: boolean;
  hasFreeOfCharge: boolean;
  correctionStatus: string | null;
  paymentTerms: Record<string, unknown> | null;
  aiExtractedData: AiExtractedData | null;
  notes: string | null;
  driveFolderId: string | null;
  sistemaDriveFolderId: string | null;
  createdAt: string;
  updatedAt: string;
  documents: Array<{
    id: number;
    type: string;
    originalFilename: string;
    isProcessed: boolean;
  }>;
  followUp: FollowUp | null;
}

// ── Constants ──────────────────────────────────────────────────────────

const STEPS = [
  { key: 'draft', label: 'Rascunho', icon: FileEdit },
  { key: 'documents_received', label: 'Docs Recebidos', icon: FileText },
  { key: 'validating', label: 'Validando', icon: ClipboardCheck },
  { key: 'validated', label: 'Validado', icon: ShieldCheck },
  { key: 'espelho_generated', label: 'Espelho', icon: Sparkles },
  { key: 'sent_to_fenicia', label: 'Fenicia', icon: Send },
  { key: 'li_pending', label: 'LI Pendente', icon: Clock },
  { key: 'completed', label: 'Concluido', icon: Flag },
] as const;

const TABS = [
  { key: 'documentos', label: 'Documentos', icon: FileText },
  { key: 'comparativo', label: 'Comparativo', icon: GitCompareArrows },
  { key: 'validacao', label: 'Validacao', icon: ClipboardCheck },
  { key: 'espelho', label: 'Espelho', icon: FileSpreadsheet },
  { key: 'cambios', label: 'Cambios', icon: DollarSign },
  { key: 'followup', label: 'Follow-Up', icon: CalendarDays },
  { key: 'comunicacoes', label: 'Comunicacoes', icon: MessageSquare },
  { key: 'emails', label: 'Emails', icon: Mail },
] as const;

// ── Stepper ────────────────────────────────────────────────────────────

function Stepper({ currentStatus }: { currentStatus: string }) {
  const isCancelled = currentStatus === 'cancelled';
  const currentIndex = STEPS.findIndex((s) => s.key === currentStatus);

  return (
    <div className="overflow-x-auto">
      {isCancelled && (
        <div className="mb-4 flex items-center gap-2.5 rounded-xl bg-red-50 border border-red-200/60 px-4 py-3 text-sm font-semibold text-red-700">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-red-100">
            <XCircle className="h-4 w-4 text-red-600" />
          </div>
          Processo Cancelado
        </div>
      )}
      <div className="flex min-w-[700px] items-center px-2 py-1">
        {STEPS.map((step, i) => {
          const isCompleted = !isCancelled && i < currentIndex;
          const isCurrent = !isCancelled && i === currentIndex;
          const StepIcon = step.icon;

          return (
            <div key={step.key} className="flex flex-1 items-center">
              <div className="flex flex-col items-center gap-2">
                <div
                  className={cn(
                    'relative flex h-10 w-10 items-center justify-center rounded-xl text-sm font-semibold transition-all duration-300',
                    isCancelled
                      ? 'bg-slate-100 text-slate-400'
                      : isCompleted
                        ? 'bg-gradient-to-br from-emerald-500 to-emerald-600 text-white shadow-md shadow-emerald-200'
                        : isCurrent
                          ? 'bg-gradient-to-br from-blue-500 to-blue-700 text-white shadow-lg shadow-blue-200 ring-4 ring-blue-100'
                          : 'bg-slate-100 text-slate-400',
                  )}
                >
                  {isCompleted ? (
                    <CheckCircle className="h-5 w-5" />
                  ) : (
                    <StepIcon className="h-4.5 w-4.5" />
                  )}
                </div>
                <span
                  className={cn(
                    'text-[11px] text-center leading-tight max-w-[80px] font-medium transition-colors',
                    isCancelled
                      ? 'text-slate-400'
                      : isCompleted
                        ? 'text-emerald-700'
                        : isCurrent
                          ? 'font-bold text-blue-700'
                          : 'text-slate-400',
                  )}
                >
                  {step.label}
                </span>
              </div>
              {i < STEPS.length - 1 && (
                <div className="relative mx-2 flex-1 h-1 rounded-full overflow-hidden bg-slate-100">
                  <div
                    className={cn(
                      'absolute inset-y-0 left-0 rounded-full transition-all duration-500',
                      !isCancelled && i < currentIndex
                        ? 'w-full bg-gradient-to-r from-emerald-400 to-emerald-500'
                        : !isCancelled && i === currentIndex
                          ? 'w-1/2 bg-gradient-to-r from-blue-400 to-blue-300'
                          : 'w-0',
                    )}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Info Field ─────────────────────────────────────────────────────────

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
        <p className="mt-0.5 text-sm font-medium text-slate-800 truncate">{value || '—'}</p>
      </div>
    </div>
  );
}

// ── Process Flags ──────────────────────────────────────────────────────

function ProcessFlags({ process }: { process: Process }) {
  const flags = [
    { active: process.hasLiItems, label: 'LI', color: 'bg-purple-100 text-purple-700 border-purple-200' },
    { active: process.hasCertification, label: 'Certificacao', color: 'bg-orange-100 text-orange-700 border-orange-200' },
    { active: process.hasFreeOfCharge, label: 'FOC', color: 'bg-yellow-100 text-yellow-700 border-yellow-200' },
  ].filter(f => f.active);

  if (flags.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2">
      {flags.map((f) => (
        <span key={f.label} className={cn('inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-semibold', f.color)}>
          <BadgeCheck className="h-3.5 w-3.5" />
          {f.label}
        </span>
      ))}
    </div>
  );
}

// ── AI Extracted Data Card ─────────────────────────────────────────────

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

// ── Follow-Up Progress ─────────────────────────────────────────────────

function FollowUpProgress({ followUp }: { followUp: FollowUp }) {
  return (
    <div className="mt-4 flex items-center gap-3">
      <BarChart3 className="h-4 w-4 text-slate-400" />
      <div className="flex-1">
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs font-medium text-slate-500">Progresso Geral</span>
          <span className="text-xs font-bold text-slate-700">{followUp.overallProgress}%</span>
        </div>
        <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
          <div
            className="h-full rounded-full bg-gradient-to-r from-blue-500 to-emerald-500 transition-all duration-500"
            style={{ width: `${followUp.overallProgress}%` }}
          />
        </div>
      </div>
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────

export function ProcessDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<string>('documentos');

  if (!id) return <Navigate to="/importacao/processos" replace />;

  const { data: process, isLoading } = useApiQuery<Process>(
    ['process', id],
    `/api/processes/${id}`,
  );

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-32 gap-4">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-500 to-blue-700 shadow-lg shadow-blue-200">
          <Package className="h-7 w-7 text-white animate-pulse" />
        </div>
        <LoadingSpinner size="lg" />
        <p className="text-sm text-slate-400 font-medium">Carregando processo...</p>
      </div>
    );
  }

  if (!process) {
    return (
      <div className="flex flex-col items-center justify-center py-32 gap-4">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100">
          <Package className="h-7 w-7 text-slate-300" />
        </div>
        <p className="text-sm font-medium text-slate-500">Processo nao encontrado.</p>
        <button
          onClick={() => navigate('/importacao/processos')}
          className="mt-2 text-sm font-medium text-blue-600 hover:text-blue-700 transition-colors"
        >
          Voltar para processos
        </button>
      </div>
    );
  }

  const docCounts = {
    total: process.documents?.length ?? 0,
    processed: process.documents?.filter(d => d.isProcessed).length ?? 0,
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-4">
          <button
            onClick={() => navigate('/importacao/processos')}
            className="flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 hover:bg-slate-50 hover:text-slate-700 hover:border-slate-300 transition-all shadow-sm"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div>
            <div className="flex items-center gap-3">
              <h2 className="text-2xl font-bold text-slate-900 tracking-tight">
                {process.processCode}
              </h2>
              <span className="inline-flex items-center rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-semibold capitalize text-slate-600 tracking-wide">
                {process.brand}
              </span>
              <StatusBadge status={process.status} />
              {process.correctionStatus && (
                <span className="inline-flex items-center gap-1 rounded-lg bg-amber-100 border border-amber-200 px-2.5 py-1 text-xs font-semibold text-amber-700">
                  <AlertTriangle className="h-3 w-3" />
                  {process.correctionStatus}
                </span>
              )}
            </div>
            <div className="mt-1.5 flex items-center gap-3 text-sm text-slate-400">
              <span>Criado em {formatDate(process.createdAt)}</span>
              {process.etd && (
                <>
                  <span className="h-1 w-1 rounded-full bg-slate-300" />
                  <span>ETD: <span className="text-slate-600 font-medium">{formatDate(process.etd)}</span></span>
                </>
              )}
              {process.eta && (
                <>
                  <span className="h-1 w-1 rounded-full bg-slate-300" />
                  <span>ETA: <span className="text-slate-600 font-medium">{formatDate(process.eta)}</span></span>
                </>
              )}
              <span className="h-1 w-1 rounded-full bg-slate-300" />
              <span>{docCounts.total} doc{docCounts.total !== 1 ? 's' : ''} ({docCounts.processed} processado{docCounts.processed !== 1 ? 's' : ''})</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2.5">
          {process.driveFolderId && (
            <a
              href={`https://drive.google.com/drive/folders/${process.driveFolderId}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm font-semibold text-emerald-700 hover:bg-emerald-100 hover:border-emerald-300 transition-all shadow-sm"
            >
              <ExternalLink className="h-4 w-4" />
              Abrir no Drive
            </a>
          )}
          {process.sistemaDriveFolderId && (
            <a
              href={`https://drive.google.com/drive/folders/${process.sistemaDriveFolderId}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-4 py-2.5 text-sm font-semibold text-blue-700 hover:bg-blue-100 hover:border-blue-300 transition-all shadow-sm"
            >
              <ExternalLink className="h-4 w-4" />
              Sistema Automatico
            </a>
          )}
          <button
            onClick={() => navigate(`/importacao/processos/${id}/editar`)}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 hover:border-slate-300 transition-all shadow-sm"
          >
            <Edit className="h-4 w-4" />
            Editar
          </button>
        </div>
      </div>

      {/* Flags */}
      <ProcessFlags process={process} />

      {/* Stepper */}
      <div className="rounded-2xl border border-slate-200/80 bg-white p-6 shadow-sm">
        <Stepper currentStatus={process.status} />
        {process.followUp && <FollowUpProgress followUp={process.followUp} />}
      </div>

      {/* Process Info Card */}
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
                {(process.paymentTerms as any).description || JSON.stringify(process.paymentTerms)}
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

      {/* Tabs */}
      <div className="rounded-2xl border border-slate-200/80 bg-white shadow-sm overflow-hidden">
        <div className="border-b border-slate-100 bg-slate-50/40 px-5 pt-4">
          <div className="flex gap-1 overflow-x-auto">
            {TABS.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.key;

              return (
                <button
                  key={tab.key}
                  onClick={() => setActiveTab(tab.key)}
                  className={cn(
                    'relative flex items-center gap-2 whitespace-nowrap rounded-t-xl px-5 py-3 text-sm font-semibold transition-all',
                    isActive
                      ? 'bg-white text-blue-700 shadow-sm border border-slate-200/80 border-b-white -mb-px z-10'
                      : 'text-slate-400 hover:text-slate-600 hover:bg-white/50',
                  )}
                >
                  <Icon className={cn('h-4 w-4', isActive ? 'text-blue-600' : '')} />
                  {tab.label}
                  {isActive && (
                    <div className="absolute bottom-0 left-4 right-4 h-0.5 rounded-full bg-gradient-to-r from-blue-500 to-blue-600" />
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Tab content */}
        <div className="p-7">
          {activeTab === 'documentos' && (
            <div className="space-y-6">
              <h3 className="text-lg font-bold text-slate-800">
                Upload de Documentos
              </h3>
              <DocumentUpload processId={id} />
              <div className="border-t border-slate-100" />
              <h3 className="text-lg font-bold text-slate-800">
                Documentos do Processo
              </h3>
              <DocumentList processId={id} />
            </div>
          )}

          {activeTab === 'comparativo' && (
            <div className="space-y-4">
              <h3 className="text-lg font-bold text-slate-800">
                Comparativo de Documentos
              </h3>
              <p className="text-sm text-slate-500">
                Visualizacao lado a lado dos dados extraidos de Invoice, Packing List e BL.
              </p>
              <DocumentComparison processId={id} />
            </div>
          )}

          {activeTab === 'validacao' && (
            <div className="space-y-4">
              <h3 className="text-lg font-bold text-slate-800">
                Checklist de Validacao
              </h3>
              <ValidationChecklist processId={id} />

              <div className="border-t border-slate-200/80 pt-6 mt-6">
                <h3 className="text-lg font-bold text-slate-800 mb-4">
                  Comparativo Sistema vs Follow-Up
                </h3>
                <FupComparisonPanel processId={id} />
              </div>
            </div>
          )}

          {activeTab === 'espelho' && (
            <div className="space-y-4">
              <h3 className="text-lg font-bold text-slate-800">
                Espelho de Importacao
              </h3>
              <EspelhoPreview processId={id} />
            </div>
          )}

          {activeTab === 'cambios' && (
            <CambiosTab processId={id} />
          )}

          {activeTab === 'followup' && (
            <FollowUpTab processId={id} />
          )}

          {activeTab === 'comunicacoes' && (
            <ComunicacoesTab processId={id} />
          )}

          {activeTab === 'emails' && (
            <EmailsTab processId={id} processCode={process.processCode} />
          )}
        </div>
      </div>
    </div>
  );
}

// ── CambiosTab ─────────────────────────────────────────────────────────

function CambiosTab({ processId }: { processId: string }) {
  interface CurrencyExchange {
    id: number;
    type: 'balance' | 'deposit';
    amountUsd: string;
    exchangeRate: string | null;
    amountBrl: string | null;
    paymentDeadline: string | null;
    expirationDate: string | null;
    notes: string | null;
    createdAt: string;
  }

  interface CurrencyTotals {
    totalBalanceUsd: string;
    totalBalanceBrl: string;
    totalDepositUsd: string;
    totalDepositBrl: string;
  }

  const { data, isLoading } = useApiQuery<{ exchanges: CurrencyExchange[]; totals: CurrencyTotals }>(
    ['cambios', processId],
    `/api/currency-exchange/process/${processId}/totals`,
  );

  if (isLoading) return <LoadingSpinner className="py-8" />;

  const exchanges = data?.exchanges ?? [];
  const totals = data?.totals;

  const typeLabel = (t: string) => t === 'deposit' ? 'Deposito' : 'Saldo';
  const typeColor = (t: string) => t === 'deposit'
    ? 'bg-amber-100 text-amber-700'
    : 'bg-blue-100 text-blue-700';

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-bold text-slate-800">Cambios do Processo</h3>

      {/* Totals summary */}
      {totals && (Number(totals.totalBalanceUsd) > 0 || Number(totals.totalDepositUsd) > 0) && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div className="rounded-xl border border-blue-100 bg-blue-50/50 p-4">
            <p className="text-xs font-semibold text-blue-500 uppercase tracking-wider">Saldo USD</p>
            <p className="mt-1 text-lg font-bold text-blue-800">{formatCurrency(totals.totalBalanceUsd)}</p>
          </div>
          <div className="rounded-xl border border-blue-100 bg-blue-50/50 p-4">
            <p className="text-xs font-semibold text-blue-500 uppercase tracking-wider">Saldo BRL</p>
            <p className="mt-1 text-lg font-bold text-blue-800">{formatCurrency(totals.totalBalanceBrl, 'BRL')}</p>
          </div>
          <div className="rounded-xl border border-amber-100 bg-amber-50/50 p-4">
            <p className="text-xs font-semibold text-amber-500 uppercase tracking-wider">Deposito USD</p>
            <p className="mt-1 text-lg font-bold text-amber-800">{formatCurrency(totals.totalDepositUsd)}</p>
          </div>
          <div className="rounded-xl border border-amber-100 bg-amber-50/50 p-4">
            <p className="text-xs font-semibold text-amber-500 uppercase tracking-wider">Deposito BRL</p>
            <p className="mt-1 text-lg font-bold text-amber-800">{formatCurrency(totals.totalDepositBrl, 'BRL')}</p>
          </div>
        </div>
      )}

      {exchanges.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100">
            <DollarSign className="h-6 w-6 text-slate-300" />
          </div>
          <p className="text-sm text-slate-400 font-medium">
            Nenhum cambio registrado para este processo.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200/80">
          <table className="min-w-full divide-y divide-slate-100 text-sm">
            <thead className="bg-slate-50/80">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">Tipo</th>
                <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-slate-500">Valor USD</th>
                <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-slate-500">Taxa</th>
                <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-slate-500">Valor BRL</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">Vencimento</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">Validade</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">Obs.</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {exchanges.map((ex) => (
                <tr key={ex.id} className="hover:bg-slate-50/50 transition-colors">
                  <td className="px-4 py-3">
                    <span className={cn('inline-flex rounded-lg px-2.5 py-0.5 text-xs font-semibold', typeColor(ex.type))}>
                      {typeLabel(ex.type)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-slate-700">{formatCurrency(ex.amountUsd)}</td>
                  <td className="px-4 py-3 text-right font-mono text-slate-600">
                    {ex.exchangeRate ? Number(ex.exchangeRate).toFixed(4) : '—'}
                  </td>
                  <td className="px-4 py-3 text-right font-semibold text-slate-900">
                    {ex.amountBrl ? formatCurrency(ex.amountBrl, 'BRL') : '—'}
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {ex.paymentDeadline ? formatDate(ex.paymentDeadline) : '—'}
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {ex.expirationDate ? formatDate(ex.expirationDate) : '—'}
                  </td>
                  <td className="px-4 py-3 text-slate-500 max-w-[200px] truncate" title={ex.notes ?? ''}>
                    {ex.notes || '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── FollowUpTab ────────────────────────────────────────────────────────

function FollowUpTab({ processId }: { processId: string }) {
  interface TrackingData {
    id: number;
    processId: number;
    documentsReceivedAt: string | null;
    preInspectionAt: string | null;
    ncmVerifiedAt: string | null;
    espelhoGeneratedAt: string | null;
    sentToFeniciaAt: string | null;
    liSubmittedAt: string | null;
    liApprovedAt: string | null;
    liDeadline: string | null;
    overallProgress: number;
    notes: string | null;
    createdAt: string;
    updatedAt: string;
  }

  const { data: tracking, isLoading } = useApiQuery<TrackingData>(
    ['followup', processId],
    `/api/follow-up/${processId}`,
  );

  if (isLoading) return <LoadingSpinner className="py-8" />;

  if (!tracking) {
    return (
      <div className="flex flex-col items-center justify-center py-12 gap-3">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100">
          <CalendarDays className="h-6 w-6 text-slate-300" />
        </div>
        <p className="text-sm text-slate-400 font-medium">
          Nenhum acompanhamento encontrado para este processo.
        </p>
      </div>
    );
  }

  const steps = [
    { key: 'documentsReceivedAt', label: 'Documentos Recebidos', icon: FileText },
    { key: 'preInspectionAt', label: 'Pre-Inspecao', icon: ClipboardCheck },
    { key: 'ncmVerifiedAt', label: 'NCM Verificado', icon: ShieldCheck },
    { key: 'espelhoGeneratedAt', label: 'Espelho Gerado', icon: FileSpreadsheet },
    { key: 'sentToFeniciaAt', label: 'Enviado a Fenicia', icon: Send },
    { key: 'liSubmittedAt', label: 'LI Submetida', icon: FileEdit },
    { key: 'liApprovedAt', label: 'LI Aprovada', icon: CheckCircle },
  ] as const;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-bold text-slate-800">Acompanhamento (Follow-Up)</h3>
        <span className="text-sm font-semibold text-slate-500">
          Progresso: <span className="text-blue-700">{tracking.overallProgress}%</span>
        </span>
      </div>

      {/* Progress bar */}
      <div className="h-3 rounded-full bg-slate-100 overflow-hidden">
        <div
          className="h-full rounded-full bg-gradient-to-r from-blue-500 to-emerald-500 transition-all duration-500"
          style={{ width: `${tracking.overallProgress}%` }}
        />
      </div>

      {/* Steps timeline */}
      <div className="space-y-3">
        {steps.map(({ key, label, icon: StepIcon }) => {
          const dateValue = tracking[key as keyof TrackingData] as string | null;
          const isCompleted = !!dateValue;

          return (
            <div
              key={key}
              className={cn(
                'flex items-center gap-4 rounded-xl border p-4 transition-colors',
                isCompleted
                  ? 'border-emerald-200/80 bg-emerald-50/50'
                  : 'border-slate-200/80 bg-white',
              )}
            >
              <div
                className={cn(
                  'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition-all',
                  isCompleted
                    ? 'bg-gradient-to-br from-emerald-500 to-emerald-600 shadow-md shadow-emerald-200'
                    : 'bg-slate-100',
                )}
              >
                {isCompleted ? (
                  <CheckCircle className="h-5 w-5 text-white" />
                ) : (
                  <StepIcon className="h-5 w-5 text-slate-400" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className={cn('text-sm font-semibold', isCompleted ? 'text-emerald-800' : 'text-slate-500')}>
                  {label}
                </p>
                {isCompleted && (
                  <p className="text-xs text-emerald-600 font-medium mt-0.5">
                    {formatDateTime(dateValue!)}
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* LI Deadline */}
      {tracking.liDeadline && (
        <div className="rounded-xl border border-amber-200 bg-amber-50/50 p-4">
          <div className="flex items-center gap-3">
            <Timer className="h-5 w-5 text-amber-600" />
            <div>
              <p className="text-xs font-semibold text-amber-600 uppercase tracking-wider">Prazo LI</p>
              <p className="text-sm font-bold text-amber-800 mt-0.5">{formatDate(tracking.liDeadline)}</p>
            </div>
          </div>
        </div>
      )}

      {/* Notes */}
      {tracking.notes && (
        <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-4">
          <div className="flex items-center gap-2 mb-2">
            <StickyNote className="h-4 w-4 text-slate-400" />
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Observacoes</p>
          </div>
          <p className="text-sm text-slate-700 whitespace-pre-wrap leading-relaxed">{tracking.notes}</p>
        </div>
      )}
    </div>
  );
}

// ── ComunicacoesTab ────────────────────────────────────────────────────

function ComunicacoesTab({ processId }: { processId: string }) {
  const queryClient = useQueryClient();

  interface Communication {
    id: number;
    recipient: string;
    recipientEmail: string;
    subject: string;
    body: string;
    status: 'draft' | 'sent' | 'failed';
    sentAt: string | null;
    errorMessage: string | null;
    attachments: Array<{ filename: string }> | null;
    createdAt: string;
  }

  const { data: response, isLoading } = useApiQuery<{ data: Communication[]; pagination: unknown }>(
    ['communications', processId],
    `/api/communications/process/${processId}`,
  );

  const [sending, setSending] = useState<number | null>(null);

  const sendEmail = async (id: number) => {
    setSending(id);
    try {
      const token = localStorage.getItem('importacao_token');
      const baseUrl = import.meta.env.VITE_API_URL || '';
      const res = await fetch(`${baseUrl}/api/communications/${id}/send`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error('Falha ao enviar');
      queryClient.invalidateQueries({ queryKey: ['communications', processId] });
    } catch (err: any) {
      alert(err.message || 'Erro ao enviar comunicacao');
    } finally {
      setSending(null);
    }
  };

  if (isLoading) return <LoadingSpinner className="py-8" />;

  const comms = response?.data ?? [];

  const statusColor = (s: string) => {
    switch (s) {
      case 'sent': return 'bg-emerald-100 text-emerald-700';
      case 'draft': return 'bg-slate-100 text-slate-600';
      case 'failed': return 'bg-red-100 text-red-700';
      default: return 'bg-slate-100 text-slate-600';
    }
  };

  const statusLabel = (s: string) => {
    switch (s) {
      case 'sent': return 'Enviado';
      case 'draft': return 'Rascunho';
      case 'failed': return 'Falhou';
      default: return s;
    }
  };

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-bold text-slate-800">Comunicacoes</h3>
      {comms.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100">
            <MessageSquare className="h-6 w-6 text-slate-300" />
          </div>
          <p className="text-sm text-slate-400 font-medium">
            Nenhuma comunicacao registrada.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {comms.map((comm) => (
            <div
              key={comm.id}
              className="rounded-xl border border-slate-200/80 bg-white p-5 hover:bg-slate-50/30 transition-colors"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className={cn('shrink-0 inline-flex rounded-lg px-2.5 py-1 text-xs font-bold uppercase tracking-wide', statusColor(comm.status))}>
                    {statusLabel(comm.status)}
                  </span>
                  <span className="text-sm font-semibold text-slate-800 truncate">
                    {comm.subject}
                  </span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {comm.status === 'draft' && (
                    <button
                      onClick={() => sendEmail(comm.id)}
                      disabled={sending === comm.id}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
                    >
                      {sending === comm.id ? <LoadingSpinner size="sm" /> : <Send className="h-3.5 w-3.5" />}
                      Enviar
                    </button>
                  )}
                  <span className="text-xs text-slate-400 font-medium">
                    {formatDateTime(comm.sentAt || comm.createdAt)}
                  </span>
                </div>
              </div>
              <div className="mt-2 flex items-center gap-2 text-xs text-slate-400">
                <User className="h-3.5 w-3.5" />
                <span className="font-medium">{comm.recipient}</span>
                <span className="text-slate-300">|</span>
                <span>{comm.recipientEmail}</span>
              </div>
              {comm.attachments && comm.attachments.length > 0 && (
                <div className="mt-2 flex items-center gap-2 text-xs text-slate-400">
                  <Paperclip className="h-3.5 w-3.5" />
                  <span>{comm.attachments.length} anexo{comm.attachments.length !== 1 ? 's' : ''}</span>
                </div>
              )}
              {comm.errorMessage && (
                <div className="mt-2 flex items-center gap-2 text-xs text-red-500">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  <span>{comm.errorMessage}</span>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── EmailsTab ──────────────────────────────────────────────────────────

function EmailsTab({ processId, processCode }: { processId: string; processCode: string }) {
  interface EmailLog {
    id: number;
    messageId: string;
    fromAddress: string;
    subject: string;
    receivedAt: string;
    status: 'pending' | 'processing' | 'completed' | 'failed' | 'ignored';
    attachmentsCount: number;
    processedAttachments: Array<{ filename: string; documentId?: number }> | null;
    processCode: string | null;
    errorMessage: string | null;
    createdAt: string;
  }

  const { data: response, isLoading } = useApiQuery<{ data: EmailLog[]; pagination: unknown }>(
    ['email-logs', processId],
    `/api/email-ingestion/logs?limit=50`,
  );

  if (isLoading) return <LoadingSpinner className="py-8" />;

  // Filter logs related to this process
  const allLogs = response?.data ?? [];
  const logs = allLogs.filter(l => l.processCode === processCode || String(l.processCode) === processCode);

  const statusConfig: Record<string, { color: string; label: string }> = {
    completed: { color: 'bg-emerald-100 text-emerald-700', label: 'Concluido' },
    processing: { color: 'bg-blue-100 text-blue-700', label: 'Processando' },
    pending: { color: 'bg-slate-100 text-slate-600', label: 'Pendente' },
    failed: { color: 'bg-red-100 text-red-700', label: 'Falhou' },
    ignored: { color: 'bg-slate-100 text-slate-400', label: 'Ignorado' },
  };

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-bold text-slate-800">Emails Recebidos</h3>
      <p className="text-sm text-slate-500">
        Emails processados automaticamente que foram vinculados a este processo.
      </p>
      {logs.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100">
            <Mail className="h-6 w-6 text-slate-300" />
          </div>
          <p className="text-sm text-slate-400 font-medium">
            Nenhum email vinculado a este processo.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {logs.map((log) => {
            const cfg = statusConfig[log.status] ?? statusConfig.pending;
            return (
              <div
                key={log.id}
                className="rounded-xl border border-slate-200/80 bg-white p-4 hover:bg-slate-50/30 transition-colors"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className={cn('shrink-0 inline-flex rounded-lg px-2 py-0.5 text-xs font-semibold', cfg.color)}>
                      {cfg.label}
                    </span>
                    <span className="text-sm font-semibold text-slate-800 truncate">{log.subject}</span>
                  </div>
                  <span className="shrink-0 text-xs text-slate-400 font-medium">
                    {formatDateTime(log.receivedAt)}
                  </span>
                </div>
                <div className="mt-2 flex items-center gap-3 text-xs text-slate-400">
                  <span className="font-medium">{log.fromAddress}</span>
                  {log.attachmentsCount > 0 && (
                    <>
                      <span className="h-1 w-1 rounded-full bg-slate-300" />
                      <span className="flex items-center gap-1">
                        <Paperclip className="h-3 w-3" />
                        {log.attachmentsCount} anexo{log.attachmentsCount !== 1 ? 's' : ''}
                      </span>
                    </>
                  )}
                </div>
                {log.processedAttachments && log.processedAttachments.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {log.processedAttachments.map((att, i) => (
                      <span key={i} className="inline-flex items-center gap-1 rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                        <FileText className="h-3 w-3" />
                        {att.filename}
                      </span>
                    ))}
                  </div>
                )}
                {log.errorMessage && (
                  <div className="mt-2 text-xs text-red-500 flex items-center gap-1">
                    <AlertTriangle className="h-3 w-3" />
                    {log.errorMessage}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
