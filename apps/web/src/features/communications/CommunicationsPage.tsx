import { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import DOMPurify from 'dompurify';
import {
  Mail,
  Send,
  Save,
  Sparkles,
  ChevronDown,
  ChevronUp,
  FileText,
  Clock,
  User,
  AtSign,
  PenTool,
} from 'lucide-react';
import { useApiQuery, useApiMutation } from '@/shared/hooks/useApi';
import { api } from '@/shared/lib/api-client';
import { cn, formatDate } from '@/shared/lib/utils';
import { LoadingSpinner } from '@/shared/components/LoadingSpinner';
import { EmptyState } from '@/shared/components/EmptyState';
import { ErrorState } from '@/shared/components/ErrorState';
import { DateRangeFilter } from '@/shared/components/DateRangeFilter';
import { SubmitButton } from '@/shared/components/SubmitButton';
import { getErrorMessage } from '@/shared/utils/errors';

interface EmailSignatureOption {
  id: number;
  name: string;
  signatureHtml: string;
  isDefault: boolean;
}

interface Process {
  id: number;
  processCode: string;
  brand: string;
}

interface Communication {
  id: number;
  processId: number;
  recipient: string;
  recipientEmail: string;
  subject: string;
  body: string;
  status: 'draft' | 'sent' | 'failed';
  createdAt: string;
  sentAt: string | null;
}

interface EmailDraft {
  subject: string;
  body: string;
}

interface ComposerForm {
  processId: string;
  recipient: string;
  recipientEmail: string;
  subject: string;
  body: string;
}

const emptyComposer: ComposerForm = {
  processId: '',
  recipient: '',
  recipientEmail: '',
  subject: '',
  body: '',
};

const statusConfig: Record<string, { label: string; dot: string; bg: string; text: string }> = {
  draft: {
    label: 'Rascunho',
    dot: 'bg-slate-400',
    bg: 'bg-slate-50 dark:bg-slate-900',
    text: 'text-slate-600 dark:text-slate-400',
  },
  sent: { label: 'Enviado', dot: 'bg-emerald-500', bg: 'bg-emerald-50', text: 'text-emerald-700' },
  failed: { label: 'Falhou', dot: 'bg-danger-500', bg: 'bg-danger-50', text: 'text-danger-700' },
};

export function CommunicationsPage() {
  const queryClient = useQueryClient();
  const [composer, setComposer] = useState<ComposerForm>(emptyComposer);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [generatingAi, setGeneratingAi] = useState(false);
  const [sending, setSending] = useState(false);
  const [aiRecipientType, setAiRecipientType] = useState<'fenicia' | 'isa'>('fenicia');
  const [selectedSignatureId, setSelectedSignatureId] = useState<number | null>(null);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  // Fetch signatures
  const { data: signatures } = useApiQuery<EmailSignatureOption[]>(
    ['email-signatures'],
    '/api/settings/email-signatures',
  );

  // Auto-select default signature
  useEffect(() => {
    if (signatures?.length && !selectedSignatureId) {
      const def = signatures.find((s) => s.isDefault);
      setSelectedSignatureId(def?.id ?? signatures[0]?.id ?? null);
    }
  }, [signatures, selectedSignatureId]);

  const { data: processResponse } = useApiQuery<{ data: Process[]; pagination: unknown }>(
    ['processes'],
    '/api/processes?limit=500',
  );
  const processes = processResponse?.data;

  const commParams = new URLSearchParams();
  commParams.set('limit', '100');
  if (startDate) commParams.set('startDate', startDate);
  if (endDate) commParams.set('endDate', endDate);
  const commQs = commParams.toString();

  const {
    data: commsResponse,
    isLoading: loadingComms,
    error: commsError,
    refetch: refetchComms,
  } = useApiQuery<{ data: Communication[]; pagination: unknown }>(
    ['communications', startDate, endDate],
    `/api/communications${commQs ? `?${commQs}` : ''}`,
  );
  const communications = commsResponse?.data;

  const saveDraftMutation = useApiMutation<
    Communication,
    Omit<Communication, 'id' | 'status' | 'createdAt' | 'sentAt'>
  >('/api/communications', 'post', {
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['communications'] });
      setComposer(emptyComposer);
    },
  });

  const handleSaveDraft = () => {
    saveDraftMutation.mutate({
      processId: Number(composer.processId),
      recipient: composer.recipient,
      recipientEmail: composer.recipientEmail,
      subject: composer.subject,
      body: composer.body,
    });
  };

  const handleSend = async () => {
    setSending(true);
    try {
      const draft = await api.post<Communication>('/api/communications', {
        processId: Number(composer.processId),
        recipient: composer.recipient,
        recipientEmail: composer.recipientEmail,
        subject: composer.subject,
        body: composer.body,
      });
      await api.post(`/api/communications/${draft.id}/send`, {
        signatureId: selectedSignatureId,
      });
      toast.success('Email enviado com sucesso');
      queryClient.invalidateQueries({ queryKey: ['communications'] });
      setComposer(emptyComposer);
    } catch (err: unknown) {
      toast.error(getErrorMessage(err));
    } finally {
      setSending(false);
    }
  };

  const handleGenerateAi = async () => {
    if (!composer.processId) return;
    setGeneratingAi(true);
    try {
      const draft = await api.post<EmailDraft>('/api/ai/email-draft', {
        processId: Number(composer.processId),
        recipientType: aiRecipientType,
      });
      setComposer((prev) => ({
        ...prev,
        subject: draft.subject,
        body: draft.body,
      }));
    } catch (err: unknown) {
      toast.error(getErrorMessage(err));
    } finally {
      setGeneratingAi(false);
    }
  };

  const applyTemplate = (template: 'fenicia' | 'isa') => {
    const templates: Record<string, { subject: string; body: string }> = {
      fenicia: {
        subject: 'Documentos para Analise - Processo de Importacao',
        body: `Prezados,\n\nSegue em anexo os documentos referentes ao processo de importacao para analise e providencias.\n\nFicamos no aguardo do retorno.\n\nAtenciosamente,`,
      },
      isa: {
        subject: 'Solicitacao de Documentos - Importacao',
        body: `Prezada Isa,\n\nGostaramos de solicitar os documentos pendentes referentes ao processo de importacao.\n\nPor gentileza, enviar com a maior brevidade possivel.\n\nAtenciosamente,`,
      },
    };
    const t = templates[template];
    setComposer((prev) => ({ ...prev, subject: t.subject, body: t.body }));
  };

  const isFormValid =
    composer.processId &&
    composer.recipient &&
    composer.recipientEmail &&
    composer.subject &&
    composer.body;

  return (
    <div className="space-y-8 animate-fade-in">
      {/* Page Header */}
      <div>
        <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Comunicacoes</h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Compose e gerencie emails para processos de importacao
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:gap-8 xl:grid-cols-5">
        {/* Composer - takes 3 cols */}
        <div className="xl:col-span-3">
          <div className="rounded-2xl border border-slate-200/80 bg-white dark:bg-slate-800 dark:border-slate-700/80 shadow-sm overflow-hidden">
            {/* Gradient header */}
            <div className="bg-gradient-to-r from-primary-600 to-primary-700 px-4 sm:px-6 py-4">
              <h3 className="flex items-center gap-2.5 text-lg font-semibold text-white">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/20">
                  <Mail className="h-4.5 w-4.5 text-white" />
                </div>
                Compor Email
              </h3>
            </div>

            <div className="space-y-5 p-4 sm:p-6">
              {/* Process select */}
              <div>
                <label
                  htmlFor="comm-process"
                  className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300"
                >
                  Processo
                </label>
                <select
                  id="comm-process"
                  value={composer.processId}
                  onChange={(e) => setComposer({ ...composer, processId: e.target.value })}
                  className="w-full rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-700 dark:text-slate-300 focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 focus:outline-none transition-all"
                >
                  <option value="">Selecione um processo</option>
                  {processes?.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.processCode} - {p.brand}
                    </option>
                  ))}
                </select>
              </div>

              {/* Recipient fields */}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label
                    htmlFor="comm-recipient"
                    className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-slate-700 dark:text-slate-300"
                  >
                    <User className="h-3.5 w-3.5 text-slate-400" />
                    Destinatario
                  </label>
                  <input
                    id="comm-recipient"
                    type="text"
                    value={composer.recipient}
                    onChange={(e) => setComposer({ ...composer, recipient: e.target.value })}
                    placeholder="Nome do destinatario"
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-700 dark:text-slate-300 placeholder:text-slate-400 focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 focus:outline-none transition-all"
                  />
                </div>
                <div>
                  <label
                    htmlFor="comm-recipient-email"
                    className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-slate-700 dark:text-slate-300"
                  >
                    <AtSign className="h-3.5 w-3.5 text-slate-400" />
                    Email
                  </label>
                  <input
                    id="comm-recipient-email"
                    type="email"
                    value={composer.recipientEmail}
                    onChange={(e) => setComposer({ ...composer, recipientEmail: e.target.value })}
                    placeholder="email@exemplo.com"
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-700 dark:text-slate-300 placeholder:text-slate-400 focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 focus:outline-none transition-all"
                  />
                </div>
              </div>

              {/* Subject */}
              <div>
                <label
                  htmlFor="comm-subject"
                  className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300"
                >
                  Assunto
                </label>
                <input
                  id="comm-subject"
                  type="text"
                  value={composer.subject}
                  onChange={(e) => setComposer({ ...composer, subject: e.target.value })}
                  placeholder="Assunto do email"
                  className="w-full rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-700 dark:text-slate-300 placeholder:text-slate-400 focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 focus:outline-none transition-all"
                />
              </div>

              {/* Body */}
              <div>
                <label
                  htmlFor="comm-body"
                  className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300"
                >
                  Corpo do Email
                </label>
                <textarea
                  id="comm-body"
                  value={composer.body}
                  onChange={(e) => setComposer({ ...composer, body: e.target.value })}
                  rows={5}
                  placeholder="Escreva o conteudo do email..."
                  className="w-full rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-700 dark:text-slate-300 placeholder:text-slate-400 focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 focus:outline-none transition-all"
                  style={{ minHeight: '120px' }}
                />
              </div>

              {/* Templates & AI */}
              <div>
                <p className="mb-2 text-xs font-medium uppercase tracking-wider text-slate-400">
                  Templates e IA
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  {/* AI with recipient selector */}
                  <div className="inline-flex items-center rounded-xl border border-violet-200 dark:border-violet-800 bg-gradient-to-r from-violet-50 to-violet-50 dark:from-violet-950/40 dark:to-violet-950/40 overflow-hidden">
                    <select
                      value={aiRecipientType}
                      onChange={(e) => setAiRecipientType(e.target.value as 'fenicia' | 'isa')}
                      className="bg-transparent border-none text-xs font-medium text-violet-600 pl-3 pr-1 py-2 focus:ring-0"
                    >
                      <option value="fenicia">Fenicia</option>
                      <option value="isa">Isa</option>
                    </select>
                    <button
                      onClick={handleGenerateAi}
                      disabled={!composer.processId || generatingAi}
                      className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-semibold text-violet-700 hover:bg-violet-100/50 disabled:opacity-50 transition-all"
                    >
                      <Sparkles className="h-4 w-4" />
                      {generatingAi ? 'Gerando...' : 'Gerar com IA'}
                    </button>
                  </div>
                  <button
                    onClick={() => applyTemplate('fenicia')}
                    className="inline-flex items-center gap-2 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 dark:bg-slate-900 hover:border-slate-300 transition-all"
                  >
                    <FileText className="h-4 w-4 text-slate-400" />
                    Template Fenicia
                  </button>
                  <button
                    onClick={() => applyTemplate('isa')}
                    className="inline-flex items-center gap-2 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 dark:bg-slate-900 hover:border-slate-300 transition-all"
                  >
                    <FileText className="h-4 w-4 text-slate-400" />
                    Template Isa
                  </button>
                </div>
              </div>

              {/* Signature selector */}
              {signatures && signatures.length > 0 && (
                <div>
                  <p className="mb-2 text-xs font-medium uppercase tracking-wider text-slate-400">
                    Assinatura
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {signatures.map((sig) => (
                      <button
                        key={sig.id}
                        onClick={() => setSelectedSignatureId(sig.id)}
                        className={cn(
                          'inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-medium transition-all',
                          selectedSignatureId === sig.id
                            ? 'border-primary-300 bg-primary-50 text-primary-700'
                            : 'border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800',
                        )}
                      >
                        <PenTool className="h-3 w-3" />
                        {sig.name}
                        {sig.isDefault && (
                          <span className="text-[10px] text-primary-400">(padrao)</span>
                        )}
                      </button>
                    ))}
                  </div>
                  {selectedSignatureId && (
                    <div className="mt-2 rounded-lg border border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 px-3 py-2">
                      <p className="text-[10px] font-semibold uppercase text-slate-400 mb-1">
                        Preview
                      </p>
                      <div
                        className="text-xs text-slate-600 dark:text-slate-400"
                        dangerouslySetInnerHTML={{
                          __html: DOMPurify.sanitize(
                            signatures.find((s) => s.id === selectedSignatureId)?.signatureHtml ||
                              '',
                          ),
                        }}
                      />
                    </div>
                  )}
                </div>
              )}

              {/* Action Buttons */}
              <div className="flex justify-end gap-3 border-t border-slate-100 dark:border-slate-700 pt-5">
                <button
                  onClick={handleSaveDraft}
                  disabled={!isFormValid || saveDraftMutation.isPending}
                  className="inline-flex items-center gap-2 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 px-5 py-2.5 text-sm font-semibold text-slate-700 dark:text-slate-300 shadow-sm hover:bg-slate-50 dark:hover:bg-slate-800 dark:bg-slate-900 disabled:opacity-50 transition-all"
                >
                  <Save className="h-4 w-4" />
                  Salvar Rascunho
                </button>
                <SubmitButton
                  type="button"
                  onClick={handleSend}
                  loading={sending}
                  disabled={!isFormValid || sending}
                >
                  <Send className="h-4 w-4" />
                  Enviar Email
                </SubmitButton>
              </div>
            </div>
          </div>
        </div>

        {/* History - takes 2 cols */}
        <div className="xl:col-span-2">
          <div className="rounded-2xl border border-slate-200/80 bg-white dark:bg-slate-800 dark:border-slate-700/80 shadow-sm overflow-hidden">
            {/* Header */}
            <div className="border-b border-slate-100 dark:border-slate-700 px-4 sm:px-6 py-4">
              <div className="flex items-center justify-between">
                <h3 className="flex items-center gap-2.5 text-base font-semibold text-slate-900 dark:text-slate-100">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-100 dark:bg-slate-700">
                    <Clock className="h-4 w-4 text-slate-600 dark:text-slate-400" />
                  </div>
                  Historico
                </h3>
                {communications?.length ? (
                  <span className="rounded-full bg-slate-100 dark:bg-slate-700 px-2.5 py-0.5 text-xs font-medium text-slate-600 dark:text-slate-400">
                    {communications.length}
                  </span>
                ) : null}
              </div>
              <div className="mt-3">
                <DateRangeFilter
                  startDate={startDate}
                  endDate={endDate}
                  onStartDateChange={setStartDate}
                  onEndDateChange={setEndDate}
                />
              </div>
            </div>

            <div className="max-h-[calc(100vh-280px)] overflow-y-auto">
              {commsError ? (
                <ErrorState
                  message="Erro ao carregar comunicacoes."
                  onRetry={() => refetchComms()}
                />
              ) : loadingComms ? (
                <LoadingSpinner className="py-12" />
              ) : !communications?.length ? (
                <EmptyState
                  icon={Mail}
                  title="Nenhuma comunicacao"
                  description="As comunicacoes enviadas e rascunhos aparecerao aqui."
                />
              ) : (
                <div className="divide-y divide-slate-100 dark:divide-slate-700">
                  {communications.map((comm) => {
                    const isExpanded = expandedId === comm.id;
                    const config = statusConfig[comm.status] || statusConfig.draft;
                    return (
                      <div key={comm.id}>
                        <button
                          onClick={() => setExpandedId(isExpanded ? null : comm.id)}
                          className="w-full px-5 py-4 text-left hover:bg-slate-50 dark:hover:bg-slate-800/80 transition-colors"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                <p className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
                                  {comm.recipient}
                                </p>
                                <span
                                  className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${config.bg} ${config.text}`}
                                >
                                  <span className={`h-1.5 w-1.5 rounded-full ${config.dot}`} />
                                  {config.label}
                                </span>
                              </div>
                              <p className="mt-1 truncate text-sm text-slate-500 dark:text-slate-400">
                                {comm.subject}
                              </p>
                              <p className="mt-1.5 text-xs text-slate-400">
                                {formatDate(comm.sentAt || comm.createdAt)}
                              </p>
                            </div>
                            <div className="flex shrink-0 items-center pt-0.5">
                              {isExpanded ? (
                                <ChevronUp className="h-4 w-4 text-slate-400" />
                              ) : (
                                <ChevronDown className="h-4 w-4 text-slate-400" />
                              )}
                            </div>
                          </div>
                        </button>
                        {isExpanded && (
                          <div className="border-t border-slate-100 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-900/60 px-3 sm:px-5 py-4">
                            <div className="mb-3 flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                              <AtSign className="h-3 w-3" />
                              {comm.recipient} &lt;{comm.recipientEmail}&gt;
                            </div>
                            <p className="mb-2 text-sm font-medium text-slate-700 dark:text-slate-300">
                              {comm.subject}
                            </p>
                            <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-600 dark:text-slate-400">
                              {comm.body}
                            </p>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
