import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  FileWarning,
  ShieldAlert,
  AlertOctagon,
  Send,
  FileX,
  Clock,
  Users,
  Banknote,
  ChevronDown,
  ArrowUpDown,
} from 'lucide-react';
import { useApiQuery } from '@/shared/hooks/useApi';
import { cn, formatDate, formatCurrency } from '@/shared/lib/utils';
import { StatusBadge } from '@/shared/components/StatusBadge';
import { LoadingSpinner } from '@/shared/components/LoadingSpinner';

// ── Types ───────────────────────────────────────────────────────────────

interface SlaDocsOverdue {
  id: number;
  processCode: string;
  brand: string;
  shipmentDate: string;
  daysSinceShipment: number;
  assignedUser: string | null;
}

interface SlaLiUrgent {
  id: number;
  processCode: string;
  brand: string;
  liDeadline: string;
  daysRemaining: number;
  status: string;
}

interface SlaWithDivergences {
  id: number;
  processCode: string;
  brand: string;
  failedCheckCount: number;
  lastValidationDate: string;
}

interface SlaPendingFenicia {
  id: number;
  processCode: string;
  brand: string;
  espelhoGeneratedDate: string | null;
  daysPending: number;
}

interface SlaNoEspelho {
  id: number;
  processCode: string;
  brand: string;
  validatedDate: string;
  daysPending: number;
}

interface SlaNoFollowUpUpdate {
  id: number;
  processCode: string;
  brand: string;
  lastUpdateDate: string;
  daysSinceUpdate: number;
}

interface SlaAgingByUser {
  userName: string;
  pendingCount: number;
  oldestPendingDays: number;
}

interface SlaUpcomingPayments {
  id: number;
  processId: number;
  processCode: string;
  amountUsd: string;
  paymentDeadline: string;
  daysUntilDue: number;
}

interface SlaData {
  docsOverdue: SlaDocsOverdue[];
  liUrgent: SlaLiUrgent[];
  withDivergences: SlaWithDivergences[];
  pendingFenicia: SlaPendingFenicia[];
  noEspelho: SlaNoEspelho[];
  noFollowUpUpdate: SlaNoFollowUpUpdate[];
  agingByUser: SlaAgingByUser[];
  upcomingPayments: SlaUpcomingPayments[];
  summary: Record<string, number>;
}

// ── Tab Configuration ───────────────────────────────────────────────────

type TabKey =
  | 'docsOverdue'
  | 'liUrgent'
  | 'withDivergences'
  | 'pendingFenicia'
  | 'noEspelho'
  | 'noFollowUpUpdate'
  | 'agingByUser'
  | 'upcomingPayments';

const tabConfig: {
  key: TabKey;
  label: string;
  icon: typeof FileWarning;
  gradient: string;
  borderColor: string;
  valueColor: string;
}[] = [
  {
    key: 'docsOverdue',
    label: 'Docs Atrasados',
    icon: FileWarning,
    gradient: 'from-danger-500 to-danger-600',
    borderColor: 'border-l-danger-500',
    valueColor: 'text-danger-600',
  },
  {
    key: 'liUrgent',
    label: 'LI Urgente',
    icon: ShieldAlert,
    gradient: 'from-amber-500 to-amber-600',
    borderColor: 'border-l-amber-500',
    valueColor: 'text-amber-600',
  },
  {
    key: 'withDivergences',
    label: 'Divergências',
    icon: AlertOctagon,
    gradient: 'from-orange-500 to-orange-600',
    borderColor: 'border-l-orange-500',
    valueColor: 'text-orange-600',
  },
  {
    key: 'pendingFenicia',
    label: 'Pendente Fenícia',
    icon: Send,
    gradient: 'from-violet-500 to-violet-600',
    borderColor: 'border-l-violet-500',
    valueColor: 'text-violet-600',
  },
  {
    key: 'noEspelho',
    label: 'Sem Espelho',
    icon: FileX,
    gradient: 'from-rose-500 to-rose-600',
    borderColor: 'border-l-rose-500',
    valueColor: 'text-rose-600',
  },
  {
    key: 'noFollowUpUpdate',
    label: 'Sem Atualização',
    icon: Clock,
    gradient: 'from-slate-500 to-slate-600',
    borderColor: 'border-l-slate-500',
    valueColor: 'text-slate-600',
  },
  {
    key: 'agingByUser',
    label: 'Por Usuário',
    icon: Users,
    gradient: 'from-primary-500 to-primary-600',
    borderColor: 'border-l-primary-500',
    valueColor: 'text-primary-600',
  },
  {
    key: 'upcomingPayments',
    label: 'Pagamentos',
    icon: Banknote,
    gradient: 'from-emerald-500 to-emerald-600',
    borderColor: 'border-l-emerald-500',
    valueColor: 'text-emerald-600',
  },
];

