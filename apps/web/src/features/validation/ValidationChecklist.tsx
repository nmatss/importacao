import { useReducer, useState, useEffect, useMemo, useCallback, useRef } from 'react';
import DOMPurify from 'dompurify';
import { toast } from 'sonner';
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
  FileSignature,
} from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useApiQuery } from '@/shared/hooks/useApi';
import { api } from '@/shared/lib/api-client';
import { cn } from '@/shared/lib/utils';
import { VALIDATION_CHECK_NAMES } from '@/shared/lib/constants';
import { LoadingSpinner } from '@/shared/components/LoadingSpinner';
import { SubmitButton } from '@/shared/components/SubmitButton';
import { ErrorState } from '@/shared/components/ErrorState';
import { ConfirmDialog } from '@/shared/components/ConfirmDialog';
import { getErrorMessage } from '@/shared/utils/errors';

interface EmailSignatureOption {
  id: number;
  name: string;
  signatureHtml: string;
  isDefault: boolean;
}

interface ValidationCheck {
  id: number;
  checkName: string;
  status: 'passed' | 'failed' | 'warning' | 'skipped';
  expectedValue?: string;
  actualValue?: string;
  message?: string;
  resolvedBy?: string | number | null;
  resolvedAt?: string | null;
  resolvedManually?: boolean;
  resolutionNote?: string | null;
}

interface AnomalyDetectionResult {
  anomalies: Anomaly[];
}

interface Anomaly {
  field: string;
  description: string;
  severity: 'high' | 'medium' | 'low';
  confidence?: number;
}

// Canonical field for the reconciled item-presence anomaly. The backend drops
// the AI's fuzzy "N itens nao encontrados" anomalies and re-emits a single one
// under this field whose count comes from the deterministic document
// comparison (the "Itens no Packing List sem correspondencia na Invoice" list
// in the Comparativo Geral). The two surfaces must never disagree (e.g. 7 vs 1),
// so we never render an independent numeric claim here — we point to that list.
const ITEM_MATCH_ANOMALY_FIELD = 'items.unmatched';

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

// --- useReducer state & actions ---

interface ChecklistState {
  running: boolean;
  detectingAnomalies: boolean;
  anomalies: Anomaly[] | null;
  generatingDraft: boolean;
  draft: CorrectionDraft | null;
  showDraftModal: boolean;
  editSubject: string;
  editBody: string;
  editRecipientEmail: string;
  sending: boolean;
  saving: boolean;
}

type ChecklistAction =
  | { type: 'SET_RUNNING'; payload: boolean }
  | { type: 'SET_DETECTING_ANOMALIES'; payload: boolean }
  | { type: 'SET_ANOMALIES'; payload: Anomaly[] | null }
  | { type: 'SET_GENERATING_DRAFT'; payload: boolean }
  | { type: 'SET_DRAFT'; payload: CorrectionDraft | null }
  | { type: 'OPEN_DRAFT_MODAL'; payload: { draft: CorrectionDraft } }
  | { type: 'CLOSE_DRAFT_MODAL' }
  | { type: 'SET_EDIT_SUBJECT'; payload: string }
  | { type: 'SET_EDIT_BODY'; payload: string }
  | { type: 'SET_EDIT_RECIPIENT_EMAIL'; payload: string }
  | { type: 'SET_SENDING'; payload: boolean }
  | { type: 'SET_SAVING'; payload: boolean }
  | { type: 'UPDATE_DRAFT'; payload: CorrectionDraft };

const initialState: ChecklistState = {
  running: false,
  detectingAnomalies: false,
  anomalies: null,
  generatingDraft: false,
  draft: null,
  showDraftModal: false,
  editSubject: '',
  editBody: '',
  editRecipientEmail: '',
  sending: false,
  saving: false,
};

