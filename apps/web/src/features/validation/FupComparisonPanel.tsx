import { CheckCircle, XCircle, AlertTriangle, FileSearch, Play } from 'lucide-react';
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
  passed: {
    Icon: CheckCircle,
    color: 'text-emerald-500',
    bg: 'bg-emerald-50',
    border: 'border-emerald-200',
  },
  failed: {
    Icon: XCircle,
    color: 'text-danger-500',
    bg: 'bg-danger-50',
    border: 'border-danger-200',
  },
  warning: {
    Icon: AlertTriangle,
    color: 'text-amber-500',
    bg: 'bg-amber-50',
    border: 'border-amber-200',
  },
  skipped: {
    Icon: AlertTriangle,
    color: 'text-slate-400',
    bg: 'bg-slate-50 dark:bg-slate-900',
    border: 'border-slate-200 dark:border-slate-600',
  },
};

function CheckRow({ check, index }: { check: ValidationCheck; index: number }) {
  const config = statusIcon[check.status] || statusIcon.warning;
  const { Icon } = config;

  return (
    <tr
      className={cn(
        'border-b border-slate-100 dark:border-slate-700 last:border-b-0 transition-colors hover:bg-primary-50/40 dark:hover:bg-primary-950/20',
        index % 2 === 0 ? '' : 'bg-slate-50 dark:bg-slate-900',
        check.status === 'failed' && 'bg-danger-50/40 dark:bg-danger-950/20',
      )}
    >
      <td className="px-3 py-2.5 sm:px-5 sm:py-3.5 text-sm font-medium text-slate-900 dark:text-slate-100">
        <div className="flex items-center gap-2">
          <Icon className={cn('h-4 w-4 shrink-0', config.color)} />
          {checkLabel(check.checkName)}
        </div>
      </td>
      <td className="px-3 py-2.5 sm:px-5 sm:py-3.5 text-sm text-slate-600 dark:text-slate-400 font-mono">
        {check.expectedValue ?? '-'}
      </td>
      <td
        className={cn(
          'px-3 py-2.5 sm:px-5 sm:py-3.5 text-sm font-mono',
          check.status === 'failed'
            ? 'text-danger-700 font-semibold'
            : 'text-slate-600 dark:text-slate-400',
        )}
      >
        {check.actualValue ?? '-'}
      </td>
      <td className="px-3 py-2.5 sm:px-5 sm:py-3.5 text-xs text-slate-500 dark:text-slate-400">
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
      <div className="flex flex-col items-center justify-center py-14 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary-50 dark:bg-primary-950/30 border border-primary-100 dark:border-primary-800 mb-4">
          <FileSearch className="h-7 w-7 text-primary-400" />
        </div>
        <p className="text-sm font-semibold text-slate-600 dark:text-slate-400">
          Nenhum relatorio de validacao disponivel
        </p>
        <p className="text-xs text-slate-400 mt-1 mb-4">
          Rode a Validacao primeiro para ver o comparativo.
        </p>
        <div className="inline-flex items-center gap-2 rounded-lg bg-primary-600 px-5 py-2.5 text-sm font-medium text-white cursor-default">
          <Play className="h-4 w-4" />
          Rode a Validacao primeiro
        </div>
      </div>
    );
  }

  const hasSystemChecks = report.systemChecks.length > 0;
  const hasCrossChecks = report.crossDocumentChecks.length > 0;

  return (
    <div className="space-y-6">
      {/* Summary */}
      <div className="flex flex-wrap items-center gap-3 sm:gap-4 text-sm">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-3 py-1 font-medium text-emerald-700">
          <CheckCircle className="h-3.5 w-3.5" /> {report.summary.passed} passou
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-danger-100 px-3 py-1 font-medium text-danger-700">
          <XCircle className="h-3.5 w-3.5" /> {report.summary.failed} falhou
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-3 py-1 font-medium text-amber-700">
          <AlertTriangle className="h-3.5 w-3.5" /> {report.summary.warnings} avisos
        </span>
      </div>

      {/* System vs Document checks */}
      {hasSystemChecks && (
        <div className="rounded-xl border border-primary-200 dark:border-primary-800 overflow-hidden">
          <div className="bg-primary-50 dark:bg-primary-950/30 px-4 py-3 border-b border-primary-200 dark:border-primary-800">
            <h4 className="text-sm font-semibold text-primary-900 dark:text-primary-300">
              Documentos vs Sistema
            </h4>
            <p className="text-xs text-primary-600 dark:text-primary-400 mt-0.5">
              Comparacao entre dados extraidos dos documentos e valores cadastrados no sistema
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full">
              <thead>
                <tr className="bg-primary-50/50 dark:bg-primary-950/30">
                  <th className="px-3 py-2 sm:px-5 sm:py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-primary-400">
                    Verificacao
                  </th>
                  <th className="px-3 py-2 sm:px-5 sm:py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-primary-400">
                    Valor Sistema
                  </th>
                  <th className="px-3 py-2 sm:px-5 sm:py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-primary-400">
                    Valor Documento
                  </th>
                  <th className="px-3 py-2 sm:px-5 sm:py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-primary-400">
                    Mensagem
                  </th>
                </tr>
              </thead>
              <tbody>
                {report.systemChecks.map((check, idx) => (
                  <CheckRow key={check.id} check={check} index={idx} />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Cross-document checks */}
      {hasCrossChecks && (
        <div className="rounded-xl border border-slate-200 dark:border-slate-600 overflow-hidden">
          <div className="bg-slate-50 dark:bg-slate-900 px-4 py-3 border-b border-slate-200 dark:border-slate-600">
            <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Cruzamento entre Documentos
            </h4>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Comparacao entre Invoice, Packing List e BL
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full">
              <thead>
                <tr className="bg-slate-50/50 dark:bg-slate-900/50">
                  <th className="px-3 py-2 sm:px-5 sm:py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                    Verificacao
                  </th>
                  <th className="px-3 py-2 sm:px-5 sm:py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                    Esperado
                  </th>
                  <th className="px-3 py-2 sm:px-5 sm:py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                    Encontrado
                  </th>
                  <th className="px-3 py-2 sm:px-5 sm:py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                    Mensagem
                  </th>
                </tr>
              </thead>
              <tbody>
                {report.crossDocumentChecks.map((check, idx) => (
                  <CheckRow key={check.id} check={check} index={idx} />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {!hasSystemChecks && !hasCrossChecks && (
        <p className="text-center text-sm text-slate-500 dark:text-slate-400 py-4">
          Nenhuma validacao executada ainda.
        </p>
      )}
    </div>
  );
}
