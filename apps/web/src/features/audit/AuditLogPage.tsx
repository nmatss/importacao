import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Shield,
  ChevronDown,
  ChevronRight,
  ChevronLeft,
  Search,
  X,
  Code2,
  Clock,
  User,
} from 'lucide-react';
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

const actionColors: Record<string, { bg: string; text: string; dot: string }> = {
  login: { bg: 'bg-primary-50', text: 'text-primary-700', dot: 'bg-primary-500' },
  create: { bg: 'bg-emerald-50', text: 'text-emerald-700', dot: 'bg-emerald-500' },
  update: { bg: 'bg-amber-50', text: 'text-amber-700', dot: 'bg-amber-500' },
  delete: { bg: 'bg-danger-50', text: 'text-danger-700', dot: 'bg-danger-500' },
  upload: { bg: 'bg-primary-50', text: 'text-primary-700', dot: 'bg-primary-500' },
  reprocess: { bg: 'bg-violet-50', text: 'text-violet-700', dot: 'bg-violet-500' },
  email_processed: { bg: 'bg-teal-50', text: 'text-teal-700', dot: 'bg-teal-500' },
  validation_run: { bg: 'bg-orange-50', text: 'text-orange-700', dot: 'bg-orange-500' },
  manual_resolution: { bg: 'bg-amber-50', text: 'text-amber-700', dot: 'bg-amber-500' },
  alert_created: { bg: 'bg-rose-50', text: 'text-rose-700', dot: 'bg-rose-500' },
  acknowledge: { bg: 'bg-emerald-50', text: 'text-emerald-700', dot: 'bg-emerald-500' },
  generate: { bg: 'bg-violet-50', text: 'text-violet-700', dot: 'bg-violet-500' },
  sent_to_fenicia: { bg: 'bg-cyan-50', text: 'text-cyan-700', dot: 'bg-cyan-500' },
};

