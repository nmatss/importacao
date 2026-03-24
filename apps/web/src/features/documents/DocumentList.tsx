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
} from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useApiQuery } from '@/shared/hooks/useApi';
import { cn, formatDate } from '@/shared/lib/utils';
import { DOCUMENT_TYPES } from '@/shared/lib/constants';
import { LoadingSpinner } from '@/shared/components/LoadingSpinner';
import { ConfirmDialog } from '@/shared/components/ConfirmDialog';
import { AiExtractionSummary } from './AiExtractionSummary';

interface Document {
  id: number;
  fileName: string;
  documentType: string;
  uploadedAt: string;
  aiProcessingStatus: 'pending' | 'processing' | 'completed' | 'failed';
  aiParsedData?: Record<string, unknown>;
  aiConfidence?: number | null;
  driveFileId?: string | null;
}

interface DocumentSource {
  source: 'email' | 'manual';
  emailSubject?: string;
}

interface DocumentListProps {
  processId: string;
}

const typeLabel = (type: string) => DOCUMENT_TYPES.find((d) => d.value === type)?.label ?? type;

const TYPE_COLORS: Record<string, string> = {
  invoice: 'bg-blue-50 text-blue-700 border-blue-200',
  packing_list: 'bg-amber-50 text-amber-700 border-amber-200',
  ohbl: 'bg-purple-50 text-purple-700 border-purple-200',
  draft_bl: 'bg-violet-50 text-violet-700 border-violet-200',
  espelho: 'bg-cyan-50 text-cyan-700 border-cyan-200',
  li: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  certificate: 'bg-pink-50 text-pink-700 border-pink-200',
  other: 'bg-slate-50 text-slate-600 border-slate-200',
};

function ConfidenceBadge({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const color =
    pct >= 80
      ? 'text-green-700 bg-green-50'
      : pct >= 50
        ? 'text-yellow-700 bg-yellow-50'
        : 'text-red-700 bg-red-50';

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium',
        color,
      )}
    >
      {pct}%
    </span>
  );
}

function AiStatus({ status }: { status: Document['aiProcessingStatus'] }) {
  switch (status) {
    case 'processing':
    case 'pending':
      return (
        <span className="inline-flex items-center gap-1 text-xs text-blue-500">
          <Loader2 className="h-3 w-3 animate-spin" />
          Processando
        </span>
      );
    case 'completed':
      return (
        <span className="inline-flex items-center gap-1 text-xs text-green-600">
          <CheckCircle className="h-3 w-3" />
          Extraído
        </span>
      );
    case 'failed':
      return (
        <span className="inline-flex items-center gap-1 text-xs text-red-500">
          <AlertTriangle className="h-3 w-3" />
          Erro
        </span>
      );
    default:
      return null;
  }
}

