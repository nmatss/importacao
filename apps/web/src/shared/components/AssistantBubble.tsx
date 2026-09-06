import { FormEvent, useCallback, useEffect, useId, useRef, useState } from 'react';
import { Bot, ExternalLink, Loader2, Send, Sparkles, X } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import { api } from '@/shared/lib/api-client';
import { cn } from '@/shared/lib/utils';
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
  score: number;
}

interface AssistantAnswer {
  question: string;
  answer: string;
  sources: AssistantSource[];
  confidence: number;
  mode: 'ai' | 'deterministic';
}

interface AssistantBubbleProps {
  accent?: 'primary' | 'emerald';
}

const quickPrompts = [
  'Pendências críticas abertas',
  'Atendimentos sem retorno',
  'Divergências recentes',
];

const sourceLabels: Record<AssistantSource['type'], string> = {
  process: 'Processo',
  alert: 'Alerta',
  communication: 'Atendimento',
  email_ingestion: 'E-mail',
  validation: 'Validação',
  document: 'Documento',
  follow_up: 'Follow-up',
  event: 'Histórico',
  audit: 'Auditoria',
  knowledge: 'Base RAG',
};

function inferProcessId(pathname: string): string {
  const match = pathname.match(/^\/importacao\/processos\/(\d+)(?:\/|$)/);
  return match?.[1] ?? '';
}

function confidenceLabel(value: number): string {
  if (value >= 0.75) return 'Alta';
  if (value >= 0.45) return 'Média';
  return 'Baixa';
}

function SourceLink({ source, children }: { source: AssistantSource; children: React.ReactNode }) {
  if (!source.url) return <div>{children}</div>;

  if (source.url.startsWith('/')) {
    return (
      <Link to={source.url} className="block">
        {children}
      </Link>
    );
  }

  return (
    <a href={source.url} target="_blank" rel="noreferrer" className="block">
      {children}
    </a>
  );
}

