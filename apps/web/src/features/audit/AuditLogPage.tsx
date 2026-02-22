import { useState } from 'react';
import { Shield, ChevronDown, ChevronRight, ChevronLeft } from 'lucide-react';
import { useApiQuery } from '@/shared/hooks/useApi';
import { LoadingSpinner } from '@/shared/components/LoadingSpinner';
import { EmptyState } from '@/shared/components/EmptyState';
import { cn } from '@/shared/lib/utils';

interface AuditLog {
  id: number;
  userId: number | null;
  userName: string | null;
  action: string;
  entityType: string | null;
  entityId: number | null;
  details: Record<string, unknown> | null;
  ipAddress: string | null;
  createdAt: string;
}

interface ApiResponse {
  data: AuditLog[];
  pagination: {
    total: number;
    page: number;
    limit: number;
    pages: number;
  };
}

const actionLabels: Record<string, string> = {
  login: 'Login',
  create: 'Criar',
  update: 'Atualizar',
  delete: 'Excluir',
  upload: 'Upload',
  reprocess: 'Reprocessar',
  email_processed: 'Email Processado',
  validation_run: 'Validacao',
  manual_resolution: 'Resolucao Manual',
  alert_created: 'Alerta Criado',
  acknowledge: 'Reconhecimento',
  generate: 'Gerar',
  sent_to_fenicia: 'Envio Fenicia',
};

const actionColors: Record<string, string> = {
  login: 'bg-blue-100 text-blue-700',
  create: 'bg-green-100 text-green-700',
  update: 'bg-yellow-100 text-yellow-700',
  delete: 'bg-red-100 text-red-700',
  upload: 'bg-indigo-100 text-indigo-700',
  reprocess: 'bg-purple-100 text-purple-700',
  email_processed: 'bg-teal-100 text-teal-700',
  validation_run: 'bg-orange-100 text-orange-700',
  manual_resolution: 'bg-amber-100 text-amber-700',
  alert_created: 'bg-red-100 text-red-700',
  acknowledge: 'bg-emerald-100 text-emerald-700',
  generate: 'bg-violet-100 text-violet-700',
  sent_to_fenicia: 'bg-cyan-100 text-cyan-700',
};

const entityTypeLabels: Record<string, string> = {
  process: 'Processo',
  document: 'Documento',
  espelho: 'Espelho',
  alert: 'Alerta',
  user: 'Usuario',
  email: 'Email',
  validation: 'Validacao',
};

function formatDateTime(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function DetailsExpander({ details }: { details: Record<string, unknown> | null }) {
  const [open, setOpen] = useState(false);

  if (!details || Object.keys(details).length === 0) {
    return <span className="text-gray-400 text-xs">-</span>;
  }

  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800"
      >
        {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        {open ? 'Ocultar' : 'Detalhes'}
      </button>
      {open && (
        <pre className="mt-1 rounded bg-gray-100 p-2 text-xs text-gray-700 max-w-md overflow-auto">
          {JSON.stringify(details, null, 2)}
        </pre>
      )}
    </div>
  );
}

export function AuditLogPage() {
  const [page, setPage] = useState(1);
  const [action, setAction] = useState('');
  const [entityType, setEntityType] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const limit = 20;

  const params = new URLSearchParams();
  params.set('page', String(page));
  params.set('limit', String(limit));
  if (action) params.set('action', action);
  if (entityType) params.set('entityType', entityType);
  if (startDate) params.set('startDate', startDate);
  if (endDate) params.set('endDate', endDate);

  const { data: response, isLoading } = useApiQuery<ApiResponse>(
    ['audit-logs', String(page), action, entityType, startDate, endDate],
    `/api/audit/logs?${params.toString()}`,
  );

  const logs = response?.data ?? [];
  const pagination = response?.pagination;

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-gray-900">Auditoria</h2>

      {/* Filters */}
      <div className="flex flex-wrap items-end gap-4 rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Acao</label>
          <select
            value={action}
            onChange={(e) => { setAction(e.target.value); setPage(1); }}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
          >
            <option value="">Todas</option>
            {Object.entries(actionLabels).map(([key, label]) => (
              <option key={key} value={key}>{label}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Tipo</label>
          <select
            value={entityType}
            onChange={(e) => { setEntityType(e.target.value); setPage(1); }}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
          >
            <option value="">Todos</option>
            {Object.entries(entityTypeLabels).map(([key, label]) => (
              <option key={key} value={key}>{label}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Data Inicio</label>
          <input
            type="date"
            value={startDate}
            onChange={(e) => { setStartDate(e.target.value); setPage(1); }}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Data Fim</label>
          <input
            type="date"
            value={endDate}
            onChange={(e) => { setEndDate(e.target.value); setPage(1); }}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
          />
        </div>

        {(action || entityType || startDate || endDate) && (
          <button
            onClick={() => { setAction(''); setEntityType(''); setStartDate(''); setEndDate(''); setPage(1); }}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-600 hover:bg-gray-50"
          >
            Limpar Filtros
          </button>
        )}
      </div>

      {/* Table */}
      <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
        <div className="border-b border-gray-200 px-5 py-4">
          <h3 className="flex items-center gap-2 text-lg font-semibold text-gray-900">
            <Shield className="h-5 w-5 text-gray-500" />
            Logs de Auditoria
            {pagination && (
              <span className="text-sm font-normal text-gray-500">
                ({pagination.total} registro{pagination.total !== 1 ? 's' : ''})
              </span>
            )}
          </h3>
        </div>

        {isLoading ? (
          <LoadingSpinner className="py-12" />
        ) : logs.length === 0 ? (
          <EmptyState
            icon={Shield}
            title="Nenhum registro"
            description="Nenhum log de auditoria encontrado com os filtros selecionados."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Data/Hora</th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Usuario</th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Acao</th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Tipo</th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">ID</th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Detalhes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {logs.map((log) => (
                  <tr key={log.id} className="hover:bg-gray-50">
                    <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-600">
                      {formatDateTime(log.createdAt)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-900">
                      {log.userName ?? <span className="text-gray-400">Sistema</span>}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <span
                        className={cn(
                          'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
                          actionColors[log.action] ?? 'bg-gray-100 text-gray-700',
                        )}
                      >
                        {actionLabels[log.action] ?? log.action}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-600">
                      {log.entityType ? (entityTypeLabels[log.entityType] ?? log.entityType) : '-'}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm">
                      {log.entityId != null ? (
                        log.entityType === 'process' ? (
                          <a
                            href={`/importacao/processos/${log.entityId}`}
                            className="text-blue-600 hover:underline"
                          >
                            #{log.entityId}
                          </a>
                        ) : (
                          <span className="text-gray-600">#{log.entityId}</span>
                        )
                      ) : (
                        <span className="text-gray-400">-</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm">
                      <DetailsExpander details={log.details} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {pagination && pagination.pages > 1 && (
          <div className="flex items-center justify-between border-t border-gray-200 px-5 py-3">
            <p className="text-sm text-gray-600">
              Pagina {pagination.page} de {pagination.pages}
            </p>
            <div className="flex gap-2">
              <button
                disabled={page <= 1}
                onClick={() => setPage(page - 1)}
                className="inline-flex items-center gap-1 rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <ChevronLeft className="h-4 w-4" />
                Anterior
              </button>
              <button
                disabled={page >= pagination.pages}
                onClick={() => setPage(page + 1)}
                className="inline-flex items-center gap-1 rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Proximo
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