function checklistReducer(state: ChecklistState, action: ChecklistAction): ChecklistState {
  switch (action.type) {
    case 'SET_RUNNING':
      return { ...state, running: action.payload };
    case 'SET_DETECTING_ANOMALIES':
      return { ...state, detectingAnomalies: action.payload };
    case 'SET_ANOMALIES':
      return { ...state, anomalies: action.payload };
    case 'SET_GENERATING_DRAFT':
      return { ...state, generatingDraft: action.payload };
    case 'SET_DRAFT':
      return { ...state, draft: action.payload };
    case 'OPEN_DRAFT_MODAL': {
      const { draft } = action.payload;
      return {
        ...state,
        draft,
        editSubject: draft.subject,
        editBody: draft.body,
        editRecipientEmail: draft.recipientEmail,
        showDraftModal: true,
      };
    }
    case 'CLOSE_DRAFT_MODAL':
      return { ...state, showDraftModal: false, draft: null };
    case 'SET_EDIT_SUBJECT':
      return { ...state, editSubject: action.payload };
    case 'SET_EDIT_BODY':
      return { ...state, editBody: action.payload };
    case 'SET_EDIT_RECIPIENT_EMAIL':
      return { ...state, editRecipientEmail: action.payload };
    case 'SET_SENDING':
      return { ...state, sending: action.payload };
    case 'SET_SAVING':
      return { ...state, saving: action.payload };
    case 'UPDATE_DRAFT':
      return { ...state, draft: action.payload };
    default:
      return state;
  }
}

// --- helpers ---

const checkLabel = (name: string) =>
  VALIDATION_CHECK_NAMES.find((c) => c.value === name)?.description ?? name;

const draftModalFocusableSelector = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[contenteditable="true"]',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

const statusConfig = {
  passed: {
    icon: CheckCircle,
    border: 'border-emerald-200',
    bg: 'bg-emerald-50',
    iconColor: 'text-emerald-500',
  },
  failed: {
    icon: XCircle,
    border: 'border-danger-200',
    bg: 'bg-danger-50',
    iconColor: 'text-danger-500',
  },
  warning: {
    icon: AlertTriangle,
    border: 'border-amber-200',
    bg: 'bg-amber-50',
    iconColor: 'text-amber-500',
  },
  skipped: {
    icon: Minus,
    border: 'border-slate-200 dark:border-slate-600',
    bg: 'bg-slate-50 dark:bg-slate-900',
    iconColor: 'text-slate-400',
  },
};

