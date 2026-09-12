import { useMemo, useEffect, useCallback } from 'react';
import { useParams, useNavigate, Navigate, useSearchParams } from 'react-router-dom';
import {
  FileText,
  FileSpreadsheet,
  DollarSign,
  CalendarDays,
  MessageSquare,
  Mail,
  Package,
  GitCompareArrows,
  ListChecks,
  Check,
  FileSearch,
  History,
  ClipboardList,
  AlertTriangle,
  ShieldCheck,
} from 'lucide-react';
import { useApiQuery } from '@/shared/hooks/useApi';
import { cn } from '@/shared/lib/utils';
import { LoadingSpinner } from '@/shared/components/LoadingSpinner';
import { ErrorState } from '@/shared/components/ErrorState';
import { Breadcrumbs } from '@/shared/components/Breadcrumbs';
import type { ImportProcess, EmailLog, CurrencyExchange, CurrencyTotals } from '@/shared/types';

import { ProcessHeader } from './components/ProcessHeader';
import { ProcessTimeline } from './components/ProcessTimeline';
import { LogisticStatusBar, buildLogisticProps } from './components/LogisticStatusBar';
import { ProcessInfoCard } from './components/ProcessInfoCard';
import { DocumentsTab } from './components/DocumentsTab';
import { ComparisonTab } from './components/ComparisonTab';
import { EspelhoTab } from './components/EspelhoTab';
import { CambiosTab } from './components/CambiosTab';
import { FollowUpTab } from './components/FollowUpTab';
import { ComunicacoesTab } from './components/ComunicacoesTab';
import { EmailsTab } from './components/EmailsTab';
import { DocumentChecklistTab } from './components/DocumentChecklistTab';
import { DraftBLTab } from './components/DraftBLTab';
import { ProcessTimelineEvents } from './components/ProcessTimelineEvents';
import { PreConsTab } from './components/PreConsTab';
import { ProformasTab } from './components/ProformasTab';
import { RegistroTab } from './components/RegistroTab';
import { ErrorsCostsTab } from './components/ErrorsCostsTab';

// ── Constants ──────────────────────────────────────────────────────────

/** Tabs that are always visible regardless of process status. */
const CORE_TABS = [
  { key: 'draft_bl', label: 'Draft BL', icon: FileSearch },
  { key: 'pre_cons', label: 'Pre-Cons', icon: ClipboardList },
  { key: 'proformas', label: 'Proformas', icon: FileText },
  { key: 'documentos', label: 'Documentos', icon: FileText },
  { key: 'comparativo', label: 'Comparativo', icon: GitCompareArrows },
  { key: 'checklist', label: 'Checklist', icon: ListChecks },
  { key: 'followup', label: 'Follow-Up', icon: CalendarDays },
  { key: 'registro', label: 'Registro', icon: ShieldCheck },
  // A aba "Etapas" saiu (D7): as etapas especificas do processo agora sao
  // linhas do proprio Checklist, na posicao escolhida. `?tab=etapas` continua
  // funcionando como link antigo e cai no Checklist.
  { key: 'erros_custos', label: 'Erros/Custos', icon: AlertTriangle },
  { key: 'comunicacoes', label: 'Atendimentos', icon: MessageSquare },
  { key: 'emails', label: 'E-mails', icon: Mail },
  { key: 'historico', label: 'Histórico', icon: History },
] as const;

/** Tabs shown conditionally based on process status. */
const CONDITIONAL_TABS = [
  { key: 'cambios', label: 'Câmbios', icon: DollarSign },
  { key: 'espelho', label: 'Espelho', icon: FileSpreadsheet },
] as const;

/** Statuses considered "at or beyond validated". */
const VALIDATED_OR_LATER = new Set([
  'validated',
  'espelho_generated',
  'sent_to_fenicia',
  'li_pending',
  'completed',
]);

// ── Tab indicator types ────────────────────────────────────────────────

interface ValidationCheck {
  id: number;
  status: 'passed' | 'failed' | 'warning' | 'skipped';
}

import { isDocumentOperational } from '@/shared/lib/confidence';

type EmailLogsResponse = { data: EmailLog[]; pagination: unknown };

type CambiosTotalsResponse = {
  exchanges: CurrencyExchange[];
  totals: CurrencyTotals;
};

