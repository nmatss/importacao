import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
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
  { key: 'draft', label: 'Rascunho' },
  { key: 'documents_received', label: 'Docs Recebidos' },
  { key: 'validating', label: 'Validando' },
  { key: 'validated', label: 'Validado' },
  { key: 'espelho_generated', label: 'Espelho' },
  { key: 'sent_to_fenicia', label: 'Fenícia' },
  { key: 'li_pending', label: 'LI Pendente' },
  { key: 'completed', label: 'Concluído' },
] as const;

const TABS = [
  { key: 'documentos', label: 'Documentos', icon: FileText },
  { key: 'validacao', label: 'Validação', icon: ClipboardCheck },
  { key: 'espelho', label: 'Espelho', icon: FileSpreadsheet },
  { key: 'cambios', label: 'Câmbios', icon: DollarSign },
  { key: 'followup', label: 'Follow-Up', icon: CalendarDays },
  { key: 'comunicacoes', label: 'Comunicações', icon: MessageSquare },
] as const;

function Stepper({ currentStatus }: { currentStatus: string }) {
  const isCancelled = currentStatus === 'cancelled';
  const currentIndex = STEPS.findIndex((s) => s.key === currentStatus);

  return (
    <div className="overflow-x-auto">
      {isCancelled && (
        <div className="mb-3 flex items-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-700">
          <XCircle className="h-4 w-4" />
          Processo Cancelado
        </div>
      )}
      <div className="flex min-w-[600px] items-center">
        {STEPS.map((step, i) => {
          const isCompleted = !isCancelled && i < currentIndex;
          const isCurrent = !isCancelled && i === currentIndex;

          return (
            <div key={step.key} className="flex flex-1 items-center">
              <div className="flex flex-col items-center">
                <div
                  className={cn(
                    'flex h-8 w-8 items-center justify-center rounded-full text-xs font-medium transition-colors',
                    isCancelled
                      ? 'bg-gray-200 text-gray-400'
                      : isCompleted
                        ? 'bg-green-500 text-white'
                        : isCurrent
                          ? 'bg-blue-600 text-white'
                          : 'bg-gray-200 text-gray-500',
                  )}
                >
                  {isCompleted ? (
                    <CheckCircle className="h-4 w-4" />
                  ) : (
                    i + 1
                  )}
                </div>
                <span
                  className={cn(
                    'mt-1 text-[10px] text-center leading-tight max-w-[80px]',
                    isCancelled
                      ? 'text-gray-400'
                      : isCurrent
                        ? 'font-semibold text-blue-700'
                        : 'text-gray-500',
                  )}
                >
                  {step.label}
                </span>
              </div>
              {i < STEPS.length - 1 && (
                <div
                  className={cn(
                    'mx-1 h-0.5 flex-1',
                    !isCancelled && i < currentIndex ? 'bg-green-500' : 'bg-gray-200',
                  )}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function InfoField({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <p className="text-xs font-medium text-gray-500">{label}</p>
      <p className="mt-0.5 text-sm text-gray-900">{value || '-'}</p>
    </div>
  );
}

export function ProcessDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<string>('documentos');

  const { data: process, isLoading } = useApiQuery<Process>(
    ['process', id!],
    `/api/processes/${id}`,
  );

  if (isLoading) {
    return <LoadingSpinner size="lg" className="py-24" />;
  }

  if (!process) {
    return (
      <div className="py-12 text-center text-gray-500">
        Processo não encontrado.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/importacao/processos')}
            className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100 transition-colors"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-2xl font-bold text-gray-900">
                {process.processCode}
              </h2>
              <span className="inline-flex rounded bg-gray-100 px-2 py-0.5 text-xs font-medium capitalize text-gray-600">
                {process.brand}
              </span>
              <StatusBadge status={process.status} />
            </div>
            <p className="mt-0.5 text-sm text-gray-500">
              Criado em {formatDate(process.createdAt)}
              {process.etd && ` | ETD: ${formatDate(process.etd)}`}
              {process.eta && ` | ETA: ${formatDate(process.eta)}`}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {process.driveFolderId && (
            <a
              href={`https://drive.google.com/drive/folders/${process.driveFolderId}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-lg border border-green-300 bg-green-50 px-4 py-2 text-sm font-medium text-green-700 hover:bg-green-100 transition-colors"
            >
              <ExternalLink className="h-4 w-4" />
              Abrir no Drive
            </a>
          )}
          <button
            onClick={() => navigate(`/importacao/processos/${id}/editar`)}
            className="inline-flex items-center gap-2 rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
          >
            <Edit className="h-4 w-4" />
            Editar
          </button>
        </div>
      </div>

      {/* Stepper */}
      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <Stepper currentStatus={process.status} />
      </div>

      {/* Process Info Card (Gap 3) */}
      <div className="rounded-lg border border-gray-200 bg-white p-5">
        <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-gray-500">
          Informacoes do Processo
        </h3>
        <div className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3 lg:grid-cols-4">
          <InfoField label="Exportador" value={process.exporterName} />
          <InfoField label="Importador" value={process.importerName} />
          <InfoField label="Porto Embarque" value={process.portOfLoading} />
          <InfoField label="Porto Destino" value={process.portOfDischarge} />
          <InfoField label="Incoterm" value={process.incoterm} />
          <InfoField
            label="Valor FOB"
            value={process.totalFobValue != null ? formatCurrency(process.totalFobValue) : null}
          />
          <InfoField
            label="Frete"
            value={process.freightValue != null ? formatCurrency(process.freightValue) : null}
          />
          <InfoField
            label="Caixas"
            value={process.totalBoxes != null ? String(process.totalBoxes) : null}
          />
          <InfoField
            label="Peso Liquido"
            value={process.totalNetWeight != null ? formatWeight(process.totalNetWeight) : null}
          />
          <InfoField
            label="Peso Bruto"
            value={process.totalGrossWeight != null ? formatWeight(process.totalGrossWeight) : null}
          />
          <InfoField
            label="CBM"
            value={process.totalCbm != null ? `${process.totalCbm.toFixed(3)} m3` : null}
          />
          <InfoField
            label="Data Embarque"
            value={process.shipmentDate ? formatDate(process.shipmentDate) : null}
          />
        </div>
        {process.notes && (
          <div className="mt-4 border-t border-gray-100 pt-3">
            <p className="text-xs font-medium text-gray-500">Observacoes</p>
            <p className="mt-1 text-sm text-gray-700 whitespace-pre-wrap">{process.notes}</p>
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200">
        <div className="flex gap-1 overflow-x-auto">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.key;

            return (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={cn(
                  'flex items-center gap-1.5 whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-medium transition-colors',
                  isActive
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700',
                )}
              >
                <Icon className="h-4 w-4" />
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Tab content */}
      <div className="rounded-lg border border-gray-200 bg-white p-6">
        {activeTab === 'documentos' && (
          <div className="space-y-6">
            <h3 className="text-lg font-semibold text-gray-900">
              Upload de Documentos
            </h3>
            <DocumentUpload processId={id!} />
            <hr className="border-gray-200" />
            <h3 className="text-lg font-semibold text-gray-900">
              Documentos do Processo
            </h3>
            <DocumentList processId={id!} />
          </div>
        )}

        {activeTab === 'validacao' && (
          <div className="space-y-4">
            <h3 className="text-lg font-semibold text-gray-900">
              Checklist de Validação
            </h3>
            <ValidationChecklist processId={id!} />
          </div>
        )}

        {activeTab === 'espelho' && (
          <div className="space-y-4">
            <h3 className="text-lg font-semibold text-gray-900">
              Espelho de Importação
            </h3>
            <EspelhoPreview processId={id!} />
          </div>
        )}

        {activeTab === 'cambios' && (
          <CambiosTab processId={id!} />
        )}

        {activeTab === 'followup' && (
          <FollowUpTab processId={id!} />
        )}

        {activeTab === 'comunicacoes' && (
          <ComunicacoesTab processId={id!} />
        )}
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
      <h3 className="text-lg font-semibold text-gray-900">
        Câmbios do Processo
      </h3>
      {!data || data.length === 0 ? (
        <p className="py-6 text-center text-sm text-gray-500">
          Nenhum câmbio registrado para este processo.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-200">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-2 text-left text-xs font-medium uppercase text-gray-500">Data</th>
                <th className="px-4 py-2 text-left text-xs font-medium uppercase text-gray-500">De</th>
                <th className="px-4 py-2 text-left text-xs font-medium uppercase text-gray-500">Para</th>
                <th className="px-4 py-2 text-right text-xs font-medium uppercase text-gray-500">Taxa</th>
                <th className="px-4 py-2 text-right text-xs font-medium uppercase text-gray-500">Valor</th>
                <th className="px-4 py-2 text-right text-xs font-medium uppercase text-gray-500">Convertido</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {data.map((ex) => (
                <tr key={ex.id}>
                  <td className="px-4 py-2 text-gray-700">{formatDate(ex.date)}</td>
                  <td className="px-4 py-2 text-gray-700">{ex.currencyFrom}</td>
                  <td className="px-4 py-2 text-gray-700">{ex.currencyTo}</td>
                  <td className="px-4 py-2 text-right text-gray-700">{ex.rate.toFixed(4)}</td>
                  <td className="px-4 py-2 text-right text-gray-700">{ex.amount.toFixed(2)}</td>
                  <td className="px-4 py-2 text-right font-medium text-gray-900">{ex.convertedAmount.toFixed(2)}</td>
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
      <h3 className="text-lg font-semibold text-gray-900">Follow-Up</h3>
      {!data || data.length === 0 ? (
        <p className="py-6 text-center text-sm text-gray-500">
          Nenhum follow-up registrado.
        </p>
      ) : (
        <div className="space-y-3">
          {data.map((entry) => (
            <div
              key={entry.id}
              className={cn(
                'flex items-center gap-4 rounded-lg border p-4',
                entry.completedDate
                  ? 'border-green-200 bg-green-50'
                  : 'border-gray-200 bg-white',
              )}
            >
              <div
                className={cn(
                  'flex h-8 w-8 items-center justify-center rounded-full',
                  entry.completedDate ? 'bg-green-500' : 'bg-gray-200',
                )}
              >
                {entry.completedDate ? (
                  <CheckCircle className="h-4 w-4 text-white" />
                ) : (
                  <CalendarDays className="h-4 w-4 text-gray-500" />
                )}
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium text-gray-900">
                  {entry.eventType}
                </p>
                <p className="text-xs text-gray-500">
                  Previsto: {formatDate(entry.scheduledDate)}
                  {entry.completedDate &&
                    ` | Concluído: ${formatDate(entry.completedDate)}`}
                </p>
                {entry.notes && (
                  <p className="mt-1 text-xs text-gray-600">{entry.notes}</p>
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
      <h3 className="text-lg font-semibold text-gray-900">Comunicações</h3>
      {!data || data.length === 0 ? (
        <p className="py-6 text-center text-sm text-gray-500">
          Nenhuma comunicação registrada.
        </p>
      ) : (
        <div className="space-y-3">
          {data.map((comm) => (
            <div
              key={comm.id}
              className="rounded-lg border border-gray-200 bg-white p-4"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="inline-flex rounded bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">
                    {comm.type}
                  </span>
                  <span className="text-sm font-medium text-gray-900">
                    {comm.subject}
                  </span>
                </div>
                <span className="text-xs text-gray-400">
                  {formatDate(comm.sentAt)}
                </span>
              </div>
              <p className="mt-2 text-sm text-gray-600">{comm.body}</p>
              <p className="mt-1 text-xs text-gray-400">De: {comm.sender}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