export function DocumentList({ processId }: DocumentListProps) {
  const queryClient = useQueryClient();
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Document | null>(null);
  const [sources, setSources] = useState<Record<string, DocumentSource>>({});

  // Auto-refresh every 5s while any doc is still processing
  const { data: documents, isLoading } = useApiQuery<Document[]>(
    ['documents', processId],
    `/api/documents/process/${processId}`,
    {
      refetchInterval: (query) => {
        const docs = query.state.data;
        if (!docs) return false;
        const hasProcessing = docs.some(
          (d) => d.aiProcessingStatus === 'processing' || d.aiProcessingStatus === 'pending',
        );
        return hasProcessing ? 5000 : false;
      },
    },
  );

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

  const handleReprocess = (docId: number) => {
    const token = localStorage.getItem('importacao_token');
    const baseUrl = import.meta.env.VITE_API_URL || '';
    fetch(`${baseUrl}/api/documents/${docId}/reprocess`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then((res) => {
        if (!res.ok) throw new Error('Falha ao reprocessar documento');
        toast.success('Reprocessamento iniciado');
        queryClient.invalidateQueries({ queryKey: ['documents', processId] });
      })
      .catch((err: any) => {
        toast.error(err.message || 'Erro ao reprocessar documento');
      });
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
        queryClient.invalidateQueries({ queryKey: ['documents', processId] });
        setDeleteTarget(null);
      })
      .catch((err: any) => {
        toast.error(err.message || 'Erro ao excluir documento');
      });
  };

  if (isLoading) {
    return <LoadingSpinner className="py-8" />;
  }

  if (!documents || documents.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-10 text-slate-400">
        <FileText className="h-8 w-8" />
        <p className="text-sm">Nenhum documento enviado ainda</p>
      </div>
    );
  }

  // Group by document type
  const grouped = documents.reduce(
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
  const totalDocs = documents.length;
  const completedDocs = documents.filter((d) => d.aiProcessingStatus === 'completed').length;
  const hasAll3 = !!grouped['invoice'] && !!grouped['packing_list'] && !!grouped['ohbl'];

  return (
    <>
      {/* Summary bar */}
      <div className="flex items-center gap-3 rounded-lg bg-slate-50 px-4 py-2">
        <span className="text-xs font-medium text-slate-500">
          {totalDocs} documento{totalDocs !== 1 ? 's' : ''}
        </span>
        <span className="text-slate-300">|</span>
        <span className="text-xs text-slate-500">
          IA: {completedDocs}/{totalDocs} extraídos
        </span>
        {hasAll3 && (
          <>
            <span className="text-slate-300">|</span>
            <span className="inline-flex items-center gap-1 text-xs font-medium text-green-600">
              <CheckCircle className="h-3 w-3" />
              INV + PL + BL completos
            </span>
          </>
        )}
      </div>

      {/* Document cards */}
      <div className="space-y-2">
        {sortedGroups.map(([type, docs]) => (
          <div key={type}>
            {sortedGroups.length > 1 && (
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                {typeLabel(type)}
              </p>
            )}
            <div className="space-y-1.5">
              {docs.map((doc) => {
                const expanded = expandedId === doc.id;
                const source = sources[doc.id];

                return (
                  <div
                    key={doc.id}
                    className="group rounded-lg border border-slate-150 bg-white transition-shadow hover:shadow-sm"
                  >
                    <div className="flex items-center gap-3 px-3 py-2.5">
                      {/* Type badge */}
                      <span
                        className={cn(
                          'inline-flex shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase',
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
                                : doc.documentType === 'certificate'
                                  ? 'CERT'
                                  : (typeLabel(doc.documentType) || doc.documentType)
                                      .slice(0, 4)
                                      .toUpperCase()}
                      </span>

                      {/* File info */}
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-slate-800">
                          {doc.fileName}
                        </p>
                        <div className="mt-0.5 flex items-center gap-2">
                          <span className="text-[11px] text-slate-400">
                            {formatDate(doc.uploadedAt)}
                          </span>
                          <AiStatus status={doc.aiProcessingStatus} />
                          {doc.aiConfidence != null && <ConfidenceBadge value={doc.aiConfidence} />}
                        </div>
                      </div>

                      {/* Actions - appear on hover */}
                      <div className="flex items-center gap-1 opacity-60 transition-opacity group-hover:opacity-100">
                        {/* Source */}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            fetchSource(doc.id);
                          }}
                          className="rounded p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
                          title="Ver origem"
                        >
                          {source ? (
                            source.source === 'email' ? (
                              <span className="inline-flex items-center gap-1 text-[10px] text-blue-600">
                                <Mail className="h-3 w-3" />
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-[10px] text-slate-500">
                                <Upload className="h-3 w-3" />
                              </span>
                            )
                          ) : (
                            <Mail className="h-3.5 w-3.5" />
                          )}
                        </button>

                        {/* Drive link */}
                        {doc.driveFileId && (
                          <a
                            href={`https://drive.google.com/file/d/${doc.driveFileId}/view`}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="rounded p-1.5 text-slate-400 transition-colors hover:bg-green-50 hover:text-green-600"
                            title="Abrir no Drive"
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
                            className="rounded p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
                            title="Ver dados extraídos"
                          >
                            {expanded ? (
                              <ChevronDown className="h-3.5 w-3.5" />
                            ) : (
                              <ChevronRight className="h-3.5 w-3.5" />
                            )}
                          </button>
                        )}

                        {/* Reprocess */}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleReprocess(doc.id);
                          }}
                          className="rounded p-1.5 text-slate-400 transition-colors hover:bg-blue-50 hover:text-blue-600"
                          title="Reprocessar IA"
                        >
                          <RefreshCw className="h-3.5 w-3.5" />
                        </button>

                        {/* Delete */}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setDeleteTarget(doc);
                          }}
                          className="rounded p-1.5 text-slate-400 transition-colors hover:bg-red-50 hover:text-red-600"
                          title="Excluir"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>

                    {/* Expanded AI data — professional summary */}
                    {expanded && doc.aiParsedData && (
                      <div className="border-t border-slate-100 bg-slate-50/50 px-3 py-2.5">
                        <AiExtractionSummary
                          documentType={doc.documentType}
                          data={doc.aiParsedData as Record<string, unknown>}
                          confidence={doc.aiConfidence ?? null}
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
