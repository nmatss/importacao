import { useState, useEffect } from 'react';
import { toast } from 'sonner';
import {
  Send,
  MessageSquare,
  User,
  Paperclip,
  AlertTriangle,
  FileSignature,
  ChevronDown,
  ChevronUp,
  Edit,
  Save,
  X,
} from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useApiQuery } from '@/shared/hooks/useApi';
import { api } from '@/shared/lib/api-client';
import { cn, formatDateTime } from '@/shared/lib/utils';
import { LoadingSpinner } from '@/shared/components/LoadingSpinner';
import { ErrorState } from '@/shared/components/ErrorState';
import type { Communication } from '@/shared/types';
import { getErrorMessage } from '@/shared/utils/errors';

interface EmailSignatureOption {
  id: number;
  name: string;
  signatureHtml: string;
  isDefault: boolean;
}

interface CommunicationTemplateOption {
  id: number;
  name: string;
  recipient: string | null;
  recipientEmail: string | null;
  subject: string;
  body: string;
}

interface ProcessDocument {
  id: number;
  fileName: string;
  documentType: string;
}

interface DraftForm {
  recipient: string;
  recipientEmail: string;
  subject: string;
  body: string;
}

export interface ComunicacoesTabProps {
  processId: string;
}

export function ComunicacoesTab({ processId }: ComunicacoesTabProps) {
  const queryClient = useQueryClient();

  const {
    data: response,
    isLoading,
    error,
    refetch,
  } = useApiQuery<{ data: Communication[]; pagination: unknown }>(
    ['communications', processId],
    `/api/communications/process/${processId}`,
  );

  const [sending, setSending] = useState<number | null>(null);
  const [saving, setSaving] = useState<number | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [draftForm, setDraftForm] = useState<DraftForm>({
    recipient: '',
    recipientEmail: '',
    subject: '',
    body: '',
  });
  const [selectedAttachmentIds, setSelectedAttachmentIds] = useState<number[]>([]);
  const [selectedSignatureId, setSelectedSignatureId] = useState<number | null>(null);

  const { data: emailSignatures, error: signaturesError } = useApiQuery<EmailSignatureOption[]>(
    ['email-signatures'],
    '/api/settings/email-signatures',
  );
  const { data: communicationTemplates } = useApiQuery<CommunicationTemplateOption[]>(
    ['communication-templates'],
    '/api/settings/communication-templates',
  );

  const { data: processDocuments, error: processDocumentsError } = useApiQuery<ProcessDocument[]>(
    ['documents', 'process', processId],
    `/api/documents/process/${processId}`,
    { enabled: Boolean(processId) },
  );

  // Auto-select default signature when signatures load
  useEffect(() => {
    if (emailSignatures && emailSignatures.length > 0 && selectedSignatureId === null) {
      const defaultSig = emailSignatures.find((s) => s.isDefault);
      if (defaultSig) setSelectedSignatureId(defaultSig.id);
    }
  }, [emailSignatures, selectedSignatureId]);

  const startEditing = (comm: Communication) => {
    setExpandedId(comm.id);
    setEditingId(comm.id);
    setDraftForm({
      recipient: comm.recipient,
      recipientEmail: comm.recipientEmail,
      subject: comm.subject,
      body: comm.body,
    });
    setSelectedAttachmentIds(
      (comm.attachments ?? [])
        .map((attachment) => attachment.documentId)
        .filter((documentId): documentId is number => typeof documentId === 'number'),
    );
  };

  const applyTemplate = (template: CommunicationTemplateOption) => {
    setDraftForm((prev) => ({
      ...prev,
      recipient: template.recipient ?? prev.recipient,
      recipientEmail: template.recipientEmail ?? prev.recipientEmail,
      subject: template.subject,
      body: template.body,
    }));
  };

  const stopEditing = () => {
    setEditingId(null);
    setDraftForm({ recipient: '', recipientEmail: '', subject: '', body: '' });
    setSelectedAttachmentIds([]);
  };

  const updateDraft = async (id: number, showToast = true) => {
    setSaving(id);
    try {
      await api.patch<Communication>(`/api/communications/${id}/draft`, {
        recipient: draftForm.recipient,
        recipientEmail: draftForm.recipientEmail,
        subject: draftForm.subject,
        body: draftForm.body,
        attachments: selectedAttachmentIds.map((documentId) => ({ documentId })),
      });
      queryClient.invalidateQueries({ queryKey: ['communications', processId] });
      if (showToast) toast.success('Rascunho atualizado');
      stopEditing();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err));
    } finally {
      setSaving(null);
    }
  };

  const sendEmail = async (id: number) => {
    setSending(id);
    try {
      if (editingId === id) {
        await api.patch<Communication>(`/api/communications/${id}/draft`, {
          recipient: draftForm.recipient,
          recipientEmail: draftForm.recipientEmail,
          subject: draftForm.subject,
          body: draftForm.body,
          attachments: selectedAttachmentIds.map((documentId) => ({ documentId })),
        });
      }
      await api.post(`/api/communications/${id}/send`, {
        signatureId: selectedSignatureId || undefined,
      });
      queryClient.invalidateQueries({ queryKey: ['communications', processId] });
      toast.success('E-mail enviado');
      stopEditing();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err));
    } finally {
      setSending(null);
    }
  };

  if (isLoading) return <LoadingSpinner className="py-8" />;

  // Antes o erro era engolido: `response?.data ?? []` caia no estado vazio e a
  // tela dizia "Nenhum atendimento registrado.". O operador concluia que nao ha
  // e-mail pendente para o fornecedor quando na verdade a chamada falhou.
  if (error && !response) {
    return (
      <ErrorState
        message="Erro ao carregar os atendimentos deste processo."
        onRetry={() => refetch()}
      />
    );
  }

  const comms = response?.data ?? [];
  const staleComms = Boolean(error && response);

  const statusColor = (s: string) => {
    switch (s) {
      case 'sent':
        return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300';
      case 'draft':
        return 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-400';
      case 'failed':
        // `danger` so tem as escalas 50/100/200/500/600/700 no @theme
        // (app/index.css) — usar 900/950 aqui nao geraria classe alguma.
        return 'bg-danger-100 text-danger-700 dark:bg-danger-700/30 dark:text-danger-200';
      default:
        return 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-400';
    }
  };

  const statusLabel = (s: string) => {
    switch (s) {
      case 'sent':
        return 'Enviado';
      case 'draft':
        return 'Rascunho';
      case 'failed':
        return 'Falhou';
      default:
        return s;
    }
  };

  const hasDrafts = comms.some((c) => c.status === 'draft');

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100">Atendimentos</h3>

      {staleComms && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
          Falha ao atualizar os atendimentos. Exibindo a ultima leitura disponivel.
        </div>
      )}

      {/* Degrada as consultas secundarias com aviso em vez de estado vazio: sem
          isso, uma falha aqui esconde a assinatura ou os anexos sem dizer nada. */}
      {signaturesError && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
          Nao foi possivel carregar as assinaturas de e-mail. O envio seguira sem assinatura.
        </div>
      )}

      {/* Signature selector - show when there are drafts and signatures available */}
      {hasDrafts && emailSignatures && emailSignatures.length > 0 && (
        <div className="rounded-xl border border-slate-200/60 dark:border-slate-700/60 bg-slate-50 dark:bg-slate-900 p-4">
          <label
            htmlFor="process-email-signature"
            className="block text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1.5"
          >
            <span className="inline-flex items-center gap-1.5">
              <FileSignature className="h-3.5 w-3.5" />
              Assinatura ao enviar
            </span>
          </label>
          <select
            id="process-email-signature"
            value={selectedSignatureId ?? ''}
            onChange={(e) => setSelectedSignatureId(e.target.value ? Number(e.target.value) : null)}
            className="w-full rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-800 dark:text-slate-100 focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 focus:outline-none transition-all"
          >
            <option value="">Sem assinatura</option>
            {emailSignatures.map((sig) => (
              <option key={sig.id} value={sig.id}>
                {sig.name}
                {sig.isDefault ? ' (padrão)' : ''}
              </option>
            ))}
          </select>
        </div>
      )}
      {comms.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 dark:bg-slate-700">
            <MessageSquare className="h-6 w-6 text-slate-300" />
          </div>
          <p className="text-sm text-slate-500 dark:text-slate-400 font-medium">
            Nenhum atendimento registrado.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {comms.map((comm) => {
            const isExpanded = expandedId === comm.id;
            const isEditing = editingId === comm.id;
            const canSubmitDraft =
              draftForm.recipient.trim() &&
              draftForm.recipientEmail.trim() &&
              draftForm.subject.trim() &&
              draftForm.body.trim();

            return (
              <div
                key={comm.id}
                className="rounded-xl border border-slate-200/60 bg-white dark:bg-slate-800 dark:border-slate-700/60 p-5 transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/30"
              >
                <button
                  type="button"
                  aria-expanded={isExpanded}
                  aria-controls={`process-communication-${comm.id}`}
                  onClick={() => setExpandedId(isExpanded ? null : comm.id)}
                  className="w-full text-left"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 sm:gap-3">
                    <div className="flex min-w-0 items-center gap-2.5">
                      <span
                        className={cn(
                          'inline-flex shrink-0 rounded-lg px-2.5 py-1 text-xs font-bold uppercase tracking-wide',
                          statusColor(comm.status),
                        )}
                      >
                        {statusLabel(comm.status)}
                      </span>
                      <span className="truncate text-sm font-semibold text-slate-800 dark:text-slate-100">
                        {comm.subject}
                      </span>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                        {formatDateTime(comm.sentAt || comm.createdAt)}
                      </span>
                      {isExpanded ? (
                        <ChevronUp className="h-4 w-4 text-slate-400" />
                      ) : (
                        <ChevronDown className="h-4 w-4 text-slate-400" />
                      )}
                    </div>
                  </div>
                </button>

                <div className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-2 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
                  <User className="h-3.5 w-3.5 shrink-0" />
                  <span className="min-w-0 break-words font-medium">{comm.recipient}</span>
                  <span className="col-start-2 min-w-0 break-all">{comm.recipientEmail}</span>
                </div>

                {isExpanded && (
                  <div
                    id={`process-communication-${comm.id}`}
                    className="mt-4 border-t border-slate-100 pt-4 dark:border-slate-700"
                  >
                    {isEditing ? (
                      <div className="space-y-3">
                        {communicationTemplates && communicationTemplates.length > 0 && (
                          <div className="flex flex-wrap gap-2">
                            {communicationTemplates.map((template) => (
                              <button
                                key={template.id}
                                type="button"
                                onClick={() => applyTemplate(template)}
                                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
                              >
                                <MessageSquare className="h-3.5 w-3.5" />
                                {template.name}
                              </button>
                            ))}
                          </div>
                        )}
                        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                          <input
                            type="text"
                            aria-label="Nome do destinatário"
                            value={draftForm.recipient}
                            onChange={(event) =>
                              setDraftForm((prev) => ({ ...prev, recipient: event.target.value }))
                            }
                            placeholder="Nome do destinatario"
                            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 transition-all focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300"
                          />
                          <input
                            type="text"
                            aria-label="E-mail do destinatário"
                            value={draftForm.recipientEmail}
                            onChange={(event) =>
                              setDraftForm((prev) => ({
                                ...prev,
                                recipientEmail: event.target.value,
                              }))
                            }
                            placeholder="email@exemplo.com"
                            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 transition-all focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300"
                          />
                        </div>
                        <input
                          type="text"
                          aria-label="Assunto do atendimento"
                          value={draftForm.subject}
                          onChange={(event) =>
                            setDraftForm((prev) => ({ ...prev, subject: event.target.value }))
                          }
                          placeholder="Assunto"
                          className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 transition-all focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300"
                        />
                        <textarea
                          aria-label="Mensagem do atendimento"
                          value={draftForm.body}
                          onChange={(event) =>
                            setDraftForm((prev) => ({ ...prev, body: event.target.value }))
                          }
                          rows={7}
                          placeholder="Mensagem"
                          className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 transition-all focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300"
                        />

                        <div>
                          <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                            <Paperclip className="h-3.5 w-3.5" />
                            Anexos
                          </p>
                          {processDocumentsError ? (
                            <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
                              Falha ao carregar os documentos do processo — a lista de anexos pode
                              estar incompleta.
                            </p>
                          ) : !processDocuments?.length ? (
                            <p className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-xs text-slate-500 dark:text-slate-400 dark:border-slate-700 dark:bg-slate-900">
                              Nenhum documento disponivel para anexar.
                            </p>
                          ) : (
                            <div className="max-h-36 space-y-1 overflow-y-auto rounded-lg border border-slate-200 bg-slate-50/60 p-2 dark:border-slate-700 dark:bg-slate-900/60">
                              {processDocuments.map((doc) => {
                                const checked = selectedAttachmentIds.includes(doc.id);
                                return (
                                  <label
                                    key={doc.id}
                                    className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-xs text-slate-600 hover:bg-white dark:text-slate-300 dark:hover:bg-slate-800"
                                  >
                                    <input
                                      type="checkbox"
                                      checked={checked}
                                      onChange={(event) =>
                                        setSelectedAttachmentIds((prev) =>
                                          event.target.checked
                                            ? [...prev, doc.id]
                                            : prev.filter((id) => id !== doc.id),
                                        )
                                      }
                                      className="h-3.5 w-3.5 rounded border-slate-300 text-primary-600 dark:text-primary-300"
                                    />
                                    <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] uppercase text-slate-500 dark:bg-slate-800">
                                      {doc.documentType}
                                    </span>
                                    <span className="truncate">{doc.fileName}</span>
                                  </label>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-600 dark:text-slate-400">
                          {comm.body}
                        </p>
                        {comm.attachments && comm.attachments.length > 0 && (
                          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
                            <Paperclip className="h-3.5 w-3.5" />
                            {comm.attachments.map((attachment, index) => (
                              <span
                                key={`${attachment.filename ?? attachment.documentId ?? index}`}
                                className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 dark:border-slate-700 dark:bg-slate-900"
                              >
                                {attachment.filename ?? `Documento ${attachment.documentId}`}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    {comm.errorMessage && (
                      <div className="mt-3 flex items-center gap-2 text-xs text-danger-500">
                        <AlertTriangle className="h-3.5 w-3.5" />
                        <span>{comm.errorMessage}</span>
                      </div>
                    )}

                    {(comm.status === 'draft' || comm.status === 'failed') && (
                      <div className="mt-4 flex flex-wrap justify-end gap-2">
                        {isEditing ? (
                          <>
                            <button
                              type="button"
                              onClick={stopEditing}
                              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
                            >
                              <X className="h-3.5 w-3.5" />
                              Cancelar
                            </button>
                            <button
                              type="button"
                              onClick={() => updateDraft(comm.id)}
                              disabled={!canSubmitDraft || saving === comm.id}
                              className="inline-flex items-center gap-1.5 rounded-lg border border-primary-200 bg-primary-50 px-3 py-1.5 text-xs font-semibold text-primary-700 hover:bg-primary-100 disabled:opacity-50 dark:border-primary-700/50 dark:bg-primary-950/30 dark:text-primary-300 dark:hover:bg-primary-950/30"
                            >
                              {saving === comm.id ? (
                                <LoadingSpinner size="sm" />
                              ) : (
                                <Save className="h-3.5 w-3.5" />
                              )}
                              Salvar
                            </button>
                          </>
                        ) : (
                          <button
                            type="button"
                            onClick={() => startEditing(comm)}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
                          >
                            <Edit className="h-3.5 w-3.5" />
                            {comm.status === 'failed' ? 'Corrigir e tentar novamente' : 'Editar'}
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => sendEmail(comm.id)}
                          disabled={sending === comm.id || (isEditing && !canSubmitDraft)}
                          className="inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-primary-700 disabled:opacity-50"
                        >
                          {sending === comm.id ? (
                            <LoadingSpinner size="sm" />
                          ) : (
                            <Send className="h-3.5 w-3.5" />
                          )}
                          {isEditing ? 'Salvar e enviar' : 'Enviar'}
                        </button>
                      </div>
                    )}
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