/** Small indicator rendered at top-right of a tab label. */
function TabIndicator({
  tabKey,
  process,
  validationChecks,
  emailCount,
}: {
  tabKey: string;
  process: ImportProcess;
  validationChecks: ValidationCheck[] | undefined;
  emailCount: number;
}) {
  if (tabKey === 'comparativo') {
    const failedCount = validationChecks?.filter((c) => c.status === 'failed').length ?? 0;
    if (failedCount > 0) {
      return (
        <span className="absolute -top-0.5 -right-0.5 flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-danger-400 opacity-75" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-danger-500" />
        </span>
      );
    }
    return null;
  }

  if (tabKey === 'documentos') {
    const docs = process.documents ?? [];
    const hasUsableDoc = (aliases: string[]) =>
      docs.some((doc) => {
        const type = doc.type?.toLowerCase();
        if (!type || !aliases.includes(type)) return false;
        if (!isDocumentOperational(doc.confidenceScore, type)) return false;
        const data = doc.aiParsedData;
        if (!doc.isProcessed || !data || typeof data !== 'object' || Array.isArray(data)) {
          return false;
        }
        if (data.extractionFailed || data.error || data.skipped) return false;
        return Object.entries(data).some(([key, value]) => {
          if (
            [
              'budgetExceeded',
              'confidence',
              'confidenceScore',
              'error',
              'extractionFailed',
              'fieldsWithLowConfidence',
              'reason',
              'rawText',
              'skipped',
              'source',
              'warnings',
            ].includes(key)
          ) {
            return false;
          }
          if (value == null) return false;
          if (typeof value === 'string') return value.trim().length > 0;
          if (typeof value === 'number') return Number.isFinite(value);
          if (Array.isArray(value)) return value.length > 0;
          if (typeof value === 'object') return Object.keys(value).length > 0;
          return true;
        });
      });
    const hasInv = hasUsableDoc(['invoice', 'inv']);
    const hasPl = hasUsableDoc(['packing_list', 'packing-list', 'pl']);
    const hasBl = hasUsableDoc(['ohbl', 'bl', 'bill_of_lading', 'bill-of-lading']);
    const hasAllReceived = ['invoice', 'packing_list', 'ohbl'].every((type) =>
      docs.some((doc) => doc.type?.toLowerCase() === type),
    );
    if (hasInv && hasPl && hasBl) {
      return (
        <span className="absolute -top-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-emerald-500 text-white">
          <Check className="h-2.5 w-2.5" />
        </span>
      );
    }
    if (hasAllReceived) {
      return (
        <span
          className="absolute -top-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-amber-500"
          title="Documentos recebidos, mas ainda ha extracao pendente ou com erro"
        />
      );
    }
    return null;
  }

  if (tabKey === 'emails' && emailCount > 0) {
    return (
      <span className="absolute -top-1 -right-2 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-primary-600 text-[10px] font-bold text-white px-1">
        {emailCount}
      </span>
    );
  }

  return null;
}

// ── Tab Content Router ─────────────────────────────────────────────────

function TabContent({
  activeTab,
  processId,
  processCode,
  aiExtractedData,
  emailResponse,
  cambiosData,
}: {
  activeTab: string;
  processId: string;
  processCode: string;
  aiExtractedData?: Record<string, unknown> | null;
  emailResponse?: EmailLogsResponse;
  cambiosData?: CambiosTotalsResponse;
}) {
  switch (activeTab) {
    case 'documentos':
      return <DocumentsTab processId={processId} aiExtractedData={aiExtractedData} />;
    case 'draft_bl':
      return <DraftBLTab processId={processId} />;
    case 'pre_cons':
      return <PreConsTab processId={processId} processCode={processCode} />;
    case 'proformas':
      return <ProformasTab processId={processId} />;
    case 'comparativo':
      return <ComparisonTab processId={processId} />;
    case 'checklist':
      return <DocumentChecklistTab processId={processId} />;
    case 'espelho':
      return <EspelhoTab processId={processId} />;
    case 'cambios':
      return <CambiosTab processId={processId} initialData={cambiosData} />;
    case 'followup':
      return <FollowUpTab processId={processId} />;
    case 'registro':
      return <RegistroTab processId={processId} />;
    case 'erros_custos':
      return <ErrorsCostsTab processId={processId} />;
    case 'comunicacoes':
      return <ComunicacoesTab processId={processId} />;
    case 'emails':
      return (
        <EmailsTab
          processId={processId}
          processCode={processCode}
          initialResponse={emailResponse}
        />
      );
    case 'historico':
      return <ProcessTimelineEvents processId={processId} />;
    default:
      return null;
  }
}

// ── Main Page ──────────────────────────────────────────────────────────

