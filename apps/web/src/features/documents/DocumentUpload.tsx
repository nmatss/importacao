import { useState, useRef, useCallback, useId } from 'react';
import { Upload, CheckCircle, FileText, Loader2, AlertCircle } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { cn } from '@/shared/lib/utils';
import { invalidateDocumentWorkflow } from './queryInvalidation';

interface DocumentUploadProps {
  processId: string;
}

const FILE_TYPES = [
  { value: 'proforma_invoice', label: 'Proforma', keywords: ['proforma', 'pro forma'] },
  { value: 'invoice', label: 'Invoice', keywords: ['invoice', 'inv', 'fatura', 'commercial'] },
  { value: 'packing_list', label: 'Packing List', keywords: ['packing', 'pl', 'pack'] },
  {
    value: 'draft_bl',
    label: 'Draft BL',
    keywords: ['draft bl', 'draft_bl', 'draft-bl', 'draftbl', 'draft bill', 'rascunho bl'],
  },
  {
    value: 'draft_duimp',
    label: 'Draft DUIMP',
    keywords: ['draft duimp', 'draft_duimp', 'rascunho duimp', 'minuta duimp'],
  },
  { value: 'duimp', label: 'DUIMP', keywords: ['duimp'] },
  {
    value: 'ohbl',
    label: 'BL',
    keywords: ['ohbl', 'original bl', 'bill', 'lading', 'conhecimento', 'bl'],
  },
  { value: 'espelho', label: 'Espelho', keywords: ['espelho', 'mirror'] },
  { value: 'li', label: 'LI', keywords: ['li', 'licen'] },
  { value: 'certificate', label: 'Certificado', keywords: ['cert', 'certificado', 'certificate'] },
  { value: 'other', label: 'Outro', keywords: [] },
] as const;

const ACCEPT =
  '.pdf,.xlsx,.xls,.doc,.docx,.jpg,.jpeg,.png,.gif,.webp,.tif,.tiff,.bmp,.csv,.txt,.eml,.msg';
const MAX_FILE_SIZE = 50 * 1024 * 1024;
const UPLOAD_TIMEOUT_MS = 45_000;
const ALLOWED_EXTENSIONS = ACCEPT.split(',');

function normalizeFilenameForDetection(filename: string): string {
  return ` ${filename
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[_\-.]+/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()} `;
}

