import { useState, useRef } from 'react';
import {
  Upload,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Package,
  FileSpreadsheet,
  ChevronDown,
  ChevronUp,
  Search,
  XCircle,
} from 'lucide-react';
import { useApiQuery } from '@/shared/hooks/useApi';
import { useQueryClient } from '@tanstack/react-query';
import { cn, formatDate } from '@/shared/lib/utils';
import { LoadingSpinner } from '@/shared/components/LoadingSpinner';

interface PreConsItem {
  id: number;
  processCode: string | null;
  orderDescription: string | null;
  etd: string | null;
  collection: string | null;
  portOfLoading: string | null;
  supplier: string | null;
  productName: string | null;
  itemCode: string | null;
  quantity: number | null;
  agreedPrice: string | null;
  ncmCode: string | null;
  amount: string | null;
  cbm: string | null;
  cargoReadyDate: string | null;
  eta: string | null;
  piNumber: string | null;
  sheetName: string | null;
  syncedAt: string;
}

interface SyncLog {
  id: number;
  source: string;
  fileName: string;
  sheetsProcessed: number;
  totalRows: number;
  created: number;
  updated: number;
  errors: number;
  details: Record<string, unknown> | null;
  syncedAt: string;
}

interface Divergence {
  processCode: string;
  field: string;
  preConsValue: string;
  systemValue: string;
  severity: 'info' | 'warning' | 'critical';
}

const fieldLabels: Record<string, string> = {
  totalFobValue: 'Valor FOB Total',
  totalCbm: 'CBM Total',
  etd: 'ETD',
};

const severityConfig = {
  critical: {
    bg: 'bg-red-50',
    border: 'border-red-200',
    text: 'text-red-700',
    badge: 'bg-red-100 text-red-700',
  },
  warning: {
    bg: 'bg-amber-50',
    border: 'border-amber-200',
    text: 'text-amber-700',
    badge: 'bg-amber-100 text-amber-700',
  },
  info: {
    bg: 'bg-blue-50',
    border: 'border-blue-200',
    text: 'text-blue-700',
    badge: 'bg-blue-100 text-blue-700',
  },
};

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB

function formatCurrency(value: string | null): string {
  if (!value) return '--';
  const num = Number(value);
  if (isNaN(num)) return '--';
  return num.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
      <XCircle className="h-4 w-4 shrink-0" />
      {message}
    </div>
  );
}

