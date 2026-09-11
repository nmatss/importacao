import { useState } from 'react';
import { toast } from 'sonner';
import {
  FileText,
  Trash2,
  RefreshCw,
  CheckCircle,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Mail,
  Upload,
  Loader2,
  AlertTriangle,
  Eye,
  Download,
  HardDrive,
  Pencil,
  X,
} from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useApiQuery } from '@/shared/hooks/useApi';
import { useAuth } from '@/shared/hooks/useAuth';
import { cn, formatDate } from '@/shared/lib/utils';
import { DOCUMENT_TYPES } from '@/shared/lib/constants';
import {
  MIN_OPERATIONAL_CONFIDENCE,
  CONFIDENCE_HIGH,
  CONFIDENCE_MEDIUM,
  explainLowConfidence,
} from '@/shared/lib/confidence';
import { TableSkeleton } from '@/shared/components/Skeleton';
import { ConfirmDialog } from '@/shared/components/ConfirmDialog';
import { ErrorState } from '@/shared/components/ErrorState';
import { AiExtractionSummary } from './AiExtractionSummary';
import { invalidateDocumentWorkflow } from './queryInvalidation';

interface Document {
  id: number;
  fileName: string;
  documentType: string;
  uploadedAt: string;
  aiProcessingStatus: 'pending' | 'processing' | 'completed' | 'failed';
  aiParsedData?: Record<string, unknown>;
  aiConfidence?: number | null;
  driveFileId?: string | null;
  extractionCoverage?: {
    readPercent: number;
    effectiveReadPercent?: number;
    trackedMissingFields?: string[];
    trackedTotalWeight?: number;
    trackedFilledWeight?: number;
    totalFields: number;
    filledFields: number;
    missingFields: string[];
    lowConfidenceFields: string[];
  } | null;
}

interface DocumentSource {
  source: 'email' | 'manual' | 'drive';
  emailSubject?: string;
  driveFileId?: string;
}

interface DocumentListProps {
  processId: string;
}

const typeLabel = (type: string) => DOCUMENT_TYPES.find((d) => d.value === type)?.label ?? type;

function sourceLabel(source: DocumentSource): string {
  if (source.source === 'email') {
    return `E-mail${source.emailSubject ? `: ${source.emailSubject}` : ''}`;
  }
  if (source.source === 'drive') return 'Pasta do processo no Drive';
  return 'Upload manual';
}

function SourceIcon({ source, className }: { source: DocumentSource; className: string }) {
  if (source.source === 'email') return <Mail className={className} />;
  if (source.source === 'drive') return <HardDrive className={className} />;
  return <Upload className={className} />;
}

// null = ainda sem score (doc não processado) → tratado como utilizável aqui;
// o LIMIAR vem da fonte única em shared/lib/confidence.ts.
function hasOperationalConfidence(value: number | null | undefined): boolean {
  return value == null || value >= MIN_OPERATIONAL_CONFIDENCE;
}

const TYPE_COLORS: Record<string, string> = {
  invoice:
    'bg-primary-50 text-primary-700 border-primary-200 dark:bg-primary-950/30 dark:text-primary-300 dark:border-primary-700/50',
  proforma_invoice: 'bg-fuchsia-50 text-fuchsia-700 border-fuchsia-200',
  packing_list:
    'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/30 dark:text-amber-300 dark:border-amber-700/50',
  ohbl: 'bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-950/30 dark:text-violet-300 dark:border-violet-700/50',
  draft_bl:
    'bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-950/30 dark:text-violet-300 dark:border-violet-700/50',
  draft_duimp:
    'bg-red-50 text-red-700 border-red-200 dark:bg-danger-950/30 dark:text-danger-300 dark:border-danger-700/50',
  duimp:
    'bg-red-50 text-red-700 border-red-200 dark:bg-danger-950/30 dark:text-danger-300 dark:border-danger-700/50',
  espelho:
    'bg-cyan-50 text-cyan-700 border-cyan-200 dark:bg-cyan-950/30 dark:text-cyan-300 dark:border-cyan-700/50',
  li: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-300 dark:border-emerald-700/50',
  certificate: 'bg-pink-50 text-pink-700 border-pink-200',
  other:
    'bg-slate-50 dark:bg-slate-900 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-600',
};

