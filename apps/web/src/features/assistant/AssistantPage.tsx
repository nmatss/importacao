import { useState } from 'react';
import { toast } from 'sonner';
import {
  Bot,
  Send,
  Sparkles,
  AlertTriangle,
  Mail,
  FileText,
  ExternalLink,
  ShieldCheck,
  Loader2,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { api } from '@/shared/lib/api-client';
import { cn, formatDate } from '@/shared/lib/utils';
import { getErrorMessage } from '@/shared/utils/errors';

interface AssistantSource {
  id: string;
  type:
    | 'process'
    | 'alert'
    | 'communication'
    | 'email_ingestion'
    | 'validation'
    | 'document'
    | 'follow_up'
    | 'event'
    | 'audit'
    | 'knowledge';
  title: string;
  subtitle?: string;
  excerpt: string;
  url?: string;
  createdAt?: string | null;
  score: number;
}

interface AssistantAnswer {
  question: string;
  answer: string;
  sources: AssistantSource[];
  confidence: number;
  mode: 'ai' | 'deterministic';
  generatedAt: string;
}

const quickPrompts = [
  'Quais atendimentos pendentes precisam de ação?',
  'Quais alertas críticos ainda estão abertos?',
  'Resuma as divergências de validação mais recentes.',
  'Quais processos precisam de conferência de documentos?',
];

const sourceConfig: Record<
  AssistantSource['type'],
  { label: string; icon: typeof FileText; tone: string }
> = {
  process: { label: 'Processo', icon: FileText, tone: 'bg-slate-100 text-slate-700' },
  alert: { label: 'Alerta', icon: AlertTriangle, tone: 'bg-amber-50 text-amber-700' },
  communication: { label: 'Atendimento', icon: Mail, tone: 'bg-primary-50 text-primary-700' },
  email_ingestion: { label: 'E-mail recebido', icon: Mail, tone: 'bg-cyan-50 text-cyan-700' },
  validation: { label: 'Validação', icon: ShieldCheck, tone: 'bg-rose-50 text-rose-700' },
  document: { label: 'Documento', icon: FileText, tone: 'bg-emerald-50 text-emerald-700' },
  follow_up: { label: 'Follow-up', icon: ShieldCheck, tone: 'bg-violet-50 text-violet-700' },
  event: { label: 'Histórico', icon: ShieldCheck, tone: 'bg-slate-100 text-slate-700' },
  audit: { label: 'Auditoria', icon: ShieldCheck, tone: 'bg-orange-50 text-orange-700' },
  knowledge: { label: 'Base RAG', icon: Sparkles, tone: 'bg-indigo-50 text-indigo-700' },
};

function confidenceLabel(value: number): string {
  if (value >= 0.75) return 'Alta';
  if (value >= 0.45) return 'Média';
  return 'Baixa';
}

export function AssistantPage() {
  const [question, setQuestion] = useState('');
  const [processId, setProcessId] = useState('');
  const [answer, setAnswer] = useState<AssistantAnswer | null>(null);
  const [loading, setLoading] = useState(false);

  const askAssistant = async (prompt?: string) => {
    const finalQuestion = (prompt ?? question).trim();
    if (finalQuestion.length < 3) {
      toast.error('Informe uma pergunta para consultar o assistente.');
      return;
    }

    setLoading(true);
    try {
      const response = await api.post<AssistantAnswer>('/api/assistant/query', {
        question: finalQuestion,
        processId: processId ? Number(processId) : undefined,
        limit: 10,
      });
      setAnswer(response);
      setQuestion(finalQuestion);
    } catch (err: unknown) {
      toast.error(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100">
            Assistente Operacional
          </h2>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Consulte processos, atendimentos, alertas, documentos e validações com fontes internas.
          </p>
        </div>
        {answer && (
          <div className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm shadow-sm dark:border-slate-700 dark:bg-slate-800">
            <span className="text-slate-500 dark:text-slate-400">Confiança </span>
            <span className="font-semibold text-slate-900 dark:text-slate-100">
              {confidenceLabel(answer.confidence)}
            </span>
            <span className="ml-2 text-xs text-slate-400">
              {answer.mode === 'ai' ? 'IA com RAG' : 'Resumo por evidências'}
            </span>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-5">
          <div className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm dark:border-slate-700/80 dark:bg-slate-800 sm:p-6">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-50 text-primary-700">
                <Bot className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                  Pergunta operacional
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  O assistente responde apenas com evidências recuperadas do sistema.
                </p>
              </div>
            </div>

            <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-[180px_minmax(0,1fr)]">
              <div>
                <label
                  htmlFor="assistant-process-id"
                  className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300"
                >
                  Processo específico
                </label>
                <input
                  id="assistant-process-id"
                  type="number"
                  min="1"
                  value={processId}
                  onChange={(event) => setProcessId(event.target.value)}
                  placeholder="ID opcional"
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition-all placeholder:text-slate-400 focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-300"
                />
              </div>
              <div>
                <label
                  htmlFor="assistant-question"
                  className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300"
                >
                  Pergunta
                </label>
                <textarea
                  id="assistant-question"
                  value={question}
                  onChange={(event) => setQuestion(event.target.value)}
                  rows={4}
                  placeholder="Ex.: O que ainda falta tratar nos atendimentos desta semana?"
                  className="w-full resize-none rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition-all placeholder:text-slate-400 focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-300"
                />
              </div>
            </div>

            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap gap-2">
                {quickPrompts.map((prompt) => (
                  <button
                    key={prompt}
                    type="button"
                    onClick={() => askAssistant(prompt)}
                    disabled={loading}
                    className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
                  >
                    {prompt}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={() => askAssistant()}
                disabled={loading || question.trim().length < 3}
                className="inline-flex items-center gap-2 rounded-xl bg-primary-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {loading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
                Perguntar
              </button>
            </div>
          </div>

          <div className="min-h-[280px] rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm dark:border-slate-700/80 dark:bg-slate-800 sm:p-6">
            {!answer ? (
              <div className="flex min-h-[220px] flex-col items-center justify-center text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-300">
                  <Sparkles className="h-5 w-5" />
                </div>
                <p className="mt-3 text-sm font-semibold text-slate-700 dark:text-slate-200">
                  Nenhuma consulta executada
                </p>
                <p className="mt-1 max-w-md text-sm text-slate-500 dark:text-slate-400">
                  Faça uma pergunta ou selecione um atalho para receber uma resposta com fontes do
                  sistema.
                </p>
              </div>
            ) : (
              <div>
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-4 dark:border-slate-700">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                      Resposta
                    </p>
                    <h3 className="mt-1 text-base font-semibold text-slate-900 dark:text-slate-100">
                      {answer.question}
                    </h3>
                  </div>
                  <span className="text-xs text-slate-400">{formatDate(answer.generatedAt)}</span>
                </div>
                <p className="whitespace-pre-wrap text-sm leading-7 text-slate-700 dark:text-slate-300">
                  {answer.answer}
                </p>
              </div>
            )}
          </div>
        </div>

        <aside className="rounded-2xl border border-slate-200/80 bg-white shadow-sm dark:border-slate-700/80 dark:bg-slate-800">
          <div className="border-b border-slate-100 px-4 py-4 dark:border-slate-700">
            <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              Fontes consultadas
            </h3>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              Evidências usadas para compor a resposta.
            </p>
          </div>
          <div className="max-h-[calc(100vh-230px)] overflow-y-auto p-3">
            {!answer?.sources.length ? (
              <p className="px-2 py-8 text-center text-sm text-slate-500 dark:text-slate-400">
                As fontes aparecem após a consulta.
              </p>
            ) : (
              <div className="space-y-3">
                {answer.sources.map((source) => {
                  const config = sourceConfig[source.type];
                  const SourceIcon = config.icon;
                  const content = (
                    <div
                      className={cn(
                        'rounded-xl border border-slate-200 p-3 transition-colors dark:border-slate-700',
                        source.url ? 'hover:bg-slate-50 dark:hover:bg-slate-900' : '',
                      )}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <span
                          className={cn(
                            'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold',
                            config.tone,
                          )}
                        >
                          <SourceIcon className="h-3 w-3" />
                          {config.label}
                        </span>
                        {source.url && <ExternalLink className="h-3.5 w-3.5 text-slate-400" />}
                      </div>
                      <p className="mt-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
                        {source.title}
                      </p>
                      {source.subtitle && (
                        <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                          {source.subtitle}
                        </p>
                      )}
                      <p className="mt-2 text-xs leading-5 text-slate-600 dark:text-slate-400">
                        {source.excerpt}
                      </p>
                    </div>
                  );

                  return source.url ? (
                    <Link key={source.id} to={source.url}>
                      {content}
                    </Link>
                  ) : (
                    <div key={source.id}>{content}</div>
                  );
                })}
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
