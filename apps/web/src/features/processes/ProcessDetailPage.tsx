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
} from 'lucide-react';
import { useApiQuery } from '@/shared/hooks/useApi';
import { cn, formatDate, formatCurrency, formatWeight } from '@/shared/lib/utils';
import { StatusBadge } from '@/shared/components/StatusBadge';
import { LoadingSpinner } from '@/shared/components/LoadingSpinner';
import { DocumentUpload } from '@/features/documents/DocumentUpload';
import { DocumentList } from '@/features/documents/DocumentList';
import { ValidationChecklist } from '@/features/validation/ValidationChecklist';
import { EspelhoPreview } from '@/features/espelhos/EspelhoPreview';

interface Process {
  id: string;
  processCode: string;
  brand: string;
  status: string;
  incoterm: string;
  portOfLoading: string | null;
  portOfDischarge: string | null;
  etd: string | null;
  eta: string | null;
  exporterName: string | null;
  importerName: string | null;
  totalFobValue: number | null;
  freightValue: number | null;
  totalBoxes: number | null;
  totalNetWeight: number | null;
  totalGrossWeight: number | null;
  totalCbm: number | null;
  shipmentDate: string | null;
  notes: string | null;
  driveFolderId: string | null;
  createdAt: string;
  updatedAt: string;
}

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
  { key: 'validacao', label: 'Validacao', icon: ClipboardCheck },
  { key: 'espelho', label: 'Espelho', icon: FileSpreadsheet },
  { key: 'cambios', label: 'Cambios', icon: DollarSign },
  { key: 'followup', label: 'Follow-Up', icon: CalendarDays },
  { key: 'comunicacoes', label: 'Comunicacoes', icon: MessageSquare },
] as const;

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
          <button
            onClick={() => navigate(`/importacao/processos/${id}/editar`)}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 hover:border-slate-300 transition-all shadow-sm"
          >
            <Edit className="h-4 w-4" />
            Editar
          </button>
        </div>
      </div>

      {/* Stepper */}
      <div className="rounded-2xl border border-slate-200/80 bg-white p-6 shadow-sm">
        <Stepper currentStatus={process.status} />
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
              value={process.totalCbm != null ? `${process.totalCbm.toFixed(3)} m3` : null}
            />
            <InfoField
              icon={CalendarDays}
              label="Data Embarque"
              value={process.shipmentDate ? formatDate(process.shipmentDate) : null}
            />
          </div>
          {process.notes && (
            <div className="mt-5 rounded-xl border border-slate-100 bg-slate-50/60 p-4">
              <div className="flex items-center gap-2 mb-2">
                <StickyNote className="h-4 w-4 text-slate-400" />
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Observacoes</p>
              </div>
              <p className="text-sm text-slate-700 whitespace-pre-wrap leading-relaxed">{process.notes}</p>
            </div>
          )}
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

          {activeTab === 'validacao' && (
            <div className="space-y-4">
              <h3 className="text-lg font-bold text-slate-800">
                Checklist de Validacao
              </h3>
              <ValidationChecklist processId={id} />
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
        </div>
      </div>
    </div>
  );
}

/* ---- Inline tab components ---- */

