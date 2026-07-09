import { DocumentComparison } from '@/features/documents/DocumentComparison';

export interface ComparisonTabProps {
  processId: string;
}

export function ComparisonTab({ processId }: ComparisonTabProps) {
  return (
    <div className="space-y-8">
      <div>
        <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100">
          Comparativo de documentos
        </h3>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Validação, cruzamento e aceite operacional de divergências em uma única tela.
        </p>
      </div>

      <DocumentComparison processId={processId} />
    </div>
  );
}
