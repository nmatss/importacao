import { EspelhoPreview } from '@/features/espelhos/EspelhoPreview';

export interface EspelhoTabProps {
  processId: string;
}

export function EspelhoTab({ processId }: EspelhoTabProps) {
  return (
    <div className="space-y-4">
      <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100">
        Espelho de Importacao
      </h3>
      <EspelhoPreview processId={processId} />
    </div>
  );
}
