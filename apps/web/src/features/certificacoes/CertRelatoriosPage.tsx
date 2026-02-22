import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchCertReports, getCertReportDownloadUrl } from '@/shared/lib/cert-api-client';
import { formatDateTime } from '@/shared/lib/utils';
import { FileSpreadsheet, Download, Eye, Loader2 } from 'lucide-react';

export default function CertRelatoriosPage() {
  const [reports, setReports] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchCertReports()
      .then((data) => setReports(Array.isArray(data) ? data : []))
      .catch(() => setReports([]))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div>
      <div className="bg-white rounded-xl border border-slate-200">
        <div className="p-4 border-b border-slate-100">
          <h2 className="text-sm font-semibold text-slate-900">
            Historico de Validacoes
          </h2>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 text-slate-400 animate-spin" />
          </div>
        ) : reports.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-slate-400">
            <FileSpreadsheet className="w-10 h-10 mb-2" />
            <p className="text-sm">Nenhum relatorio encontrado</p>
            <p className="text-xs mt-1">Execute uma validacao para gerar relatorios</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {reports.map((report: any, i: number) => (
              <div key={i} className="flex items-center justify-between p-4 hover:bg-slate-50 transition-colors">
                <div className="flex items-center gap-3">
                  <FileSpreadsheet className="w-5 h-5 text-emerald-600" />
                  <div>
                    <p className="text-sm font-medium text-slate-900">
                      {report.filename}
                    </p>
                    <p className="text-xs text-slate-500">
                      {report.date ? formatDateTime(report.date) : ''}
                      {report.size_bytes ? ` - ${(report.size_bytes / 1024).toFixed(1)} KB` : ''}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Link
                    to={`/certificacoes/relatorios/${encodeURIComponent(report.filename)}`}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 transition-colors"
                  >
                    <Eye className="w-3.5 h-3.5" />
                    Ver
                  </Link>
                  <a
                    href={getCertReportDownloadUrl(report.filename)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 transition-colors"
                  >
                    <Download className="w-3.5 h-3.5" />
                    Excel
                  </a>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
