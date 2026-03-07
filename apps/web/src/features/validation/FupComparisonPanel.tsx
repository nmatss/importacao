import { CheckCircle, XCircle, AlertTriangle, FileSearch } from 'lucide-react';
import { useApiQuery } from '@/shared/hooks/useApi';
import { cn } from '@/shared/lib/utils';
import { VALIDATION_CHECK_NAMES } from '@/shared/lib/constants';
import { LoadingSpinner } from '@/shared/components/LoadingSpinner';

const checkLabel = (name: string) =>
  VALIDATION_CHECK_NAMES.find((c) => c.value === name)?.description ?? name;

interface ValidationReport {
  processCode: string;
  brand: string;
  status: string;
  generatedAt: string;
  processData: {
    totalFobValue: string | null;
    freightValue: string | null;
    totalCbm: string | null;
    containerType: string | null;
  };
  summary: {
    total: number;
    passed: number;
    failed: number;
    warnings: number;
  };
  crossDocumentChecks: ValidationCheck[];
  systemChecks: ValidationCheck[];
}

interface ValidationCheck {
  id: number;
  checkName: string;
  status: 'passed' | 'failed' | 'warning' | 'skipped';
  expectedValue?: string | null;
  actualValue?: string | null;
  documentsCompared?: string | null;
  message?: string | null;
  dataSource?: string | null;
}

interface FupComparisonPanelProps {
  processId: string;
}

const statusIcon = {
  passed: { Icon: CheckCircle, color: 'text-green-500', bg: 'bg-green-50', border: 'border-green-200' },
  failed: { Icon: XCircle, color: 'text-red-500', bg: 'bg-red-50', border: 'border-red-200' },
  warning: { Icon: AlertTriangle, color: 'text-amber-500', bg: 'bg-amber-50', border: 'border-amber-200' },
  skipped: { Icon: AlertTriangle, color: 'text-slate-400', bg: 'bg-slate-50', border: 'border-slate-200' },
};

function CheckRow({ check }: { check: ValidationCheck }) {
  const config = statusIcon[check.status] || statusIcon.warning;
  const { Icon } = config;

  return (
    <tr className={cn('border-b last:border-b-0', config.bg)}>
      <td className="px-4 py-3 text-sm font-medium text-slate-900">
        <div className="flex items-center gap-2">
          <Icon className={cn('h-4 w-4 shrink-0', config.color)} />
          {checkLabel(check.checkName)}
        </div>
      </td>
      <td className="px-4 py-3 text-sm text-slate-600 font-mono">
        {check.expectedValue ?? '-'}
      </td>
      <td className={cn(
        'px-4 py-3 text-sm font-mono',
        check.status === 'failed' ? 'text-red-700 font-semibold' : 'text-slate-600',
      )}>
        {check.actualValue ?? '-'}
      </td>
      <td className="px-4 py-3 text-xs text-slate-500">
        {check.message}
      </td>
    </tr>
  );
}

export function FupComparisonPanel({ processId }: FupComparisonPanelProps) {
  const { data: report, isLoading } = useApiQuery<ValidationReport>(
    ['validation-report', processId],
    `/api/validation/${processId}/report`,
  );

  if (isLoading) return <LoadingSpinner className="py-8" />;

  if (!report) {
    return (
      <div className="flex flex-col items-center justify-center py-10 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-50 mb-3">
          <FileSearch className="h-6 w-6 text-slate-300" />
        </div>
        <p className="text-sm font-medium text-slate-400">Nenhum relatorio de validacao disponivel.</p>
        <p className="text-xs text-slate-300 mt-1">Execute a validacao primeiro.</p>
      </div>
    );
  }

  const hasSystemChecks = report.systemChecks.length > 0;
  const hasCrossChecks = report.crossDocumentChecks.length > 0;

  return (
    <div className="space-y-6">
      {/* Summary */}
      <div className="flex items-center gap-4 text-sm">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-green-100 px-3 py-1 font-medium text-green-700">
          <CheckCircle className="h-3.5 w-3.5" /> {report.summary.passed} passou
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-red-100 px-3 py-1 font-medium text-red-700">
          <XCircle className="h-3.5 w-3.5" /> {report.summary.failed} falhou
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-3 py-1 font-medium text-amber-700">
          <AlertTriangle className="h-3.5 w-3.5" /> {report.summary.warnings} avisos
        </span>
      </div>

      {/* System vs Document checks */}
      {hasSystemChecks && (
        <div className="rounded-xl border border-blue-200 overflow-hidden">
          <div className="bg-blue-50 px-4 py-3 border-b border-blue-200">
            <h4 className="text-sm font-semibold text-blue-900">
              Documentos vs Sistema
            </h4>
            <p className="text-xs text-blue-600 mt-0.5">
              Comparacao entre dados extraidos dos documentos e valores cadastrados no sistema
            </p>
          </div>
          <div className="overflow-x-auto">
          <table className="min-w-full">
            <thead>
              <tr className="bg-blue-50/50">
                <th className="px-4 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-blue-400">Verificacao</th>
                <th className="px-4 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-blue-400">Valor Sistema</th>
                <th className="px-4 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-blue-400">Valor Documento</th>
                <th className="px-4 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-blue-400">Mensagem</th>
              </tr>
            </thead>
            <tbody>
              {report.systemChecks.map((check) => (
                <CheckRow key={check.id} check={check} />
              ))}
            </tbody>
          </table>
          </div>
        </div>
      )}

      {/* Cross-document checks */}
      {hasCrossChecks && (
        <div className="rounded-xl border border-slate-200 overflow-hidden">
          <div className="bg-slate-50 px-4 py-3 border-b border-slate-200">
            <h4 className="text-sm font-semibold text-slate-900">
              Cruzamento entre Documentos
            </h4>
            <p className="text-xs text-slate-500 mt-0.5">
              Comparacao entre Invoice, Packing List e BL
            </p>
          </div>
          <div className="overflow-x-auto">
          <table className="min-w-full">
            <thead>
              <tr className="bg-slate-50/50">
                <th className="px-4 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400">Verificacao</th>
                <th className="px-4 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400">Esperado</th>
                <th className="px-4 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400">Encontrado</th>
                <th className="px-4 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400">Mensagem</th>
              </tr>
            </thead>
            <tbody>
              {report.crossDocumentChecks.map((check) => (
                <CheckRow key={check.id} check={check} />
              ))}
            </tbody>
          </table>
          </div>
        </div>
      )}

      {!hasSystemChecks && !hasCrossChecks && (
        <p className="text-center text-sm text-slate-500 py-4">
          Nenhuma validacao executada ainda.
        </p>
      )}
    </div>
  );
}
