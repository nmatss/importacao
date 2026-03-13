import { DocumentComparison } from '@/features/documents/DocumentComparison';

export interface ComparisonTabProps {
  processId: string;
}

export function ComparisonTab({ processId }: ComparisonTabProps) {
  return (
    <div className="space-y-4">
      <h3 className="text-lg font-bold text-slate-800">
        Comparativo de Documentos
      </h3>
      <p className="text-sm text-slate-500">
        Visualizacao lado a lado dos dados extraidos de Invoice, Packing List e BL.
      </p>
      <DocumentComparison processId={processId} />
    </div>
  );
}