export function AssistantBubble({ accent = 'primary' }: AssistantBubbleProps) {
  const location = useLocation();
  const titleId = useId();
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState('');
  const [processId, setProcessId] = useState(() => inferProcessId(location.pathname));
  const [answer, setAnswer] = useState<AssistantAnswer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const hidden = location.pathname === '/importacao/assistente';
  const tone =
    accent === 'emerald'
      ? {
          button: 'bg-emerald-600 hover:bg-emerald-700 focus:ring-emerald-500/30',
          text: 'text-emerald-700 dark:text-emerald-300',
          soft: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300',
          focus: 'focus:border-emerald-500 focus:ring-emerald-500/20',
        }
      : {
          button: 'bg-primary-600 hover:bg-primary-700 focus:ring-primary-500/30',
          text: 'text-primary-700 dark:text-primary-300',
          soft: 'bg-primary-50 text-primary-700 dark:bg-primary-500/10 dark:text-primary-300',
          focus: 'focus:border-primary-500 focus:ring-primary-500/20',
        };

  useEffect(() => {
    setProcessId(inferProcessId(location.pathname));
  }, [location.pathname]);

  const closePanel = useCallback(() => {
    setOpen(false);
    window.setTimeout(() => triggerRef.current?.focus(), 0);
  }, []);

  useEffect(() => {
    if (!open) return;

    const timeout = window.setTimeout(() => textareaRef.current?.focus(), 80);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closePanel();
    };

    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.clearTimeout(timeout);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [closePanel, open]);

  async function askAssistant(event?: FormEvent<HTMLFormElement>, prompt?: string) {
    event?.preventDefault();
    const finalQuestion = (prompt ?? question).trim();
    if (finalQuestion.length < 3) {
      setError('Informe uma pergunta com pelo menos 3 caracteres.');
      return;
    }

    setLoading(true);
    setError(null);
    setQuestion(finalQuestion);
    try {
      const response = await api.post<AssistantAnswer>('/api/assistant/query', {
        question: finalQuestion,
        processId: processId ? Number(processId) : undefined,
        limit: 6,
      });
      setAnswer(response);
    } catch (err: unknown) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  if (hidden) return null;

  return (
    <div className="fixed bottom-4 right-4 z-30 sm:bottom-6 sm:right-6">
      {open && (
        <section
          role="dialog"
          aria-labelledby={titleId}
          className="mb-3 flex max-h-[min(680px,calc(100dvh-110px))] w-[calc(100vw-2rem)] max-w-[420px] flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl shadow-slate-900/20 dark:border-slate-700 dark:bg-slate-900 dark:shadow-black/40"
        >
          <header className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3 dark:border-slate-800">
            <div className="flex min-w-0 items-center gap-3">
              <div
                className={cn(
                  'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg',
                  tone.soft,
                )}
              >
                <Bot className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <h2
                  id={titleId}
                  className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100"
                >
                  Assistente IA
                </h2>
                <p className="truncate text-xs text-slate-500 dark:text-slate-400">
                  Fontes internas do sistema
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={closePanel}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
              aria-label="Fechar assistente IA"
            >
              <X className="h-4 w-4" />
            </button>
          </header>

          <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
            <form className="space-y-3" onSubmit={(event) => askAssistant(event)}>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-[104px_minmax(0,1fr)]">
                <div>
                  <label
                    htmlFor="assistant-bubble-process"
                    className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300"
                  >
                    Processo
                  </label>
                  <input
                    id="assistant-bubble-process"
                    type="number"
                    min="1"
                    value={processId}
                    onChange={(event) => setProcessId(event.target.value)}
                    placeholder="Opc."
                    className={cn(
                      'h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-800 outline-none transition-all placeholder:text-slate-400 focus:ring-2 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100',
                      tone.focus,
                    )}
                  />
                </div>
                <div>
                  <label
                    htmlFor="assistant-bubble-question"
                    className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300"
                  >
                    Pergunta
                  </label>
                  <textarea
                    ref={textareaRef}
                    id="assistant-bubble-question"
                    value={question}
                    onChange={(event) => setQuestion(event.target.value)}
                    rows={2}
                    placeholder="Pergunte sobre processos, alertas ou documentos"
                    className={cn(
                      'min-h-10 w-full resize-none rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition-all placeholder:text-slate-400 focus:ring-2 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100',
                      tone.focus,
                    )}
                  />
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                {quickPrompts.map((prompt) => (
                  <button
                    key={prompt}
                    type="button"
                    onClick={() => askAssistant(undefined, prompt)}
                    disabled={loading}
                    className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                  >
                    {prompt}
                  </button>
                ))}
              </div>

              <button
                type="submit"
                disabled={loading || question.trim().length < 3}
                className={cn(
                  'flex h-10 w-full items-center justify-center gap-2 rounded-lg px-4 text-sm font-semibold text-white shadow-sm transition-colors focus:outline-none focus:ring-4 disabled:cursor-not-allowed disabled:opacity-50',
                  tone.button,
                )}
              >
                {loading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
                Perguntar
              </button>
            </form>

            {error && (
              <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-300">
                {error}
              </p>
            )}

            {!answer && !error && (
              <div className="rounded-lg border border-dashed border-slate-200 px-3 py-4 text-center dark:border-slate-700">
                <Sparkles className={cn('mx-auto h-5 w-5', tone.text)} />
                <p className="mt-2 text-xs font-medium text-slate-500 dark:text-slate-400">
                  O resultado aparece aqui.
                </p>
              </div>
            )}

            {answer && (
              <div className="space-y-3">
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3 dark:border-slate-700 dark:bg-slate-950">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                      Confiança {confidenceLabel(answer.confidence)}
                    </p>
                    <span
                      className={cn('rounded-full px-2 py-1 text-[11px] font-semibold', tone.soft)}
                    >
                      {answer.mode === 'ai' ? 'IA com RAG' : 'Evidências'}
                    </span>
                  </div>
                  <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-slate-700 dark:text-slate-300">
                    {answer.answer}
                  </p>
                </div>

                {answer.sources.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                      Fontes
                    </p>
                    {answer.sources.slice(0, 4).map((source) => (
                      <SourceLink key={source.id} source={source}>
                        <div className="rounded-lg border border-slate-200 px-3 py-2 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800">
                          <div className="flex items-start justify-between gap-2">
                            <span
                              className={cn(
                                'rounded-full px-2 py-0.5 text-[11px] font-semibold',
                                tone.soft,
                              )}
                            >
                              {sourceLabels[source.type]}
                            </span>
                            {source.url && (
                              <ExternalLink className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
                            )}
                          </div>
                          <p className="mt-1 line-clamp-1 text-xs font-semibold text-slate-800 dark:text-slate-100">
                            {source.title}
                          </p>
                          <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-500 dark:text-slate-400">
                            {source.excerpt}
                          </p>
                        </div>
                      </SourceLink>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </section>
      )}

      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((current) => !current)}
        className={cn(
          'ml-auto flex h-14 w-14 items-center justify-center rounded-full text-white shadow-xl shadow-slate-900/25 transition-transform hover:scale-105 focus:outline-none focus:ring-4 dark:shadow-black/40',
          tone.button,
        )}
        aria-label={open ? 'Ocultar assistente IA' : 'Abrir assistente IA'}
        aria-expanded={open}
        title="Assistente IA"
      >
        {loading ? <Loader2 className="h-6 w-6 animate-spin" /> : <Bot className="h-6 w-6" />}
      </button>
    </div>
  );
}
