import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Anchor, Search, Package, CheckCircle2, Clock, AlertTriangle } from 'lucide-react';
import { useAllPagesQuery } from '@/shared/hooks/useApi';
import { LoadingSpinner } from '@/shared/components/LoadingSpinner';
import { EmptyState } from '@/shared/components/EmptyState';
import { ErrorState } from '@/shared/components/ErrorState';
import { formatDate, cn } from '@/shared/lib/utils';

interface ProcessItem {
  id: number;
  processCode: string;
  status: string;
  aiExtractedData: Record<string, unknown> | null;
  // Colunas TIPADAS, gravadas pelo formulario de edicao de processo. Ate
  // 2026-08-29 esta tela lia exclusivamente `aiExtractedData`, cujo unico
  // produtor e um script manual de importacao: quem preenchia o canal aduaneiro
  // no formulario nunca via o resultado aqui, e o processo sequer aparecia na
  // lista se nao tivesse o blob.
  customsChannel: string | null;
  customsClearanceAt: string | null;
  diNumber: string | null;
  registeredAt: string | null;
  cdArrivalAt: string | null;
}

/**
 * Chave do blob -> coluna tipada equivalente.
 *
 * Precedencia: a COLUNA vence. Ela e escrita por uma pessoa no formulario, com
 * autoria e no presente; o blob vem de uma planilha importada por script. Onde a
 * coluna esta vazia, o blob preenche — e o historico continua visivel.
 */
const COLUNA_EQUIVALENTE: Record<string, keyof ProcessItem> = {
  canal: 'customsChannel',
  desembaraco: 'customsClearanceAt',
  numeroDI: 'diNumber',
  dataRegistroDI: 'registeredAt',
  chegadaCD: 'cdArrivalAt',
};

type ClearanceFilter = 'all' | 'pending' | 'cleared' | 'delivered';

const filterOptions: { value: ClearanceFilter; label: string }[] = [
  { value: 'all', label: 'Todos' },
  { value: 'pending', label: 'Pendente Desembaraco' },
  { value: 'cleared', label: 'Desembaracado' },
  { value: 'delivered', label: 'Entregue' },
];

const canalColors: Record<string, { bg: string; text: string }> = {
  Verde: { bg: 'bg-emerald-50', text: 'text-emerald-700' },
  verde: { bg: 'bg-emerald-50', text: 'text-emerald-700' },
  Amarelo: { bg: 'bg-amber-50', text: 'text-amber-700' },
  amarelo: { bg: 'bg-amber-50', text: 'text-amber-700' },
  Vermelho: { bg: 'bg-danger-50', text: 'text-danger-700' },
  vermelho: { bg: 'bg-danger-50', text: 'text-danger-700' },
};

function getField(data: Record<string, unknown> | null | undefined, key: string): string | null {
  if (!data) return null;
  const val = data[key];
  if (val == null) return null;
  return String(val);
}

/** Valor efetivo de um campo: coluna tipada primeiro, blob como historico. */
function campo(proc: ProcessItem, chave: string): string | null {
  const coluna = COLUNA_EQUIVALENTE[chave];
  if (coluna) {
    const tipado = proc[coluna];
    if (tipado != null && String(tipado) !== '') return String(tipado);
  }
  return getField(proc.aiExtractedData, chave);
}

/**
 * Coluna e blob discordam. Nao escolher em silencio: o operador precisa VER que
 * ha duas versoes do mesmo dado, senao o sistema decide por ele sem avisar.
 */
function divergente(proc: ProcessItem, chave: string): string | null {
  const coluna = COLUNA_EQUIVALENTE[chave];
  if (!coluna) return null;
  const tipado = proc[coluna];
  const doBlob = getField(proc.aiExtractedData, chave);
  if (tipado == null || String(tipado) === '' || doBlob == null) return null;
  return String(tipado) === doBlob ? null : doBlob;
}

function matchesFilter(proc: ProcessItem, filter: ClearanceFilter): boolean {
  if (filter === 'all') return true;
  const desembaraco = campo(proc, 'desembaraco');
  const chegadaCD = campo(proc, 'chegadaCD');
  if (filter === 'delivered') return !!chegadaCD;
  if (filter === 'cleared') return !!desembaraco && !chegadaCD;
  // pending
  return !desembaraco;
}

