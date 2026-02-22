import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { CertStatsCards } from '@/features/certificacoes/components/CertStatsCards';
import { CertStatusBadge } from '@/features/certificacoes/components/CertStatusBadge';
import { fetchCertReportDetail, getCertReportDownloadUrl } from '@/shared/lib/cert-api-client';
import { Download, Search, Loader2, ArrowLeft } from 'lucide-react';

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
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="p-6 text-center text-slate-500">Relatorio nao encontrado</div>
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

  const statuses = [...new Set(results.map((r) => r.status))];
  const brands = [...new Set(results.map((r) => r.brand))];

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link to="/certificacoes/relatorios" className="text-slate-500 hover:text-slate-700">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <h2 className="text-lg font-semibold text-slate-900 flex-1">{filename}</h2>
        <a
          href={getCertReportDownloadUrl(filename)}
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 transition-colors"
        >
          <Download className="w-4 h-4" />
          Download Excel
        </a>
      </div>

      <CertStatsCards
        data={{
          total: summary.total || results.length,
          ok: summary.ok || results.filter((r) => r.status === 'OK').length,
          missing: summary.missing || results.filter((r) => r.status === 'MISSING').length,
          inconsistent: summary.inconsistent || results.filter((r) => r.status === 'INCONSISTENT').length,
          not_found: summary.not_found || results.filter((r) => r.status === 'URL_NOT_FOUND').length,
        }}
      />

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            placeholder="Buscar SKU ou nome..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 rounded-lg border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm"
        >
          <option value="">Todos os status</option>
          {statuses.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <select
          value={brandFilter}
          onChange={(e) => setBrandFilter(e.target.value)}
          className="px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm"
        >
          <option value="">Todas as marcas</option>
          {brands.map((b) => (
            <option key={b} value={b}>{b}</option>
          ))}
        </select>
      </div>

      {/* Results Table */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="text-left px-4 py-3 font-medium text-slate-600">SKU</th>
                <th className="text-left px-4 py-3 font-medium text-slate-600">Nome</th>
                <th className="text-left px-4 py-3 font-medium text-slate-600">Marca</th>
                <th className="text-left px-4 py-3 font-medium text-slate-600">Status</th>
                <th className="text-left px-4 py-3 font-medium text-slate-600">Score</th>
                <th className="text-left px-4 py-3 font-medium text-slate-600">URL</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map((r, i) => (
                <tr key={i} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-mono text-slate-900">{r.sku}</td>
                  <td className="px-4 py-3 text-slate-700 max-w-[200px] truncate">{r.name}</td>
                  <td className="px-4 py-3 text-slate-600">{r.brand}</td>
                  <td className="px-4 py-3"><CertStatusBadge status={r.status} /></td>
                  <td className="px-4 py-3 text-slate-600">{r.score != null ? `${(r.score * 100).toFixed(0)}%` : '--'}</td>
                  <td className="px-4 py-3">
                    {r.url && (
                      <a href={r.url} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline text-xs truncate block max-w-[150px]">
                        Link
                      </a>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="px-4 py-3 border-t border-slate-100 text-xs text-slate-500">
          {filtered.length} de {results.length} resultados
        </div>
      </div>
    </div>
  );
}