export function ProcessDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = searchParams.get('tab') ?? 'documentos';

  const setActiveTab = useCallback(
    (key: string) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (key === 'documentos') {
            next.delete('tab');
          } else {
            next.set('tab', key);
          }
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const {
    data: process,
    isLoading,
    error,
    refetch,
  } = useApiQuery<ImportProcess>(['process', id!], `/api/processes/${id}`, { enabled: !!id });

  // Lightweight queries for tab indicators
  const {
    data: validationChecks,
    error: validationChecksError,
    refetch: refetchValidationChecks,
  } = useApiQuery<ValidationCheck[]>(['validation', id!], `/api/validation/${id}`, {
    enabled: !!id,
    staleTime: 60_000,
  });

  const {
    data: emailResponse,
    error: emailLogsError,
    refetch: refetchEmailLogs,
  } = useApiQuery<EmailLogsResponse>(
    ['email-logs', id!, process?.processCode],
    `/api/email-ingestion/logs?limit=100&processId=${id}`,
    { enabled: !!id && !!process, staleTime: 60_000 },
  );

  // Lightweight check for cambios data (cached — CambiosTab won't re-fetch)
  const {
    data: cambiosData,
    isLoading: isLoadingCambios,
    error: cambiosError,
    refetch: refetchCambios,
  } = useApiQuery<CambiosTotalsResponse>(
    ['cambios', id!],
    `/api/currency-exchange/process/${id}/totals`,
    {
      enabled: !!id && !!process && process.status !== 'draft',
      staleTime: 60_000,
    },
  );

  const emailCount = useMemo(() => {
    if (!emailResponse?.data) return 0;
    return emailResponse.data.length;
  }, [emailResponse]);

  const hasAuxiliaryLoadError = !!(validationChecksError || emailLogsError || cambiosError);

  /** Compute which tabs are visible based on process status and available data. */
  const visibleTabs = useMemo(() => {
    if (!process) return [...CORE_TABS];

    const status = process.status;
    const tabs: Array<{ key: string; label: string; icon: typeof FileText }> = [...CORE_TABS];

    // Cambios: show only when there is actual data
    const hasCambios = (cambiosData?.exchanges ?? []).length > 0;
    if (status !== 'draft' && hasCambios) {
      tabs.push(CONDITIONAL_TABS[0]);
    }

    // Espelho: show only when status is 'validated' or later
    if (VALIDATED_OR_LATER.has(status)) {
      tabs.push(CONDITIONAL_TABS[1]);
    }

    return tabs;
  }, [process, cambiosData]);

  // Reset active tab if it becomes hidden
  useEffect(() => {
    // Conditional tabs depend on asynchronous data. Validating too early used
    // to discard deep links such as ?tab=espelho on the first render and
    // ?tab=cambios while the exchange summary was still loading.
    if (!process || isLoading || (activeTab === 'cambios' && isLoadingCambios)) return;

    const visibleKeys = new Set(visibleTabs.map((t) => t.key));
    if (!visibleKeys.has(activeTab)) {
      // Abas que deixaram de existir continuam navegaveis pelo link antigo:
      // 'validacao' virou o Comparativo e 'etapas' virou parte do Checklist
      // (D7). Qualquer outra chave desconhecida cai em Documentos.
      const REMOVED_TAB_REDIRECTS: Record<string, string> = {
        validacao: 'comparativo',
        etapas: 'checklist',
      };
      setActiveTab(REMOVED_TAB_REDIRECTS[activeTab] ?? 'documentos');
    }
  }, [visibleTabs, activeTab, setActiveTab, process, isLoading, isLoadingCambios]);

  const handleTabChange = useCallback((key: string) => setActiveTab(key), [setActiveTab]);
  const handleBack = useCallback(() => navigate('/importacao/processos'), [navigate]);
  const handleEdit = useCallback(
    () => navigate(`/importacao/processos/${id}/editar`),
    [navigate, id],
  );

  if (!id) return <Navigate to="/importacao/processos" replace />;

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-32 gap-4">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-primary-500 to-primary-700 shadow-sm">
          <Package className="h-7 w-7 text-white animate-pulse" />
        </div>
        <LoadingSpinner size="lg" />
        <p className="text-sm text-slate-400 dark:text-slate-500 font-medium">
          Carregando processo...
        </p>
      </div>
    );
  }

  if (error) {
    return <ErrorState message="Erro ao carregar processo." onRetry={() => refetch()} />;
  }

  if (!process) {
    return (
      <div className="flex flex-col items-center justify-center py-32 gap-4">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 dark:bg-slate-800">
          <Package className="h-7 w-7 text-slate-300" />
        </div>
        <p className="text-sm font-medium text-slate-500 dark:text-slate-400">
          Processo nao encontrado.
        </p>
        <button
          type="button"
          onClick={() => navigate('/importacao/processos')}
          className="mt-2 text-sm font-medium text-primary-600 hover:text-primary-700 transition-colors dark:text-primary-300 dark:hover:text-primary-300"
        >
          Voltar para processos
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      {/* O breadcrumb ROLA junto com a pagina: dentro da area fixa ele custava
          ~28px permanentes so para repetir o codigo do processo, que ja esta na
          barra e no titulo. */}
      <Breadcrumbs
        items={[
          { label: 'Processos', href: '/importacao/processos' },
          { label: process.processCode || 'Detalhe' },
        ]}
      />

      {/* Fixo so no desktop: em 375px o bloco media 537px de 812px de viewport
          (66% da tela) e sobrava quase nada para o conteudo da aba. */}
      <div className="z-30 -mx-4 border-b border-slate-200/70 bg-slate-50/95 px-4 py-2 backdrop-blur dark:border-slate-800 dark:bg-slate-950/95 lg:sticky lg:top-0 lg:-mx-6 lg:px-6">
        <ProcessHeader process={process} processId={id} onBack={handleBack} onEdit={handleEdit} />
      </div>

      {/* Ciclo de transporte primeiro (reuniao 11/09: "esse ciclo de
          transporte podia vir antes"): e o que a operacao olha o dia inteiro.
          O stepper documental e a capa vem depois. */}
      <LogisticStatusBar {...buildLogisticProps(process)} />

      <ProcessTimeline currentStatus={process.status} followUp={process.followUp} />

      <ProcessInfoCard process={process} />

      {hasAuxiliaryLoadError && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100"
        >
          <span>Alguns indicadores do processo não puderam ser atualizados.</span>
          <button
            type="button"
            onClick={() => {
              void refetchValidationChecks();
              void refetchEmailLogs();
              void refetchCambios();
            }}
            className="rounded-lg border border-amber-300 px-3 py-1.5 text-xs font-semibold transition-colors hover:bg-amber-100 dark:border-amber-700 dark:hover:bg-amber-900/40"
          >
            Tentar novamente
          </button>
        </div>
      )}

      {/* Tabs */}
      <div className="rounded-2xl border border-slate-200/60 bg-white dark:bg-slate-800 dark:border-slate-700/60 shadow-sm overflow-hidden">
        <div className="border-b border-slate-100 dark:border-slate-700 bg-slate-50/40 dark:bg-slate-900/40 px-3 pt-3 sm:px-5 sm:pt-4">
          <div className="flex gap-1 overflow-x-auto scrollbar-hide" role="tablist">
            {visibleTabs.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.key;

              return (
                <button
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  aria-label={tab.label}
                  aria-controls="process-tabpanel"
                  id={`process-tab-${tab.key}`}
                  key={tab.key}
                  onClick={() => handleTabChange(tab.key)}
                  className={cn(
                    'relative flex shrink-0 items-center gap-1.5 sm:gap-2 whitespace-nowrap rounded-t-xl px-3 py-2.5 sm:px-5 sm:py-3 text-sm font-semibold transition-all',
                    isActive
                      ? 'bg-white dark:bg-slate-800 text-primary-700 dark:text-primary-400 shadow-sm border border-slate-200/60 dark:border-slate-700/60 border-b-white dark:border-b-slate-800 -mb-px z-10'
                      : 'text-slate-400 hover:text-slate-600 dark:text-slate-400 dark:hover:text-slate-200 hover:bg-white/50 dark:hover:bg-slate-700/50',
                  )}
                >
                  <Icon
                    className={cn(
                      'h-4 w-4',
                      isActive ? 'text-primary-600 dark:text-primary-300' : '',
                    )}
                  />
                  <span className="relative inline">
                    {tab.label}
                    {process && (
                      <TabIndicator
                        tabKey={tab.key}
                        process={process}
                        validationChecks={validationChecks}
                        emailCount={emailCount}
                      />
                    )}
                  </span>
                  {isActive && (
                    <div className="absolute bottom-0 left-4 right-4 h-0.5 rounded-full bg-gradient-to-r from-primary-500 to-primary-600" />
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Tab content */}
        <div
          id="process-tabpanel"
          role="tabpanel"
          aria-labelledby={`process-tab-${activeTab}`}
          className="p-4 md:p-7"
        >
          <TabContent
            activeTab={activeTab}
            processId={id}
            processCode={process.processCode}
            aiExtractedData={process.aiExtractedData}
            emailResponse={emailResponse}
            cambiosData={cambiosData}
          />
        </div>
      </div>
    </div>
  );
}