export function ValidationChecklist({ processId }: ValidationChecklistProps) {
  const queryClient = useQueryClient();
  const [state, dispatch] = useReducer(checklistReducer, initialState);

  const {
    running,
    detectingAnomalies,
    anomalies,
    generatingDraft,
    draft,
    showDraftModal,
    editSubject,
    editBody,
    editRecipientEmail,
    sending,
    saving,
  } = state;

  const [selectedSignatureId, setSelectedSignatureId] = useState<number | null>(null);
  const [showSendConfirm, setShowSendConfirm] = useState(false);
  const [filter, setFilter] = useState<'all' | 'failed' | 'warning' | 'passed' | 'accepted'>('all');
  // Manual-resolution inline form: which check is being resolved + its note.
  const [resolveTarget, setResolveTarget] = useState<number | null>(null);
  const [resolveNote, setResolveNote] = useState('');
  const [resolvingId, setResolvingId] = useState<number | null>(null);
  const draftBodyRef = useRef<HTMLDivElement | null>(null);
  const draftModalRef = useRef<HTMLDivElement | null>(null);
  const draftRecipientEmailRef = useRef<HTMLTextAreaElement | null>(null);
  const draftModalOpenerRef = useRef<HTMLElement | null>(null);
  const latestDraftBodyRef = useRef(editBody);

  useEffect(() => {
    latestDraftBodyRef.current = editBody;
  }, [editBody]);

  const getCurrentDraftBody = useCallback(
    () => draftBodyRef.current?.innerHTML ?? latestDraftBodyRef.current,
    [],
  );

  const closeDraftModal = useCallback(() => {
    dispatch({ type: 'CLOSE_DRAFT_MODAL' });
    setShowSendConfirm(false);
    window.setTimeout(() => {
      draftModalOpenerRef.current?.focus();
      draftModalOpenerRef.current = null;
    }, 0);
  }, []);

  useEffect(() => {
    if (!showDraftModal || showSendConfirm) return;

    draftRecipientEmailRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeDraftModal();
        return;
      }

      if (event.key !== 'Tab') return;

      const modal = draftModalRef.current;
      if (!modal) return;

      const focusable = Array.from(
        modal.querySelectorAll<HTMLElement>(draftModalFocusableSelector),
      ).filter((element) => {
        const disabled = element.getAttribute('aria-disabled') === 'true';
        const style = window.getComputedStyle(element);
        return !disabled && style.display !== 'none' && style.visibility !== 'hidden';
      });

      if (focusable.length === 0) {
        event.preventDefault();
        modal.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;

      if (event.shiftKey && (active === first || active === modal)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [closeDraftModal, showDraftModal, showSendConfirm]);

  const { data: emailSignatures } = useApiQuery<EmailSignatureOption[]>(
    ['email-signatures'],
    '/api/settings/email-signatures',
  );

  // Auto-select default signature when signatures load
  useEffect(() => {
    if (emailSignatures && emailSignatures.length > 0 && selectedSignatureId === null) {
      const defaultSig = emailSignatures.find((s) => s.isDefault);
      if (defaultSig) setSelectedSignatureId(defaultSig.id);
    }
  }, [emailSignatures, selectedSignatureId]);

  const {
    data: checks,
    isLoading,
    error,
    refetch,
  } = useApiQuery<ValidationCheck[]>(['validation', processId], `/api/validation/${processId}`);

  // Skipped checks are blocked by a missing source document — they are not
  // errors and are surfaced in a separate collapsible section, never in the
  // main list, to keep the checklist readable.
  const skippedChecks = useMemo(
    () => checks?.filter((c) => c.status === 'skipped') ?? [],
    [checks],
  );

  const visibleChecks = useMemo(
    () => checks?.filter((c) => c.status !== 'skipped') ?? [],
    [checks],
  );

  const filteredChecks = useMemo(() => {
    if (filter === 'all') return visibleChecks;
    if (filter === 'accepted') return visibleChecks.filter((c) => c.resolvedManually);
    if (filter === 'failed') {
      return visibleChecks.filter((c) => c.status === 'failed' && !c.resolvedManually);
    }
    if (filter === 'warning') {
      return visibleChecks.filter((c) => c.status === 'warning' && !c.resolvedManually);
    }
    return visibleChecks.filter((c) => c.status === filter);
  }, [filter, visibleChecks]);

  const openFailedCount = useMemo(
    () => visibleChecks.filter((c) => c.status === 'failed' && !c.resolvedManually).length,
    [visibleChecks],
  );
  const openWarningCount = useMemo(
    () => visibleChecks.filter((c) => c.status === 'warning' && !c.resolvedManually).length,
    [visibleChecks],
  );
  const passedCount = useMemo(
    () => visibleChecks.filter((c) => c.status === 'passed').length,
    [visibleChecks],
  );
  const acceptedCount = useMemo(
    () => visibleChecks.filter((c) => c.resolvedManually).length,
    [visibleChecks],
  );

  const invalidateValidationContext = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['validation', processId] }),
      queryClient.invalidateQueries({ queryKey: ['validation-report', processId] }),
      queryClient.invalidateQueries({ queryKey: ['doc-comparison', processId] }),
      queryClient.invalidateQueries({ queryKey: ['process-events', processId] }),
      queryClient.invalidateQueries({ queryKey: ['process', processId] }),
      queryClient.invalidateQueries({ queryKey: ['communications', processId] }),
      queryClient.invalidateQueries({ queryKey: ['communications'] }),
    ]);
  }, [processId, queryClient]);

  const runValidation = useCallback(async () => {
    dispatch({ type: 'SET_RUNNING', payload: true });
    try {
      await api.post(`/api/validation/${processId}/run`);
      dispatch({ type: 'SET_ANOMALIES', payload: null });
      dispatch({ type: 'SET_DRAFT', payload: null });
      await invalidateValidationContext();
      toast.success('Validação executada com sucesso.');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err));
    } finally {
      dispatch({ type: 'SET_RUNNING', payload: false });
    }
  }, [invalidateValidationContext, processId]);

  const detectAnomalies = useCallback(async () => {
    dispatch({ type: 'SET_DETECTING_ANOMALIES', payload: true });
    try {
      const data = await api.post<AnomalyDetectionResult>(`/api/validation/${processId}/anomalies`);
      dispatch({ type: 'SET_ANOMALIES', payload: data.anomalies ?? [] });
    } catch (err: unknown) {
      toast.error(getErrorMessage(err));
    } finally {
      dispatch({ type: 'SET_DETECTING_ANOMALIES', payload: false });
    }
  }, [processId]);

  // Manual resolution is an audited override/acceptance of the divergence — it
  // does NOT re-validate. A justification (resolution_note) is mandatory.
  const resolveManually = useCallback(
    async (resultId: number, resolutionNote: string) => {
      const note = resolutionNote.trim();
      if (!note) {
        toast.error('Informe uma justificativa para o aceite manual.');
        return;
      }
      setResolvingId(resultId);
      try {
        await api.patch(`/api/validation/results/${resultId}/resolve`, {
          resolution: 'manual',
          resolution_note: note,
        });
        await invalidateValidationContext();
        setResolveTarget(null);
        setResolveNote('');
        toast.success('Divergência aceita com justificativa.');
      } catch (err: unknown) {
        toast.error(getErrorMessage(err));
      } finally {
        setResolvingId(null);
      }
    },
    [invalidateValidationContext],
  );

  const generateCorrectionDraft = async (useAi = false) => {
    if (openFailedCount === 0) {
      toast.success('Não há falhas abertas para gerar e-mail de correção.');
      return;
    }
    draftModalOpenerRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dispatch({ type: 'SET_GENERATING_DRAFT', payload: true });
    try {
      const data = await api.post<CorrectionDraft>(
        `/api/validation/${processId}/correction-draft`,
        { useAi },
      );
      dispatch({ type: 'OPEN_DRAFT_MODAL', payload: { draft: data } });
      queryClient.invalidateQueries({ queryKey: ['communications', processId] });
      queryClient.invalidateQueries({ queryKey: ['communications'] });
    } catch (err: unknown) {
      toast.error(getErrorMessage(err));
    } finally {
      dispatch({ type: 'SET_GENERATING_DRAFT', payload: false });
    }
  };

  const saveDraft = async () => {
    if (!draft) return;
    const currentBody = getCurrentDraftBody();
    dispatch({ type: 'SET_SAVING', payload: true });
    try {
      const updated = await api.patch<CorrectionDraft>(`/api/communications/${draft.id}/draft`, {
        subject: editSubject,
        body: currentBody,
        recipientEmail: editRecipientEmail,
      });
      dispatch({ type: 'UPDATE_DRAFT', payload: updated });
      toast.success('Rascunho salvo com sucesso');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err));
    } finally {
      dispatch({ type: 'SET_SAVING', payload: false });
    }
  };

  const sendEmail = async () => {
    if (!draft) return;
    setShowSendConfirm(false);
    const currentBody = getCurrentDraftBody();
    dispatch({ type: 'SET_SENDING', payload: true });
    try {
      // Save any edits first
      await api.patch(`/api/communications/${draft.id}/draft`, {
        subject: editSubject,
        body: currentBody,
        recipientEmail: editRecipientEmail,
      });
      // Then send (with optional signature)
      await api.post(`/api/communications/${draft.id}/send`, {
        signatureId: selectedSignatureId || undefined,
      });
      toast.success('E-mail enviado com sucesso');
      closeDraftModal();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err));
    } finally {
      dispatch({ type: 'SET_SENDING', payload: false });
    }
  };

  if (isLoading) {
    return <LoadingSpinner className="py-8" />;
  }

  if (error) {
    return <ErrorState message="Erro ao carregar validações." onRetry={() => refetch()} />;
  }

  // Total of actionable checks (skipped are excluded — blocked, not failures).
  const totalCount = visibleChecks.length;
  const skippedCount = skippedChecks.length;
  const completedCount = passedCount + acceptedCount;
  const progressPct = totalCount > 0 ? (completedCount / totalCount) * 100 : 0;
  const progressColor =
    openFailedCount > 0
      ? 'bg-danger-500'
      : openWarningCount > 0
        ? 'bg-amber-500'
        : 'bg-emerald-500';

  const emptyFilterMessage =
    filter === 'failed'
      ? 'Nenhuma falha aberta neste processo.'
      : filter === 'warning'
        ? 'Nenhuma atenção aberta neste processo.'
        : filter === 'accepted'
          ? 'Nenhuma divergência aceita manualmente neste processo.'
          : filter === 'passed'
            ? 'Nenhuma verificação conforme neste processo.'
            : 'Nenhuma validação executada ainda. Clique em "Executar validação" para iniciar.';

  return (
    <div className="space-y-4">
      {/* Progress bar */}
      {checks && checks.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium text-slate-700 dark:text-slate-300">
              {completedCount} de {totalCount} verificações acionáveis aprovadas ou aceitas
            </span>
            <span className="flex items-center gap-2">
              {skippedCount > 0 && (
                <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600 ring-1 ring-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700">
                  <Minus className="h-3 w-3" />
                  {skippedCount} bloqueada{skippedCount !== 1 ? 's' : ''}
                </span>
              )}
              <span className="text-xs text-slate-400">{Math.round(progressPct)}%</span>
            </span>
          </div>
          <div className="h-2.5 w-full rounded-full bg-slate-100 dark:bg-slate-700 overflow-hidden">
            <div
              className={cn('h-full rounded-full transition-all duration-500', progressColor)}
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>
      )}

      {/* Filter buttons */}
      {checks && checks.length > 0 && (
        <div className="flex items-center gap-2">
          {[
            { key: 'all' as const, label: 'Todos', count: totalCount },
            { key: 'failed' as const, label: 'Falhas', count: openFailedCount },
            { key: 'warning' as const, label: 'Atenções', count: openWarningCount },
            { key: 'accepted' as const, label: 'Aceitos', count: acceptedCount },
            { key: 'passed' as const, label: 'Conformes', count: passedCount },
          ].map(({ key, label, count }) => (
            <button
              key={key}
              onClick={() => setFilter(key)}
              aria-pressed={filter === key}
              aria-label={`${label}: ${count}`}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors',
                filter === key
                  ? 'bg-primary-600 text-white'
                  : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-200',
              )}
            >
              {label}
              <span
                className={cn(
                  'rounded-full px-1.5 py-0.5 text-[10px] font-bold',
                  filter === key
                    ? 'bg-white/20 text-white'
                    : 'bg-slate-200 dark:bg-slate-600 text-slate-500 dark:text-slate-400',
                )}
              >
                {count}
              </span>
            </button>
          ))}
        </div>
      )}

      {/* Actions */}
      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={runValidation}
          disabled={running}
          className="inline-flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50 transition-colors"
        >
          {running ? <LoadingSpinner size="sm" /> : <Play className="h-4 w-4" />}
          Executar validação
        </button>
        <button
          onClick={detectAnomalies}
          disabled={detectingAnomalies}
          className="inline-flex items-center gap-2 rounded-lg border border-violet-300 bg-violet-50 px-4 py-2 text-sm font-medium text-violet-700 hover:bg-violet-100 disabled:opacity-50 transition-colors"
        >
          {detectingAnomalies ? <LoadingSpinner size="sm" /> : <Brain className="h-4 w-4" />}
          Analisar divergências
        </button>

        {/* Generate Correction Email - only show when there are failures */}
        {openFailedCount > 0 && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => generateCorrectionDraft(false)}
              disabled={generatingDraft}
              className="inline-flex items-center gap-2 rounded-lg border border-danger-300 bg-danger-50 px-4 py-2 text-sm font-medium text-danger-700 hover:bg-danger-100 disabled:opacity-50 transition-colors"
            >
              {generatingDraft ? <LoadingSpinner size="sm" /> : <Mail className="h-4 w-4" />}
              Gerar e-mail correcao
            </button>
            <button
              onClick={() => generateCorrectionDraft(true)}
              disabled={generatingDraft}
              className="inline-flex items-center gap-2 rounded-lg border border-orange-300 bg-orange-50 px-4 py-2 text-sm font-medium text-orange-700 hover:bg-orange-100 disabled:opacity-50 transition-colors"
              title="Gerar e-mail detalhado"
            >
              {generatingDraft ? <LoadingSpinner size="sm" /> : <Sparkles className="h-4 w-4" />}
              Gerar e-mail detalhado
            </button>
          </div>
        )}

        {/*
          The status counts already live on the filter buttons above, so the
          duplicate summary-badge strip here was a parallel count system that
          overlapped with both those buttons and the Cruzamento panel below.
          Removed to keep a single, unambiguous set of counts per panel.
        */}
      </div>

      {/* Checks grid */}
      {filteredChecks && filteredChecks.length > 0 ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {filteredChecks.map((check) => {
            const config = check.resolvedManually
              ? {
                  icon: Wrench,
                  border: 'border-primary-200',
                  bg: 'bg-primary-50',
                  iconColor: 'text-primary-500',
                }
              : (statusConfig[check.status] ?? statusConfig.warning);
            const Icon = config.icon;

            return (
              <div
                key={check.id}
                className={cn('rounded-lg border p-4 transition-colors', config.border, config.bg)}
              >
                <div className="flex items-start gap-3">
                  <Icon className={cn('mt-0.5 h-5 w-5 shrink-0', config.iconColor)} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                      {checkLabel(check.checkName)}
                    </p>
                    {check.message && (
                      <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-400">
                        {check.message}
                      </p>
                    )}
                    {check.status === 'failed' && (check.expectedValue || check.actualValue) && (
                      <div className="mt-2 space-y-1 text-xs">
                        {check.expectedValue && (
                          <p>
                            <span className="text-slate-500 dark:text-slate-400">Esperado: </span>
                            <span className="font-medium text-slate-800 dark:text-slate-100">
                              {check.expectedValue}
                            </span>
                          </p>
                        )}
                        {check.actualValue && (
                          <p>
                            <span className="text-slate-500 dark:text-slate-400">Encontrado: </span>
                            <span
                              className={cn(
                                'font-medium',
                                check.resolvedManually
                                  ? 'text-slate-800 dark:text-slate-100'
                                  : 'text-danger-700',
                              )}
                            >
                              {check.actualValue}
                            </span>
                          </p>
                        )}
                      </div>
                    )}
                    {check.resolvedManually && check.resolvedBy && (
                      <div className="mt-2 inline-flex items-center gap-1.5 rounded bg-primary-50 px-2 py-1 text-xs text-primary-700">
                        <Wrench className="h-3 w-3" />
                        Aceito por {check.resolvedBy}
                        {check.resolvedAt && (
                          <span className="text-primary-500">
                            em{' '}
                            {new Date(check.resolvedAt).toLocaleDateString('pt-BR', {
                              day: '2-digit',
                              month: '2-digit',
                              year: 'numeric',
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </span>
                        )}
                      </div>
                    )}
                    {check.status === 'failed' &&
                      !check.resolvedManually &&
                      (resolveTarget === check.id ? (
                        <div className="mt-2 space-y-2">
                          <label className="flex items-center gap-1 text-[11px] font-medium text-slate-500 dark:text-slate-400">
                            Justificativa do aceite manual
                            <span className="text-danger-500">*</span>
                            <span
                              className="cursor-help text-slate-400"
                              title="Aceite manual da divergencia — registra um override auditado. NAO revalida nem corrige os dados; apenas suprime o alerta com justificativa."
                            >
                              (?)
                            </span>
                          </label>
                          <textarea
                            value={resolveNote}
                            onChange={(e) => setResolveNote(e.target.value)}
                            rows={2}
                            autoFocus
                            placeholder="Ex.: divergencia aceita; peso confere com PL fisico conferido em 28/05."
                            className="w-full rounded-lg border border-slate-200 dark:border-slate-600 px-2.5 py-1.5 text-xs text-slate-800 dark:text-slate-100 focus:border-primary-400 focus:ring-2 focus:ring-primary-100 outline-none transition-all"
                          />
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => resolveManually(check.id, resolveNote)}
                              disabled={resolvingId === check.id || !resolveNote.trim()}
                              className="inline-flex items-center gap-1 rounded-md bg-primary-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-primary-700 disabled:opacity-50"
                            >
                              {resolvingId === check.id ? (
                                <LoadingSpinner size="sm" />
                              ) : (
                                <Wrench className="h-3 w-3" />
                              )}
                              Confirmar aceite
                            </button>
                            <button
                              onClick={() => {
                                setResolveTarget(null);
                                setResolveNote('');
                              }}
                              className="text-xs font-medium text-slate-500 dark:text-slate-400 hover:text-slate-700"
                            >
                              Cancelar
                            </button>
                          </div>
                        </div>
                      ) : (
                        <button
                          onClick={() => {
                            setResolveTarget(check.id);
                            setResolveNote('');
                          }}
                          title="Aceite manual da divergencia — nao revalida"
                          className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-primary-600 hover:text-primary-700"
                        >
                          <Wrench className="h-3 w-3" />
                          Aceitar
                        </button>
                      ))}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="py-6 text-center text-sm text-slate-500 dark:text-slate-400">
          {emptyFilterMessage}
        </p>
      )}

      {/* Skipped checks — blocked by a missing source document (collapsible) */}
      {skippedCount > 0 && (
        <details className="rounded-lg border border-slate-200 dark:border-slate-600 bg-slate-50/60 dark:bg-slate-900/40">
          <summary className="flex cursor-pointer items-center gap-2 px-4 py-2.5 text-sm font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800">
            <Minus className="h-4 w-4 text-slate-400" />
            Bloqueados por documento ausente
            <span className="rounded-full bg-slate-200 dark:bg-slate-700 px-2 py-0.5 text-[10px] font-bold text-slate-500 dark:text-slate-400">
              {skippedCount}
            </span>
            <span className="ml-auto text-[11px] font-normal text-slate-400">
              Nao contam como erro
            </span>
          </summary>
          <div className="grid grid-cols-1 gap-2 px-4 pb-4 pt-1 sm:grid-cols-2">
            {skippedChecks.map((check) => (
              <div
                key={check.id}
                className="rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 p-3"
              >
                <div className="flex items-start gap-2.5">
                  <Minus className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
                      {checkLabel(check.checkName)}
                    </p>
                    {check.message && (
                      <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                        {check.message}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </details>
      )}

      {/* Anomalies */}
      {anomalies && anomalies.length > 0 && (
        <div className="rounded-lg border border-violet-200 dark:border-violet-800 bg-violet-50 dark:bg-violet-950/30 p-4">
          <h4 className="mb-1 text-sm font-semibold text-violet-900 dark:text-violet-300">
            Anomalias Detectadas pela IA
          </h4>
          <p className="mb-3 text-xs text-violet-700/80 dark:text-violet-400/80">
            A contagem de itens sem correspondencia segue a comparacao deterministica do{' '}
            <span className="font-semibold">Comparativo Geral</span> — esta lista nao reporta um
            numero proprio.
          </p>
          <div className="space-y-2">
            {anomalies.map((anomaly, i) => {
              // The reconciled item-presence anomaly carries the deterministic
              // count; it is the canonical unmatched-items signal, so we point
              // back to the Comparativo Geral list instead of re-stating a count.
              const isReconciledItemMatch = anomaly.field === ITEM_MATCH_ANOMALY_FIELD;
              return (
                <div
                  key={i}
                  className="flex items-start gap-3 rounded-lg bg-white dark:bg-slate-800 p-3 border border-violet-100 dark:border-violet-800"
                >
                  <AlertTriangle
                    className={cn(
                      'mt-0.5 h-4 w-4 shrink-0',
                      anomaly.severity === 'high'
                        ? 'text-danger-500'
                        : anomaly.severity === 'medium'
                          ? 'text-amber-500'
                          : 'text-primary-500',
                    )}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                      {isReconciledItemMatch ? 'Itens sem correspondencia' : anomaly.field}
                    </p>
                    <p className="text-xs text-slate-600 dark:text-slate-400">
                      {anomaly.description}
                    </p>
                    {isReconciledItemMatch && (
                      <p className="mt-1 text-[11px] text-slate-400">
                        Ver a lista completa em "Itens no Packing List sem correspondencia na
                        Invoice" no Comparativo Geral.
                      </p>
                    )}
                  </div>
                  {!isReconciledItemMatch && Number.isFinite(anomaly.confidence) && (
                    <span className="text-xs text-slate-400">
                      {((anomaly.confidence ?? 0) * 100).toFixed(0)}%
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {anomalies && anomalies.length === 0 && (
        <div className="rounded-lg border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/30 p-4 text-center">
          <CheckCircle className="mx-auto h-6 w-6 text-emerald-500" />
          <p className="mt-1 text-sm text-emerald-700 dark:text-emerald-400">
            Nenhuma anomalia detectada pela IA.
          </p>
        </div>
      )}

      {/* Correction Draft Modal */}
      {showDraftModal && draft && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div
            ref={draftModalRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="draft-modal-title"
            tabIndex={-1}
            className="relative w-full max-w-3xl max-h-[90vh] overflow-y-auto rounded-2xl bg-white dark:bg-slate-800 shadow-xl"
          >
            {/* Header */}
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 px-6 py-4 rounded-t-2xl">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-danger-100">
                  <Mail className="h-4.5 w-4.5 text-danger-600" />
                </div>
                <div>
                  <h3
                    id="draft-modal-title"
                    className="text-lg font-bold text-slate-900 dark:text-slate-100"
                  >
                    E-mail de Correcao
                  </h3>
                  <p className="text-xs text-slate-400">
                    Rascunho para {draft.recipient} - Revise antes de enviar
                  </p>
                </div>
              </div>
              <button
                onClick={closeDraftModal}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 dark:bg-slate-700 dark:hover:bg-slate-700 hover:text-slate-600 dark:text-slate-400 transition-colors"
                aria-label="Fechar modal"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Body */}
            <div className="p-6 space-y-4">
              {/* Recipient Email */}
              <div>
                <label
                  htmlFor="draft-recipient-email"
                  className="block text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1.5"
                >
                  Destinatário
                </label>
                <textarea
                  ref={draftRecipientEmailRef}
                  id="draft-recipient-email"
                  value={editRecipientEmail}
                  onChange={(e) =>
                    dispatch({ type: 'SET_EDIT_RECIPIENT_EMAIL', payload: e.target.value })
                  }
                  rows={2}
                  placeholder="email@exemplo.com, outro@exemplo.com"
                  className="w-full resize-y rounded-lg border border-slate-200 dark:border-slate-600 px-3 py-2 text-sm text-slate-800 dark:text-slate-100 focus:border-primary-400 focus:ring-2 focus:ring-primary-100 outline-none transition-all"
                />
              </div>

              {/* Subject */}
              <div>
                <label
                  htmlFor="draft-subject"
                  className="block text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1.5"
                >
                  Assunto
                </label>
                <input
                  id="draft-subject"
                  type="text"
                  value={editSubject}
                  onChange={(e) => dispatch({ type: 'SET_EDIT_SUBJECT', payload: e.target.value })}
                  className="w-full rounded-lg border border-slate-200 dark:border-slate-600 px-3 py-2 text-sm text-slate-800 dark:text-slate-100 focus:border-primary-400 focus:ring-2 focus:ring-primary-100 outline-none transition-all"
                />
              </div>

              {/* Body Preview / Edit */}
              <div>
                <label
                  htmlFor="draft-body"
                  className="block text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1.5"
                >
                  Corpo do E-mail
                </label>
                <div className="rounded-lg border border-slate-200 dark:border-slate-600 overflow-hidden">
                  <div
                    ref={draftBodyRef}
                    id="draft-body"
                    role="textbox"
                    aria-multiline="true"
                    aria-label="Corpo do E-mail"
                    className="p-4 text-sm text-slate-700 dark:text-slate-300 min-h-[200px] max-h-[400px] overflow-y-auto prose prose-sm prose-slate max-w-none"
                    contentEditable
                    suppressContentEditableWarning
                    onInput={(e) => {
                      latestDraftBodyRef.current = e.currentTarget.innerHTML;
                    }}
                    onBlur={(e) =>
                      dispatch({ type: 'SET_EDIT_BODY', payload: e.currentTarget.innerHTML })
                    }
                    dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(editBody) }}
                  />
                </div>
              </div>

              {/* Signature Selector */}
              {emailSignatures && emailSignatures.length > 0 && (
                <div>
                  <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1.5">
                    <span className="inline-flex items-center gap-1.5">
                      <FileSignature className="h-3.5 w-3.5" />
                      Assinatura de E-mail
                    </span>
                  </label>
                  <select
                    value={selectedSignatureId ?? ''}
                    onChange={(e) =>
                      setSelectedSignatureId(e.target.value ? Number(e.target.value) : null)
                    }
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-600 px-3 py-2 text-sm text-slate-800 dark:text-slate-100 focus:border-primary-400 focus:ring-2 focus:ring-primary-100 outline-none transition-all"
                  >
                    <option value="">Sem assinatura</option>
                    {emailSignatures.map((sig) => (
                      <option key={sig.id} value={sig.id}>
                        {sig.name}
                        {sig.isDefault ? ' (padrão)' : ''}
                      </option>
                    ))}
                  </select>
                  {selectedSignatureId &&
                    (() => {
                      const sig = emailSignatures.find((s) => s.id === selectedSignatureId);
                      if (!sig) return null;
                      return (
                        <div
                          className="mt-2 rounded-lg border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-900 p-3 text-sm text-slate-600 dark:text-slate-400 prose prose-sm max-w-none"
                          dangerouslySetInnerHTML={{
                            __html: DOMPurify.sanitize(sig.signatureHtml),
                          }}
                        />
                      );
                    })()}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="sticky bottom-0 flex items-center justify-end gap-3 border-t border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-900 px-6 py-4 rounded-b-2xl">
              <button
                onClick={closeDraftModal}
                className="rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800 dark:bg-slate-900 transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={saveDraft}
                disabled={saving}
                className="inline-flex items-center gap-2 rounded-lg border border-primary-200 bg-primary-50 px-4 py-2 text-sm font-medium text-primary-700 hover:bg-primary-100 disabled:opacity-50 transition-colors"
              >
                {saving ? <LoadingSpinner size="sm" /> : <Mail className="h-4 w-4" />}
                Salvar Rascunho
              </button>
              <SubmitButton
                type="button"
                onClick={() => setShowSendConfirm(true)}
                loading={sending}
                disabled={sending}
                variant="danger"
              >
                <Send className="h-4 w-4" />
                Enviar E-mail
              </SubmitButton>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        isOpen={showSendConfirm}
        variant="danger"
        title="Enviar e-mail de correcao"
        message="Deseja realmente enviar este e-mail de correcao ao fornecedor?"
        confirmLabel="Enviar"
        onConfirm={sendEmail}
        onCancel={() => setShowSendConfirm(false)}
      />
    </div>
  );
}