function CambiosTab({ processId }: { processId: string }) {
  interface ExchangeRate {
    id: string;
    date: string;
    currencyFrom: string;
    currencyTo: string;
    rate: number;
    amount: number;
    convertedAmount: number;
  }

  const { data, isLoading } = useApiQuery<ExchangeRate[]>(
    ['cambios', processId],
    `/api/currency-exchange?processId=${processId}`,
  );

  if (isLoading) return <LoadingSpinner className="py-8" />;

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-bold text-slate-800">
        Cambios do Processo
      </h3>
      {!data || data.length === 0 ? (
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
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">Data</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">De</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">Para</th>
                <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-slate-500">Taxa</th>
                <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-slate-500">Valor</th>
                <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-slate-500">Convertido</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.map((ex) => (
                <tr key={ex.id} className="hover:bg-slate-50/50 transition-colors">
                  <td className="px-4 py-3 text-slate-700">{formatDate(ex.date)}</td>
                  <td className="px-4 py-3">
                    <span className="inline-flex rounded-lg bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">{ex.currencyFrom}</span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="inline-flex rounded-lg bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">{ex.currencyTo}</span>
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-slate-600">{ex.rate.toFixed(4)}</td>
                  <td className="px-4 py-3 text-right text-slate-700">{ex.amount.toFixed(2)}</td>
                  <td className="px-4 py-3 text-right font-semibold text-slate-900">{ex.convertedAmount.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function FollowUpTab({ processId }: { processId: string }) {
  interface FollowUpEntry {
    id: string;
    eventType: string;
    scheduledDate: string;
    completedDate: string | null;
    notes: string | null;
  }

  const { data, isLoading } = useApiQuery<FollowUpEntry[]>(
    ['followup', processId],
    `/api/follow-up?processId=${processId}`,
  );

  if (isLoading) return <LoadingSpinner className="py-8" />;

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-bold text-slate-800">Follow-Up</h3>
      {!data || data.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100">
            <CalendarDays className="h-6 w-6 text-slate-300" />
          </div>
          <p className="text-sm text-slate-400 font-medium">
            Nenhum follow-up registrado.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {data.map((entry) => (
            <div
              key={entry.id}
              className={cn(
                'flex items-center gap-4 rounded-xl border p-4 transition-colors',
                entry.completedDate
                  ? 'border-emerald-200/80 bg-emerald-50/50'
                  : 'border-slate-200/80 bg-white hover:bg-slate-50/50',
              )}
            >
              <div
                className={cn(
                  'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition-all',
                  entry.completedDate
                    ? 'bg-gradient-to-br from-emerald-500 to-emerald-600 shadow-md shadow-emerald-200'
                    : 'bg-slate-100',
                )}
              >
                {entry.completedDate ? (
                  <CheckCircle className="h-5 w-5 text-white" />
                ) : (
                  <CalendarDays className="h-5 w-5 text-slate-400" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-slate-800">
                  {entry.eventType}
                </p>
                <div className="flex items-center gap-2 mt-0.5">
                  <p className="text-xs text-slate-400">
                    Previsto: <span className="text-slate-600 font-medium">{formatDate(entry.scheduledDate)}</span>
                  </p>
                  {entry.completedDate && (
                    <>
                      <span className="h-1 w-1 rounded-full bg-slate-300" />
                      <p className="text-xs text-emerald-600 font-medium">
                        Concluido: {formatDate(entry.completedDate)}
                      </p>
                    </>
                  )}
                </div>
                {entry.notes && (
                  <p className="mt-1.5 text-xs text-slate-500 leading-relaxed">{entry.notes}</p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ComunicacoesTab({ processId }: { processId: string }) {
  interface Communication {
    id: string;
    type: string;
    subject: string;
    body: string;
    sentAt: string;
    sender: string;
  }

  const { data, isLoading } = useApiQuery<Communication[]>(
    ['communications', processId],
    `/api/communications?processId=${processId}`,
  );

  if (isLoading) return <LoadingSpinner className="py-8" />;

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-bold text-slate-800">Comunicacoes</h3>
      {!data || data.length === 0 ? (
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
          {data.map((comm) => (
            <div
              key={comm.id}
              className="rounded-xl border border-slate-200/80 bg-white p-5 hover:bg-slate-50/30 transition-colors"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className="shrink-0 inline-flex rounded-lg bg-blue-100/80 px-2.5 py-1 text-xs font-bold text-blue-700 uppercase tracking-wide">
                    {comm.type}
                  </span>
                  <span className="text-sm font-semibold text-slate-800 truncate">
                    {comm.subject}
                  </span>
                </div>
                <span className="shrink-0 text-xs text-slate-400 font-medium">
                  {formatDate(comm.sentAt)}
                </span>
              </div>
              <p className="mt-3 text-sm text-slate-600 leading-relaxed">{comm.body}</p>
              <div className="mt-3 flex items-center gap-2 text-xs text-slate-400">
                <User className="h-3.5 w-3.5" />
                <span className="font-medium">{comm.sender}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