export function detectDocType(filename: string): string {
  const normalizedName = normalizeFilenameForDetection(filename);
  for (const ft of FILE_TYPES) {
    if (ft.keywords.some((kw) => normalizedName.includes(normalizeFilenameForDetection(kw)))) {
      return ft.value;
    }
  }
  return 'other';
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

type UploadState = 'idle' | 'uploading' | 'success' | 'error';

export function DocumentUpload({ processId }: DocumentUploadProps) {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const inputId = useId();
  const [docType, setDocType] = useState<string>('invoice');
  const [dragOver, setDragOver] = useState(false);
  const [typeTouched, setTypeTouched] = useState(false);
  const [state, setState] = useState<UploadState>('idle');
  const [progress, setProgress] = useState(0);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);

  const upload = useCallback(
    async (file: File, overrideDocType?: string) => {
      setState('uploading');
      setProgress(0);
      setError(null);
      setSelectedFile(file);

      const formData = new FormData();
      formData.append('file', file);
      formData.append('documentType', overrideDocType || docType);
      formData.append('processId', processId);

      try {
        const token = localStorage.getItem('importacao_token');
        const baseUrl = import.meta.env.VITE_API_URL || '';

        const xhr = new XMLHttpRequest();
        xhr.open('POST', `${baseUrl}/api/documents/upload`);
        xhr.timeout = UPLOAD_TIMEOUT_MS;
        if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);

        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) {
            setProgress(Math.round((e.loaded / e.total) * 100));
          }
        };

        await new Promise<void>((resolve, reject) => {
          xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
              setState('success');
              if (fileInputRef.current) fileInputRef.current.value = '';
              void invalidateDocumentWorkflow(queryClient, processId);
              // Auto-reset after 3s
              setTimeout(() => {
                setState('idle');
                setSelectedFile(null);
              }, 3000);
              resolve();
            } else {
              let msg = 'Falha no upload';
              try {
                const resp = JSON.parse(xhr.responseText);
                msg = resp.error || resp.message || msg;
              } catch {
                /* ignore */
              }
              reject(new Error(msg));
            }
          };
          xhr.onerror = () => reject(new Error('Erro de rede'));
          xhr.ontimeout = () =>
            reject(new Error('Tempo limite no upload. Verifique a conexão e tente novamente.'));
          xhr.onabort = () => reject(new Error('Upload cancelado.'));
          xhr.send(formData);
        });
      } catch (err) {
        setState('error');
        setError(err instanceof Error ? err.message : 'Erro no upload');
      }
    },
    [docType, processId, queryClient],
  );

  const validateFile = (file: File): string | null => {
    if (file.size > MAX_FILE_SIZE) {
      return `Arquivo acima do limite de ${formatFileSize(MAX_FILE_SIZE)}.`;
    }
    const lowerName = file.name.toLowerCase();
    const hasAllowedExtension = ALLOWED_EXTENSIONS.some((ext) => lowerName.endsWith(ext));
    if (!hasAllowedExtension) {
      return 'Tipo de arquivo nao permitido para upload.';
    }
    return null;
  };

  const handleFiles = (files: FileList | null) => {
    if (state === 'uploading') return;
    if (!files || files.length === 0) return;
    const file = files[0];
    const validationError = validateFile(file);
    if (validationError) {
      setSelectedFile(file);
      setError(validationError);
      setState('error');
      return;
    }
    // Auto-detect doc type from filename
    const detected = detectDocType(file.name);
    const effectiveDocType = !typeTouched && detected !== 'other' ? detected : docType;
    if (!typeTouched && detected !== 'other') {
      setDocType(detected);
    }
    upload(file, effectiveDocType);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (state === 'uploading') return;
    setDragOver(false);
    handleFiles(e.dataTransfer.files);
  };

  const reset = () => {
    setState('idle');
    setError(null);
    setSelectedFile(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  return (
    <div className="space-y-3">
      {/* Compact type selector - pills */}
      <div className="flex flex-wrap gap-1.5">
        {FILE_TYPES.map((ft) => (
          <button
            key={ft.value}
            type="button"
            onClick={() => {
              setDocType(ft.value);
              setTypeTouched(true);
            }}
            aria-pressed={docType === ft.value}
            disabled={state === 'uploading'}
            className={cn(
              'rounded-full px-3 py-1 text-xs font-medium transition-all',
              docType === ft.value
                ? 'bg-primary-600 text-white shadow-sm'
                : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-200',
            )}
          >
            {ft.label}
          </button>
        ))}
      </div>

      {/* Drop zone */}
      <input
        id={inputId}
        ref={fileInputRef}
        type="file"
        accept={ACCEPT}
        onChange={(e) => handleFiles(e.target.files)}
        className="sr-only"
        aria-label="Selecionar documento para upload"
        tabIndex={-1}
      />
      <button
        type="button"
        onDragOver={(e) => {
          e.preventDefault();
          if (state === 'uploading') return;
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={(e) => {
          if (state === 'uploading') {
            e.preventDefault();
            return;
          }
          if (state === 'error') reset();
          fileInputRef.current?.click();
        }}
        aria-describedby={`${inputId}-description ${inputId}-status`}
        aria-busy={state === 'uploading'}
        aria-disabled={state === 'uploading'}
        className={cn(
          'relative w-full rounded-xl border-2 border-dashed text-left transition-all duration-200',
          dragOver && 'border-primary-400 bg-primary-50 scale-[1.01]',
          state === 'idle' &&
            !dragOver &&
            'cursor-pointer border-slate-200 dark:border-slate-600 hover:border-primary-300 hover:bg-slate-50 dark:hover:bg-slate-800 dark:bg-slate-900',
          state === 'uploading' && 'border-primary-300 bg-primary-50/50 cursor-wait',
          state === 'success' && 'border-emerald-300 bg-emerald-50',
          state === 'error' && 'border-danger-300 bg-danger-50',
        )}
      >
        <div className="flex items-center gap-4 px-5 py-4">
          {/* Icon */}
          <div
            className={cn(
              'flex h-12 w-12 shrink-0 items-center justify-center rounded-lg',
              state === 'idle' && 'bg-slate-100 dark:bg-slate-700',
              state === 'uploading' && 'bg-primary-100',
              state === 'success' && 'bg-emerald-100',
              state === 'error' && 'bg-danger-100',
            )}
          >
            {state === 'idle' && <Upload className="h-5 w-5 text-slate-400" />}
            {state === 'uploading' && <Loader2 className="h-5 w-5 text-primary-500 animate-spin" />}
            {state === 'success' && <CheckCircle className="h-5 w-5 text-emerald-500" />}
            {state === 'error' && <AlertCircle className="h-5 w-5 text-danger-500" />}
          </div>

          {/* Content */}
          <div className="min-w-0 flex-1">
            {state === 'idle' && (
              <>
                <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
                  Arraste ou clique para enviar
                </p>
                <p id={`${inputId}-description`} className="text-xs text-slate-400">
                  PDF, Excel, Word, imagens, CSV, TXT, EML/MSG - max. 50MB
                </p>
              </>
            )}

            {state === 'uploading' && selectedFile && (
              <div id={`${inputId}-status`} role="status" aria-live="polite">
                <div className="flex items-center gap-2">
                  <FileText className="h-3.5 w-3.5 text-primary-500" />
                  <p className="truncate text-sm font-medium text-slate-700 dark:text-slate-300">
                    {selectedFile.name}
                  </p>
                  <span className="text-xs text-slate-400">
                    {formatFileSize(selectedFile.size)}
                  </span>
                </div>
                <div className="mt-1.5 flex items-center gap-2">
                  <div
                    className="h-1.5 flex-1 overflow-hidden rounded-full bg-primary-100"
                    role="progressbar"
                    aria-label="Progresso do upload"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={progress}
                  >
                    <div
                      className="h-full rounded-full bg-primary-500 transition-all duration-300"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                  <span className="text-xs font-medium text-primary-600">{progress}%</span>
                </div>
              </div>
            )}

            {state === 'success' && selectedFile && (
              <div id={`${inputId}-status`} role="status" aria-live="polite">
                <p className="text-sm font-medium text-emerald-700">
                  {selectedFile.name} enviado com sucesso
                </p>
                <p className="text-xs text-emerald-500">IA processando em background...</p>
              </div>
            )}

            {state === 'error' && (
              <div id={`${inputId}-status`} role="alert">
                <p className="text-sm font-medium text-danger-700">{error || 'Erro no upload'}</p>
                <p className="text-xs text-danger-400">Clique para tentar novamente</p>
              </div>
            )}
          </div>

          {/* Selected type badge */}
          <span className="shrink-0 rounded-full bg-slate-100 dark:bg-slate-700 px-2.5 py-0.5 text-xs font-medium text-slate-500 dark:text-slate-400">
            {FILE_TYPES.find((ft) => ft.value === docType)?.label}
          </span>
        </div>
      </button>
    </div>
  );
}
