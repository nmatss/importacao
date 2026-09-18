import { useState } from 'react';
import { useApiQuery } from '@/shared/hooks/useApi';

type SourceKey = 'invoiceId' | 'packingListId' | 'blId' | 'espelhoId' | 'duimpId';
const sources: Record<SourceKey, { label: string; types: string[] }> = {
  invoiceId: { label: 'Invoice', types: ['invoice'] },
  packingListId: { label: 'Packing list', types: ['packing_list'] },
  blId: { label: 'BL', types: ['ohbl', 'draft_bl'] },
  espelhoId: { label: 'Espelho', types: ['espelho'] },
  duimpId: { label: 'DUIMP', types: ['draft_duimp', 'duimp'] },
};
interface SourceDocument {
  id: number;
  fileName: string;
  documentType: string;
}

export function useSourceDocumentPicker(processId: string, keys: SourceKey[]) {
  const [state, setState] = useState<{
    processId: string;
    values: Partial<Record<SourceKey, string>>;
  }>({ processId, values: {} });
  const values = state.processId === processId ? state.values : {};
  const { data, isError, refetch } = useApiQuery<SourceDocument[]>(
    ['documents', processId],
    `/api/documents/process/${processId}`,
  );
  const params = new URLSearchParams(Object.entries(values).filter(([, value]) => !!value));
  const query = params.toString();
  const picker = (
    <fieldset className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
      <legend className="px-1 text-sm font-medium">Arquivos para conferência</legend>
      <p className="mb-2 text-sm text-slate-600 dark:text-slate-300">
        Escolha um arquivo para conferir uma versão específica. A seleção é apenas para consulta;
        não altera documentos nem registra aceites.
      </p>
      {isError ? (
        <p role="alert">
          Não foi possível listar os arquivos.{' '}
          <button type="button" onClick={() => void refetch()} className="underline">
            Tentar novamente
          </button>
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {keys.map((key) => (
            <label key={key} className="min-w-0 text-sm">
              {sources[key].label}
              <select
                className="mt-1 w-full min-w-0 rounded border border-slate-300 bg-white p-2 text-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                value={values[key] ?? ''}
                onChange={(event) =>
                  setState({ processId, values: { ...values, [key]: event.target.value } })
                }
              >
                <option value="">Seleção automática</option>
                {(Array.isArray(data) ? data : [])
                  .filter((doc) => sources[key].types.includes(doc.documentType))
                  .map((doc) => (
                    <option key={doc.id} value={doc.id}>
                      {doc.fileName} · #{doc.id}
                    </option>
                  ))}
              </select>
            </label>
          ))}
        </div>
      )}
      {!!query && (
        <button
          type="button"
          className="mt-2 text-sm underline"
          onClick={() => setState({ processId, values: {} })}
        >
          Voltar às fontes automáticas
        </button>
      )}
    </fieldset>
  );
  return { picker, query, isCustom: !!query };
}
