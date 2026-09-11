import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  CheckCircle2,
  FileCheck2,
  FileText,
  Pencil,
  ShieldCheck,
} from 'lucide-react';
import { useApiQuery } from '@/shared/hooks/useApi';
import { cn, formatDate, formatDateTime } from '@/shared/lib/utils';
import { isRecord, unwrapAiValue } from '@/shared/lib/ai-values';
import { LoadingSpinner } from '@/shared/components/LoadingSpinner';
import { ErrorState } from '@/shared/components/ErrorState';
import type { Document, ImportProcess } from '@/shared/types';

type RegistroCheckStatus = 'match' | 'warning' | 'divergent' | 'empty';
type RegistroCheckKind = 'text' | 'number' | 'date';

interface RegistroCheck {
  key: string;
  label: string;
  processValue: string | number | null | undefined;
  documentValue: unknown;
  kind: RegistroCheckKind;
  status: RegistroCheckStatus;
  message: string;
}

function valueOrDash(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === '') return '--';
  return String(value);
}

function statusText(doc: Document | undefined) {
  if (!doc) return 'Nao enviado';
  if (doc.aiProcessingStatus === 'failed') return 'Revisao manual';
  if (doc.aiProcessingStatus === 'completed') return 'Recebido';
  return 'Processando';
}

