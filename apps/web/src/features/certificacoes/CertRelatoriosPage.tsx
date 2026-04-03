import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { fetchCertReports, getCertReportDownloadUrl } from '@/shared/lib/cert-api-client';
import { cn, formatDateTime } from '@/shared/lib/utils';
import {
  FileSpreadsheet,
  Eye,
  Loader2,
  FileText,
  Filter,
  AlertTriangle,
  CalendarX2,
  Warehouse,
  ClipboardList,
  RefreshCw,
  FileJson,
  Table,
} from 'lucide-react';

interface CertReportFile {
  filename: string;
  date?: string;
  size_bytes?: number;
}

const CERT_BASE = '/cert-api';

const EXPORT_TYPES = [
  {
    id: 'all',
    label: 'Todos os Produtos',
    description: 'Relatorio completo com status, estoque e certificacoes',
    icon: ClipboardList,
    color: 'from-emerald-600 to-emerald-700',
    shadow: 'shadow-sm',
    params: {},
  },
  {
    id: 'problems',
    label: 'Problemas (Nao Encontrado + Inconsistente)',
    description: 'Apenas produtos com problemas de certificacao',
    icon: AlertTriangle,
    color: 'from-amber-500 to-amber-600',
    shadow: 'shadow-sm',
    params: { status: 'URL_NOT_FOUND,INCONSISTENT' },
  },
  {
    id: 'expired',
    label: 'Vencidos / Em Encerramento',
    description: 'Produtos com certificacao vencida ou em fase de encerramento',
    icon: CalendarX2,
    color: 'from-pink-500 to-pink-600',
    shadow: 'shadow-sm',
    params: { status: 'EXPIRED' },
  },
  {
    id: 'stock',
    label: 'Estoque Detalhado (WMS + E-commerce)',
    description: 'Estoque aberto por localizacao: CD Biguacu (Picking, Armazem, etc) + Extrema MG',
    icon: Warehouse,
    color: 'from-emerald-600 to-emerald-700',
    shadow: 'shadow-sm',
    params: {},
    exportUrl: '/api/reports/export-stock',
  },
] as const;