export function PreConsPage() {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState<{ success: boolean; message: string } | null>(
    null,
  );
  const [search, setSearch] = useState('');
  const [sheetFilter, setSheetFilter] = useState('');
  const [page, setPage] = useState(1);
  const [logsExpanded, setLogsExpanded] = useState(false);

  const {
    data: itemsResponse,
    isLoading: loadingItems,
    isError: itemsError,
  } = useApiQuery<{
    data: PreConsItem[];
    pagination: { total: number; page: number; limit: number; pages: number };
  }>(
    ['pre-cons-items', String(page), search, sheetFilter],
    `/api/pre-cons/items?page=${page}&limit=50${search ? `&processCode=${encodeURIComponent(search)}` : ''}${sheetFilter ? `&sheetName=${encodeURIComponent(sheetFilter)}` : ''}`,
  );

  const { data: sheetNames, isLoading: loadingSheets } = useApiQuery<string[]>(
    ['pre-cons-sheets'],
    '/api/pre-cons/sheets',
  );

  const {
    data: divergences,
    isLoading: loadingDivergences,
    isError: divergencesError,
  } = useApiQuery<Divergence[]>(['pre-cons-divergences'], '/api/pre-cons/divergences');

  const {
    data: syncLogs,
    isLoading: loadingLogs,
    isError: logsError,
  } = useApiQuery<SyncLog[]>(['pre-cons-sync-logs'], '/api/pre-cons/sync-logs');

  const items = itemsResponse?.data ?? [];
  const pagination = itemsResponse?.pagination;

  async function handleUpload(file: File) {
    // Client-side validation
    if (!/\.xlsx?$/i.test(file.name)) {
      setUploadResult({
        success: false,
        message: 'Apenas arquivos Excel (.xlsx, .xls) sao aceitos.',
      });
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      setUploadResult({ success: false, message: 'Arquivo excede o limite de 20MB.' });
      return;
    }

    setUploading(true);
    setUploadResult(null);
    try {
      const formData = new FormData();
      formData.append('file', file);

      const token = localStorage.getItem('importacao_token');
      if (!token) {
        setUploadResult({ success: false, message: 'Sessao expirada. Faca login novamente.' });
        return;
      }

      const res = await fetch('/api/pre-cons/sync', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });

      if (!res.ok) {
        const errorJson = await res.json().catch(() => null);
        setUploadResult({ success: false, message: errorJson?.error || `Erro ${res.status}` });
        return;
      }

      const json = await res.json();
      if (json.success) {
        setUploadResult({
          success: true,
          message: `${json.data.created} itens importados. ${json.data.divergences?.length ?? 0} divergencias encontradas.`,
        });
        queryClient.invalidateQueries({ queryKey: ['pre-cons-items'] });
        queryClient.invalidateQueries({ queryKey: ['pre-cons-divergences'] });
        queryClient.invalidateQueries({ queryKey: ['pre-cons-sync-logs'] });
        queryClient.invalidateQueries({ queryKey: ['pre-cons-sheets'] });
      } else {
        setUploadResult({ success: false, message: json.error || 'Erro ao sincronizar' });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erro de conexao';
      setUploadResult({ success: false, message });
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  const lastSync = syncLogs?.[0];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 tracking-tight">Pre-Conferencia</h1>
          <p className="text-sm text-slate-500 mt-1">
            Dados da planilha Pre_Cons KIOM — comparados automaticamente com o sistema
          </p>
        </div>

        <div className="flex items-center gap-3">
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleUpload(file);
            }}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className={cn(
              'flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition-all shadow-sm',
              uploading
                ? 'bg-slate-100 text-slate-400 cursor-not-allowed'
                : 'bg-blue-600 text-white hover:bg-blue-700 shadow-blue-200/50',
            )}
          >
            {uploading ? (
              <>
                <RefreshCw className="h-4 w-4 animate-spin" />
                Importando...
              </>
            ) : (
              <>
                <Upload className="h-4 w-4" />
                Upload XLSX
              </>
            )}
          </button>
        </div>
      </div>

      {/* Upload result */}
      {uploadResult && (
        <div
          className={cn(
            'flex items-center gap-3 rounded-xl border px-4 py-3 text-sm font-medium',
            uploadResult.success
              ? 'bg-green-50 border-green-200 text-green-700'
              : 'bg-red-50 border-red-200 text-red-700',
          )}
        >
          {uploadResult.success ? (
            <CheckCircle2 className="h-4 w-4 shrink-0" />
          ) : (
            <AlertTriangle className="h-4 w-4 shrink-0" />
          )}
          {uploadResult.message}
        </div>
      )}

      {/* Stats cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="rounded-xl border border-slate-200/80 bg-white p-4 shadow-sm">
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-500 uppercase tracking-wider">
            <Package className="h-3.5 w-3.5" />
            Total Itens
          </div>
          <p className="mt-2 text-2xl font-bold text-slate-800">
            {loadingItems ? '-' : (pagination?.total ?? 0)}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200/80 bg-white p-4 shadow-sm">
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-500 uppercase tracking-wider">
            <AlertTriangle className="h-3.5 w-3.5" />
            Divergencias
          </div>
          <p
            className={cn(
              'mt-2 text-2xl font-bold',
              (divergences?.length ?? 0) > 0 ? 'text-amber-600' : 'text-slate-800',
            )}
          >
            {loadingDivergences ? '-' : divergencesError ? '!' : (divergences?.length ?? 0)}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200/80 bg-white p-4 shadow-sm">
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-500 uppercase tracking-wider">
            <Clock className="h-3.5 w-3.5" />
            Ultimo Sync
          </div>
          <p className="mt-2 text-sm font-semibold text-slate-700">
            {loadingLogs ? '-' : lastSync ? formatDate(lastSync.syncedAt) : 'Nunca'}
          </p>
          {lastSync && (
            <p className="text-xs text-slate-400 mt-0.5">
              {lastSync.source} - {lastSync.fileName}
            </p>
          )}
        </div>
        <div className="rounded-xl border border-slate-200/80 bg-white p-4 shadow-sm">
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-500 uppercase tracking-wider">
            <FileSpreadsheet className="h-3.5 w-3.5" />
            Fonte
          </div>
          <p className="mt-2 text-sm font-semibold text-slate-700">
            {lastSync?.source === 'email'
              ? 'E-mail (auto)'
              : lastSync?.source === 'upload'
                ? 'Upload manual'
                : '-'}
          </p>
        </div>
      </div>

      {/* Divergences error */}
      {divergencesError && (
        <ErrorBanner message="Erro ao carregar divergencias. Verifique suas permissoes." />
      )}

      {/* Divergences */}
      {(divergences?.length ?? 0) > 0 && (
        <div className="rounded-xl border border-amber-200/80 bg-amber-50/50 p-4 space-y-3">
          <h3 className="text-sm font-bold text-amber-800 flex items-center gap-2">
            <AlertTriangle className="h-4 w-4" />
            Divergencias Encontradas ({divergences!.length})
          </h3>
          <div className="space-y-2">
            {divergences!.map((d, i) => {
              const cfg = severityConfig[d.severity];
              return (
                <div
                  key={i}
                  className={cn(
                    'flex flex-col sm:flex-row sm:items-center gap-2 rounded-lg border px-3 py-2',
                    cfg.bg,
                    cfg.border,
                  )}
                >
                  <span
                    className={cn(
                      'inline-flex rounded-md px-2 py-0.5 text-xs font-semibold',
                      cfg.badge,
                    )}
                  >
                    {d.severity}
                  </span>
                  <span className="text-sm font-semibold text-slate-800">{d.processCode}</span>
                  <span className="text-sm text-slate-600">
                    {fieldLabels[d.field] || d.field}: Pre-Cons <strong>{d.preConsValue}</strong> vs
                    Sistema <strong>{d.systemValue}</strong>
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Items table */}
      <div className="rounded-xl border border-slate-200/80 bg-white shadow-sm overflow-hidden">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
          <h3 className="text-sm font-bold text-slate-700">Itens Pre-Conferencia</h3>
          <div className="flex items-center gap-2">
            {loadingSheets ? (
              <div className="h-8 w-32 rounded-lg bg-slate-100 animate-pulse" />
            ) : (sheetNames?.length ?? 0) > 1 ? (
              <select
                value={sheetFilter}
                onChange={(e) => {
                  setSheetFilter(e.target.value);
                  setPage(1);
                }}
                className="text-sm border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-300 bg-white"
              >
                <option value="">Todas as abas</option>
                {sheetNames!.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            ) : null}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <input
                type="text"
                placeholder="Filtrar por processo..."
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
                className="pl-9 pr-3 py-1.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-300 w-48"
              />
            </div>
          </div>
        </div>

        {itemsError ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <XCircle className="h-8 w-8 text-red-300" />
            <p className="text-sm text-red-500 font-medium">Erro ao carregar itens.</p>
          </div>
        ) : loadingItems ? (
          <LoadingSpinner className="py-12" />
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100">
              <Package className="h-6 w-6 text-slate-300" />
            </div>
            <p className="text-sm text-slate-400 font-medium">
              {search
                ? 'Nenhum item encontrado para este processo.'
                : 'Nenhum dado de Pre-Conferencia importado.'}
            </p>
            {!search && (
              <p className="text-xs text-slate-400">
                Faca o upload da planilha XLSX ou aguarde o sync automatico por e-mail.
              </p>
            )}
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-100 text-sm">
                <thead className="bg-slate-50/80">
                  <tr>
                    <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                      Processo
                    </th>
                    <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                      Fornecedor
                    </th>
                    <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                      Produto
                    </th>
                    <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                      Cod. Item
                    </th>
                    <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase tracking-wider text-slate-500">
                      Qtd
                    </th>
                    <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase tracking-wider text-slate-500">
                      Valor
                    </th>
                    <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                      NCM
                    </th>
                    <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                      ETD
                    </th>
                    <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                      ETA
                    </th>
                    <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                      Aba
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {items.map((item) => (
                    <tr key={item.id} className="hover:bg-slate-50/50 transition-colors">
                      <td className="px-3 py-2 font-semibold text-blue-700">
                        {item.processCode || <span className="text-slate-300">--</span>}
                      </td>
                      <td
                        className="px-3 py-2 text-slate-600 max-w-[140px] truncate"
                        title={item.supplier ?? ''}
                      >
                        {item.supplier || '--'}
                      </td>
                      <td
                        className="px-3 py-2 text-slate-700 max-w-[180px] truncate"
                        title={item.productName ?? ''}
                      >
                        {item.productName || '--'}
                      </td>
                      <td className="px-3 py-2 font-mono text-xs text-slate-600">
                        {item.itemCode || '--'}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-slate-700">
                        {item.quantity?.toLocaleString('pt-BR') ?? '--'}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-slate-700">
                        {formatCurrency(item.amount)}
                      </td>
                      <td className="px-3 py-2 font-mono text-xs text-slate-600">
                        {item.ncmCode || '--'}
                      </td>
                      <td className="px-3 py-2 text-slate-600">{item.etd || '--'}</td>
                      <td className="px-3 py-2 text-slate-600">{item.eta || '--'}</td>
                      <td className="px-3 py-2">
                        <span className="inline-flex rounded-md px-2 py-0.5 text-xs font-medium bg-slate-100 text-slate-600">
                          {item.sheetName || '--'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {pagination && pagination.pages > 1 && (
              <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3">
                <p className="text-xs text-slate-500">
                  Pagina {pagination.page} de {pagination.pages} ({pagination.total} itens)
                </p>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page <= 1}
                    className="rounded-lg px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    Anterior
                  </button>
                  <button
                    onClick={() => setPage((p) => Math.min(pagination.pages, p + 1))}
                    disabled={page >= pagination.pages}
                    className="rounded-lg px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    Proximo
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Sync logs */}
      <div className="rounded-xl border border-slate-200/80 bg-white shadow-sm overflow-hidden">
        <button
          onClick={() => setLogsExpanded(!logsExpanded)}
          className="flex items-center justify-between w-full px-4 py-3 text-sm font-bold text-slate-700 hover:bg-slate-50/50 transition-colors"
        >
          <span>Historico de Sincronizacao ({syncLogs?.length ?? 0})</span>
          {logsExpanded ? (
            <ChevronUp className="h-4 w-4 text-slate-400" />
          ) : (
            <ChevronDown className="h-4 w-4 text-slate-400" />
          )}
        </button>

        {logsExpanded &&
          (logsError ? (
            <div className="px-4 pb-4">
              <ErrorBanner message="Erro ao carregar historico. Verifique suas permissoes." />
            </div>
          ) : loadingLogs ? (
            <LoadingSpinner className="py-8" />
          ) : (syncLogs?.length ?? 0) === 0 ? (
            <p className="px-4 pb-4 text-sm text-slate-400">Nenhum sync realizado.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-100 text-sm">
                <thead className="bg-slate-50/80">
                  <tr>
                    <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                      Data
                    </th>
                    <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                      Fonte
                    </th>
                    <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                      Arquivo
                    </th>
                    <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wider text-slate-500">
                      Itens
                    </th>
                    <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wider text-slate-500">
                      Erros
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {syncLogs!.map((log) => (
                    <tr key={log.id} className="hover:bg-slate-50/50 transition-colors">
                      <td className="px-3 py-2 text-slate-600">{formatDate(log.syncedAt)}</td>
                      <td className="px-3 py-2">
                        <span
                          className={cn(
                            'inline-flex rounded-md px-2 py-0.5 text-xs font-semibold',
                            log.source === 'email'
                              ? 'bg-blue-100 text-blue-700'
                              : 'bg-slate-100 text-slate-600',
                          )}
                        >
                          {log.source === 'email' ? 'E-mail' : 'Upload'}
                        </span>
                      </td>
                      <td
                        className="px-3 py-2 text-slate-700 max-w-[200px] truncate"
                        title={log.fileName}
                      >
                        {log.fileName}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-slate-700">
                        {log.created}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <span
                          className={cn(
                            'font-mono',
                            log.errors > 0 ? 'text-red-600 font-semibold' : 'text-slate-400',
                          )}
                        >
                          {log.errors}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
      </div>
    </div>
  );
}
