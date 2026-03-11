import { useState } from 'react';
import {
  CheckCircle,
  XCircle,
  AlertTriangle,
  Minus,
  Play,
  Brain,
  Wrench,
  Mail,
  Send,
  X,
  Sparkles,
} from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useApiQuery } from '@/shared/hooks/useApi';
import { api } from '@/shared/lib/api-client';
import { cn } from '@/shared/lib/utils';
import { VALIDATION_CHECK_NAMES } from '@/shared/lib/constants';
import { LoadingSpinner } from '@/shared/components/LoadingSpinner';

interface ValidationCheck {
  id: string;
  checkName: string;
  status: 'passed' | 'failed' | 'warning' | 'skipped';
  expectedValue?: string;
  actualValue?: string;
  message?: string;
  resolvedBy?: string | null;
  resolvedAt?: string | null;
  resolvedManually?: boolean;
}

interface AnomalyDetectionResult {
  anomalies: Anomaly[];
}

interface Anomaly {
  field: string;
  description: string;
  severity: 'high' | 'medium' | 'low';
  confidence: number;
}

interface CorrectionDraft {
  id: number;
  processId: number;
  recipient: string;
  recipientEmail: string;
  subject: string;
  body: string;
  status: string;
}

interface ValidationChecklistProps {
  processId: string;
}

const checkLabel = (name: string) =>
  VALIDATION_CHECK_NAMES.find((c) => c.value === name)?.description ?? name;

const statusConfig = {
  passed: {
    icon: CheckCircle,
    border: 'border-green-200',
    bg: 'bg-green-50',
    iconColor: 'text-green-500',
  },
  failed: {
    icon: XCircle,
    border: 'border-red-200',
    bg: 'bg-red-50',
    iconColor: 'text-red-500',
  },
  warning: {
    icon: AlertTriangle,
    border: 'border-amber-200',
    bg: 'bg-amber-50',
    iconColor: 'text-amber-500',
  },
  skipped: {
    icon: Minus,
    border: 'border-gray-200',
    bg: 'bg-gray-50',
    iconColor: 'text-gray-400',
  },
};

