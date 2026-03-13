import { useState } from 'react';
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
} from 'lucide-react';
import { useApiQuery } from '@/shared/hooks/useApi';
import { cn } from '@/shared/lib/utils';
import { LoadingSpinner } from '@/shared/components/LoadingSpinner';
import type { ImportProcess } from '@/shared/types';

import { ProcessHeader } from './components/ProcessHeader';
import { ProcessTimeline } from './components/ProcessTimeline';
import { ProcessInfoCard } from './components/ProcessInfoCard';
import { DocumentsTab } from './components/DocumentsTab';
import { ComparisonTab } from './components/ComparisonTab';
import { ValidationTab } from './components/ValidationTab';
import { EspelhoTab } from './components/EspelhoTab';
import { CambiosTab } from './components/CambiosTab';
import { FollowUpTab } from './components/FollowUpTab';
import { ComunicacoesTab } from './components/ComunicacoesTab';
import { EmailsTab } from './components/EmailsTab';

// ── Constants ──────────────────────────────────────────────────────────

const TABS = [
  { key: 'documentos', label: 'Documentos', icon: FileText },
  { key: 'comparativo', label: 'Comparativo', icon: GitCompareArrows },
  { key: 'validacao', label: 'Validacao', icon: ClipboardCheck },
  { key: 'espelho', label: 'Espelho', icon: FileSpreadsheet },
  { key: 'cambios', label: 'Cambios', icon: DollarSign },
  { key: 'followup', label: 'Follow-Up', icon: CalendarDays },
  { key: 'comunicacoes', label: 'Comunicacoes', icon: MessageSquare },
  { key: 'emails', label: 'Emails', icon: Mail },
] as const;

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
    case 'comparativo':
      return <ComparisonTab processId={processId} />;
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
    default:
      return null;
  }
}

// ── Main Page ──────────────────────────────────────────────────────────

export function ProcessDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<string>('documentos');

  if (!id) return <Navigate to="/importacao/processos" replace />;

  const { data: process, isLoading } = useApiQuery<ImportProcess>(
    ['process', id],
    `/api/processes/${id}`,
  );

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
      <ProcessHeader
        process={process}
        processId={id}
        onBack={() => navigate('/importacao/processos')}
        onEdit={() => navigate(`/importacao/processos/${id}/editar`)}
      />

      <ProcessTimeline currentStatus={process.status} followUp={process.followUp} />

      <ProcessInfoCard process={process} />

      {/* Tabs */}
      <div className="rounded-2xl border border-slate-200/80 bg-white shadow-sm overflow-hidden">
        <div className="border-b border-slate-100 bg-slate-50/40 px-5 pt-4">
          <div className="flex gap-1 overflow-x-auto">
            {TABS.map((tab) => {
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
                  {tab.label}
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