function ConfidenceBadge({ value, data }: { value: number; data?: Record<string, unknown> }) {
  const pct = Math.round(value * 100);
  const usable = hasOperationalConfidence(value);
  // Limiar de cor unificado (shared/lib/confidence.ts) — a mesma % tinha
  // cores diferentes conforme a tela.
  // Compara sobre o pct ARREDONDADO (o número que o operador vê): 0.795
  // exibe "80%" e precisa ser verde, não âmbar.
  const color = !usable
    ? 'text-danger-700 bg-danger-50 ring-1 ring-danger-200 dark:text-danger-300 dark:bg-danger-950/30 dark:ring-danger-700/50'
    : pct >= CONFIDENCE_HIGH * 100
      ? 'text-emerald-700 bg-emerald-50 dark:text-emerald-300 dark:bg-emerald-950/30'
      : pct >= CONFIDENCE_MEDIUM * 100
        ? 'text-amber-700 bg-amber-50 dark:text-amber-300 dark:bg-amber-950/30'
        : 'text-danger-700 bg-danger-50 dark:text-danger-300 dark:bg-danger-950/30';

  // "Por quê está baixo": a fórmula nova derruba números de propósito —
  // o tooltip explica a causa em linguagem de operador.
  const { reasons, action } = explainLowConfidence(data);
  const base = usable
    ? `Confiança da extração: ${pct}%`
    : `Confiança ${pct}% abaixo do piso operacional; documento não utilizável automaticamente`;
  const why =
    pct < CONFIDENCE_HIGH * 100 && reasons.length > 0
      ? `\nPor quê: ${reasons.join(' ')}${action ? `\nAção: ${action}` : ''}`
      : '';

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium',
        color,
      )}
      title={`${base}${why}`}
    >
      {usable ? `${pct}%` : `${pct}% não utilizável`}
    </span>
  );
}

function AiStatus({
  status,
  confidence,
}: {
  status: Document['aiProcessingStatus'];
  confidence?: number | null;
}) {
  if (status === 'completed' && !hasOperationalConfidence(confidence)) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-danger-500">
        <AlertTriangle className="h-3 w-3" />
        Não utilizável
      </span>
    );
  }

  switch (status) {
    case 'processing':
    case 'pending':
      return (
        <span className="inline-flex items-center gap-1 text-xs text-primary-500">
          <Loader2 className="h-3 w-3 animate-spin" />
          Processando
        </span>
      );
    case 'completed':
      return (
        <span className="inline-flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-300">
          <CheckCircle className="h-3 w-3" />
          Extraído
        </span>
      );
    case 'failed':
      return (
        <span className="inline-flex items-center gap-1 text-xs text-danger-500">
          <AlertTriangle className="h-3 w-3" />
          Erro
        </span>
      );
    default:
      return null;
  }
}

function isOperationallyExtracted(doc: Document): boolean {
  return (
    doc.aiProcessingStatus === 'completed' &&
    hasOperationalConfidence(doc.aiConfidence) &&
    !!doc.aiParsedData
  );
}

function extractionFailureMessage(doc: Document): string | null {
  if (doc.aiProcessingStatus === 'completed' && !hasOperationalConfidence(doc.aiConfidence)) {
    const pct = Math.round((doc.aiConfidence ?? 0) * 100);
    return `Confiança da extração (${pct}%) abaixo do piso operacional. Dados ficam apenas para revisão e não devem ser usados automaticamente.`;
  }
  if (doc.aiProcessingStatus !== 'failed') return null;
  const data = doc.aiParsedData;
  if (!data || typeof data !== 'object') {
    return 'Falha na extração. Reprocesse o documento ou revise o arquivo enviado.';
  }
  if (data.budgetExceeded) {
    return 'Orçamento de IA indisponível no momento. Reprocesse após a normalização do provedor.';
  }
  const detail = data.reason ?? data.error ?? data.message;
  return detail
    ? `Falha na extração: ${String(detail).slice(0, 180)}`
    : 'Falha na extração. Reprocesse o documento ou revise o arquivo enviado.';
}