const BRAND_OPTIONS = [
  { value: '', label: 'Todas as marcas' },
  { value: 'imaginarium', label: 'Imaginarium' },
  { value: 'puket', label: 'Puket' },
  { value: 'puket_escolares', label: 'Puket Escolares' },
];

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function CertRelatoriosPage() {
  const [reports, setReports] = useState<CertReportFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState<string | null>(null);
  const [brandFilter, setBrandFilter] = useState('');
  const [syncing, setSyncing] = useState(false);

  const loadReports = useCallback(() => {
    setLoading(true);
    fetchCertReports()
      .then((data) => setReports(Array.isArray(data) ? data : []))
      .catch(() => setReports([]))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    loadReports();
  }, [loadReports]);

  async function handleExport(exportType: (typeof EXPORT_TYPES)[number]) {
    setExporting(exportType.id);
    try {
      const params: Record<string, string> = { ...exportType.params };
      if (brandFilter) params.brand = brandFilter;

      const query = new URLSearchParams(params).toString();
      const baseExportUrl = (exportType as any).exportUrl || '/api/reports/export';
      const url = `${CERT_BASE}${baseExportUrl}${query ? `?${query}` : ''}`;

      const res = await fetch(url, { method: 'POST' });
      if (!res.ok) throw new Error('Erro ao gerar relatorio');

      const blob = await res.blob();
      const filename =
        res.headers.get('content-disposition')?.match(/filename="?(.+)"?/)?.[1] ||
        `relatorio_${exportType.id}_${new Date().toISOString().slice(0, 10)}.xlsx`;

      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      a.click();
      URL.revokeObjectURL(a.href);

      toast.success(`Relatorio "${exportType.label}" exportado`);
      loadReports();
    } catch (err: any) {
      toast.error(err.message || 'Erro ao gerar relatorio');
    } finally {
      setExporting(null);
    }
  }

  async function handleSyncStock() {
    setSyncing(true);
    try {
      const res = await fetch(`${CERT_BASE}/api/sync-stock`, { method: 'POST' });
      const data = await res.json();
      if (data.errors?.length) {
        toast.warning(`Sync parcial: ${data.errors.join(', ')}`);
      } else {
        toast.success(
          `Estoque sincronizado: WMS ${data.wms?.toLocaleString('pt-BR') ?? 0} | Puket ${data.ecommerce_puket?.toLocaleString('pt-BR') ?? 0} | IMG ${data.ecommerce_imaginarium?.toLocaleString('pt-BR') ?? 0}`,
        );
      }
    } catch {
      toast.error('Erro ao sincronizar estoque');
    } finally {
      setSyncing(false);
    }
  }

  function handleDownloadJson(filename: string) {
    const url = `${CERT_BASE}/api/reports/${encodeURIComponent(filename)}?format=json`;
    window.open(url, '_blank');
  }

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="flex items-center justify-center w-12 h-12 rounded-2xl bg-gradient-to-br from-emerald-500 to-emerald-700 text-white shadow-sm">
            <FileSpreadsheet className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900">Relatorios</h1>
            <p className="text-sm text-slate-500">
              Exporte dados de certificacao, estoque e validacao
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleSyncStock}
            disabled={syncing}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-emerald-200 bg-emerald-50 text-sm font-semibold text-emerald-700 hover:bg-emerald-100 transition-all disabled:opacity-50"
          >
            {syncing ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <RefreshCw className="w-4 h-4" />
            )}
            {syncing ? 'Sincronizando...' : 'Sync Estoque'}
          </button>
        </div>
      </div>

      {/* Export Cards */}
      <div className="rounded-2xl border border-slate-200/60 bg-white shadow-sm p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-slate-400" />
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
              Gerar Novo Relatorio
            </span>
          </div>
          <select
            value={brandFilter}
            onChange={(e) => setBrandFilter(e.target.value)}
            className="text-xs font-medium rounded-lg border border-slate-200 px-3 py-1.5 text-slate-600 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
          >
            {BRAND_OPTIONS.map((b) => (
              <option key={b.value} value={b.value}>
                {b.label}
              </option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {EXPORT_TYPES.map((et) => {
            const Icon = et.icon;
            const isExporting = exporting === et.id;
            return (
              <button
                key={et.id}
                onClick={() => handleExport(et)}
                disabled={!!exporting}
                className={cn(
                  'group relative flex flex-col items-start gap-2 rounded-xl p-4 text-left transition-all',
                  'border-2 border-transparent hover:border-slate-200',
                  isExporting && 'opacity-70 cursor-wait',
                  !exporting && 'hover:shadow-md active:scale-[0.98]',
                )}
              >
                <div
                  className={cn(
                    'flex items-center justify-center w-10 h-10 rounded-xl bg-gradient-to-br text-white shadow-md',
                    et.color,
                    et.shadow,
                  )}
                >
                  {isExporting ? (
                    <Loader2 className="w-5 h-5 animate-spin" />
                  ) : (
                    <Icon className="w-5 h-5" />
                  )}
                </div>
                <div>
                  <p className="text-sm font-bold text-slate-800">{et.label}</p>
                  <p className="text-[11px] text-slate-400 mt-0.5 leading-tight">
                    {et.description}
                  </p>
                </div>
                <div className="flex items-center gap-1 mt-1">
                  <FileSpreadsheet className="w-3 h-3 text-slate-400" />
                  <span className="text-[10px] font-semibold text-slate-400 uppercase">
                    {isExporting ? 'Gerando...' : 'Excel (.xlsx)'}
                  </span>
                  {brandFilter && (
                    <span className="text-[10px] font-medium text-violet-500 ml-1">
                      {BRAND_OPTIONS.find((b) => b.value === brandFilter)?.label}
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Reports History */}
      <div className="rounded-2xl border border-slate-200/60 shadow-sm bg-white overflow-hidden">
        <div className="px-6 py-3.5 bg-slate-50/80 border-b border-slate-100 flex items-center justify-between">
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
            Relatorios Gerados
            {reports.length > 0 && (
              <span className="ml-2 text-slate-400 font-normal">({reports.length})</span>
            )}
          </span>
          <button
            onClick={loadReports}
            className="text-xs text-slate-400 hover:text-slate-600 transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-6 h-6 text-emerald-500 animate-spin" />
          </div>
        ) : reports.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 px-6">
            <div className="flex items-center justify-center w-14 h-14 rounded-2xl bg-slate-100 mb-3">
              <FileText className="w-7 h-7 text-slate-300" />
            </div>
            <p className="text-sm font-semibold text-slate-500">Nenhum relatorio gerado</p>
            <p className="text-xs text-slate-400 mt-1">Execute uma validacao ou exporte acima</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {reports.map((report, i) => (
              <div
                key={i}
                className="flex items-center justify-between px-5 py-3.5 hover:bg-slate-50/60 transition-colors group"
              >
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-emerald-50 text-emerald-600 shrink-0 group-hover:bg-emerald-100 transition-colors">
                    <FileSpreadsheet className="w-4 h-4" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-800 truncate">
                      {report.filename.replace('.json', '')}
                    </p>
                    <div className="flex items-center gap-2 mt-0.5 text-[11px] text-slate-400">
                      {report.date && <span>{formatDateTime(report.date)}</span>}
                      {report.size_bytes && (
                        <>
                          <span className="text-slate-200">|</span>
                          <span>{formatSize(report.size_bytes)}</span>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-1.5 shrink-0 ml-3">
                  <Link
                    to={`/certificacoes/relatorios/${encodeURIComponent(report.filename)}`}
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-[11px] font-semibold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 transition-colors"
                  >
                    <Eye className="w-3 h-3" />
                    Ver
                  </Link>
                  <a
                    href={getCertReportDownloadUrl(report.filename)}
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-[11px] font-semibold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 transition-colors"
                  >
                    <Table className="w-3 h-3" />
                    Excel
                  </a>
                  <button
                    onClick={() => handleDownloadJson(report.filename)}
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-[11px] font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 transition-colors"
                  >
                    <FileJson className="w-3 h-3" />
                    JSON
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
