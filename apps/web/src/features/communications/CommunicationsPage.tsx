import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Mail, Send, Save, Sparkles, ChevronDown, ChevronUp, FileText, Clock, User, AtSign } from 'lucide-react';
import { useApiQuery, useApiMutation } from '@/shared/hooks/useApi';
import { api } from '@/shared/lib/api-client';
import { formatDate } from '@/shared/lib/utils';
import { LoadingSpinner } from '@/shared/components/LoadingSpinner';
import { EmptyState } from '@/shared/components/EmptyState';

interface Process {
  id: string;
  processCode: string;
  brand: string;
}

interface Communication {
  id: string;
  processId: string;
  recipientName: string;
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
  recipientName: string;
  recipientEmail: string;
  subject: string;
  body: string;
}

const emptyComposer: ComposerForm = {
  processId: '',
  recipientName: '',
  recipientEmail: '',
  subject: '',
  body: '',
};

const statusConfig: Record<string, { label: string; dot: string; bg: string; text: string }> = {
  draft: { label: 'Rascunho', dot: 'bg-slate-400', bg: 'bg-slate-50', text: 'text-slate-600' },
  sent: { label: 'Enviado', dot: 'bg-emerald-500', bg: 'bg-emerald-50', text: 'text-emerald-700' },
  failed: { label: 'Falhou', dot: 'bg-red-500', bg: 'bg-red-50', text: 'text-red-700' },
};

