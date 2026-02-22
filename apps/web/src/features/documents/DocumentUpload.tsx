import { useState, useRef, useCallback } from 'react';
import { Upload, File, CheckCircle } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { cn } from '@/shared/lib/utils';

interface DocumentUploadProps {
  processId: string;
}

const FILE_TYPES = [
  { value: 'invoice', label: 'Invoice' },
  { value: 'packing_list', label: 'Packing List' },
  { value: 'ohbl', label: 'BL' },
] as const;

const ACCEPT = '.pdf,.xlsx,.xls';

export function DocumentUpload({ processId }: DocumentUploadProps) {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [docType, setDocType] = useState<string>('invoice');
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [uploadedFile, setUploadedFile] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const upload = useCallback(
    async (file: File) => {
      setUploading(true);
      setProgress(0);
      setError(null);
      setUploadedFile(null);

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
              setUploadedFile(file.name);
              queryClient.invalidateQueries({ queryKey: ['documents', processId] });
              resolve();
            } else {
              reject(new Error('Falha no upload'));
            }
          };
          xhr.onerror = () => reject(new Error('Erro de rede'));
          xhr.send(formData);
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Erro no upload');
      } finally {
        setUploading(false);
      }
    },
    [docType, processId, queryClient],
  );

  const handleFiles = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    upload(files[0]);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    handleFiles(e.dataTransfer.files);
  };

  return (
    <div className="space-y-4">
      {/* File type selection */}
      <div className="flex gap-3">
        {FILE_TYPES.map((ft) => (
          <label
            key={ft.value}
            className={cn(
              'flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors',
              docType === ft.value
                ? 'border-blue-500 bg-blue-50 text-blue-700'
                : 'border-gray-300 text-gray-700 hover:bg-gray-50',
            )}
          >
            <input
              type="radio"
              name="docType"
              value={ft.value}
              checked={docType === ft.value}
              onChange={(e) => setDocType(e.target.value)}
              className="sr-only"
            />
            {ft.label}
          </label>
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
        onClick={() => fileInputRef.current?.click()}
        className={cn(
          'cursor-pointer rounded-lg border-2 border-dashed p-8 text-center transition-colors',
          dragOver
            ? 'border-blue-500 bg-blue-50'
            : 'border-gray-300 hover:border-gray-400',
        )}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPT}
          onChange={(e) => handleFiles(e.target.files)}
          className="hidden"
        />

        {uploading ? (
          <div className="space-y-2">
            <p className="text-sm text-gray-600">Enviando...</p>
            <div className="mx-auto h-2 w-48 overflow-hidden rounded-full bg-gray-200">
              <div
                className="h-full rounded-full bg-blue-600 transition-all"
                style={{ width: `${progress}%` }}
              />
            </div>
            <p className="text-xs text-gray-500">{progress}%</p>
          </div>
        ) : uploadedFile ? (
          <div className="flex flex-col items-center gap-2">
            <CheckCircle className="h-8 w-8 text-green-500" />
            <p className="text-sm font-medium text-green-700">{uploadedFile}</p>
            <p className="text-xs text-gray-500">
              Clique para enviar outro arquivo
            </p>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2">
            <Upload className="h-8 w-8 text-gray-400" />
            <p className="text-sm text-gray-600">
              Arraste um arquivo ou clique para selecionar
            </p>
            <p className="text-xs text-gray-400">PDF, XLSX, XLS</p>
          </div>
        )}
      </div>

      {error && (
        <p className="text-sm text-red-600">{error}</p>
      )}
    </div>
  );
}
