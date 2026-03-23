import { useState, useMemo, useEffect } from 'react';
import { useParams, useNavigate, Navigate } from 'react-router-dom';
import {
  FileText,
  ClipboardCheck,
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
} from 'lucide-react';
import { useApiQuery } from '@/shared/hooks/useApi';
import { cn } from '@/shared/lib/utils';
import { LoadingSpinner } from '@/shared/components/LoadingSpinner';
import { Breadcrumbs } from '@/shared/components/Breadcrumbs';
import type { ImportProcess, EmailLog } from '@/shared/types';

import { ProcessHeader } from './components/ProcessHeader';
import { ProcessTimeline } from './components/ProcessTimeline';
import { LogisticStatusBar, buildLogisticProps } from './components/LogisticStatusBar';
import { ProcessInfoCard } from './components/ProcessInfoCard';
import { DocumentsTab } from './components/DocumentsTab';
import { ComparisonTab } from './components/ComparisonTab';
import { ValidationTab } from './components/ValidationTab';
import { EspelhoTab } from './components/EspelhoTab';
import { CambiosTab } from './components/CambiosTab';
import { FollowUpTab } from './components/FollowUpTab';
import { ComunicacoesTab } from './components/ComunicacoesTab';
import { EmailsTab } from './components/EmailsTab';
import { DocumentChecklistTab } from './components/DocumentChecklistTab';
import { DraftBLTab } from './components/DraftBLTab';
import { ProcessTimelineEvents } from './components/ProcessTimelineEvents';

// ── Constants ──────────────────────────────────────────────────────────

/** Tabs that are always visible regardless of process status. */
const CORE_TABS = [
  { key: 'documentos', label: 'Documentos', icon: FileText },
  { key: 'draft_bl', label: 'Draft BL', icon: FileSearch },
  { key: 'comparativo', label: 'Comparativo', icon: GitCompareArrows },
  { key: 'checklist', label: 'Checklist', icon: ListChecks },
  { key: 'validacao', label: 'Validacao', icon: ClipboardCheck },
  { key: 'followup', label: 'Follow-Up', icon: CalendarDays },
  { key: 'comunicacoes', label: 'Comunicacoes', icon: MessageSquare },
  { key: 'emails', label: 'Emails', icon: Mail },
  { key: 'historico', label: 'Historico', icon: History },
] as const;