export function DesembaracoPage() {
  const navigate = useNavigate();
  const [filter, setFilter] = useState<ClearanceFilter>('all');
  const [search, setSearch] = useState('');

  const {
    data: processResponse,
    isLoading,
    error,
    refetch,
  } = useAllPagesQuery<ProcessItem>(['processes-desembaraco'], '/api/processes');
  const allProcesses = processResponse?.data;
  // O teto do `limit` no backend e 100. Enquanto a pagina pedia uma unica
  // pagina, os filtros so enxergavam essa fatia E os cartoes somavam a fatia
  // como se fosse o total.
  const fatiaIncompleta = processResponse?.truncated ?? false;

  // Filter only processes that have aiExtractedData with customs-related fields
  const customsProcesses = useMemo(() => {
    if (!allProcesses) return [];
    return allProcesses.filter((p) => {
      // A inclusao tambem passou a considerar as colunas tipadas. Sem isto, um
      // processo cujo canal foi preenchido SO no formulario nao aparecia nesta
      // tela de jeito nenhum — nao era filtro errado, era ausencia da linha.
      const data = p.aiExtractedData ?? {};
      return (
        campo(p, 'numeroDI') != null ||
        campo(p, 'dataRegistroDI') != null ||
        campo(p, 'canal') != null ||
        campo(p, 'desembaraco') != null ||
        campo(p, 'chegadaCD') != null ||
        data.recinto != null ||
        data.freeTime != null ||
        data.alertaDemurrage != null
      );
    });
  }, [allProcesses]);

  const filtered = useMemo(() => {
    let result = customsProcesses.filter((p) => matchesFilter(p, filter));
    if (search) {
      const q = search.toLowerCase();
      result = result.filter((p) => p.processCode.toLowerCase().includes(q));
    }
    return result;
  }, [customsProcesses, filter, search]);

  // Stats
  const totalInClearance = customsProcesses.filter((p) => !campo(p, 'desembaraco')).length;
  const now = new Date();
  const currentMonth = now.getMonth();
  const currentYear = now.getFullYear();
  const clearedThisMonth = customsProcesses.filter((p) => {
    const d = campo(p, 'desembaraco');
    if (!d) return false;
    const date = new Date(d);
    return date.getMonth() === currentMonth && date.getFullYear() === currentYear;
  }).length;
  const freeTimeValues = customsProcesses
    .map((p) => {
      const ft = getField(p.aiExtractedData, 'freeTime');
      return ft ? parseFloat(ft) : NaN;
    })
    .filter((v) => !isNaN(v));
  const avgFreeTime =
    freeTimeValues.length > 0
      ? Math.round(freeTimeValues.reduce((a, b) => a + b, 0) / freeTimeValues.length)
      : 0;

  const kpiCards = [
    {
      label: 'Em Desembaraco',
      value: totalInClearance,
      icon: Clock,
      gradient: 'from-amber-500 to-amber-600',
    },
    {
      label: 'Desembaracados (Mes)',
      value: clearedThisMonth,
      icon: CheckCircle2,
      gradient: 'from-emerald-500 to-emerald-600',
    },
    {
      label: 'Free Time Medio (dias)',
      value: avgFreeTime,
      icon: AlertTriangle,
      gradient: 'from-primary-500 to-primary-600',
    },
  ];

  if (isLoading) {
    return <LoadingSpinner className="py-24" size="lg" />;
  }

  if (error) {
    return (
      <ErrorState message="Erro ao carregar processos de desembaraco." onRetry={() => refetch()} />
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-sky-500 to-sky-600 shadow-sm">
          <Anchor className="h-5 w-5 text-white" />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100 tracking-tight">
            Desembaraco Aduaneiro
          </h2>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            {customsProcesses.length} processo{customsProcesses.length !== 1 ? 's' : ''} com dados
            aduaneiros
          </p>
        </div>
      </div>

      {fatiaIncompleta && (
        <p
          role="status"
          className="rounded-lg border border-warning-500/40 bg-warning-50 px-3 py-2 text-xs text-warning-700 dark:bg-warning-700/10 dark:text-warning-100"
        >
          Mostrando apenas parte dos processos: os numeros abaixo somam a fatia carregada, nao o
          total.
        </p>
      )}
      {/* KPI Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 stagger-children">
        {kpiCards.map((kpi) => (
          <div
            key={kpi.label}
            className="rounded-2xl border border-slate-200/60 bg-white dark:bg-slate-800 dark:border-slate-700/60 p-5 shadow-sm"
          >
            <div className="flex items-center gap-3.5">
              <div
                className={cn(
                  'flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br shadow-sm',
                  kpi.gradient,
                )}
              >
                <kpi.icon className="h-5 w-5 text-white" />
              </div>
              <div>
                <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
                  {kpi.label}
                </p>
                <p className="text-lg font-bold text-slate-900 dark:text-slate-100">{kpi.value}</p>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Filter Bar */}
      <div className="rounded-2xl border border-slate-200/60 bg-white dark:bg-slate-800 dark:border-slate-700/60 p-5 shadow-sm">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
          {/* Search */}
          <div className="flex-1 max-w-xs">
            <label
              htmlFor="desembaraco-search"
              className="mb-1.5 block text-xs font-medium text-slate-500 dark:text-slate-400"
            >
              Processo
            </label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                id="desembaraco-search"
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar processo..."
                className="w-full rounded-lg border border-slate-200 dark:border-slate-600 py-2 pl-10 pr-4 text-sm text-slate-700 dark:text-slate-300 transition-all placeholder:text-slate-400 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
              />
            </div>
          </div>

          {/* Status Filter Pills */}
          <div>
            <p className="mb-1.5 text-xs font-medium text-slate-500 dark:text-slate-400">Status</p>
            <div className="flex flex-wrap items-center gap-1.5">
              {filterOptions.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setFilter(opt.value)}
                  className={cn(
                    'rounded-lg px-3.5 py-1.5 text-sm font-medium transition-all',
                    filter === opt.value
                      ? 'bg-slate-900 text-white shadow-sm'
                      : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-200',
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {(filter !== 'all' || search) && (
            <button
              onClick={() => {
                setFilter('all');
                setSearch('');
              }}
              className="rounded-lg px-3 py-1.5 text-sm font-medium text-primary-600 hover:bg-primary-50 dark:hover:bg-primary-900/30 focus-visible:ring-2 focus-visible:ring-primary-500 focus:outline-none transition-colors"
            >
              Limpar filtros
            </button>
          )}
        </div>
      </div>

      {/* Table */}
      {!filtered.length ? (
        <EmptyState
          icon={Package}
          title="Nenhum processo encontrado"
          description="Nenhum processo com dados de desembaraco encontrado com os filtros selecionados."
        />
      ) : (
        <div className="rounded-2xl border border-slate-200/60 bg-white dark:bg-slate-800 dark:border-slate-700/60 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-[900px] w-full divide-y divide-slate-200 dark:divide-slate-700">
              <thead>
                <tr className="bg-slate-50 dark:bg-slate-900">
                  <th className="px-3 py-2.5 sm:px-6 sm:py-3.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    Processo
                  </th>
                  <th className="px-3 py-2.5 sm:px-6 sm:py-3.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    DI
                  </th>
                  <th className="px-3 py-2.5 sm:px-6 sm:py-3.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    Data DI
                  </th>
                  <th className="px-3 py-2.5 sm:px-6 sm:py-3.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    Canal
                  </th>
                  <th className="px-3 py-2.5 sm:px-6 sm:py-3.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    Desembaraco
                  </th>
                  <th className="px-3 py-2.5 sm:px-6 sm:py-3.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    Recinto
                  </th>
                  <th className="px-3 py-2.5 sm:px-6 sm:py-3.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    Free Time
                  </th>
                  <th className="px-3 py-2.5 sm:px-6 sm:py-3.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    Demurrage
                  </th>
                  <th className="px-3 py-2.5 sm:px-6 sm:py-3.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    Chegada CD
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                {filtered.map((proc) => {
                  const data = proc.aiExtractedData;
                  const canal = campo(proc, 'canal');
                  // Quando as duas fontes discordam, o operador ve as duas — a
                  // tela nao escolhe em silencio.
                  const canalAntigo = divergente(proc, 'canal');
                  const desembaracoAntigo = divergente(proc, 'desembaraco');
                  const canalStyle = canal
                    ? (canalColors[canal] ?? {
                        bg: 'bg-slate-100 dark:bg-slate-700',
                        text: 'text-slate-700 dark:text-slate-300',
                      })
                    : null;
                  const demurrage = getField(data, 'alertaDemurrage');

                  return (
                    <tr
                      key={proc.id}
                      onClick={() => navigate(`/importacao/processos/${proc.id}`)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          navigate(`/importacao/processos/${proc.id}`);
                        }
                      }}
                      role="link"
                      tabIndex={0}
                      aria-label={`Abrir processo ${proc.processCode}`}
                      className="cursor-pointer border-t border-slate-100 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors"
                    >
                      <td className="whitespace-nowrap px-3 py-2.5 sm:px-6 sm:py-3.5 text-sm font-semibold text-slate-900 dark:text-slate-100">
                        {proc.processCode}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 sm:px-6 sm:py-3.5 text-sm font-mono text-slate-700 dark:text-slate-300">
                        {campo(proc, 'numeroDI') || <span className="text-slate-300">--</span>}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 sm:px-6 sm:py-3.5 text-sm text-slate-600 dark:text-slate-400">
                        {campo(proc, 'dataRegistroDI') ? (
                          formatDate(campo(proc, 'dataRegistroDI')!)
                        ) : (
                          <span className="text-slate-300">--</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 sm:px-6 sm:py-3.5">
                        {canal && canalStyle ? (
                          <span
                            title={
                              canalAntigo
                                ? `Planilha importada registra "${canalAntigo}"`
                                : undefined
                            }
                            className={cn(
                              'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold',
                              canalStyle.bg,
                              canalStyle.text,
                              canalAntigo && 'ring-1 ring-inset ring-amber-400',
                            )}
                          >
                            {canal}
                          </span>
                        ) : (
                          <span className="text-sm text-slate-300">--</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 sm:px-6 sm:py-3.5 text-sm text-slate-600 dark:text-slate-400">
                        {campo(proc, 'desembaraco') ? (
                          <span
                            title={
                              desembaracoAntigo
                                ? `Planilha importada registra ${formatDate(desembaracoAntigo)}`
                                : undefined
                            }
                            className={
                              desembaracoAntigo ? 'underline decoration-dotted' : undefined
                            }
                          >
                            {formatDate(campo(proc, 'desembaraco')!)}
                          </span>
                        ) : (
                          <span className="text-slate-300">--</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 sm:px-6 sm:py-3.5 text-sm text-slate-600 dark:text-slate-400">
                        {getField(data, 'recinto') || <span className="text-slate-300">--</span>}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 sm:px-6 sm:py-3.5 text-sm text-slate-600 dark:text-slate-400">
                        {getField(data, 'freeTime') ? (
                          `${getField(data, 'freeTime')} dias`
                        ) : (
                          <span className="text-slate-300">--</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 sm:px-6 sm:py-3.5">
                        {demurrage ? (
                          <span
                            className={cn(
                              'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold',
                              demurrage.toLowerCase().includes('sim') ||
                                demurrage.toLowerCase().includes('yes')
                                ? 'bg-danger-50 text-danger-700'
                                : 'bg-emerald-50 text-emerald-700',
                            )}
                          >
                            {demurrage.toLowerCase().includes('sim') ||
                            demurrage.toLowerCase().includes('yes') ? (
                              <AlertTriangle className="h-3 w-3" />
                            ) : null}
                            {demurrage}
                          </span>
                        ) : (
                          <span className="text-sm text-slate-300">--</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 sm:px-6 sm:py-3.5 text-sm text-slate-600 dark:text-slate-400">
                        {campo(proc, 'chegadaCD') ? (
                          formatDate(campo(proc, 'chegadaCD')!)
                        ) : (
                          <span className="text-slate-300">--</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
