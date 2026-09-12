import { useApiQuery } from '@/shared/hooks/useApi';
import { ErrorState } from '@/shared/components/ErrorState';
import { LoadingSpinner } from '@/shared/components/LoadingSpinner';

export interface RegistroComparisonResult {
  status: 'match' | 'divergent' | 'pending';
  issues: string[];
  sources: Record<string, { fileName: string; type: string; driveVersion: number | null } | null>;
  rows: Array<{
    key: string;
    label: string;
    status: string;
    values: Record<
      string,
      {
        value: unknown;
        unitType?: string | null;
        fileName: string | null;
        driveVersion: number | null;
        field: string;
      }
    >;
  }>;
}

export function RegistroComparisonTable({ result }: { result: RegistroComparisonResult }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
      <h4 className="font-semibold">Rascunho DUIMP × Invoice × Espelho</h4>
      <p className="mt-1 text-xs text-slate-500">
        Quantidades devem ser iguais. FOB é conferido em centavos; diferenças de valores ou pesos,
        mesmo dentro das tolerâncias do comparativo documental, exigem revisão.
      </p>
      <p className="mt-1 text-sm" role="status">
        {result.status === 'match'
          ? 'Todos os itens e campos conferidos correspondem nas três fontes.'
          : result.status === 'divergent'
            ? 'Divergências encontradas. Revise os valores e arquivos abaixo.'
            : 'Conferência pendente: há fontes, campos ou itens que precisam de revisão.'}
      </p>
      {result.issues.length > 0 && (
        <ul className="my-3 list-disc pl-5 text-sm text-amber-800 dark:text-amber-300">
          {result.issues.map((issue, index) => (
            <li key={`${index}:${issue}`}>{issue}</li>
          ))}
        </ul>
      )}
      <div className="mt-3 overflow-x-auto">
        <table className="min-w-full text-left text-sm">
          <thead>
            <tr>
              <th className="p-2">Campo / SKU</th>
              {['duimp', 'invoice', 'espelho'].map((source) => (
                <th key={source} className="p-2 align-top">
                  {source === 'duimp'
                    ? result.sources.duimp?.type === 'duimp'
                      ? 'DUIMP final'
                      : 'Rascunho DUIMP'
                    : source === 'invoice'
                      ? 'Invoice'
                      : 'Espelho'}
                  <span className="block text-xs font-normal">
                    {result.sources[source]?.fileName ?? 'Sem arquivo associado'}
                  </span>
                </th>
              ))}
              <th className="p-2">Resultado</th>
            </tr>
          </thead>
          <tbody>
            {result.rows.map((row) => (
              <tr key={row.key} className="border-t border-slate-100 dark:border-slate-700">
                <th className="p-2 font-medium">{row.label}</th>
                {['duimp', 'invoice', 'espelho'].map((source) => {
                  const cell = row.values[source];
                  return (
                    <td className="p-2" key={source}>
                      {cell?.value == null
                        ? 'Não lido / ausente'
                        : [String(cell.value), cell.unitType].filter(Boolean).join(' ')}
                      {cell?.fileName && (
                        <span className="block text-xs text-slate-500">
                          {cell.fileName} ·{' '}
                          {cell.driveVersion == null
                            ? 'Versão não informada'
                            : `v${cell.driveVersion}`}{' '}
                          · {cell.field}
                        </span>
                      )}
                    </td>
                  );
                })}
                <td className="p-2">
                  {row.status === 'match'
                    ? 'Conforme'
                    : row.status === 'divergent'
                      ? 'Divergente'
                      : 'Pendente'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function RegistroDocumentComparison({ processId }: { processId: string }) {
  const { data, isLoading, isError, refetch } = useApiQuery<RegistroComparisonResult>(
    ['documents', 'process', processId, 'registro-comparison'],
    `/api/documents/process/${processId}/registro-comparison`,
  );
  if (isLoading) return <LoadingSpinner className="py-4" />;
  if (isError || !data)
    return (
      <ErrorState
        message="Não foi possível conferir DUIMP, invoice e espelho."
        onRetry={() => void refetch()}
      />
    );
  return <RegistroComparisonTable result={data} />;
}
