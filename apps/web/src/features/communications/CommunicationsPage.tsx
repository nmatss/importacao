import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Mail, Send, Save, Sparkles, ChevronDown, ChevronUp, FileText } from 'lucide-react';
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

const statusConfig: Record<string, { label: string; classes: string }> = {
  draft: { label: 'Rascunho', classes: 'bg-gray-100 text-gray-700' },
  sent: { label: 'Enviado', classes: 'bg-green-100 text-green-700' },
  failed: { label: 'Falhou', classes: 'bg-red-100 text-red-700' },
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
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-gray-900">Comunicacoes</h2>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Composer */}
        <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
          <div className="border-b border-gray-200 px-5 py-4">
            <h3 className="flex items-center gap-2 text-lg font-semibold text-gray-900">
              <Mail className="h-5 w-5 text-blue-600" />
              Compor Email
            </h3>
          </div>
          <div className="space-y-4 p-5">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Processo</label>
              <select
                value={composer.processId}
                onChange={(e) => setComposer({ ...composer, processId: e.target.value })}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              >
                <option value="">Selecione um processo</option>
                {processes?.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.processCode} - {p.brand}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Destinatario</label>
                <input
                  type="text"
                  value={composer.recipientName}
                  onChange={(e) => setComposer({ ...composer, recipientName: e.target.value })}
                  placeholder="Nome do destinatario"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                <input
                  type="email"
                  value={composer.recipientEmail}
                  onChange={(e) => setComposer({ ...composer, recipientEmail: e.target.value })}
                  placeholder="email@exemplo.com"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Assunto</label>
              <input
                type="text"
                value={composer.subject}
                onChange={(e) => setComposer({ ...composer, subject: e.target.value })}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Corpo</label>
              <textarea
                value={composer.body}
                onChange={(e) => setComposer({ ...composer, body: e.target.value })}
                rows={8}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                style={{ minHeight: '200px' }}
              />
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                onClick={handleGenerateAi}
                disabled={!composer.processId || generatingAi}
                className="inline-flex items-center gap-1.5 rounded-lg border border-purple-300 bg-purple-50 px-3 py-1.5 text-sm font-medium text-purple-700 hover:bg-purple-100 disabled:opacity-50"
              >
                <Sparkles className="h-4 w-4" />
                {generatingAi ? 'Gerando...' : 'Gerar com IA'}
              </button>
              <button
                onClick={() => applyTemplate('fenicia')}
                className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                <FileText className="h-4 w-4" />
                Template Fenicia
              </button>
              <button
                onClick={() => applyTemplate('isa')}
                className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                <FileText className="h-4 w-4" />
                Template Isa
              </button>
            </div>

            <div className="flex justify-end gap-3 border-t border-gray-100 pt-4">
              <button
                onClick={handleSaveDraft}
                disabled={!isFormValid || saveDraftMutation.isPending}
                className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                <Save className="h-4 w-4" />
                Salvar Rascunho
              </button>
              <button
                onClick={handleSend}
                disabled={!isFormValid}
                className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                <Send className="h-4 w-4" />
                Enviar
              </button>
            </div>
          </div>
        </div>

        {/* History */}
        <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
          <div className="border-b border-gray-200 px-5 py-4">
            <h3 className="flex items-center gap-2 text-lg font-semibold text-gray-900">
              <Mail className="h-5 w-5 text-gray-500" />
              Historico
            </h3>
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
              <ul className="divide-y divide-gray-100">
                {communications.map((comm) => {
                  const isExpanded = expandedId === comm.id;
                  const config = statusConfig[comm.status] || statusConfig.draft;
                  return (
                    <li key={comm.id}>
                      <button
                        onClick={() => setExpandedId(isExpanded ? null : comm.id)}
                        className="w-full px-5 py-4 text-left hover:bg-gray-50"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium text-gray-900">
                              {comm.recipientName}
                            </p>
                            <p className="truncate text-sm text-gray-600">{comm.subject}</p>
                          </div>
                          <div className="flex shrink-0 items-center gap-2">
                            <span
                              className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${config.classes}`}
                            >
                              {config.label}
                            </span>
                            {isExpanded ? (
                              <ChevronUp className="h-4 w-4 text-gray-400" />
                            ) : (
                              <ChevronDown className="h-4 w-4 text-gray-400" />
                            )}
                          </div>
                        </div>
                        <p className="mt-1 text-xs text-gray-400">
                          {formatDate(comm.sentAt || comm.createdAt)}
                        </p>
                      </button>
                      {isExpanded && (
                        <div className="border-t border-gray-100 bg-gray-50 px-5 py-4">
                          <p className="text-xs text-gray-500 mb-1">
                            Para: {comm.recipientName} &lt;{comm.recipientEmail}&gt;
                          </p>
                          <p className="text-xs font-medium text-gray-700 mb-2">{comm.subject}</p>
                          <p className="whitespace-pre-wrap text-sm text-gray-600">{comm.body}</p>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
