import { useEffect, useId, useState } from 'react';
import { Download, ExternalLink, FileText, Loader2, X } from 'lucide-react';
import { ModalPortal } from './ModalPortal';
import { ErrorState } from './ErrorState';

interface DocumentViewerModalProps {
  documentId: number | null;
  fileName?: string | null;
  /** Fallback quando o arquivo local sumiu mas existe copia no Drive. */
  driveFileId?: string | null;
  onClose: () => void;
}

type ViewerKind = 'pdf' | 'image' | 'unsupported';

function viewerKindFor(mimeType: string): ViewerKind {
  if (mimeType === 'application/pdf') return 'pdf';
  if (mimeType.startsWith('image/')) return 'image';
  return 'unsupported';
}

/**
 * Abre o documento DENTRO do sistema.
 *
 * A rota `/api/documents/:id/file` ja responde `inline` por padrao e
 * `attachment` com `?download=1`, mas exige `Authorization` — por isso o arquivo
 * e buscado via fetch e exibido a partir de um object URL, em vez de apontar o
 * `src` direto para a rota (que iria sem o header e voltaria 401).
 */
export function DocumentViewerModal({
  documentId,
  fileName,
  driveFileId,
  onClose,
}: DocumentViewerModalProps) {
  const titleId = useId();
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [kind, setKind] = useState<ViewerKind>('unsupported');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [onClose]);

  useEffect(() => {
    if (!documentId) return;

    let revoked = false;
    let createdUrl: string | null = null;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 45_000);

    setLoading(true);
    setError(null);
    setObjectUrl(null);

    (async () => {
      try {
        const token = localStorage.getItem('importacao_token');
        const baseUrl = import.meta.env.VITE_API_URL || '';
        const response = await fetch(`${baseUrl}/api/documents/${documentId}/file`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          redirect: 'follow',
          signal: controller.signal,
        });

        // Arquivo local ausente: a rota redireciona para o visualizador do Drive,
        // que nao pode ser embutido em iframe (X-Frame-Options).
        if (response.redirected) {
          setKind('unsupported');
          setError('Arquivo local indisponível. Use "Abrir no Drive" para visualizar a cópia.');
          return;
        }
        if (!response.ok) throw new Error(`Falha ao abrir documento (${response.status})`);

        const blob = await response.blob();
        if (revoked) return;
        createdUrl = URL.createObjectURL(blob);
        setKind(viewerKindFor(blob.type));
        setObjectUrl(createdUrl);
      } catch (err) {
        if (revoked) return;
        setError(
          (err as Error)?.name === 'AbortError'
            ? 'Tempo limite ao carregar o documento.'
            : ((err as Error)?.message ?? 'Erro ao carregar o documento'),
        );
      } finally {
        window.clearTimeout(timeout);
        if (!revoked) setLoading(false);
      }
    })();

    return () => {
      revoked = true;
      controller.abort();
      window.clearTimeout(timeout);
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [documentId, reloadToken]);

  if (!documentId) return null;

  const handleDownload = async () => {
    setDownloading(true);
    try {
      const token = localStorage.getItem('importacao_token');
      const baseUrl = import.meta.env.VITE_API_URL || '';
      const response = await fetch(`${baseUrl}/api/documents/${documentId}/file?download=1`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        redirect: 'follow',
      });
      if (response.redirected && response.url) {
        window.open(response.url, '_blank', 'noopener,noreferrer');
        return;
      }
      if (!response.ok) throw new Error(`Falha ao baixar documento (${response.status})`);

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = window.document.createElement('a');
      anchor.href = url;
      anchor.download = fileName || `documento-${documentId}`;
      window.document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err) {
      setError((err as Error)?.message ?? 'Erro ao baixar o documento');
    } finally {
      setDownloading(false);
    }
  };

  return (
    <ModalPortal>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6">
        <div className="fixed inset-0 bg-sidebar-950/50 backdrop-blur-sm" onClick={onClose} />
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          className="relative z-10 flex h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-2xl dark:border-slate-700/80 dark:bg-slate-800"
        >
          <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3 dark:border-slate-700 sm:px-6">
            <div className="flex min-w-0 items-center gap-2.5">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 dark:bg-slate-700">
                <FileText className="h-4 w-4 text-slate-600 dark:text-slate-300" />
              </div>
              <h2
                id={titleId}
                className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100"
              >
                {fileName || `Documento ${documentId}`}
              </h2>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {driveFileId && (
                <a
                  href={`https://drive.google.com/file/d/${driveFileId}/view`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">Abrir no Drive</span>
                </a>
              )}
              <button
                type="button"
                onClick={handleDownload}
                disabled={downloading}
                className="inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-primary-700 disabled:opacity-50"
              >
                {downloading ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Download className="h-3.5 w-3.5" />
                )}
                Baixar
              </button>
              <button
                type="button"
                onClick={onClose}
                aria-label="Fechar visualizador"
                className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-700 dark:hover:text-slate-200"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-auto bg-slate-50 dark:bg-slate-900">
            {loading ? (
              <div className="flex h-full items-center justify-center gap-2 text-sm text-slate-500 dark:text-slate-400">
                <Loader2 className="h-5 w-5 animate-spin" />
                Carregando documento...
              </div>
            ) : error ? (
              <ErrorState message={error} onRetry={() => setReloadToken((token) => token + 1)} />
            ) : objectUrl && kind === 'pdf' ? (
              <iframe
                src={objectUrl}
                title={fileName || `Documento ${documentId}`}
                className="h-full w-full border-0"
              />
            ) : objectUrl && kind === 'image' ? (
              <div className="flex h-full items-center justify-center p-4">
                <img
                  src={objectUrl}
                  alt={fileName || `Documento ${documentId}`}
                  className="max-h-full max-w-full object-contain"
                />
              </div>
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 dark:bg-slate-700">
                  <FileText className="h-6 w-6 text-slate-400" />
                </div>
                <p className="text-sm font-medium text-slate-600 dark:text-slate-300">
                  Pré-visualização indisponível para este formato.
                </p>
                <p className="text-xs text-slate-400">
                  Use &quot;Baixar&quot; para abrir o arquivo no aplicativo do seu computador.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </ModalPortal>
  );
}