function normalizeKey(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function normalizeTextValue(value: unknown) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function findValueByAliases(data: unknown, aliases: string[]): unknown {
  const wanted = new Set(aliases.map(normalizeKey));

  const visit = (node: unknown, depth: number): unknown => {
    if (!isRecord(node) || depth > 3) return null;
    for (const [key, rawValue] of Object.entries(node)) {
      const value = unwrapAiValue(rawValue);
      if (wanted.has(normalizeKey(key)) && value !== null && value !== undefined && value !== '') {
        return value;
      }
    }
    for (const rawValue of Object.values(node)) {
      const value = unwrapAiValue(rawValue);
      if (isRecord(value)) {
        const nested = visit(value, depth + 1);
        if (nested !== null && nested !== undefined && nested !== '') return nested;
      }
    }
    return null;
  };

  return visit(data, 0);
}

function parseNumberValue(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const text = String(value).trim();
  if (!text) return null;
  const cleaned = text.replace(/[^\d,.-]/g, '');
  const hasComma = cleaned.includes(',');
  const hasDot = cleaned.includes('.');
  const normalized =
    hasComma && hasDot
      ? cleaned.replace(/\./g, '').replace(',', '.')
      : hasComma
        ? cleaned.replace(',', '.')
        : cleaned;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeDateValue(value: unknown): string | null {
  if (!value) return null;
  const text = String(value).trim();
  if (!text) return null;
  const brazilian = text.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (brazilian) return `${brazilian[3]}-${brazilian[2]}-${brazilian[1]}`;
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

function formatRegistroValue(value: unknown, kind: RegistroCheckKind) {
  const unwrapped = unwrapAiValue(value);
  if (unwrapped === null || unwrapped === undefined || unwrapped === '') return '--';
  if (kind === 'date') {
    const normalized = normalizeDateValue(unwrapped);
    return normalized ? formatDate(normalized) : String(unwrapped);
  }
  if (kind === 'number') {
    const numeric = parseNumberValue(unwrapped);
    if (numeric !== null) {
      return numeric.toLocaleString('pt-BR', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 6,
      });
    }
  }
  return String(unwrapped);
}

function compareRegistroField(
  processValue: unknown,
  documentValue: unknown,
  kind: RegistroCheckKind,
  precision = 0.01,
): Pick<RegistroCheck, 'status' | 'message'> {
  const hasProcess = processValue !== null && processValue !== undefined && processValue !== '';
  const hasDocument = documentValue !== null && documentValue !== undefined && documentValue !== '';

  if (!hasProcess && !hasDocument) {
    return { status: 'empty', message: 'Sem valor no processo e no documento.' };
  }
  if (!hasProcess && hasDocument) {
    return {
      status: 'warning',
      message: 'Extraido do documento, ainda nao preenchido no processo.',
    };
  }
  if (hasProcess && !hasDocument) {
    return { status: 'warning', message: 'Preenchido no processo, mas nao extraido do documento.' };
  }

  if (kind === 'number') {
    const processNumber = parseNumberValue(processValue);
    const documentNumber = parseNumberValue(documentValue);
    if (processNumber === null || documentNumber === null) {
      return { status: 'warning', message: 'Valor numerico requer revisao manual.' };
    }
    return Math.abs(processNumber - documentNumber) <= precision
      ? { status: 'match', message: 'Conforme com o documento.' }
      : { status: 'divergent', message: 'Divergente do documento de registro.' };
  }

  if (kind === 'date') {
    const processDate = normalizeDateValue(processValue);
    const documentDate = normalizeDateValue(documentValue);
    if (!processDate || !documentDate) {
      return { status: 'warning', message: 'Data requer revisao manual.' };
    }
    return processDate === documentDate
      ? { status: 'match', message: 'Conforme com o documento.' }
      : { status: 'divergent', message: 'Data divergente do documento de registro.' };
  }

  const processText = normalizeTextValue(processValue);
  const documentText = normalizeTextValue(documentValue);
  return processText === documentText
    ? { status: 'match', message: 'Conforme com o documento.' }
    : { status: 'divergent', message: 'Divergente do documento de registro.' };
}

function buildRegistroChecks(process: ImportProcess, sourceDoc?: Document): RegistroCheck[] {
  const data = sourceDoc?.aiParsedData ?? null;
  const specs = [
    {
      key: 'customsValue',
      label: 'Valor aduaneiro',
      processValue: process.customsValue,
      kind: 'number' as const,
      precision: 0.01,
      aliases: [
        'customsValue',
        'customsValueBrl',
        'valorAduaneiro',
        'valorAduaneiroBrl',
        'valorAduaneiroTotal',
        'totalCustomsValue',
      ],
    },
    {
      key: 'registrationDollar',
      label: 'Dolar de registro',
      processValue: process.registrationDollar,
      kind: 'number' as const,
      precision: 0.0001,
      aliases: [
        'registrationDollar',
        'dolarRegistro',
        'taxaCambio',
        'exchangeRate',
        'exchangeRateUsd',
      ],
    },
    {
      key: 'insuranceValue',
      label: 'Seguro',
      processValue: process.insuranceValue,
      kind: 'number' as const,
      precision: 0.01,
      aliases: ['insuranceValue', 'seguro', 'valorSeguro', 'insurance'],
    },
    {
      key: 'duimpNumber',
      label: 'N DUIMP',
      processValue: process.duimpNumber,
      kind: 'text' as const,
      aliases: ['duimpNumber', 'numeroDuimp', 'nDuimp', 'declarationNumber', 'documentNumber'],
    },
    {
      key: 'registeredAt',
      label: 'Data de registro',
      processValue: process.registeredAt,
      kind: 'date' as const,
      aliases: ['registeredAt', 'registrationDate', 'dataRegistro', 'dataDeRegistro'],
    },
    {
      key: 'customsClearanceAt',
      label: 'Desembaraco',
      processValue: process.customsClearanceAt,
      kind: 'date' as const,
      aliases: ['customsClearanceAt', 'clearanceDate', 'dataDesembaraco', 'desembaraco'],
    },
    {
      key: 'customsChannel',
      label: 'Canal RFB',
      processValue: process.customsChannel,
      kind: 'text' as const,
      aliases: ['customsChannel', 'canalRfb', 'canal', 'channel'],
    },
  ];

  return specs.map((spec) => {
    const documentValue = findValueByAliases(data, spec.aliases);
    const comparison = compareRegistroField(
      spec.processValue,
      documentValue,
      spec.kind,
      spec.precision,
    );
    return { ...spec, documentValue, ...comparison };
  });
}

function statusLabel(status: RegistroCheckStatus) {
  if (status === 'match') return 'Conforme';
  if (status === 'divergent') return 'Divergente';
  if (status === 'warning') return 'Revisar';
  return 'Sem dados';
}

function statusClass(status: RegistroCheckStatus) {
  if (status === 'match')
    return 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-700/50 dark:bg-emerald-950/30 dark:text-emerald-300';
  if (status === 'divergent')
    return 'border-red-200 bg-red-50 text-red-700 dark:border-danger-700/50 dark:bg-danger-950/30 dark:text-danger-300';
  if (status === 'warning')
    return 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-700/50 dark:bg-amber-950/30 dark:text-amber-300';
  return 'border-slate-200 bg-slate-50 text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300';
}

export function RegistroTab({ processId }: { processId: string }) {
  const {
    data: process,
    isLoading: loadingProcess,
    isError: processError,
    refetch: refetchProcess,
  } = useApiQuery<ImportProcess>(['process', processId], `/api/processes/${processId}`);
  const {
    data: docs,
    isLoading: loadingDocs,
    isError: documentsError,
    refetch: refetchDocuments,
  } = useApiQuery<Document[]>(
    ['documents', 'process', processId],
    `/api/documents/process/${processId}`,
  );

  if (loadingProcess || loadingDocs) return <LoadingSpinner className="py-8" />;
  if (processError || documentsError) {
    return (
      <ErrorState
        message="Erro ao carregar os dados de registro aduaneiro."
        onRetry={() => {
          void refetchProcess();
          void refetchDocuments();
        }}
      />
    );
  }
  if (!process) return null;

  const draftDuimp = docs?.find((doc) => doc.documentType === 'draft_duimp');
  const finalDuimp = docs?.find((doc) => doc.documentType === 'duimp');
  const sourceDuimp = finalDuimp ?? draftDuimp;
  const sourceLabel = finalDuimp ? 'DUIMP Final' : draftDuimp ? 'Draft DUIMP' : 'Documento DUIMP';
  const registroChecks = buildRegistroChecks(process, sourceDuimp);

  const fields = [
    ['Valor aduaneiro', process.customsValue],
    ['Dolar de registro', process.registrationDollar],
    ['Seguro', process.insuranceValue],
    ['N DUIMP', process.duimpNumber],
    ['Data de registro', process.registeredAt ? formatDateTime(process.registeredAt) : null],
    ['Desembaraco', process.customsClearanceAt ? formatDate(process.customsClearanceAt) : null],
    ['Canal RFB', process.customsChannel],
  ] as const;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100">Registro Aduaneiro</h3>
        <Link
          to={`/importacao/processos/${processId}/editar`}
          className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
        >
          <Pencil className="h-4 w-4" />
          Editar dados
        </Link>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        {fields.map(([label, value]) => (
          <div
            key={label}
            className="rounded-xl border border-slate-200/70 bg-white p-4 dark:border-slate-700/70 dark:bg-slate-800"
          >
            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              {label}
            </p>
            <p className="mt-1 text-sm font-semibold text-slate-800 dark:text-slate-100">
              {valueOrDash(value)}
            </p>
          </div>
        ))}
      </div>

      <div className="rounded-xl border border-slate-200/70 bg-white dark:border-slate-700/70 dark:bg-slate-800">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-3 dark:border-slate-700">
          <div>
            <h4 className="text-sm font-semibold text-slate-800 dark:text-slate-100">
              Conferencia do registro
            </h4>
            <p className="mt-0.5 text-xs text-slate-500">
              Fonte preferencial: {sourceDuimp ? sourceLabel : 'nenhuma DUIMP anexada'}
            </p>
          </div>
          {registroChecks.some((check) => check.status === 'divergent') ? (
            <span className="inline-flex items-center gap-1 rounded-full border border-red-200 bg-red-50 px-2 py-1 text-xs font-semibold text-red-700 dark:border-danger-700/50 dark:bg-danger-950/30 dark:text-danger-300">
              <AlertTriangle className="h-3.5 w-3.5" />
              Revisar divergencias
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-700 dark:border-emerald-700/50 dark:bg-emerald-950/30 dark:text-emerald-300">
              <CheckCircle2 className="h-3.5 w-3.5" />
              Sem divergencia critica
            </span>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-100 text-sm dark:divide-slate-700">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500 dark:bg-slate-900/40">
              <tr>
                <th className="px-4 py-3 text-left font-semibold">Campo</th>
                <th className="px-4 py-3 text-left font-semibold">Processo</th>
                <th className="px-4 py-3 text-left font-semibold">{sourceLabel}</th>
                <th className="px-4 py-3 text-left font-semibold">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
              {registroChecks.map((check) => (
                <tr key={check.key}>
                  <td className="px-4 py-3 font-medium text-slate-700 dark:text-slate-200">
                    {check.label}
                  </td>
                  <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                    {formatRegistroValue(check.processValue, check.kind)}
                  </td>
                  <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                    {formatRegistroValue(check.documentValue, check.kind)}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={cn(
                        'inline-flex rounded-full border px-2 py-1 text-xs font-semibold',
                        statusClass(check.status),
                      )}
                      title={check.message}
                    >
                      {statusLabel(check.status)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {[
          { label: 'Draft DUIMP', doc: draftDuimp, icon: FileText },
          { label: 'DUIMP Final', doc: finalDuimp, icon: FileCheck2 },
        ].map(({ label, doc, icon: Icon }) => (
          <div
            key={label}
            className="rounded-xl border border-slate-200/70 bg-white p-4 dark:border-slate-700/70 dark:bg-slate-800"
          >
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-100 text-slate-500 dark:bg-slate-700">
                <Icon className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">{label}</p>
                <p className="mt-0.5 text-xs text-slate-500">{statusText(doc)}</p>
                {doc && (
                  <p className="mt-2 truncate text-xs font-medium text-slate-600 dark:text-slate-300">
                    {doc.fileName}
                  </p>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-700/50 dark:bg-amber-950/30 dark:text-amber-300">
        <div className="flex items-start gap-3">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            Dados do Draft DUIMP podem ser preenchidos no processo e substituidos pela DUIMP final.
            Quando a DUIMP final estiver anexada, ela passa a ser a fonte preferencial da
            conferencia acima.
          </p>
        </div>
      </div>
    </div>
  );
}
