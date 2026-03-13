import { ValidationChecklist } from '@/features/validation/ValidationChecklist';
import { FupComparisonPanel } from '@/features/validation/FupComparisonPanel';

export interface ValidationTabProps {
  processId: string;
}

export function ValidationTab({ processId }: ValidationTabProps) {
  return (
    <div className="space-y-4">
      <h3 className="text-lg font-bold text-slate-800">
        Checklist de Validacao
      </h3>
      <ValidationChecklist processId={processId} />

      <div className="border-t border-slate-200/80 pt-6 mt-6">
        <h3 className="text-lg font-bold text-slate-800 mb-4">
          Comparativo Sistema vs Follow-Up
        </h3>
        <FupComparisonPanel processId={processId} />
      </div>
    </div>
  );
}