export function CommunicationsPage() {
  const queryClient = useQueryClient();
  const [composer, setComposer] = useState<ComposerForm>(emptyComposer);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [generatingAi, setGeneratingAi] = useState(false);

  const { data: processResponse } = useApiQuery<{ data: Process[]; pagination: unknown }>(['processes'], '/api/processes');
  const processes = processResponse?.data;

  const { data: communications, isLoading: loadingComms } = useApiQuery<Communication[]>(
    ['communications'],
    '/api/communications',
  );

  const saveDraftMutation = useApiMutation<Communication, Omit<Communication, 'id' | 'status' | 'createdAt' | 'sentAt'>>(
    '/api/communications',
    'post',
    {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ['communications'] });
        setComposer(emptyComposer);
      },
    },
  );

  const handleSaveDraft = () => {
    saveDraftMutation.mutate({
      processId: composer.processId,
      recipientName: composer.recipientName,
      recipientEmail: composer.recipientEmail,
      subject: composer.subject,
      body: composer.body,
    });
  };

  const handleSend = async () => {
    try {
      const draft = await api.post<Communication>('/api/communications', {
        processId: composer.processId,
        recipientName: composer.recipientName,
        recipientEmail: composer.recipientEmail,
        subject: composer.subject,
        body: composer.body,
      });
      await api.post(`/api/communications/${draft.id}/send`);
      queryClient.invalidateQueries({ queryKey: ['communications'] });
      setComposer(emptyComposer);
    } catch (err: any) {
      alert(err.message || 'Erro ao enviar email');
    }
  };

  const handleGenerateAi = async () => {
    if (!composer.processId) return;
    setGeneratingAi(true);
    try {
      const draft = await api.post<EmailDraft>('/api/ai/email-draft', {
        processId: composer.processId,
      });
      setComposer((prev) => ({
        ...prev,
        subject: draft.subject,
        body: draft.body,
      }));
    } catch (err: any) {
      alert(err.message || 'Erro ao gerar email com IA');
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
    composer.recipientName &&
    composer.recipientEmail &&
    composer.subject &&
    composer.body;

  return (
    <div className="space-y-8">
      {/* Page Header */}
      <div>
        <h2 className="text-2xl font-bold text-slate-900">Comunicacoes</h2>
        <p className="mt-1 text-sm text-slate-500">Compose e gerencie emails para processos de importacao</p>
      </div>

      <div className="grid grid-cols-1 gap-8 xl:grid-cols-5">
        {/* Composer - takes 3 cols */}
        <div className="xl:col-span-3">
          <div className="rounded-2xl border border-slate-200/80 bg-white shadow-sm overflow-hidden">
            {/* Gradient header */}
            <div className="bg-gradient-to-r from-blue-600 to-blue-700 px-6 py-4">
              <h3 className="flex items-center gap-2.5 text-lg font-semibold text-white">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/20">
                  <Mail className="h-4.5 w-4.5 text-white" />
                </div>
                Compor Email
              </h3>
            </div>

            <div className="space-y-5 p-6">
              {/* Process select */}
              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-700">Processo</label>
                <select
                  value={composer.processId}
                  onChange={(e) => setComposer({ ...composer, processId: e.target.value })}
                  className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm text-slate-900 focus:border-blue-500 focus:ring-4 focus:ring-blue-500/20 transition-shadow"
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
                  <label className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-slate-700">
                    <User className="h-3.5 w-3.5 text-slate-400" />
                    Destinatario
                  </label>
                  <input
                    type="text"
                    value={composer.recipientName}
                    onChange={(e) => setComposer({ ...composer, recipientName: e.target.value })}
                    placeholder="Nome do destinatario"
                    className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:ring-4 focus:ring-blue-500/20 transition-shadow"
                  />
                </div>
                <div>
                  <label className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-slate-700">
                    <AtSign className="h-3.5 w-3.5 text-slate-400" />
                    Email
                  </label>
                  <input
                    type="email"
                    value={composer.recipientEmail}
                    onChange={(e) => setComposer({ ...composer, recipientEmail: e.target.value })}
                    placeholder="email@exemplo.com"
                    className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:ring-4 focus:ring-blue-500/20 transition-shadow"
                  />
                </div>
              </div>

              {/* Subject */}
              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-700">Assunto</label>
                <input
                  type="text"
                  value={composer.subject}
                  onChange={(e) => setComposer({ ...composer, subject: e.target.value })}
                  placeholder="Assunto do email"
                  className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:ring-4 focus:ring-blue-500/20 transition-shadow"
                />
              </div>

              {/* Body */}
              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-700">Corpo do Email</label>
                <textarea
                  value={composer.body}
                  onChange={(e) => setComposer({ ...composer, body: e.target.value })}
                  rows={8}
                  placeholder="Escreva o conteudo do email..."
                  className="w-full rounded-xl border border-slate-200 px-4 py-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:ring-4 focus:ring-blue-500/20 transition-shadow"
                  style={{ minHeight: '200px' }}
                />
              </div>

              {/* Templates & AI */}
              <div>
                <p className="mb-2 text-xs font-medium uppercase tracking-wider text-slate-400">Templates e IA</p>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={handleGenerateAi}
                    disabled={!composer.processId || generatingAi}
                    className="inline-flex items-center gap-2 rounded-xl border border-purple-200 bg-gradient-to-r from-purple-50 to-violet-50 px-4 py-2 text-sm font-semibold text-purple-700 hover:from-purple-100 hover:to-violet-100 disabled:opacity-50 transition-all"
                  >
                    <Sparkles className="h-4 w-4" />
                    {generatingAi ? 'Gerando...' : 'Gerar com IA'}
                  </button>
                  <button
                    onClick={() => applyTemplate('fenicia')}
                    className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 hover:border-slate-300 transition-all"
                  >
                    <FileText className="h-4 w-4 text-slate-400" />
                    Template Fenicia
                  </button>
                  <button
                    onClick={() => applyTemplate('isa')}
                    className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 hover:border-slate-300 transition-all"
                  >
                    <FileText className="h-4 w-4 text-slate-400" />
                    Template Isa
                  </button>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex justify-end gap-3 border-t border-slate-100 pt-5">
                <button
                  onClick={handleSaveDraft}
                  disabled={!isFormValid || saveDraftMutation.isPending}
                  className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-50 transition-all"
                >
                  <Save className="h-4 w-4" />
                  Salvar Rascunho
                </button>
                <button
                  onClick={handleSend}
                  disabled={!isFormValid}
                  className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 to-blue-700 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:from-blue-700 hover:to-blue-800 disabled:opacity-50 transition-all"
                >
                  <Send className="h-4 w-4" />
                  Enviar Email
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* History - takes 2 cols */}
        <div className="xl:col-span-2">
          <div className="rounded-2xl border border-slate-200/80 bg-white shadow-sm overflow-hidden">
            {/* Header */}
            <div className="border-b border-slate-100 px-6 py-4">
              <div className="flex items-center justify-between">
                <h3 className="flex items-center gap-2.5 text-base font-semibold text-slate-900">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-100">
                    <Clock className="h-4 w-4 text-slate-600" />
                  </div>
                  Historico
                </h3>
                {communications?.length ? (
                  <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-600">
                    {communications.length}
                  </span>
                ) : null}
              </div>
            </div>

            <div className="max-h-[calc(100vh-280px)] overflow-y-auto">
              {loadingComms ? (
                <LoadingSpinner className="py-12" />
              ) : !communications?.length ? (
                <EmptyState
                  icon={Mail}
                  title="Nenhuma comunicacao"
                  description="As comunicacoes enviadas e rascunhos aparecerao aqui."
                />
              ) : (
                <div className="divide-y divide-slate-100">
                  {communications.map((comm) => {
                    const isExpanded = expandedId === comm.id;
                    const config = statusConfig[comm.status] || statusConfig.draft;
                    return (
                      <div key={comm.id}>
                        <button
                          onClick={() => setExpandedId(isExpanded ? null : comm.id)}
                          className="w-full px-5 py-4 text-left hover:bg-slate-50/80 transition-colors"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                <p className="truncate text-sm font-semibold text-slate-900">
                                  {comm.recipientName}
                                </p>
                                <span
                                  className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${config.bg} ${config.text}`}
                                >
                                  <span className={`h-1.5 w-1.5 rounded-full ${config.dot}`} />
                                  {config.label}
                                </span>
                              </div>
                              <p className="mt-1 truncate text-sm text-slate-500">{comm.subject}</p>
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
                          <div className="border-t border-slate-100 bg-slate-50/60 px-5 py-4">
                            <div className="mb-3 flex items-center gap-2 text-xs text-slate-500">
                              <AtSign className="h-3 w-3" />
                              {comm.recipientName} &lt;{comm.recipientEmail}&gt;
                            </div>
                            <p className="mb-2 text-sm font-medium text-slate-700">{comm.subject}</p>
                            <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-600">{comm.body}</p>
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
