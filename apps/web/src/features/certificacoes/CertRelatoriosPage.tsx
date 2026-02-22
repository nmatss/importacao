import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchCertReports, getCertReportDownloadUrl } from '@/shared/lib/cert-api-client';
import { formatDateTime } from '@/shared/lib/utils';
import { FileSpreadsheet, Download, Eye, Loader2, FileText } from 'lucide-react';

interface CertReportFile {
  filename: string;
  date?: string;
  size_bytes?: number;
}

export default function CertRelatoriosPage() {
  const [reports, setReports] = useState<CertReportFile[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchCertReports()
      .then((data) => setReports(Array.isArray(data) ? data : []))
      .catch(() => setReports([]))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex items-center gap-4">
        <div className="flex items-center justify-center w-12 h-12 rounded-2xl bg-gradient-to-br from-emerald-500 to-emerald-700 text-white shadow-lg shadow-emerald-500/25">
          <FileSpreadsheet className="w-6 h-6" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-slate-900">Historico de Validacoes</h1>
          <p className="text-sm text-slate-500">Relatorios gerados pelas validacoes de certificacoes</p>
        </div>
      </div>

      {/* Reports Card */}
      <div className="rounded-2xl border border-slate-200/80 shadow-sm bg-white overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="flex flex-col items-center gap-3">
              <Loader2 className="w-7 h-7 text-emerald-500 animate-spin" />
              <p className="text-sm text-slate-400">Carregando relatorios...</p>
            </div>
          </div>
        ) : reports.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 px-6">
            <div className="flex items-center justify-center w-16 h-16 rounded-2xl bg-slate-100 mb-4">
              <FileText className="w-8 h-8 text-slate-300" />
            </div>
            <p className="text-base font-semibold text-slate-900 mb-1">Nenhum relatorio encontrado</p>
            <p className="text-sm text-slate-400 text-center max-w-sm">
              Execute uma validacao de certificacoes para gerar relatorios automaticamente
            </p>
          </div>
        ) : (
          <>
            {/* Table Header */}
            <div className="px-6 py-3.5 bg-slate-50/80 border-b border-slate-100">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  {reports.length} {reports.length === 1 ? 'relatorio' : 'relatorios'}
                </span>
              </div>
            </div>

            {/* Report Items */}
            <div className="divide-y divide-slate-100">
              {reports.map((report, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between px-6 py-4 hover:bg-slate-50 transition-colors group"
                >
                  <div className="flex items-center gap-4 min-w-0 flex-1">
                    <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 flex-shrink-0 group-hover:bg-emerald-100 transition-colors">
                      <FileSpreadsheet className="w-5 h-5" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-900 truncate">
                        {report.filename}
                      </p>
                      <div className="flex items-center gap-2 mt-0.5">
                        {report.date && (
                          <span className="text-xs text-slate-400">
                            {formatDateTime(report.date)}
                          </span>
                        )}
                        {report.date && report.size_bytes && (
                          <span className="text-slate-200">|</span>
                        )}
                        {report.size_bytes && (
                          <span className="text-xs text-slate-400">
                            {(report.size_bytes / 1024).toFixed(1)} KB
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 flex-shrink-0 ml-4">
                    <Link
                      to={`/certificacoes/relatorios/${encodeURIComponent(report.filename)}`}
                      className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 transition-colors"
                    >
                      <Eye className="w-3.5 h-3.5" />
                      Visualizar
                    </Link>
                    <a
                      href={getCertReportDownloadUrl(report.filename)}
                      className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 transition-colors"
                    >
                      <Download className="w-3.5 h-3.5" />
                      Excel
                    </a>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
