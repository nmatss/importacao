import { useCallback, useState } from 'react';
import { toast } from 'sonner';
import { MailWarning, RefreshCw } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '@/shared/lib/api-client';
import { getErrorMessage } from '@/shared/utils/errors';
import { cn } from '@/shared/lib/utils';
import { DocumentComparison } from '@/features/documents/DocumentComparison';

export interface ComparisonTabProps {
  processId: string;
}

export function ComparisonTab({ processId }: ComparisonTabProps) {
  const queryClient = useQueryClient();
  const [running, setRunning] = useState(false);
  const [generatingDraft, setGeneratingDraft] = useState(false);

  const invalidateValidationContext = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['validation', processId] }),
      queryClient.invalidateQueries({ queryKey: ['validation-report', processId] }),
      queryClient.invalidateQueries({ queryKey: ['doc-comparison', processId] }),
      queryClient.invalidateQueries({ queryKey: ['process-events', processId] }),
      queryClient.invalidateQueries({ queryKey: ['process', processId] }),
      queryClient.invalidateQueries({ queryKey: ['communications', processId] }),
      queryClient.invalidateQueries({ queryKey: ['communications'] }),
    ]);
  }, [processId, queryClient]);

  const runValidation = useCallback(async () => {
    setRunning(true);
    try {
      await api.post(`/api/validation/${processId}/run`);
      await invalidateValidationContext();
      toast.success('Validação executada com sucesso.');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err));
    } finally {
      setRunning(false);
    }
  }, [invalidateValidationContext, processId]);

  // O rascunho é criado no backend e editado/enviado na aba Atendimentos,
  // onde vive o editor completo (destinatário, anexos, modelos).
  const generateCorrectionDraft = useCallback(async () => {
    setGeneratingDraft(true);
    try {
      await api.post(`/api/validation/${processId}/correction-draft`, { useAi: false });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['communications', processId] }),
        queryClient.invalidateQueries({ queryKey: ['communications'] }),
      ]);
      toast.success('Rascunho de correção criado — revise e envie na aba Atendimentos.');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err));
    } finally {
      setGeneratingDraft(false);
    }
  }, [processId, queryClient]);

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100">
            Comparativo de documentos
          </h3>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Validação, cruzamento e aceite operacional de divergências em uma única tela.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={runValidation}
            disabled={running}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50 transition-colors"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', running && 'animate-spin')} />
            {running ? 'Validando…' : 'Revalidar'}
          </button>
          <button
            type="button"
            onClick={generateCorrectionDraft}
            disabled={generatingDraft}
            className="inline-flex items-center gap-1.5 rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/30 px-3 py-1.5 text-xs font-medium text-amber-700 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/50 disabled:opacity-50 transition-colors"
          >
            <MailWarning className="h-3.5 w-3.5" />
            {generatingDraft ? 'Gerando…' : 'Gerar e-mail de correção'}
          </button>
        </div>
      </div>

      <DocumentComparison processId={processId} />
    </div>
  );
}