const defaultActionColor = {
  bg: 'bg-slate-50 dark:bg-slate-900',
  text: 'text-slate-700 dark:text-slate-300',
  dot: 'bg-slate-400',
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

function formatDateShort(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleString('pt-BR', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function DetailsExpander({ details }: { details: Record<string, unknown> | null }) {
  const [open, setOpen] = useState(false);

  if (!details || Object.keys(details).length === 0) {
    return <span className="text-slate-300 text-xs">--</span>;
  }

  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        className={cn(
          'inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium transition-all duration-200',
          open
            ? 'bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300'
            : 'text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800 dark:bg-slate-900 hover:text-slate-600 dark:text-slate-400',
        )}
      >
        <Code2 className="h-3 w-3" />
        {open ? 'Ocultar' : 'Detalhes'}
        {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
      </button>
      {open && (
        <div className="mt-2 rounded-xl border border-slate-200 dark:border-slate-600/80 bg-slate-50 dark:bg-slate-900 overflow-hidden">
          <div className="flex items-center justify-between border-b border-slate-200/60 dark:border-slate-700/60 px-3 py-1.5">
            <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
              JSON
            </span>
            <span className="text-[10px] text-slate-300">{Object.keys(details).length} campos</span>
          </div>
          <pre className="p-3 text-xs text-slate-600 dark:text-slate-400 max-w-lg overflow-auto font-mono leading-relaxed">
            {JSON.stringify(details, null, 2)}
          </pre>
        </div>
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
  const hasFilters = action || entityType || startDate || endDate;

  const clearFilters = () => {
    setAction('');
    setEntityType('');
    setStartDate('');
    setEndDate('');
    setPage(1);
  };

  const selectClasses =
    'rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-700 dark:text-slate-300 focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 focus:outline-none transition-all appearance-none cursor-pointer';
  const inputClasses =
    'rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-700 dark:text-slate-300 focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 focus:outline-none transition-all';

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Page header */}
      <div>
        <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100 tracking-tight">
          Auditoria
        </h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Registro de atividades e acoes do sistema
        </p>
      </div>

      {/* Filter bar */}
      <div className="rounded-2xl border border-slate-200/80 bg-white dark:bg-slate-800 dark:border-slate-700/80 p-3 sm:p-5 shadow-sm">
        <div className="flex items-center gap-2 mb-4">
          <Search className="h-4 w-4 text-slate-400" />
          <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300">Filtros</h3>
          {hasFilters && (
            <button
              onClick={clearFilters}
              className="ml-auto inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800 dark:bg-slate-900 hover:text-slate-600 dark:text-slate-400 transition-colors"
            >
              <X className="h-3 w-3" />
              Limpar
            </button>
          )}
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-full sm:w-auto sm:min-w-[160px]">
            <label
              htmlFor="audit-action"
              className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1.5"
            >
              Acao
            </label>
            <select
              id="audit-action"
              value={action}
              onChange={(e) => {
                setAction(e.target.value);
                setPage(1);
              }}
              className={selectClasses}
            >
              <option value="">Todas as acoes</option>
              {Object.entries(actionLabels).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </div>

          <div className="w-full sm:w-auto sm:min-w-[140px]">
            <label
              htmlFor="audit-entity-type"
              className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1.5"
            >
              Tipo
            </label>
            <select
              id="audit-entity-type"
              value={entityType}
              onChange={(e) => {
                setEntityType(e.target.value);
                setPage(1);
              }}
              className={selectClasses}
            >
              <option value="">Todos os tipos</option>
              {Object.entries(entityTypeLabels).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              htmlFor="audit-start-date"
              className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1.5"
            >
              De
            </label>
            <input
              id="audit-start-date"
              type="date"
              value={startDate}
              onChange={(e) => {
                setStartDate(e.target.value);
                setPage(1);
              }}
              className={inputClasses}
            />
          </div>

          <div>
            <label
              htmlFor="audit-end-date"
              className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1.5"
            >
              Ate
            </label>
            <input
              id="audit-end-date"
              type="date"
              value={endDate}
              onChange={(e) => {
                setEndDate(e.target.value);
                setPage(1);
              }}
              className={inputClasses}
            />
          </div>
        </div>
      </div>

      {/* Table card */}
      <div className="rounded-2xl border border-slate-200/80 bg-white dark:bg-slate-800 dark:border-slate-700/80 shadow-sm overflow-hidden">
        {/* Card header */}
        <div className="border-b border-slate-100 dark:border-slate-700 px-4 sm:px-6 py-4">
          <div className="flex items-center justify-between">
            <h3 className="flex items-center gap-2.5 text-sm sm:text-base font-semibold text-slate-800 dark:text-slate-100">
              <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-slate-100 dark:bg-slate-700">
                <Shield className="h-4 w-4 text-slate-600 dark:text-slate-400" />
              </div>
              Logs de Auditoria
            </h3>
            {pagination && (
              <span className="rounded-lg bg-slate-100 dark:bg-slate-700 px-2.5 py-1 text-xs font-semibold text-slate-500 dark:text-slate-400">
                {pagination.total.toLocaleString('pt-BR')} registro
                {pagination.total !== 1 ? 's' : ''}
              </span>
            )}
          </div>
        </div>

        {isLoading ? (
          <LoadingSpinner className="py-16" />
        ) : logs.length === 0 ? (
          <EmptyState
            icon={Shield}
            title="Nenhum registro"
            description="Nenhum log de auditoria encontrado com os filtros selecionados."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-[800px] w-full">
              <thead>
                <tr className="border-b border-slate-100 dark:border-slate-700 bg-slate-50/80 dark:bg-slate-900/80">
                  <th className="px-3 py-2 sm:px-6 sm:py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                    <div className="flex items-center gap-1.5">
                      <Clock className="h-3 w-3" />
                      Data/Hora
                    </div>
                  </th>
                  <th className="px-3 py-2 sm:px-6 sm:py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                    <div className="flex items-center gap-1.5">
                      <User className="h-3 w-3" />
                      Usuario
                    </div>
                  </th>
                  <th className="px-3 py-2 sm:px-6 sm:py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                    Acao
                  </th>
                  <th className="px-3 py-2 sm:px-6 sm:py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                    Entidade
                  </th>
                  <th className="px-3 py-2 sm:px-6 sm:py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                    ID
                  </th>
                  <th className="px-3 py-2 sm:px-6 sm:py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                    Detalhes
                  </th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log, idx) => {
                  const colors = actionColors[log.action] ?? defaultActionColor;
                  return (
                    <tr
                      key={log.id}
                      className={cn(
                        'group transition-colors duration-150 hover:bg-slate-50 dark:hover:bg-slate-800/80',
                        idx !== logs.length - 1 &&
                          'border-b border-slate-100 dark:border-slate-700/80',
                      )}
                    >
                      <td className="whitespace-nowrap px-3 py-2.5 sm:px-6 sm:py-3.5">
                        <div className="text-sm font-medium text-slate-700 dark:text-slate-300">
                          {formatDateShort(log.createdAt)}
                        </div>
                        <div className="text-[11px] text-slate-400 mt-0.5 hidden xl:block">
                          {formatDateTime(log.createdAt)}
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 sm:px-6 sm:py-3.5">
                        {log.userName ? (
                          <div className="flex items-center gap-2.5">
                            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-slate-100 dark:bg-slate-700 text-[10px] font-bold text-slate-500 dark:text-slate-400">
                              {log.userName
                                .split(' ')
                                .map((w) => w[0])
                                .slice(0, 2)
                                .join('')
                                .toUpperCase()}
                            </div>
                            <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
                              {log.userName}
                            </span>
                          </div>
                        ) : (
                          <span className="text-sm text-slate-300 italic">Sistema</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 sm:px-6 sm:py-3.5">
                        <span
                          className={cn(
                            'inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-semibold',
                            colors.bg,
                            colors.text,
                          )}
                        >
                          <span className={cn('h-1.5 w-1.5 rounded-full', colors.dot)} />
                          {actionLabels[log.action] ?? log.action}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 sm:px-6 sm:py-3.5">
                        {log.entityType ? (
                          <span className="inline-flex items-center rounded-lg bg-slate-100 dark:bg-slate-700/80 px-2 py-0.5 text-xs font-medium text-slate-600 dark:text-slate-400">
                            {entityTypeLabels[log.entityType] ?? log.entityType}
                          </span>
                        ) : (
                          <span className="text-slate-300">--</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 sm:px-6 sm:py-3.5 text-sm">
                        {log.entityId != null ? (
                          log.entityType === 'process' ? (
                            <Link
                              to={`/importacao/processos/${log.entityId}`}
                              className="inline-flex items-center rounded-lg bg-primary-50 px-2 py-0.5 text-xs font-semibold text-primary-600 hover:bg-primary-100 transition-colors"
                            >
                              #{log.entityId}
                            </Link>
                          ) : (
                            <span className="text-sm font-medium text-slate-500 dark:text-slate-400">
                              #{log.entityId}
                            </span>
                          )
                        ) : (
                          <span className="text-slate-300">--</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 sm:px-6 sm:py-3.5 text-sm">
                        <DetailsExpander details={log.details} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {pagination && pagination.pages > 1 && (
          <div className="flex flex-col sm:flex-row items-center justify-between gap-2 border-t border-slate-100 dark:border-slate-700 px-4 sm:px-6 py-3 sm:py-4">
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Pagina{' '}
              <span className="font-semibold text-slate-700 dark:text-slate-300">
                {pagination.page}
              </span>{' '}
              de{' '}
              <span className="font-semibold text-slate-700 dark:text-slate-300">
                {pagination.pages}
              </span>
            </p>
            <div className="flex gap-2">
              <button
                disabled={page <= 1}
                onClick={() => setPage(page - 1)}
                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 px-3.5 py-2 text-sm font-medium text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800 dark:bg-slate-900 disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-200 shadow-sm"
              >
                <ChevronLeft className="h-4 w-4" />
                Anterior
              </button>
              <button
                disabled={page >= pagination.pages}
                onClick={() => setPage(page + 1)}
                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 px-3.5 py-2 text-sm font-medium text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800 dark:bg-slate-900 disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-200 shadow-sm"
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