// ── Helpers ─────────────────────────────────────────────────────────────

function severityColor(count: number): string {
  if (count === 0) return 'text-slate-300';
  if (count <= 2) return 'text-amber-500';
  return 'text-danger-500';
}

function urgencyBg(days: number): string {
  if (days <= 0) return 'bg-danger-50/50';
  if (days <= 3) return 'bg-amber-50/50';
  return '';
}

function urgencyText(days: number): string {
  if (days <= 0) return 'text-danger-700 font-bold';
  if (days <= 3) return 'text-amber-700 font-semibold';
  return 'text-slate-600';
}

function Skeleton({ className }: { className?: string }) {
  return <div className={cn('bg-slate-200/50 rounded-lg animate-pulse', className)} />;
}

// ── Component ───────────────────────────────────────────────────────────

export function SLADashboard() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<TabKey>('docsOverdue');
  const [sortField, setSortField] = useState<string>('');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  const { data: sla, isLoading } = useApiQuery<SlaData>(
    ['dashboard', 'sla'],
    '/api/dashboard/sla',
    { refetchInterval: 60_000 },
  );

  function handleSort(field: string) {
    if (sortField === field) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  }

  function sorted<T>(items: T[], field: keyof T): T[] {
    if (!sortField || !(sortField in (items[0] ?? {}))) return items;
    return [...items].sort((a, b) => {
      const va = a[field as keyof T];
      const vb = b[field as keyof T];
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      const cmp = va < vb ? -1 : va > vb ? 1 : 0;
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }

  function goToProcess(id: number) {
    navigate(`/importacao/processos/${id}`);
  }

  function SortHeader({ field, children }: { field: string; children: React.ReactNode }) {
    return (
      <th
        className="px-5 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500 cursor-pointer hover:text-slate-700 select-none"
        onClick={() => handleSort(field)}
      >
        <span className="inline-flex items-center gap-1">
          {children}
          <ArrowUpDown
            className={cn('h-3 w-3', sortField === field ? 'text-primary-500' : 'text-slate-300')}
          />
        </span>
      </th>
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-8">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-2xl" />
          ))}
        </div>
        <Skeleton className="h-96 rounded-2xl" />
      </div>
    );
  }

  const summary = sla?.summary ?? {};

  // ── Tab Content Renderers ───────────────────────────────────────────

  function renderDocsOverdue() {
    const items = sla?.docsOverdue ?? [];
    if (items.length === 0) return <EmptyTab />;
    return (
      <table className="min-w-full">
        <thead>
          <tr className="bg-slate-50 border-b border-slate-200/60">
            <SortHeader field="processCode">Processo</SortHeader>
            <SortHeader field="brand">Marca</SortHeader>
            <SortHeader field="shipmentDate">Data Embarque</SortHeader>
            <SortHeader field="daysSinceShipment">Dias Atraso</SortHeader>
            <th className="px-5 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              Usuário
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {sorted(items, sortField as keyof SlaDocsOverdue).map((row) => (
            <tr
              key={row.id}
              onClick={() => goToProcess(row.id)}
              className="hover:bg-slate-50/50 cursor-pointer transition-colors"
            >
              <td className="px-5 py-3 text-sm font-medium text-primary-600">{row.processCode}</td>
              <td className="px-5 py-3 text-sm text-slate-600 capitalize">{row.brand}</td>
              <td className="px-5 py-3 text-sm text-slate-500">
                {row.shipmentDate ? formatDate(row.shipmentDate) : '--'}
              </td>
              <td className="px-5 py-3 text-sm">
                <span className="inline-flex items-center rounded-full bg-danger-50 px-2.5 py-0.5 text-xs font-bold text-danger-700 ring-1 ring-danger-200/60">
                  {row.daysSinceShipment}d
                </span>
              </td>
              <td className="px-5 py-3 text-sm text-slate-500">{row.assignedUser ?? '--'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }

  function renderLiUrgent() {
    const items = sla?.liUrgent ?? [];
    if (items.length === 0) return <EmptyTab />;
    return (
      <table className="min-w-full">
        <thead>
          <tr className="bg-slate-50 border-b border-slate-200/60">
            <SortHeader field="processCode">Processo</SortHeader>
            <SortHeader field="brand">Marca</SortHeader>
            <SortHeader field="liDeadline">Prazo LI</SortHeader>
            <SortHeader field="daysRemaining">Dias Restantes</SortHeader>
            <th className="px-5 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              Status
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {sorted(items, sortField as keyof SlaLiUrgent).map((row) => (
            <tr
              key={row.id}
              onClick={() => goToProcess(row.id)}
              className={cn(
                'hover:bg-slate-50/50 cursor-pointer transition-colors',
                urgencyBg(row.daysRemaining),
              )}
            >
              <td className="px-5 py-3 text-sm font-medium text-primary-600">{row.processCode}</td>
              <td className="px-5 py-3 text-sm text-slate-600 capitalize">{row.brand}</td>
              <td className="px-5 py-3 text-sm text-slate-500">
                {row.liDeadline ? formatDate(row.liDeadline) : '--'}
              </td>
              <td className="px-5 py-3 text-sm">
                <span
                  className={cn(
                    'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-bold',
                    urgencyText(row.daysRemaining),
                    row.daysRemaining <= 0
                      ? 'bg-danger-50 ring-1 ring-danger-200/60'
                      : row.daysRemaining <= 3
                        ? 'bg-amber-50 ring-1 ring-amber-200/60'
                        : 'bg-slate-100 ring-1 ring-slate-200/60',
                  )}
                >
                  {row.daysRemaining <= 0
                    ? `${Math.abs(row.daysRemaining)}d atrasado`
                    : `${row.daysRemaining}d`}
                </span>
              </td>
              <td className="px-5 py-3 text-sm">
                <StatusBadge status={row.status} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }

  function renderDivergences() {
    const items = sla?.withDivergences ?? [];
    if (items.length === 0) return <EmptyTab />;
    return (
      <table className="min-w-full">
        <thead>
          <tr className="bg-slate-50 border-b border-slate-200/60">
            <SortHeader field="processCode">Processo</SortHeader>
            <SortHeader field="brand">Marca</SortHeader>
            <SortHeader field="failedCheckCount">Checks Falhos</SortHeader>
            <SortHeader field="lastValidationDate">Última Validação</SortHeader>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {sorted(items, sortField as keyof SlaWithDivergences).map((row) => (
            <tr
              key={row.id}
              onClick={() => goToProcess(row.id)}
              className="hover:bg-slate-50/50 cursor-pointer transition-colors"
            >
              <td className="px-5 py-3 text-sm font-medium text-primary-600">{row.processCode}</td>
              <td className="px-5 py-3 text-sm text-slate-600 capitalize">{row.brand}</td>
              <td className="px-5 py-3 text-sm">
                <span className="inline-flex items-center rounded-full bg-orange-50 px-2.5 py-0.5 text-xs font-bold text-orange-700 ring-1 ring-orange-200/60">
                  {row.failedCheckCount}
                </span>
              </td>
              <td className="px-5 py-3 text-sm text-slate-500">
                {row.lastValidationDate ? formatDate(row.lastValidationDate) : '--'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }

  function renderPendingFenicia() {
    const items = sla?.pendingFenicia ?? [];
    if (items.length === 0) return <EmptyTab />;
    return (
      <table className="min-w-full">
        <thead>
          <tr className="bg-slate-50 border-b border-slate-200/60">
            <SortHeader field="processCode">Processo</SortHeader>
            <SortHeader field="brand">Marca</SortHeader>
            <SortHeader field="espelhoGeneratedDate">Espelho Gerado</SortHeader>
            <SortHeader field="daysPending">Dias Pendente</SortHeader>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {sorted(items, sortField as keyof SlaPendingFenicia).map((row) => (
            <tr
              key={row.id}
              onClick={() => goToProcess(row.id)}
              className="hover:bg-slate-50/50 cursor-pointer transition-colors"
            >
              <td className="px-5 py-3 text-sm font-medium text-primary-600">{row.processCode}</td>
              <td className="px-5 py-3 text-sm text-slate-600 capitalize">{row.brand}</td>
              <td className="px-5 py-3 text-sm text-slate-500">
                {row.espelhoGeneratedDate ? formatDate(row.espelhoGeneratedDate) : '--'}
              </td>
              <td className="px-5 py-3 text-sm">
                <span
                  className={cn(
                    'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-bold',
                    row.daysPending > 3
                      ? 'bg-danger-50 text-danger-700 ring-1 ring-danger-200/60'
                      : 'bg-amber-50 text-amber-700 ring-1 ring-amber-200/60',
                  )}
                >
                  {row.daysPending}d
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }

  function renderNoEspelho() {
    const items = sla?.noEspelho ?? [];
    if (items.length === 0) return <EmptyTab />;
    return (
      <table className="min-w-full">
        <thead>
          <tr className="bg-slate-50 border-b border-slate-200/60">
            <SortHeader field="processCode">Processo</SortHeader>
            <SortHeader field="brand">Marca</SortHeader>
            <SortHeader field="validatedDate">Data Validação</SortHeader>
            <SortHeader field="daysPending">Dias Pendente</SortHeader>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {sorted(items, sortField as keyof SlaNoEspelho).map((row) => (
            <tr
              key={row.id}
              onClick={() => goToProcess(row.id)}
              className="hover:bg-slate-50/50 cursor-pointer transition-colors"
            >
              <td className="px-5 py-3 text-sm font-medium text-primary-600">{row.processCode}</td>
              <td className="px-5 py-3 text-sm text-slate-600 capitalize">{row.brand}</td>
              <td className="px-5 py-3 text-sm text-slate-500">
                {row.validatedDate ? formatDate(row.validatedDate) : '--'}
              </td>
              <td className="px-5 py-3 text-sm">
                <span
                  className={cn(
                    'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-bold',
                    row.daysPending > 3
                      ? 'bg-rose-50 text-rose-700 ring-1 ring-rose-200/60'
                      : 'bg-slate-100 text-slate-600 ring-1 ring-slate-200/60',
                  )}
                >
                  {row.daysPending}d
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }

  function renderNoFollowUpUpdate() {
    const items = sla?.noFollowUpUpdate ?? [];
    if (items.length === 0) return <EmptyTab />;
    return (
      <table className="min-w-full">
        <thead>
          <tr className="bg-slate-50 border-b border-slate-200/60">
            <SortHeader field="processCode">Processo</SortHeader>
            <SortHeader field="brand">Marca</SortHeader>
            <SortHeader field="lastUpdateDate">Última Atualização</SortHeader>
            <SortHeader field="daysSinceUpdate">Dias sem Atualização</SortHeader>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {sorted(items, sortField as keyof SlaNoFollowUpUpdate).map((row) => (
            <tr
              key={row.id}
              onClick={() => goToProcess(row.id)}
              className="hover:bg-slate-50/50 cursor-pointer transition-colors"
            >
              <td className="px-5 py-3 text-sm font-medium text-primary-600">{row.processCode}</td>
              <td className="px-5 py-3 text-sm text-slate-600 capitalize">{row.brand}</td>
              <td className="px-5 py-3 text-sm text-slate-500">
                {row.lastUpdateDate ? formatDate(row.lastUpdateDate) : '--'}
              </td>
              <td className="px-5 py-3 text-sm">
                <span
                  className={cn(
                    'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-bold',
                    row.daysSinceUpdate > 10
                      ? 'bg-danger-50 text-danger-700 ring-1 ring-danger-200/60'
                      : 'bg-slate-100 text-slate-600 ring-1 ring-slate-200/60',
                  )}
                >
                  {row.daysSinceUpdate}d
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }

  function renderAgingByUser() {
    const items = sla?.agingByUser ?? [];
    if (items.length === 0) return <EmptyTab />;
    return (
      <table className="min-w-full">
        <thead>
          <tr className="bg-slate-50 border-b border-slate-200/60">
            <SortHeader field="userName">Usuário</SortHeader>
            <SortHeader field="pendingCount">Pendências</SortHeader>
            <SortHeader field="oldestPendingDays">Mais Antigo (dias)</SortHeader>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {sorted(items, sortField as keyof SlaAgingByUser).map((row, i) => (
            <tr key={i} className="hover:bg-slate-50/50 transition-colors">
              <td className="px-5 py-3 text-sm font-medium text-slate-700">{row.userName}</td>
              <td className="px-5 py-3 text-sm">
                <span className="inline-flex items-center rounded-full bg-primary-50 px-2.5 py-0.5 text-xs font-bold text-primary-700 ring-1 ring-primary-200/60">
                  {row.pendingCount}
                </span>
              </td>
              <td className="px-5 py-3 text-sm">
                <span
                  className={cn(
                    'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-bold',
                    row.oldestPendingDays > 30
                      ? 'bg-danger-50 text-danger-700 ring-1 ring-danger-200/60'
                      : row.oldestPendingDays > 14
                        ? 'bg-amber-50 text-amber-700 ring-1 ring-amber-200/60'
                        : 'bg-slate-100 text-slate-600 ring-1 ring-slate-200/60',
                  )}
                >
                  {row.oldestPendingDays}d
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }

  function renderUpcomingPayments() {
    const items = sla?.upcomingPayments ?? [];
    if (items.length === 0) return <EmptyTab />;
    return (
      <table className="min-w-full">
        <thead>
          <tr className="bg-slate-50 border-b border-slate-200/60">
            <SortHeader field="processCode">Processo</SortHeader>
            <SortHeader field="amountUsd">Valor USD</SortHeader>
            <SortHeader field="paymentDeadline">Vencimento</SortHeader>
            <SortHeader field="daysUntilDue">Dias Restantes</SortHeader>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {sorted(items, sortField as keyof SlaUpcomingPayments).map((row) => (
            <tr
              key={row.id}
              onClick={() => goToProcess(row.processId)}
              className={cn(
                'hover:bg-slate-50/50 cursor-pointer transition-colors',
                urgencyBg(row.daysUntilDue),
              )}
            >
              <td className="px-5 py-3 text-sm font-medium text-primary-600">{row.processCode}</td>
              <td className="px-5 py-3 text-sm font-medium text-slate-700">
                {formatCurrency(Number(row.amountUsd))}
              </td>
              <td className="px-5 py-3 text-sm text-slate-500">
                {row.paymentDeadline ? formatDate(row.paymentDeadline) : '--'}
              </td>
              <td className="px-5 py-3 text-sm">
                <span
                  className={cn(
                    'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-bold',
                    urgencyText(row.daysUntilDue),
                    row.daysUntilDue <= 0
                      ? 'bg-danger-50 ring-1 ring-danger-200/60'
                      : row.daysUntilDue <= 3
                        ? 'bg-amber-50 ring-1 ring-amber-200/60'
                        : 'bg-emerald-50 ring-1 ring-emerald-200/60',
                  )}
                >
                  {row.daysUntilDue <= 0
                    ? `${Math.abs(row.daysUntilDue)}d vencido`
                    : `${row.daysUntilDue}d`}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }

  function EmptyTab() {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 mb-4">
          <Clock className="h-5 w-5 text-slate-400" />
        </div>
        <p className="text-sm font-medium text-slate-500">Nenhuma pendência nesta categoria</p>
        <p className="text-xs text-slate-400 mt-1">Tudo em dia por aqui</p>
      </div>
    );
  }

  const tabRenderers: Record<TabKey, () => React.ReactNode> = {
    docsOverdue: renderDocsOverdue,
    liUrgent: renderLiUrgent,
    withDivergences: renderDivergences,
    pendingFenicia: renderPendingFenicia,
    noEspelho: renderNoEspelho,
    noFollowUpUpdate: renderNoFollowUpUpdate,
    agingByUser: renderAgingByUser,
    upcomingPayments: renderUpcomingPayments,
  };

  return (
    <div className="space-y-6">
      {/* Section Header */}
      <div>
        <h3 className="text-base font-semibold text-slate-900 tracking-tight">
          Painel SLA / Pendências
        </h3>
        <p className="mt-0.5 text-sm text-slate-500">
          Visão consolidada de todas as pendências e prazos
        </p>
      </div>

      {/* Metric Cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-4 xl:grid-cols-8 stagger-children">
        {tabConfig.map((card) => {
          const Icon = card.icon;
          const value = summary[card.key] ?? 0;
          const isActive = activeTab === card.key;

          return (
            <button
              key={card.key}
              onClick={() => {
                setActiveTab(card.key);
                setSortField('');
              }}
              className={cn(
                'group rounded-2xl border bg-white p-4 text-left transition-all duration-200',
                'hover:shadow-md',
                'border-l-4',
                card.borderColor,
                isActive ? 'ring-2 ring-primary-500/20 shadow-md border-primary-300' : 'shadow-sm',
              )}
            >
              <div className="flex items-center justify-between mb-2">
                <div
                  className={cn(
                    'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg',
                    'bg-gradient-to-br text-white shadow-sm',
                    card.gradient,
                  )}
                >
                  <Icon className="h-4 w-4" />
                </div>
                {value > 0 && (
                  <span
                    className={cn(
                      'text-[10px] font-bold uppercase tracking-wider',
                      severityColor(value),
                    )}
                  >
                    {value > 5 ? 'ALTO' : value > 0 ? 'ATIVO' : ''}
                  </span>
                )}
              </div>
              <p
                className={cn(
                  'text-xl font-bold tabular-nums',
                  value === 0 ? 'text-slate-300' : card.valueColor,
                )}
              >
                {value}
              </p>
              <p className="text-[11px] font-medium text-slate-400 mt-0.5 truncate">{card.label}</p>
            </button>
          );
        })}
      </div>

      {/* Tab Content */}
      <div className="rounded-2xl border border-slate-200/60 bg-white shadow-sm overflow-hidden">
        {/* Tab Bar */}
        <div className="flex items-center gap-1 px-4 pt-3 pb-0 overflow-x-auto">
          {tabConfig.map((tab) => {
            const isActive = activeTab === tab.key;
            const cnt = summary[tab.key] ?? 0;
            return (
              <button
                key={tab.key}
                onClick={() => {
                  setActiveTab(tab.key);
                  setSortField('');
                }}
                className={cn(
                  'inline-flex items-center gap-1.5 px-3 py-2 rounded-t-lg text-sm font-medium whitespace-nowrap transition-all border-b-2',
                  isActive
                    ? 'bg-slate-50 text-primary-700 border-primary-500'
                    : 'text-slate-500 hover:text-slate-700 hover:bg-slate-50 border-transparent',
                )}
              >
                {tab.label}
                {cnt > 0 && (
                  <span
                    className={cn(
                      'inline-flex items-center justify-center h-5 min-w-[20px] px-1.5 rounded-full text-[10px] font-bold',
                      isActive ? 'bg-primary-100 text-primary-700' : 'bg-slate-100 text-slate-500',
                    )}
                  >
                    {cnt}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Active Tab Content */}
        <div className="border-t border-slate-100">
          <div className="overflow-x-auto">{tabRenderers[activeTab]()}</div>
        </div>
      </div>
    </div>
  );
}
