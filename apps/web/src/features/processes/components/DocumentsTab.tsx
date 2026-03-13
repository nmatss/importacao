import { DocumentUpload } from '@/features/documents/DocumentUpload';
import { DocumentList } from '@/features/documents/DocumentList';

export interface DocumentsTabProps {
  processId: string;
}

export function DocumentsTab({ processId }: DocumentsTabProps) {
  return (
    <div className="space-y-6">
      <h3 className="text-lg font-bold text-slate-800">
        Upload de Documentos
      </h3>
      <DocumentUpload processId={processId} />
      <div className="border-t border-slate-100" />
      <h3 className="text-lg font-bold text-slate-800">
        Documentos do Processo
      </h3>
      <DocumentList processId={processId} />
    </div>
  );
}