export function DocumentList({ processId }: DocumentListProps) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const canDeleteDocuments = user?.role === 'admin';
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Document | null>(null);
  const [sources, setSources] = useState<Record<string, DocumentSource>>({});
  const [activeFileAction, setActiveFileAction] = useState<string | null>(null);
  const [reprocessingId, setReprocessingId] = useState<number | null>(null);
  const [reclassifyingId, setReclassifyingId] = useState<number | null>(null);
  const [reclassificationType, setReclassificationType] = useState('');

  // Auto-refresh every 5s while any doc is still processing
  const {
    data: documents,
    isLoading,
    error,
    refetch,
  } = useApiQuery<Document[]>(['documents', processId], `/api/documents/process/${processId}`, {
    refetchInterval: (query) => {
      const docs = query.state.data;
      if (!docs) return false;
      const hasProcessing = docs.some(
        (d) => d.aiProcessingStatus === 'processing' || d.aiProcessingStatus === 'pending',
      );
      return hasProcessing ? 5000 : false;
    },
  });

  const fetchSource = async (docId: number) => {
    if (sources[docId]) return;
    try {
      const token = localStorage.getItem('importacao_token');
      const baseUrl = import.meta.env.VITE_API_URL || '';
      const res = await fetch(`${baseUrl}/api/documents/${docId}/source`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (res.ok) {
        const json = await res.json();
        const data = json.data ?? json;
        setSources((prev) => ({ ...prev, [docId]: data }));
      }
    } catch {
      // ignore
    }
  };

  const openOrDownload = async (doc: Document, mode: 'open' | 'download') => {
    const actionKey = `${doc.id}:${mode}`;
    if (activeFileAction) return;
    setActiveFileAction(actionKey);
    const token = localStorage.getItem('importacao_token');
    const baseUrl = import.meta.env.VITE_API_URL || '';
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 45_000);
    try {
      const url = `${baseUrl}/api/documents/${doc.id}/file${mode === 'download' ? '?download=1' : ''}`;
      const res = await fetch(url, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        // Allow redirect to Google Drive when the local file is missing
        redirect: 'follow',
        signal: controller.signal,
      });
      if (res.redirected && res.url) {
        window.open(res.url, '_blank', 'noopener,noreferrer');
        return;
      }
      if (!res.ok) throw new Error(`Falha ao abrir documento (${res.status})`);
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      if (mode === 'download') {
        const a = window.document.createElement('a');
        a.href = objectUrl;
        a.download = doc.fileName || `documento-${doc.id}`;
        window.document.body.appendChild(a);
        a.click();
        a.remove();
      } else {
        window.open(objectUrl, '_blank', 'noopener,noreferrer');
      }
      setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
    } catch (err: any) {
      if (doc.driveFileId) {
        window.open(
          `https://drive.google.com/file/d/${doc.driveFileId}/view`,
          '_blank',
          'noopener,noreferrer',
        );
        toast.info('Arquivo local indisponível. Abrindo cópia no Drive.');
        return;
      }
      toast.error(
        err?.name === 'AbortError'
          ? 'Tempo limite ao acessar documento. Tente baixar novamente ou abrir no Drive.'
          : err.message || 'Erro ao acessar documento',
      );
    } finally {
      window.clearTimeout(timeout);
      setActiveFileAction(null);
    }
  };

  const handleReprocess = async (docId: number) => {
    if (reprocessingId) return;
    setReprocessingId(docId);
    const token = localStorage.getItem('importacao_token');
    const baseUrl = import.meta.env.VITE_API_URL || '';
    try {
      const res = await fetch(`${baseUrl}/api/documents/${docId}/reprocess`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error || body?.message || 'Falha ao reprocessar documento');
      }
      toast.success('Reprocessamento iniciado');
      void invalidateDocumentWorkflow(queryClient, processId);
    } catch (err: any) {
      toast.error(err.message || 'Erro ao reprocessar documento');
    } finally {
      setReprocessingId(null);
    }
  };

  const handleReclassify = async (doc: Document) => {
    if (!reclassificationType || reclassificationType === doc.documentType) {
      setReclassifyingId(null);
      return;
    }
    const token = localStorage.getItem('importacao_token');
    const baseUrl = import.meta.env.VITE_API_URL || '';
    try {
      const res = await fetch(`${baseUrl}/api/documents/${doc.id}/classification`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ documentType: reclassificationType }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error || body?.message || 'Falha ao corrigir classificação');
      }
      toast.success('Classificação corrigida; nova extração iniciada');
      void invalidateDocumentWorkflow(queryClient, processId);
      setReclassifyingId(null);
    } catch (err: any) {
      toast.error(err.message || 'Erro ao corrigir classificação');
    }
  };

  const handleDelete = (doc: Document) => {
    const token = localStorage.getItem('importacao_token');
    const baseUrl = import.meta.env.VITE_API_URL || '';
    fetch(`${baseUrl}/api/documents/${doc.id}`, {
      method: 'DELETE',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then((res) => {
        if (!res.ok) throw new Error('Falha ao excluir documento');
        toast.success('Documento excluído');
        void invalidateDocumentWorkflow(queryClient, processId);
        setDeleteTarget(null);
      })
      .catch((err: any) => {
        toast.error(err.message || 'Erro ao excluir documento');
      });
  };

  if (isLoading) return <TableSkeleton />;

  if (error) {
    return <ErrorState message="Erro ao carregar documentos." onRetry={() => refetch()} />;
  }

  const visibleDocuments = (documents ?? []).filter(
    (doc) => doc.documentType !== 'proforma_invoice',
  );

  if (!visibleDocuments || visibleDocuments.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-10 text-slate-400">
        <FileText className="h-8 w-8" />
        <p className="text-sm">Nenhum documento enviado ainda</p>
      </div>
    );
  }

  // Group by document type
  const grouped = visibleDocuments.reduce(
    (acc, doc) => {
      const key = doc.documentType || 'other';
      if (!acc[key]) acc[key] = [];
      acc[key].push(doc);
      return acc;
    },
    {} as Record<string, Document[]>,
  );

  // Order groups: invoice, packing_list, ohbl first, then rest
  const typeOrder = [
    'invoice',
    'packing_list',
    'ohbl',
    'draft_bl',
    'draft_duimp',
    'duimp',
    'espelho',
    'li',
    'certificate',
    'other',
  ];
  const sortedGroups = Object.entries(grouped).sort(
    ([a], [b]) =>
      (typeOrder.indexOf(a) === -1 ? 99 : typeOrder.indexOf(a)) -
      (typeOrder.indexOf(b) === -1 ? 99 : typeOrder.indexOf(b)),
  );

  // Status summary
  const totalDocs = visibleDocuments.length;
  const completedDocs = visibleDocuments.filter(isOperationallyExtracted).length;
  const lowConfidenceDocs = visibleDocuments.filter(
    (d) => d.aiProcessingStatus === 'completed' && !hasOperationalConfidence(d.aiConfidence),
  ).length;
  const failedDocs = visibleDocuments.filter((d) => d.aiProcessingStatus === 'failed').length;
  const coreTypes = ['invoice', 'packing_list', 'ohbl'];
  const hasAllCoreDocs = coreTypes.every((type) => Boolean(grouped[type]?.length));
  const hasAllCoreExtracted = coreTypes.every((type) =>
    (grouped[type] ?? []).some(isOperationallyExtracted),
  );

  return (
    <>
      {/* Summary bar */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg bg-slate-50 dark:bg-slate-900 px-4 py-2">
        <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
          {totalDocs} documento{totalDocs !== 1 ? 's' : ''}
        </span>
        <span className="text-slate-300 dark:text-slate-600">|</span>
        <span className="text-xs text-slate-500 dark:text-slate-400">
          IA: {completedDocs}/{totalDocs} extraídos
        </span>
        {failedDocs > 0 && (
          <>
            <span className="text-slate-300 dark:text-slate-600">|</span>
            <span className="inline-flex items-center gap-1 text-xs font-medium text-danger-600 dark:text-danger-300">
              <AlertTriangle className="h-3 w-3" />
              {failedDocs} com erro
            </span>
          </>
        )}
        {lowConfidenceDocs > 0 && (
          <>
            <span className="text-slate-300 dark:text-slate-600">|</span>
            <span className="inline-flex items-center gap-1 text-xs font-medium text-danger-600 dark:text-danger-300">
              <AlertTriangle className="h-3 w-3" />
              {lowConfidenceDocs} não utilizável{lowConfidenceDocs !== 1 ? 's' : ''}
            </span>
          </>
        )}
        {hasAllCoreDocs && (
          <>
            <span className="text-slate-300 dark:text-slate-600">|</span>
            <span
              className={cn(
                'inline-flex items-center gap-1 text-xs font-medium',
                hasAllCoreExtracted
                  ? 'text-emerald-600 dark:text-emerald-300'
                  : 'text-amber-600 dark:text-amber-300',
              )}
            >
              {hasAllCoreExtracted ? (
                <CheckCircle className="h-3 w-3" />
              ) : (
                <Loader2 className="h-3 w-3 animate-spin" />
              )}
              {hasAllCoreExtracted
                ? 'INV + PL + BL extraídos'
                : 'INV + PL + BL recebidos, aguardando IA'}
            </span>
          </>
        )}
      </div>

      {/* Document cards */}
      <div className="space-y-2">
        {sortedGroups.map(([type, docs]) => (
          <div key={type}>
            {sortedGroups.length > 1 && (
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                {typeLabel(type)}
              </p>
            )}
            <div className="space-y-1.5">
              {docs.map((doc) => {
                const expanded = expandedId === doc.id;
                const source = sources[doc.id];
                const opening = activeFileAction === `${doc.id}:open`;
                const downloading = activeFileAction === `${doc.id}:download`;
                const reprocessing = reprocessingId === doc.id;
                const reclassifying = reclassifyingId === doc.id;
                const failureMessage = extractionFailureMessage(doc);

                return (
                  <div
                    key={doc.id}
                    className="group rounded-lg border border-slate-150 dark:border-slate-700 bg-white dark:bg-slate-800 transition-shadow hover:shadow-sm"
                  >
                    <div className="flex flex-wrap items-start gap-x-3 gap-y-2 px-3 py-2.5">
                      {/* Type badge */}
                      <span
                        className={cn(
                          'mt-0.5 inline-flex shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase',
                          TYPE_COLORS[doc.documentType] || TYPE_COLORS.other,
                        )}
                      >
                        {doc.documentType === 'packing_list'
                          ? 'PL'
                          : doc.documentType === 'invoice'
                            ? 'INV'
                            : doc.documentType === 'ohbl'
                              ? 'BL'
                              : doc.documentType === 'draft_bl'
                                ? 'DRAFT'
                                : doc.documentType === 'draft_duimp'
                                  ? 'D-DUIMP'
                                  : doc.documentType === 'duimp'
                                    ? 'DUIMP'
                                    : doc.documentType === 'certificate'
                                      ? 'CERT'
                                      : (typeLabel(doc.documentType) || doc.documentType)
                                          .slice(0, 4)
                                          .toUpperCase()}
                      </span>

                      {/* File info */}
                      <div className="min-w-[10rem] flex-1">
                        <p className="truncate text-sm font-medium text-slate-800 dark:text-slate-100">
                          {doc.fileName}
                        </p>
                        <div className="mt-0.5 flex items-center gap-2">
                          <span className="text-[11px] text-slate-500 dark:text-slate-400">
                            {formatDate(doc.uploadedAt)}
                          </span>
                          <AiStatus status={doc.aiProcessingStatus} confidence={doc.aiConfidence} />
                          {doc.aiConfidence != null && (
                            <ConfidenceBadge value={doc.aiConfidence} data={doc.aiParsedData} />
                          )}
                        </div>
                        {source && (
                          <div className="mt-1 flex min-w-0 items-center gap-1 text-[11px] text-slate-500 dark:text-slate-400">
                            <SourceIcon source={source} className="h-3 w-3 shrink-0" />
                            <span className="truncate">{sourceLabel(source)}</span>
                          </div>
                        )}
                        {failureMessage && (
                          <p className="mt-1 text-[11px] leading-4 text-danger-600 dark:text-danger-300">
                            {failureMessage}
                          </p>
                        )}
                      </div>

                      {/* Acoes: em ponteiro fino aparecem no hover; em toque
                          ficam sempre visiveis, e ganham a linha inteira quando
                          nao cabem ao lado do nome do arquivo. */}
                      <div className="flex w-full shrink-0 flex-wrap items-center justify-end gap-1 transition-opacity sm:w-auto sm:justify-start [@media(hover:hover)]:opacity-60 [@media(hover:hover)]:group-hover:opacity-100">
                        {/* Source */}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            fetchSource(doc.id);
                          }}
                          className="rounded p-1.5 text-slate-400 transition-colors hover:bg-slate-100 dark:bg-slate-700 dark:hover:bg-slate-700 hover:text-slate-600 dark:text-slate-400 focus-visible:ring-2 focus-visible:ring-primary-500 focus:outline-none"
                          title={source ? sourceLabel(source) : 'Ver origem'}
                          aria-label={
                            source
                              ? `Origem ${sourceLabel(source)} de ${doc.fileName}`
                              : `Ver origem de ${doc.fileName}`
                          }
                        >
                          {source ? (
                            <span className="inline-flex items-center gap-1 text-[10px] text-primary-600 dark:text-primary-300">
                              <SourceIcon source={source} className="h-3 w-3" />
                            </span>
                          ) : (
                            <Mail className="h-3.5 w-3.5" />
                          )}
                        </button>

                        {/* Open document inline */}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            openOrDownload(doc, 'open');
                          }}
                          disabled={!!activeFileAction}
                          className="rounded p-1.5 text-slate-400 transition-colors hover:bg-primary-50 hover:text-primary-600 focus-visible:ring-2 focus-visible:ring-primary-500 focus:outline-none dark:hover:bg-primary-950/30 dark:hover:text-primary-300"
                          title="Abrir documento"
                          aria-label={`Abrir documento ${doc.fileName}`}
                        >
                          {opening ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Eye className="h-3.5 w-3.5" />
                          )}
                        </button>

                        {/* Download document */}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            openOrDownload(doc, 'download');
                          }}
                          disabled={!!activeFileAction}
                          className="rounded p-1.5 text-slate-400 transition-colors hover:bg-primary-50 hover:text-primary-600 focus-visible:ring-2 focus-visible:ring-primary-500 focus:outline-none dark:hover:bg-primary-950/30 dark:hover:text-primary-300"
                          title="Baixar documento"
                          aria-label={`Baixar documento ${doc.fileName}`}
                        >
                          {downloading ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Download className="h-3.5 w-3.5" />
                          )}
                        </button>

                        {/* Drive link */}
                        {doc.driveFileId && (
                          <a
                            href={`https://drive.google.com/file/d/${doc.driveFileId}/view`}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="rounded p-1.5 text-slate-400 transition-colors hover:bg-emerald-50 hover:text-emerald-600 dark:hover:bg-emerald-950/30 dark:hover:text-emerald-300"
                            title="Abrir no Drive"
                            aria-label={`Abrir ${doc.fileName} no Drive`}
                          >
                            <ExternalLink className="h-3.5 w-3.5" />
                          </a>
                        )}

                        {/* Expand AI data */}
                        {doc.aiParsedData && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setExpandedId(expanded ? null : doc.id);
                            }}
                            className="rounded p-1.5 text-slate-400 transition-colors hover:bg-slate-100 dark:bg-slate-700 dark:hover:bg-slate-700 hover:text-slate-600 dark:text-slate-400 focus-visible:ring-2 focus-visible:ring-primary-500 focus:outline-none"
                            title="Ver dados extraídos"
                            aria-label={
                              expanded
                                ? `Ocultar dados extraidos de ${doc.fileName}`
                                : `Ver dados extraidos de ${doc.fileName}`
                            }
                          >
                            {expanded ? (
                              <ChevronDown className="h-3.5 w-3.5" />
                            ) : (
                              <ChevronRight className="h-3.5 w-3.5" />
                            )}
                          </button>
                        )}

                        {/* Reprocess is operational, not destructive: analysts can recover a failed extraction. */}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleReprocess(doc.id);
                          }}
                          disabled={!!reprocessingId || reclassifyingId !== null}
                          className="rounded p-1.5 text-slate-400 transition-colors hover:bg-primary-50 hover:text-primary-600 focus-visible:ring-2 focus-visible:ring-primary-500 focus:outline-none dark:hover:bg-primary-950/30 dark:hover:text-primary-300"
                          title="Reprocessar IA"
                          aria-label={`Reprocessar IA de ${doc.fileName}`}
                        >
                          {reprocessing ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <RefreshCw className="h-3.5 w-3.5" />
                          )}
                        </button>

                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setReclassifyingId(reclassifying ? null : doc.id);
                            setReclassificationType(doc.documentType);
                          }}
                          disabled={
                            !!reprocessingId || (reclassifyingId !== null && !reclassifying)
                          }
                          className="rounded p-1.5 text-slate-400 transition-colors hover:bg-primary-50 hover:text-primary-600 focus-visible:ring-2 focus-visible:ring-primary-500 focus:outline-none dark:hover:bg-primary-950/30 dark:hover:text-primary-300"
                          title="Corrigir classificação"
                          aria-label={`Corrigir classificação de ${doc.fileName}`}
                        >
                          {reclassifying ? (
                            <X className="h-3.5 w-3.5" />
                          ) : (
                            <Pencil className="h-3.5 w-3.5" />
                          )}
                        </button>

                        {/* Delete */}
                        {canDeleteDocuments && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setDeleteTarget(doc);
                            }}
                            className="rounded p-1.5 text-slate-400 transition-colors hover:bg-danger-50 hover:text-danger-600 dark:hover:bg-danger-950/30 dark:hover:text-danger-300"
                            title="Excluir"
                            aria-label={`Excluir documento ${doc.fileName}`}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    </div>

                    {reclassifying && (
                      <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 bg-slate-50 px-3 py-2 dark:border-slate-700 dark:bg-slate-900">
                        <label
                          htmlFor={`document-type-${doc.id}`}
                          className="text-xs font-medium text-slate-600 dark:text-slate-300"
                        >
                          Tipo correto
                        </label>
                        <select
                          id={`document-type-${doc.id}`}
                          value={reclassificationType}
                          onChange={(event) => setReclassificationType(event.target.value)}
                          className="rounded border border-slate-300 bg-white px-2 py-1 text-xs dark:border-slate-600 dark:bg-slate-800"
                        >
                          {DOCUMENT_TYPES.map((type) => (
                            <option key={type.value} value={type.value}>
                              {type.label}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          onClick={() => handleReclassify(doc)}
                          className="rounded bg-primary-600 px-2 py-1 text-xs font-medium text-white hover:bg-primary-700"
                        >
                          Salvar e reprocessar
                        </button>
                      </div>
                    )}

                    {/* Expanded AI data — professional summary */}
                    {expanded && doc.aiParsedData && (
                      <div className="border-t border-slate-100 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-900/50 px-3 py-2.5">
                        <AiExtractionSummary
                          documentType={doc.documentType}
                          data={doc.aiParsedData as Record<string, unknown>}
                          confidence={doc.aiConfidence ?? null}
                          coverage={doc.extractionCoverage}
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <ConfirmDialog
        isOpen={!!deleteTarget}
        title="Excluir Documento"
        message={`Tem certeza que deseja excluir "${deleteTarget?.fileName}"? Esta ação não pode ser desfeita.`}
        confirmLabel="Excluir"
        onConfirm={() => deleteTarget && handleDelete(deleteTarget)}
        onCancel={() => setDeleteTarget(null)}
      />
    </>
  );
}
