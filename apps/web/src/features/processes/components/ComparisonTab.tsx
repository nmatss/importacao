import { DocumentComparison } from '@/features/documents/DocumentComparison';
import { ValidationChecklist } from '@/features/validation/ValidationChecklist';
import { FupComparisonPanel } from '@/features/validation/FupComparisonPanel';

export interface ComparisonTabProps {
  processId: string;
}

export function ComparisonTab({ processId }: ComparisonTabProps) {
  return (
    <div className="space-y-8">
      <div>
        <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100">
          Comparativo de Documentos
        </h3>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Validacao, cruzamento e aceite operacional de divergencias em uma unica tela.
        </p>
      </div>

      <section className="space-y-3">
        <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
          Validacao e e-mail de correcao
        </h4>
        <ValidationChecklist processId={processId} />
      </section>

      <section className="space-y-3">
        <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
          Cruzamento entre documentos
        </h4>
        <FupComparisonPanel processId={processId} />
      </section>

      <DocumentComparison processId={processId} />
    </div>
  );
}