/** Tabs shown conditionally based on process status. */
const CONDITIONAL_TABS = [
  { key: 'cambios', label: 'Cambios', icon: DollarSign },
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
  if (tabKey === 'validacao') {
    const failedCount = validationChecks?.filter((c) => c.status === 'failed').length ?? 0;
    if (failedCount > 0) {
      return (
        <span className="absolute -top-0.5 -right-0.5 flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500" />
        </span>
      );
    }
    return null;
  }

  if (tabKey === 'documentos') {
    const docs = process.documents ?? [];
    const types = new Set(docs.map((d) => d.type?.toLowerCase()));
    const hasInv = types.has('invoice') || types.has('inv');
    const hasPl = types.has('packing_list') || types.has('packing-list') || types.has('pl');
    const hasBl =
      types.has('ohbl') ||
      types.has('bl') ||
      types.has('bill_of_lading') ||
      types.has('bill-of-lading');
    if (hasInv && hasPl && hasBl) {
      return (
        <span className="absolute -top-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-green-500 text-white">
          <Check className="h-2.5 w-2.5" />
        </span>
      );
    }
    return null;
  }

  if (tabKey === 'emails' && emailCount > 0) {
    return (
      <span className="absolute -top-1 -right-2 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-blue-600 text-[10px] font-bold text-white px-1">
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
}: {
  activeTab: string;
  processId: string;
  processCode: string;
}) {
  switch (activeTab) {
    case 'documentos':
      return <DocumentsTab processId={processId} />;
    case 'draft_bl':
      return <DraftBLTab processId={processId} />;
    case 'comparativo':
      return <ComparisonTab processId={processId} />;
    case 'checklist':
      return <DocumentChecklistTab processId={processId} />;
    case 'validacao':
      return <ValidationTab processId={processId} />;
    case 'espelho':
      return <EspelhoTab processId={processId} />;
    case 'cambios':
      return <CambiosTab processId={processId} />;
    case 'followup':
      return <FollowUpTab processId={processId} />;
    case 'comunicacoes':
      return <ComunicacoesTab processId={processId} />;
    case 'emails':
      return <EmailsTab processId={processId} processCode={processCode} />;
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
  const [activeTab, setActiveTab] = useState<string>('documentos');

  const { data: process, isLoading } = useApiQuery<ImportProcess>(
    ['process', id!],
    `/api/processes/${id}`,
    { enabled: !!id },
  );

  // Lightweight queries for tab indicators
  const { data: validationChecks } = useApiQuery<ValidationCheck[]>(
    ['validation', id!],
    `/api/validation/${id}`,
    { enabled: !!id, staleTime: 60_000 },
  );

  const { data: emailResponse } = useApiQuery<{ data: EmailLog[]; pagination: unknown }>(
    ['email-logs', id!],
    `/api/email-ingestion/logs?limit=50`,
    { enabled: !!id && !!process, staleTime: 60_000 },
  );

  const emailCount = useMemo(() => {
    if (!emailResponse?.data || !process) return 0;
    return emailResponse.data.filter(
      (l) => l.processCode === process.processCode || String(l.processCode) === process.processCode,
    ).length;
  }, [emailResponse, process]);

  /** Compute which tabs are visible based on process status. */
  const visibleTabs = useMemo(() => {
    if (!process) return [...CORE_TABS];

    const status = process.status;
    const tabs: Array<{ key: string; label: string; icon: typeof FileText }> = [...CORE_TABS];

    // Cambios: show when status is anything other than 'draft'
    if (status !== 'draft') {
      tabs.push(CONDITIONAL_TABS[0]);
    }

    // Espelho: show only when status is 'validated' or later
    if (VALIDATED_OR_LATER.has(status)) {
      tabs.push(CONDITIONAL_TABS[1]);
    }

    return tabs;
  }, [process]);

  // Reset active tab if it becomes hidden
  useEffect(() => {
    const visibleKeys = new Set(visibleTabs.map((t) => t.key));
    if (!visibleKeys.has(activeTab)) {
      setActiveTab('documentos');
    }
  }, [visibleTabs, activeTab]);

  if (!id) return <Navigate to="/importacao/processos" replace />;

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-32 gap-4">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-500 to-blue-700 shadow-lg shadow-blue-200">
          <Package className="h-7 w-7 text-white animate-pulse" />
        </div>
        <LoadingSpinner size="lg" />
        <p className="text-sm text-slate-400 font-medium">Carregando processo...</p>
      </div>
    );
  }

  if (!process) {
    return (
      <div className="flex flex-col items-center justify-center py-32 gap-4">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100">
          <Package className="h-7 w-7 text-slate-300" />
        </div>
        <p className="text-sm font-medium text-slate-500">Processo nao encontrado.</p>
        <button
          onClick={() => navigate('/importacao/processos')}
          className="mt-2 text-sm font-medium text-blue-600 hover:text-blue-700 transition-colors"
        >
          Voltar para processos
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Breadcrumbs
        items={[
          { label: 'Processos', href: '/importacao/processos' },
          { label: process.processCode || 'Detalhe' },
        ]}
      />

      <ProcessHeader
        process={process}
        processId={id}
        onBack={() => navigate('/importacao/processos')}
        onEdit={() => navigate(`/importacao/processos/${id}/editar`)}
      />

      <ProcessTimeline currentStatus={process.status} followUp={process.followUp} />

      <LogisticStatusBar {...buildLogisticProps(process)} />

      <ProcessInfoCard process={process} />

      {/* Tabs */}
      <div className="rounded-2xl border border-slate-200/80 bg-white shadow-sm overflow-hidden">
        <div className="border-b border-slate-100 bg-slate-50/40 px-5 pt-4">
          <div className="flex gap-1 overflow-x-auto">
            {visibleTabs.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.key;

              return (
                <button
                  key={tab.key}
                  onClick={() => setActiveTab(tab.key)}
                  className={cn(
                    'relative flex items-center gap-2 whitespace-nowrap rounded-t-xl px-5 py-3 text-sm font-semibold transition-all',
                    isActive
                      ? 'bg-white text-blue-700 shadow-sm border border-slate-200/80 border-b-white -mb-px z-10'
                      : 'text-slate-400 hover:text-slate-600 hover:bg-white/50',
                  )}
                >
                  <Icon className={cn('h-4 w-4', isActive ? 'text-blue-600' : '')} />
                  <span className="relative">
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
                    <div className="absolute bottom-0 left-4 right-4 h-0.5 rounded-full bg-gradient-to-r from-blue-500 to-blue-600" />
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Tab content */}
        <div className="p-7">
          <TabContent activeTab={activeTab} processId={id} processCode={process.processCode} />
        </div>
      </div>
    </div>
  );
}
