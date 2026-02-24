import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { CertStatsCards } from '@/features/certificacoes/components/CertStatsCards';
import { CertStatusBadge } from '@/features/certificacoes/components/CertStatusBadge';
import { fetchCertReportDetail, getCertReportDownloadUrl } from '@/shared/lib/cert-api-client';
import { Download, Search, Loader2, ArrowLeft, FileSpreadsheet, ExternalLink, Filter } from 'lucide-react';

interface CertReportResult {
  sku: string;
  name: string;
  brand: string;
  status: string;
  score: number | null;
  url: string | null;
}

interface CertReportData {
  results: CertReportResult[];
  summary: {
    total: number;
    ok: number;
    missing: number;
    inconsistent: number;
    not_found: number;
  };
}

export default function CertRelatorioDetailPage() {
  const { id } = useParams();
  const filename = decodeURIComponent(id || '');
  const [data, setData] = useState<CertReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [brandFilter, setBrandFilter] = useState('');

  useEffect(() => {
    fetchCertReportDetail(filename)
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [filename]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3">
        <Loader2 className="w-7 h-7 animate-spin text-emerald-500" />
        <p className="text-sm text-slate-400">Carregando relatório...</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <div className="flex items-center justify-center w-16 h-16 rounded-2xl bg-slate-100 mb-4">
          <FileSpreadsheet className="w-8 h-8 text-slate-300" />
        </div>
        <p className="text-base font-semibold text-slate-900 mb-1">Relatório não encontrado</p>
        <p className="text-sm text-slate-400 mb-4">O arquivo solicitado não existe ou foi removido</p>
        <Link
          to="/certificacoes/relatorios"
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Voltar aos relatórios
        </Link>
      </div>
    );
  }

  const results = data.results || [];
  const summary = data.summary || { total: 0, ok: 0, missing: 0, inconsistent: 0, not_found: 0 };

  const filtered = results.filter((r: CertReportResult) => {
    if (search) {
      const q = search.toLowerCase();
      if (!r.sku?.toLowerCase().includes(q) && !r.name?.toLowerCase().includes(q)) return false;
    }
    if (statusFilter && r.status !== statusFilter) return false;
    if (brandFilter && r.brand !== brandFilter) return false;
    return true;
  });

  const STATUS_LABELS: Record<string, string> = {
    OK: 'Conforme',
    MISSING: 'Ausente',
    INCONSISTENT: 'Inconsistente',
    URL_NOT_FOUND: 'Não Encontrado',
    API_ERROR: 'Erro de API',
    NO_EXPECTED: 'Sem Certificação',
  };
  const statuses = [...new Set(results.map((r) => r.status))];
  const brands = [...new Set(results.map((r) => r.brand))];
  const hasActiveFilters = search || statusFilter || brandFilter;

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-4 min-w-0">
          <Link
            to="/certificacoes/relatorios"
            className="flex items-center justify-center w-10 h-10 rounded-xl bg-slate-100 text-slate-500 hover:bg-slate-200 hover:text-slate-700 transition-colors flex-shrink-0"
          >
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div className="min-w-0">
            <h1 className="text-xl font-bold text-slate-900 truncate">{filename}</h1>
            <p className="text-sm text-slate-400 mt-0.5">Detalhes do relatório de validação</p>
          </div>
        </div>
        <a
          href={getCertReportDownloadUrl(filename)}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-emerald-600 to-emerald-700 text-white text-sm font-semibold shadow-sm hover:shadow-md hover:from-emerald-700 hover:to-emerald-800 active:scale-[0.98] transition-all flex-shrink-0"
        >
          <Download className="w-4 h-4" />
          Baixar Relatório
        </a>
      </div>

      {/* Stats Cards */}
      <CertStatsCards
        data={{
          total: summary.total || results.length,
          ok: summary.ok || results.filter((r) => r.status === 'OK').length,
          missing: summary.missing || results.filter((r) => r.status === 'MISSING').length,
          inconsistent: summary.inconsistent || results.filter((r) => r.status === 'INCONSISTENT').length,
          not_found: summary.not_found || results.filter((r) => r.status === 'URL_NOT_FOUND').length,
        }}
      />

      {/* Filters Card */}
      <div className="rounded-2xl border border-slate-200/80 shadow-sm bg-white p-4">
        <div className="flex items-center gap-2 mb-3">
          <Filter className="w-4 h-4 text-slate-400" />
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Filtros</span>
          {hasActiveFilters && (
            <button
              onClick={() => { setSearch(''); setStatusFilter(''); setBrandFilter(''); }}
              className="ml-auto text-xs text-emerald-600 hover:text-emerald-700 font-medium transition-colors"
            >
              Limpar filtros
            </button>
          )}
        </div>
        <div className="flex flex-wrap gap-3">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              placeholder="Buscar por SKU ou nome..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-200 bg-white text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/20 transition-all"
            />
          </div>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-4 py-2.5 rounded-xl border border-slate-200 bg-white text-sm text-slate-700 focus:outline-none focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/20 transition-all min-w-[160px]"
          >
            <option value="">Todos os status</option>
            {statuses.map((s) => (
              <option key={s} value={s}>{STATUS_LABELS[s] || s}</option>
            ))}
          </select>
          <select
            value={brandFilter}
            onChange={(e) => setBrandFilter(e.target.value)}
            className="px-4 py-2.5 rounded-xl border border-slate-200 bg-white text-sm text-slate-700 focus:outline-none focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/20 transition-all min-w-[160px]"
          >
            <option value="">Todas as marcas</option>
            {brands.map((b) => (
              <option key={b} value={b}>{b}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Results Table */}
      <div className="rounded-2xl border border-slate-200/80 shadow-sm bg-white overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50/80 border-b border-slate-200">
                <th className="text-left px-5 py-3.5 font-semibold text-xs text-slate-500 uppercase tracking-wider">SKU</th>
                <th className="text-left px-5 py-3.5 font-semibold text-xs text-slate-500 uppercase tracking-wider">Nome</th>
                <th className="text-left px-5 py-3.5 font-semibold text-xs text-slate-500 uppercase tracking-wider">Marca</th>
                <th className="text-left px-5 py-3.5 font-semibold text-xs text-slate-500 uppercase tracking-wider">Status</th>
                <th className="text-left px-5 py-3.5 font-semibold text-xs text-slate-500 uppercase tracking-wider">Pontuação</th>
                <th className="text-left px-5 py-3.5 font-semibold text-xs text-slate-500 uppercase tracking-wider">URL</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-5 py-12 text-center">
                    <p className="text-sm text-slate-400">Nenhum resultado encontrado com os filtros aplicados</p>
                  </td>
                </tr>
              ) : (
                filtered.map((r, i) => (
                  <tr key={i} className="hover:bg-slate-50 transition-colors">
                    <td className="px-5 py-3.5 font-mono text-sm font-medium text-slate-900">{r.sku}</td>
                    <td className="px-5 py-3.5 text-slate-700 max-w-[220px] truncate">{r.name}</td>
                    <td className="px-5 py-3.5 text-slate-600">{r.brand}</td>
                    <td className="px-5 py-3.5"><CertStatusBadge status={r.status} /></td>
                    <td className="px-5 py-3.5">
                      {r.score != null ? (
                        <span className={`text-sm font-semibold ${
                          r.score >= 0.8 ? 'text-emerald-600' : r.score >= 0.5 ? 'text-amber-600' : 'text-red-600'
                        }`}>
                          {(r.score * 100).toFixed(0)}%
                        </span>
                      ) : (
                        <span className="text-slate-300">--</span>
                      )}
                    </td>
                    <td className="px-5 py-3.5">
                      {r.url && (
                        <a
                          href={r.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-emerald-600 hover:text-emerald-700 text-xs font-medium transition-colors"
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                          Abrir
                        </a>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Footer */}
        <div className="px-5 py-3.5 border-t border-slate-100 bg-slate-50/50 flex items-center justify-between">
          <span className="text-xs font-medium text-slate-500">
            {filtered.length} de {results.length} resultados
          </span>
          {hasActiveFilters && (
            <span className="text-xs text-slate-400">
              {results.length - filtered.length} ocultos pelos filtros
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
