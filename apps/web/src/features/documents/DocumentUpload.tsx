import { useState, useRef, useCallback } from 'react';
import { Upload, CheckCircle, FileText, Loader2, AlertCircle } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { cn } from '@/shared/lib/utils';

interface DocumentUploadProps {
  processId: string;
}

const FILE_TYPES = [
  { value: 'invoice', label: 'Invoice', keywords: ['invoice', 'inv', 'fatura', 'commercial'] },
  { value: 'packing_list', label: 'Packing List', keywords: ['packing', 'pl', 'pack'] },
  { value: 'ohbl', label: 'BL', keywords: ['bl', 'bill', 'lading', 'conhecimento', 'ohbl'] },
  { value: 'draft_bl', label: 'Draft BL', keywords: ['draft bl', 'draft_bl', 'rascunho bl'] },
  { value: 'espelho', label: 'Espelho', keywords: ['espelho', 'mirror'] },
  { value: 'li', label: 'LI', keywords: ['li', 'licen'] },
  { value: 'certificate', label: 'Certificado', keywords: ['cert', 'certificado', 'certificate'] },
  { value: 'other', label: 'Outro', keywords: [] },
] as const;

const ACCEPT =
  '.pdf,.xlsx,.xls,.doc,.docx,.jpg,.jpeg,.png,.gif,.webp,.tif,.tiff,.bmp,.csv,.txt,.html,.htm,.eml';

function detectDocType(filename: string): string {
  const lower = filename.toLowerCase();
  for (const ft of FILE_TYPES) {
    if (ft.keywords.some((kw) => lower.includes(kw))) return ft.value;
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
  const [docType, setDocType] = useState<string>('invoice');
  const [dragOver, setDragOver] = useState(false);
  const [state, setState] = useState<UploadState>('idle');
  const [progress, setProgress] = useState(0);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);

  const upload = useCallback(
    async (file: File) => {
      setState('uploading');
      setProgress(0);
      setError(null);
      setSelectedFile(file);

      const formData = new FormData();
      formData.append('file', file);
      formData.append('documentType', docType);
      formData.append('processId', processId);

      try {
        const token = localStorage.getItem('importacao_token');
        const baseUrl = import.meta.env.VITE_API_URL || '';

        const xhr = new XMLHttpRequest();
        xhr.open('POST', `${baseUrl}/api/documents/upload`);
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
              queryClient.invalidateQueries({ queryKey: ['documents', processId] });
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
          xhr.send(formData);
        });
      } catch (err) {
        setState('error');
        setError(err instanceof Error ? err.message : 'Erro no upload');
      }
    },
    [docType, processId, queryClient],
  );

  const handleFiles = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const file = files[0];
    // Auto-detect doc type from filename
    const detected = detectDocType(file.name);
    if (detected !== 'other') {
      setDocType(detected);
    }
    upload(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
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
            onClick={() => setDocType(ft.value)}
            className={cn(
              'rounded-full px-3 py-1 text-xs font-medium transition-all',
              docType === ft.value
                ? 'bg-blue-600 text-white shadow-sm'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200',
            )}
          >
            {ft.label}
          </button>
        ))}
      </div>

      {/* Drop zone */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => {
          if (state === 'error') reset();
          if (state !== 'uploading') fileInputRef.current?.click();
        }}
        className={cn(
          'relative cursor-pointer rounded-xl border-2 border-dashed transition-all duration-200',
          dragOver && 'border-blue-400 bg-blue-50 scale-[1.01]',
          state === 'idle' &&
            !dragOver &&
            'border-slate-200 hover:border-blue-300 hover:bg-slate-50',
          state === 'uploading' && 'border-blue-300 bg-blue-50/50 cursor-wait',
          state === 'success' && 'border-green-300 bg-green-50',
          state === 'error' && 'border-red-300 bg-red-50',
        )}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPT}
          onChange={(e) => handleFiles(e.target.files)}
          className="hidden"
        />

        <div className="flex items-center gap-4 px-5 py-4">
          {/* Icon */}
          <div
            className={cn(
              'flex h-12 w-12 shrink-0 items-center justify-center rounded-lg',
              state === 'idle' && 'bg-slate-100',
              state === 'uploading' && 'bg-blue-100',
              state === 'success' && 'bg-green-100',
              state === 'error' && 'bg-red-100',
            )}
          >
            {state === 'idle' && <Upload className="h-5 w-5 text-slate-400" />}
            {state === 'uploading' && <Loader2 className="h-5 w-5 text-blue-500 animate-spin" />}
            {state === 'success' && <CheckCircle className="h-5 w-5 text-green-500" />}
            {state === 'error' && <AlertCircle className="h-5 w-5 text-red-500" />}
          </div>

          {/* Content */}
          <div className="min-w-0 flex-1">
            {state === 'idle' && (
              <>
                <p className="text-sm font-medium text-slate-700">Arraste ou clique para enviar</p>
                <p className="text-xs text-slate-400">
                  PDF, Excel, Word, Imagens, CSV, HTML, EML — máx. 50MB
                </p>
              </>
            )}

            {state === 'uploading' && selectedFile && (
              <>
                <div className="flex items-center gap-2">
                  <FileText className="h-3.5 w-3.5 text-blue-500" />
                  <p className="truncate text-sm font-medium text-slate-700">{selectedFile.name}</p>
                  <span className="text-xs text-slate-400">
                    {formatFileSize(selectedFile.size)}
                  </span>
                </div>
                <div className="mt-1.5 flex items-center gap-2">
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-blue-100">
                    <div
                      className="h-full rounded-full bg-blue-500 transition-all duration-300"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                  <span className="text-xs font-medium text-blue-600">{progress}%</span>
                </div>
              </>
            )}

            {state === 'success' && selectedFile && (
              <>
                <p className="text-sm font-medium text-green-700">
                  {selectedFile.name} enviado com sucesso
                </p>
                <p className="text-xs text-green-500">IA processando em background...</p>
              </>
            )}

            {state === 'error' && (
              <>
                <p className="text-sm font-medium text-red-700">{error || 'Erro no upload'}</p>
                <p className="text-xs text-red-400">Clique para tentar novamente</p>
              </>
            )}
          </div>

          {/* Selected type badge */}
          <span className="shrink-0 rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-500">
            {FILE_TYPES.find((ft) => ft.value === docType)?.label}
          </span>
        </div>
      </div>
    </div>
  );
}
