import { useState } from 'react';
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
} from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useApiQuery, useApiMutation } from '@/shared/hooks/useApi';
import { cn, formatDate } from '@/shared/lib/utils';
import { DOCUMENT_TYPES } from '@/shared/lib/constants';
import { LoadingSpinner } from '@/shared/components/LoadingSpinner';
import { ConfirmDialog } from '@/shared/components/ConfirmDialog';

interface Document {
  id: string;
  fileName: string;
  documentType: string;
  uploadedAt: string;
  aiProcessingStatus: 'pending' | 'processing' | 'completed' | 'failed';
  aiParsedData?: Record<string, unknown>;
  aiConfidence?: number;
  driveFileId?: string | null;
}

interface DocumentSource {
  source: 'email' | 'manual';
  emailSubject?: string;
}

interface DocumentListProps {
  processId: string;
}

const typeLabel = (type: string) =>
  DOCUMENT_TYPES.find((d) => d.value === type)?.label ?? type;

function ConfidenceIndicator({ value }: { value: number }) {
  const color =
    value > 0.8
      ? 'text-green-600 bg-green-100'
      : value >= 0.5
        ? 'text-yellow-600 bg-yellow-100'
        : 'text-red-600 bg-red-100';

  return (
    <span className={cn('inline-flex rounded-full px-2 py-0.5 text-xs font-medium', color)}>
      {(value * 100).toFixed(0)}%
    </span>
  );
}

function AiStatusIndicator({ status }: { status: Document['aiProcessingStatus'] }) {
  switch (status) {
    case 'processing':
    case 'pending':
      return <LoadingSpinner size="sm" />;
    case 'completed':
      return <CheckCircle className="h-4 w-4 text-green-500" />;
    case 'failed':
      return <span className="text-xs text-red-500">Erro</span>;
    default:
      return null;
  }
}

export function DocumentList({ processId }: DocumentListProps) {
  const queryClient = useQueryClient();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Document | null>(null);
  const [sources, setSources] = useState<Record<string, DocumentSource>>({});

  const { data: documents, isLoading } = useApiQuery<Document[]>(
    ['documents', processId],
    `/api/documents?processId=${processId}`,
  );

  const fetchSource = async (docId: string) => {
    if (sources[docId]) return;
    try {
      const token = localStorage.getItem('importacao_token');
      const baseUrl = import.meta.env.VITE_API_URL || '/api';
      const res = await fetch(`${baseUrl}/api/documents/${docId}/source`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (res.ok) {
        const data = await res.json();
        setSources((prev) => ({ ...prev, [docId]: data }));
      }
    } catch {
      // ignore
    }
  };

  const reprocessMutation = useApiMutation<void, void>(
    '', // overridden per call
    'post',
  );

  const deleteMutation = useApiMutation<void, void>(
    '', // overridden per call
    'delete',
    {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ['documents', processId] });
        setDeleteTarget(null);
      },
    },
  );

  const handleReprocess = (docId: string) => {
    // Use fetch directly since URL varies per document
    const token = localStorage.getItem('importacao_token');
    const baseUrl = import.meta.env.VITE_API_URL || '/api';
    fetch(`${baseUrl}/api/documents/${docId}/reprocess`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    }).then(() => {
      queryClient.invalidateQueries({ queryKey: ['documents', processId] });
    });
  };

  const handleDelete = (doc: Document) => {
    const token = localStorage.getItem('importacao_token');
    const baseUrl = import.meta.env.VITE_API_URL || '/api';
    fetch(`${baseUrl}/api/documents/${doc.id}`, {
      method: 'DELETE',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    }).then(() => {
      queryClient.invalidateQueries({ queryKey: ['documents', processId] });
      setDeleteTarget(null);
    });
  };

  if (isLoading) {
    return <LoadingSpinner className="py-8" />;
  }

  if (!documents || documents.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-gray-500">
        Nenhum documento enviado.
      </p>
    );
  }

  return (
    <>
      <div className="divide-y divide-gray-200 rounded-lg border border-gray-200">
        {documents.map((doc) => {
          const expanded = expandedId === doc.id;

          return (
            <div key={doc.id} className="bg-white">
              <div className="flex items-center gap-3 px-4 py-3">
                <FileText className="h-5 w-5 shrink-0 text-gray-400" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-gray-900">
                    {doc.fileName}
                  </p>
                  <div className="mt-0.5 flex items-center gap-2 text-xs text-gray-500">
                    <span className="inline-flex rounded bg-gray-100 px-1.5 py-0.5 text-xs font-medium text-gray-600">
                      {typeLabel(doc.documentType)}
                    </span>
                    <span>{formatDate(doc.uploadedAt)}</span>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {/* Source tag (Gap 11) */}
                  <button
                    onClick={() => fetchSource(doc.id)}
                    className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
                    title="Ver origem"
                  >
                    {sources[doc.id] ? (
                      sources[doc.id].source === 'email' ? (
                        <span className="inline-flex items-center gap-1 rounded bg-blue-50 px-1.5 py-0.5 text-xs text-blue-600">
                          <Mail className="h-3 w-3" />
                          {sources[doc.id].emailSubject
                            ? sources[doc.id].emailSubject!.slice(0, 20) + (sources[doc.id].emailSubject!.length > 20 ? '...' : '')
                            : 'Email'}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded bg-gray-50 px-1.5 py-0.5 text-xs text-gray-600">
                          <Upload className="h-3 w-3" />
                          Manual
                        </span>
                      )
                    ) : (
                      <Mail className="h-3.5 w-3.5" />
                    )}
                  </button>

                  <AiStatusIndicator status={doc.aiProcessingStatus} />

                  {doc.aiParsedData && doc.aiConfidence != null && (
                    <ConfidenceIndicator value={doc.aiConfidence} />
                  )}

                  {/* Drive link (Gap 1) */}
                  {doc.driveFileId && (
                    <a
                      href={`https://drive.google.com/file/d/${doc.driveFileId}/view`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-green-600 transition-colors"
                      title="Abrir no Drive"
                    >
                      <ExternalLink className="h-4 w-4" />
                    </a>
                  )}

                  {doc.aiParsedData && (
                    <button
                      onClick={() => setExpandedId(expanded ? null : doc.id)}
                      className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
                      title="Ver dados extraídos"
                    >
                      {expanded ? (
                        <ChevronDown className="h-4 w-4" />
                      ) : (
                        <ChevronRight className="h-4 w-4" />
                      )}
                    </button>
                  )}

                  <button
                    onClick={() => handleReprocess(doc.id)}
                    className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-blue-600 transition-colors"
                    title="Reprocessar IA"
                  >
                    <RefreshCw className="h-4 w-4" />
                  </button>

                  <button
                    onClick={() => setDeleteTarget(doc)}
                    className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-red-600 transition-colors"
                    title="Excluir"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>

              {/* Expanded AI data */}
              {expanded && doc.aiParsedData && (
                <div className="border-t border-gray-100 bg-gray-50 px-4 py-3">
                  <h4 className="mb-2 text-xs font-semibold uppercase text-gray-500">
                    Dados Extraídos pela IA
                  </h4>
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    {Object.entries(doc.aiParsedData).map(([key, val]) => (
                      <div key={key}>
                        <span className="text-gray-500">{key}: </span>
                        <span className="font-medium text-gray-900">
                          {typeof val === 'object' ? JSON.stringify(val) : String(val)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}
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