export function ValidationChecklist({ processId }: ValidationChecklistProps) {
  const queryClient = useQueryClient();
  const [running, setRunning] = useState(false);
  const [detectingAnomalies, setDetectingAnomalies] = useState(false);
  const [anomalies, setAnomalies] = useState<Anomaly[] | null>(null);
  const [generatingDraft, setGeneratingDraft] = useState(false);
  const [draft, setDraft] = useState<CorrectionDraft | null>(null);
  const [showDraftModal, setShowDraftModal] = useState(false);
  const [editSubject, setEditSubject] = useState('');
  const [editBody, setEditBody] = useState('');
  const [editRecipientEmail, setEditRecipientEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [saving, setSaving] = useState(false);

  const { data: checks, isLoading } = useApiQuery<ValidationCheck[]>(
    ['validation', processId],
    `/api/validation/${processId}`,
  );

  const runValidation = async () => {
    setRunning(true);
    try {
      await api.post(`/api/validation/${processId}/run`);
      queryClient.invalidateQueries({ queryKey: ['validation', processId] });
    } catch (err: any) {
      alert(err.message || 'Erro ao executar validacao');
    } finally {
      setRunning(false);
    }
  };

  const detectAnomalies = async () => {
    setDetectingAnomalies(true);
    try {
      const data = await api.post<AnomalyDetectionResult>(`/api/validation/${processId}/anomalies`);
      setAnomalies(data.anomalies ?? []);
    } catch (err: any) {
      alert(err.message || 'Erro ao detectar anomalias');
    } finally {
      setDetectingAnomalies(false);
    }
  };

  const resolveManually = async (resultId: string) => {
    try {
      await api.patch(`/api/validation/results/${resultId}/resolve`, { resolution: 'manual' });
      queryClient.invalidateQueries({ queryKey: ['validation', processId] });
    } catch (err: any) {
      alert(err.message || 'Erro ao resolver manualmente');
    }
  };

  const generateCorrectionDraft = async (useAi = false) => {
    setGeneratingDraft(true);
    try {
      const data = await api.post<CorrectionDraft>(
        `/api/validation/${processId}/correction-draft`,
        { useAi },
      );
      setDraft(data);
      setEditSubject(data.subject);
      setEditBody(data.body);
      setEditRecipientEmail(data.recipientEmail);
      setShowDraftModal(true);
    } catch (err: any) {
      alert(err.message || 'Erro ao gerar rascunho de correcao');
    } finally {
      setGeneratingDraft(false);
    }
  };

  const saveDraft = async () => {
    if (!draft) return;
    setSaving(true);
    try {
      const updated = await api.patch<CorrectionDraft>(`/api/communications/${draft.id}/draft`, {
        subject: editSubject,
        body: editBody,
        recipientEmail: editRecipientEmail,
      });
      setDraft(updated);
      alert('Rascunho salvo com sucesso');
    } catch (err: any) {
      alert(err.message || 'Erro ao salvar rascunho');
    } finally {
      setSaving(false);
    }
  };

  const sendEmail = async () => {
    if (!draft) return;
    if (!confirm('Deseja realmente enviar este e-mail de correcao?')) return;
    setSending(true);
    try {
      // Save any edits first
      await api.patch(`/api/communications/${draft.id}/draft`, {
        subject: editSubject,
        body: editBody,
        recipientEmail: editRecipientEmail,
      });
      // Then send
      await api.post(`/api/communications/${draft.id}/send`);
      alert('E-mail enviado com sucesso');
      setShowDraftModal(false);
      setDraft(null);
    } catch (err: any) {
      alert(err.message || 'Erro ao enviar e-mail');
    } finally {
      setSending(false);
    }
  };

  if (isLoading) {
    return <LoadingSpinner className="py-8" />;
  }

  const passedCount = checks?.filter((c) => c.status === 'passed').length ?? 0;
  const failedCount = checks?.filter((c) => c.status === 'failed').length ?? 0;
  const warningCount = checks?.filter((c) => c.status === 'warning').length ?? 0;

  return (
    <div className="space-y-4">
      {/* Actions */}
      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={runValidation}
          disabled={running}
          className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
        >
          {running ? (
            <LoadingSpinner size="sm" />
          ) : (
            <Play className="h-4 w-4" />
          )}
          Executar Validacao
        </button>
        <button
          onClick={detectAnomalies}
          disabled={detectingAnomalies}
          className="inline-flex items-center gap-2 rounded-lg border border-purple-300 bg-purple-50 px-4 py-2 text-sm font-medium text-purple-700 hover:bg-purple-100 disabled:opacity-50 transition-colors"
        >
          {detectingAnomalies ? (
            <LoadingSpinner size="sm" />
          ) : (
            <Brain className="h-4 w-4" />
          )}
          Detectar Anomalias (IA)
        </button>

        {/* Generate Correction Email - only show when there are failures */}
        {failedCount > 0 && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => generateCorrectionDraft(false)}
              disabled={generatingDraft}
              className="inline-flex items-center gap-2 rounded-lg border border-red-300 bg-red-50 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-100 disabled:opacity-50 transition-colors"
            >
              {generatingDraft ? (
                <LoadingSpinner size="sm" />
              ) : (
                <Mail className="h-4 w-4" />
              )}
              Gerar E-mail Correcao
            </button>
            <button
              onClick={() => generateCorrectionDraft(true)}
              disabled={generatingDraft}
              className="inline-flex items-center gap-2 rounded-lg border border-orange-300 bg-orange-50 px-4 py-2 text-sm font-medium text-orange-700 hover:bg-orange-100 disabled:opacity-50 transition-colors"
              title="Gerar com IA (texto mais elaborado)"
            >
              {generatingDraft ? (
                <LoadingSpinner size="sm" />
              ) : (
                <Sparkles className="h-4 w-4" />
              )}
              Gerar com IA
            </button>
          </div>
        )}

        {/* Summary badges */}
        {checks && checks.length > 0 && (
          <div className="flex items-center gap-2 ml-auto text-xs">
            <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2.5 py-1 font-medium text-green-700">
              <CheckCircle className="h-3 w-3" /> {passedCount}
            </span>
            <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2.5 py-1 font-medium text-red-700">
              <XCircle className="h-3 w-3" /> {failedCount}
            </span>
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-1 font-medium text-amber-700">
              <AlertTriangle className="h-3 w-3" /> {warningCount}
            </span>
          </div>
        )}
      </div>

      {/* Checks grid */}
      {checks && checks.length > 0 ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {checks.map((check) => {
            const config = statusConfig[check.status] ?? statusConfig.warning;
            const Icon = config.icon;

            return (
              <div
                key={check.id}
                className={cn(
                  'rounded-lg border p-4 transition-colors',
                  config.border,
                  config.bg,
                )}
              >
                <div className="flex items-start gap-3">
                  <Icon className={cn('mt-0.5 h-5 w-5 shrink-0', config.iconColor)} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-gray-900">
                      {checkLabel(check.checkName)}
                    </p>
                    {check.message && (
                      <p className="mt-0.5 text-xs text-gray-600">{check.message}</p>
                    )}
                    {check.status === 'failed' &&
                      (check.expectedValue || check.actualValue) && (
                        <div className="mt-2 space-y-1 text-xs">
                          {check.expectedValue && (
                            <p>
                              <span className="text-gray-500">Esperado: </span>
                              <span className="font-medium text-gray-800">
                                {check.expectedValue}
                              </span>
                            </p>
                          )}
                          {check.actualValue && (
                            <p>
                              <span className="text-gray-500">Encontrado: </span>
                              <span className="font-medium text-red-700">
                                {check.actualValue}
                              </span>
                            </p>
                          )}
                        </div>
                      )}
                    {check.resolvedManually && check.resolvedBy && (
                      <div className="mt-2 inline-flex items-center gap-1.5 rounded bg-blue-50 px-2 py-1 text-xs text-blue-700">
                        <Wrench className="h-3 w-3" />
                        Resolvido por {check.resolvedBy}
                        {check.resolvedAt && (
                          <span className="text-blue-500">
                            em {new Date(check.resolvedAt).toLocaleDateString('pt-BR', {
                              day: '2-digit', month: '2-digit', year: 'numeric',
                              hour: '2-digit', minute: '2-digit',
                            })}
                          </span>
                        )}
                      </div>
                    )}
                    {check.status === 'failed' && !check.resolvedManually && (
                      <button
                        onClick={() => resolveManually(check.id)}
                        className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-700"
                      >
                        <Wrench className="h-3 w-3" />
                        Resolver Manualmente
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="py-6 text-center text-sm text-gray-500">
          Nenhuma validacao executada ainda. Clique em "Executar Validacao" para iniciar.
        </p>
      )}

      {/* Anomalies */}
      {anomalies && anomalies.length > 0 && (
        <div className="rounded-lg border border-purple-200 bg-purple-50 p-4">
          <h4 className="mb-3 text-sm font-semibold text-purple-900">
            Anomalias Detectadas pela IA
          </h4>
          <div className="space-y-2">
            {anomalies.map((anomaly, i) => (
              <div
                key={i}
                className="flex items-start gap-3 rounded-lg bg-white p-3 border border-purple-100"
              >
                <AlertTriangle
                  className={cn(
                    'mt-0.5 h-4 w-4 shrink-0',
                    anomaly.severity === 'high'
                      ? 'text-red-500'
                      : anomaly.severity === 'medium'
                        ? 'text-amber-500'
                        : 'text-blue-500',
                  )}
                />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-gray-900">{anomaly.field}</p>
                  <p className="text-xs text-gray-600">{anomaly.description}</p>
                </div>
                <span className="text-xs text-gray-400">
                  {(anomaly.confidence * 100).toFixed(0)}%
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {anomalies && anomalies.length === 0 && (
        <div className="rounded-lg border border-green-200 bg-green-50 p-4 text-center">
          <CheckCircle className="mx-auto h-6 w-6 text-green-500" />
          <p className="mt-1 text-sm text-green-700">
            Nenhuma anomalia detectada pela IA.
          </p>
        </div>
      )}

      {/* Correction Draft Modal */}
      {showDraftModal && draft && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="relative w-full max-w-3xl max-h-[90vh] overflow-y-auto rounded-2xl bg-white shadow-xl">
            {/* Header */}
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-white px-6 py-4 rounded-t-2xl">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-red-100">
                  <Mail className="h-4.5 w-4.5 text-red-600" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-slate-900">
                    E-mail de Correcao
                  </h3>
                  <p className="text-xs text-slate-400">
                    Rascunho para {draft.recipient} - Revise antes de enviar
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowDraftModal(false)}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Body */}
            <div className="p-6 space-y-4">
              {/* Recipient Email */}
              <div>
                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
                  Destinatario
                </label>
                <input
                  type="email"
                  value={editRecipientEmail}
                  onChange={(e) => setEditRecipientEmail(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-800 focus:border-blue-400 focus:ring-2 focus:ring-blue-100 outline-none transition-all"
                />
              </div>

              {/* Subject */}
              <div>
                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
                  Assunto
                </label>
                <input
                  type="text"
                  value={editSubject}
                  onChange={(e) => setEditSubject(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-800 focus:border-blue-400 focus:ring-2 focus:ring-blue-100 outline-none transition-all"
                />
              </div>

              {/* Body Preview / Edit */}
              <div>
                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
                  Corpo do E-mail
                </label>
                <div className="rounded-lg border border-slate-200 overflow-hidden">
                  <div
                    className="p-4 text-sm text-slate-700 min-h-[200px] max-h-[400px] overflow-y-auto prose prose-sm prose-slate max-w-none"
                    contentEditable
                    suppressContentEditableWarning
                    onBlur={(e) => setEditBody(e.currentTarget.innerHTML)}
                    dangerouslySetInnerHTML={{ __html: editBody }}
                  />
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="sticky bottom-0 flex items-center justify-end gap-3 border-t border-slate-200 bg-slate-50 px-6 py-4 rounded-b-2xl">
              <button
                onClick={() => setShowDraftModal(false)}
                className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={saveDraft}
                disabled={saving}
                className="inline-flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-4 py-2 text-sm font-medium text-blue-700 hover:bg-blue-100 disabled:opacity-50 transition-colors"
              >
                {saving ? <LoadingSpinner size="sm" /> : <Mail className="h-4 w-4" />}
                Salvar Rascunho
              </button>
              <button
                onClick={sendEmail}
                disabled={sending}
                className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50 transition-colors"
              >
                {sending ? <LoadingSpinner size="sm" /> : <Send className="h-4 w-4" />}
                Enviar E-mail
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
