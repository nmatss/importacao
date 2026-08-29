import { useEffect } from 'react';
import { useParams, useNavigate, Navigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { ArrowLeft, Ship, Building2, Warehouse, FileText, DollarSign } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useApiQuery, useApiMutation } from '@/shared/hooks/useApi';
import { LoadingSpinner } from '@/shared/components/LoadingSpinner';
import { ErrorState } from '@/shared/components/ErrorState';

const decimalPattern = /^(?:0|[1-9]\d*)(?:[.,]\d{1,6})?$/;

function optionalDecimalString(label: string) {
  return z
    .string()
    .trim()
    .optional()
    .refine((value) => !value || decimalPattern.test(value), {
      message: `${label} deve ser zero ou positivo`,
    });
}

const optionalNonNegativeInteger = z.preprocess(
  (value) => (value === '' || value == null ? undefined : Number(value)),
  z.number().int('Informe um numero inteiro').min(0, 'Informe zero ou mais').optional(),
);

const processSchema = z
  .object({
    processCode: z.string().min(1, 'Codigo do processo e obrigatorio'),
    brand: z.enum(['puket', 'imaginarium'], { required_error: 'Selecione a marca' }),
    incoterm: z.string().default('FOB'),
    portOfLoading: z.string().optional(),
    portOfDischarge: z.string().optional(),
    etd: z.string().optional(),
    eta: z.string().optional(),
    exporterName: z.string().optional(),
    exporterAddress: z.string().optional(),
    importerName: z.string().optional(),
    importerAddress: z.string().optional(),
    notes: z.string().optional(),
    containerType: z.string().optional(),
    totalFobValue: optionalDecimalString('Valor FOB'),
    freightValue: optionalDecimalString('Valor de frete'),
    insuranceValue: optionalDecimalString('Seguro'),
    customsValue: optionalDecimalString('Valor aduaneiro'),
    registrationDollar: optionalDecimalString('Dolar de registro'),
    totalCbm: optionalDecimalString('CBM'),
    totalBoxes: optionalNonNegativeInteger,
    totalNetWeight: optionalDecimalString('Peso liquido'),
    totalGrossWeight: optionalDecimalString('Peso bruto'),
    shipmentDate: z.string().optional(),
    duimpNumber: z.string().optional(),
    registeredAt: z.string().optional(),
    customsClearanceAt: z.string().optional(),
    customsChannel: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.etd && data.eta && data.eta < data.etd) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['eta'],
        message: 'ETA nao pode ser anterior ao ETD',
      });
    }
    if (data.shipmentDate && data.eta && data.shipmentDate > data.eta) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['shipmentDate'],
        message: 'Data de embarque nao pode ser posterior ao ETA',
      });
    }
  });

type ProcessFormData = z.infer<typeof processSchema>;

/**
 * Campos que `updateProcessSchema` (apps/api/src/modules/processes/schema.ts)
 * aceita como `null` explicito para APAGAR o valor guardado.
 *
 * Tres ausencias sao DELIBERADAS, nao esquecimento:
 *
 * - `processCode` e `brand` sao obrigatorios; o Zod do formulario ja barra o
 *   envio vazio, entao nunca chegam aqui.
 * - `incoterm` o backend ate aceita como `null`, mas ele tem `default('FOB')`
 *   no schema: esvaziar o campo e ambiguo (o usuario quer NULL ou quer voltar
 *   para FOB?). Enquanto a operacao nao decidir, esvaziar incoterm continua
 *   sendo descartado e o valor anterior permanece.
 */
const NULLABLE_PROCESS_FIELDS = new Set<keyof ProcessFormData>([
  'portOfLoading',
  'portOfDischarge',
  'etd',
  'eta',
  'shipmentDate',
  'exporterName',
  'exporterAddress',
  'importerName',
  'importerAddress',
  'notes',
  'containerType',
  'duimpNumber',
  'registeredAt',
  'customsChannel',
  'customsClearanceAt',
  'totalFobValue',
  'freightValue',
  'insuranceValue',
  'customsValue',
  'registrationDollar',
  'totalCbm',
  'totalNetWeight',
  'totalGrossWeight',
  'totalBoxes',
]);

/**
 * Monta o corpo do PUT respeitando o contrato acertado com a API:
 *
 *   - chave AUSENTE  -> nao mexer no campo;
 *   - chave com `null` -> apagar o valor.
 *
 * O `null` sai apenas para o campo que o usuario EFETIVAMENTE esvaziou (estava
 * preenchido e ficou vazio), sinalizado pelo `dirtyFields` do react-hook-form,
 * que compara com os defaultValues gravados pelo `reset()`. Mandar `null` para
 * todo campo vazio do formulario apagaria dado que o usuario nem tocou — e, se
 * outra pessoa tivesse preenchido o campo entre a carga da tela e o salvamento,
 * essa alteracao seria perdida.
 *
 * Antes desta correcao o campo esvaziado era simplesmente descartado: a API
 * mantinha o valor antigo, respondia 200 e a tela dizia "Processo atualizado
 * com sucesso" — o ETD, o porto ou a DUIMP errada continuavam la.
 */
function normalizeProcessPayload(
  data: ProcessFormData,
  dirtyFields: Partial<Record<keyof ProcessFormData, unknown>>,
): Partial<ProcessFormData> {
  const payload: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    const field = key as keyof ProcessFormData;
    if (value === '' || value == null) {
      if (NULLABLE_PROCESS_FIELDS.has(field) && dirtyFields[field]) {
        payload[key] = null;
      }
      continue;
    }
    payload[key] = value;
  }
  return payload as Partial<ProcessFormData>;
}

interface Process {
  id: number;
  processCode: string;
  brand: string;
  incoterm: string;
  portOfLoading: string | null;
  portOfDischarge: string | null;
  etd: string | null;
  eta: string | null;
  exporterName: string | null;
  exporterAddress: string | null;
  importerName: string | null;
  importerAddress: string | null;
  notes: string | null;
  containerType: string | null;
  totalFobValue: string | null;
  freightValue: string | null;
  insuranceValue: string | null;
  customsValue: string | null;
  registrationDollar: string | null;
  totalCbm: string | null;
  totalBoxes: number | null;
  totalNetWeight: string | null;
  totalGrossWeight: string | null;
  shipmentDate: string | null;
  duimpNumber: string | null;
  registeredAt: string | null;
  customsClearanceAt: string | null;
  customsChannel: string | null;
  lockedAt?: string | null;
  lockedReason?: string | null;
}

export function ProcessEditPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const {
    data: process,
    isLoading,
    error,
    refetch,
  } = useApiQuery<Process>(['process', id!], `/api/processes/${id}`, { enabled: !!id });

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting, dirtyFields },
  } = useForm<ProcessFormData>({
    resolver: zodResolver(processSchema),
  });

  useEffect(() => {
    if (process) {
      reset({
        processCode: process.processCode,
        brand: process.brand as 'puket' | 'imaginarium',
        incoterm: process.incoterm || 'FOB',
        portOfLoading: process.portOfLoading || '',
        portOfDischarge: process.portOfDischarge || '',
        etd: process.etd ? process.etd.slice(0, 10) : '',
        eta: process.eta ? process.eta.slice(0, 10) : '',
        exporterName: process.exporterName || '',
        exporterAddress: process.exporterAddress || '',
        importerName: process.importerName || '',
        importerAddress: process.importerAddress || '',
        notes: process.notes || '',
        containerType: process.containerType || '',
        totalFobValue: process.totalFobValue || '',
        freightValue: process.freightValue || '',
        insuranceValue: process.insuranceValue || '',
        customsValue: process.customsValue || '',
        registrationDollar: process.registrationDollar || '',
        totalCbm: process.totalCbm || '',
        totalBoxes: process.totalBoxes ?? undefined,
        totalNetWeight: process.totalNetWeight || '',
        totalGrossWeight: process.totalGrossWeight || '',
        shipmentDate: process.shipmentDate ? process.shipmentDate.slice(0, 10) : '',
        duimpNumber: process.duimpNumber || '',
        registeredAt: process.registeredAt ? process.registeredAt.slice(0, 10) : '',
        customsClearanceAt: process.customsClearanceAt
          ? process.customsClearanceAt.slice(0, 10)
          : '',
        customsChannel: process.customsChannel || '',
      });
    }
  }, [process, reset]);

  const mutation = useApiMutation<Process, Partial<ProcessFormData>>(
    `/api/processes/${id}`,
    'put',
    {
      onSuccess: () => {
        // Sem isso o detalhe volta a renderizar o valor PRE-EDICAO: a query
        // ['process', id] nao esta stale (staleTime 30s, refetchOnWindowFocus
        // desligado em app/App.tsx), entao o toast verde aparece sobre o dado
        // antigo por ate 30 segundos.
        void queryClient.invalidateQueries({ queryKey: ['process', id] });
        void queryClient.invalidateQueries({ queryKey: ['processes'] });
        toast.success('Processo atualizado com sucesso');
        navigate(`/importacao/processos/${id}`);
      },
    },
  );

  if (!id) return <Navigate to="/importacao/processos" replace />;

  const onSubmit = (data: ProcessFormData) => {
    if (process?.lockedAt) {
      toast.error('Destrave o processo antes de salvar alteracoes.');
      return;
    }
    mutation.mutate(normalizeProcessPayload(data, dirtyFields));
  };

  if (isLoading) {
    return <LoadingSpinner size="lg" className="py-24" />;
  }

  if (error) {
    return <ErrorState message="Erro ao carregar processo." onRetry={() => refetch()} />;
  }

  if (!process) {
    return (
      <div className="flex flex-col items-center justify-center py-24">
        <p className="text-sm text-slate-600 dark:text-slate-400">Processo nao encontrado.</p>
        <button
          type="button"
          onClick={() => navigate('/importacao/processos')}
          className="mt-4 rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 dark:bg-slate-900 transition-colors"
        >
          Voltar para lista
        </button>
      </div>
    );
  }

  const inputClass =
    'w-full rounded-lg border border-slate-200 dark:border-slate-600 dark:bg-slate-900 px-3 py-2 text-sm text-slate-700 dark:text-slate-200 placeholder:text-slate-400 focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 focus:outline-none transition-all';
  const labelClass = 'block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1.5';
  const errorClass = 'mt-1.5 text-[11px] text-danger-600';

  return (
    <div className="mx-auto max-w-3xl space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => navigate(`/importacao/processos/${id}`)}
          className="rounded-lg p-2 text-slate-400 hover:text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:bg-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200 transition-all"
          aria-label="Voltar para detalhes do processo"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div>
          <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100 tracking-tight">
            Editar Processo
          </h2>
          <p className="text-sm text-slate-600 dark:text-slate-400">{process.processCode}</p>
        </div>
      </div>

      {process.lockedAt && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-900/30 px-4 py-3 flex items-start gap-3">
          <span className="text-amber-700 dark:text-amber-400 text-sm">
            <strong>Processo travado</strong> em{' '}
            {new Date(process.lockedAt).toLocaleDateString('pt-BR')}
            {process.lockedReason ? ` (motivo: ${process.lockedReason})` : ''}. A API rejeitará
            alterações enquanto o processo estiver travado — destrave pelo botão no cabeçalho antes
            de salvar.
          </span>
        </div>
      )}

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
        <fieldset disabled={!!process.lockedAt} className="space-y-6 disabled:opacity-70">
          {/* Main Fields */}
          <div className="rounded-2xl border border-slate-200/60 bg-white dark:bg-slate-800 dark:border-slate-700/60 p-5 shadow-sm space-y-6">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary-50 text-primary-600">
                <Ship className="h-5 w-5" />
              </div>
              <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                Dados Gerais
              </h3>
            </div>
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
              <div>
                <label htmlFor="processCode" className={labelClass}>
                  Codigo do Processo <span className="text-danger-500">*</span>
                </label>
                <input
                  id="processCode"
                  {...register('processCode')}
                  placeholder="Ex: IMP-2024-001"
                  className={inputClass}
                />
                {errors.processCode && <p className={errorClass}>{errors.processCode.message}</p>}
              </div>
              <div>
                <label htmlFor="brand" className={labelClass}>
                  Marca <span className="text-danger-500">*</span>
                </label>
                <select id="brand" {...register('brand')} className={inputClass}>
                  <option value="">Selecione a marca...</option>
                  <option value="puket">Puket</option>
                  <option value="imaginarium">Imaginarium</option>
                </select>
                {errors.brand && <p className={errorClass}>{errors.brand.message}</p>}
              </div>
              <div>
                <label htmlFor="incoterm" className={labelClass}>
                  Incoterm
                </label>
                <input
                  id="incoterm"
                  {...register('incoterm')}
                  placeholder="FOB"
                  className={inputClass}
                />
              </div>
              <div>
                <label htmlFor="portOfLoading" className={labelClass}>
                  Porto de Embarque
                </label>
                <input
                  id="portOfLoading"
                  {...register('portOfLoading')}
                  placeholder="Ex: Shanghai"
                  className={inputClass}
                />
              </div>
              <div>
                <label htmlFor="portOfDischarge" className={labelClass}>
                  Porto de Destino
                </label>
                <input
                  id="portOfDischarge"
                  {...register('portOfDischarge')}
                  placeholder="Ex: Santos"
                  className={inputClass}
                />
              </div>
              <div>
                <label htmlFor="etd" className={labelClass}>
                  ETD
                </label>
                <input
                  type="date"
                  id="etd"
                  {...register('etd')}
                  aria-invalid={!!errors.etd}
                  className={inputClass}
                />
                {errors.etd && <p className={errorClass}>{errors.etd.message}</p>}
              </div>
              <div>
                <label htmlFor="eta" className={labelClass}>
                  ETA
                </label>
                <input
                  type="date"
                  id="eta"
                  {...register('eta')}
                  aria-invalid={!!errors.eta}
                  className={inputClass}
                />
                {errors.eta && <p className={errorClass}>{errors.eta.message}</p>}
              </div>
            </div>
          </div>

          {/* Exporter */}
          <div className="rounded-2xl border border-slate-200/60 bg-white dark:bg-slate-800 dark:border-slate-700/60 p-5 shadow-sm space-y-6">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
                <Building2 className="h-5 w-5" />
              </div>
              <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                Exportador
              </h3>
            </div>
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
              <div className="sm:col-span-1">
                <label htmlFor="exporterName" className={labelClass}>
                  Nome
                </label>
                <input
                  id="exporterName"
                  {...register('exporterName')}
                  placeholder="Nome do exportador"
                  className={inputClass}
                />
              </div>
              <div className="sm:col-span-2">
                <label htmlFor="exporterAddress" className={labelClass}>
                  Endereco
                </label>
                <textarea
                  id="exporterAddress"
                  {...register('exporterAddress')}
                  rows={2}
                  placeholder="Endereco completo do exportador"
                  className={inputClass}
                />
              </div>
            </div>
          </div>

          {/* Importer */}
          <div className="rounded-2xl border border-slate-200/60 bg-white dark:bg-slate-800 dark:border-slate-700/60 p-5 shadow-sm space-y-6">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-violet-50 text-violet-600">
                <Warehouse className="h-5 w-5" />
              </div>
              <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                Importador
              </h3>
            </div>
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
              <div className="sm:col-span-1">
                <label htmlFor="importerName" className={labelClass}>
                  Nome
                </label>
                <input
                  id="importerName"
                  {...register('importerName')}
                  placeholder="Nome do importador"
                  className={inputClass}
                />
              </div>
              <div className="sm:col-span-2">
                <label htmlFor="importerAddress" className={labelClass}>
                  Endereco
                </label>
                <textarea
                  id="importerAddress"
                  {...register('importerAddress')}
                  rows={2}
                  placeholder="Endereco completo do importador"
                  className={inputClass}
                />
              </div>
            </div>
          </div>

          {/* Financial & Cargo */}
          <div className="rounded-2xl border border-slate-200/60 bg-white dark:bg-slate-800 dark:border-slate-700/60 p-5 shadow-sm space-y-6">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
                <DollarSign className="h-5 w-5" />
              </div>
              <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                Dados Financeiros e Carga
              </h3>
            </div>
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
              <div>
                <label htmlFor="totalFobValue" className={labelClass}>
                  Valor FOB USD
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  inputMode="decimal"
                  id="totalFobValue"
                  {...register('totalFobValue')}
                  aria-invalid={!!errors.totalFobValue}
                  placeholder="0.00"
                  className={inputClass}
                />
                {errors.totalFobValue && (
                  <p className={errorClass}>{errors.totalFobValue.message}</p>
                )}
              </div>
              <div>
                <label htmlFor="freightValue" className={labelClass}>
                  Valor Frete USD
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  inputMode="decimal"
                  id="freightValue"
                  {...register('freightValue')}
                  aria-invalid={!!errors.freightValue}
                  placeholder="0.00"
                  className={inputClass}
                />
                {errors.freightValue && <p className={errorClass}>{errors.freightValue.message}</p>}
              </div>
              <div>
                <label htmlFor="containerType" className={labelClass}>
                  Tipo Container
                </label>
                <input
                  id="containerType"
                  {...register('containerType')}
                  placeholder="Ex: 40HC"
                  className={inputClass}
                />
              </div>
              <div>
                <label htmlFor="totalBoxes" className={labelClass}>
                  Quantidade Caixas
                </label>
                <input
                  type="number"
                  step="1"
                  min="0"
                  inputMode="numeric"
                  id="totalBoxes"
                  {...register('totalBoxes')}
                  aria-invalid={!!errors.totalBoxes}
                  placeholder="0"
                  className={inputClass}
                />
                {errors.totalBoxes && <p className={errorClass}>{errors.totalBoxes.message}</p>}
              </div>
              <div>
                <label htmlFor="totalNetWeight" className={labelClass}>
                  Peso Liquido kg
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  inputMode="decimal"
                  id="totalNetWeight"
                  {...register('totalNetWeight')}
                  aria-invalid={!!errors.totalNetWeight}
                  placeholder="0.00"
                  className={inputClass}
                />
                {errors.totalNetWeight && (
                  <p className={errorClass}>{errors.totalNetWeight.message}</p>
                )}
              </div>
              <div>
                <label htmlFor="totalGrossWeight" className={labelClass}>
                  Peso Bruto kg
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  inputMode="decimal"
                  id="totalGrossWeight"
                  {...register('totalGrossWeight')}
                  aria-invalid={!!errors.totalGrossWeight}
                  placeholder="0.00"
                  className={inputClass}
                />
                {errors.totalGrossWeight && (
                  <p className={errorClass}>{errors.totalGrossWeight.message}</p>
                )}
              </div>
              <div>
                <label htmlFor="totalCbm" className={labelClass}>
                  CBM m3
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  inputMode="decimal"
                  id="totalCbm"
                  {...register('totalCbm')}
                  aria-invalid={!!errors.totalCbm}
                  placeholder="0.00"
                  className={inputClass}
                />
                {errors.totalCbm && <p className={errorClass}>{errors.totalCbm.message}</p>}
              </div>
              <div>
                <label htmlFor="shipmentDate" className={labelClass}>
                  Data Embarque
                </label>
                <input
                  type="date"
                  id="shipmentDate"
                  {...register('shipmentDate')}
                  aria-invalid={!!errors.shipmentDate}
                  className={inputClass}
                />
                {errors.shipmentDate && <p className={errorClass}>{errors.shipmentDate.message}</p>}
              </div>
            </div>
          </div>

          {/* Customs Registration */}
          <div className="rounded-2xl border border-slate-200/60 bg-white dark:bg-slate-800 dark:border-slate-700/60 p-5 shadow-sm space-y-6">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-red-50 text-red-600">
                <FileText className="h-5 w-5" />
              </div>
              <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                Registro Aduaneiro
              </h3>
            </div>
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
              <div>
                <label htmlFor="customsValue" className={labelClass}>
                  Valor Aduaneiro
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  inputMode="decimal"
                  id="customsValue"
                  {...register('customsValue')}
                  aria-invalid={!!errors.customsValue}
                  placeholder="0.00"
                  className={inputClass}
                />
                {errors.customsValue && <p className={errorClass}>{errors.customsValue.message}</p>}
              </div>
              <div>
                <label htmlFor="registrationDollar" className={labelClass}>
                  Dolar de Registro
                </label>
                <input
                  type="number"
                  step="0.000001"
                  min="0"
                  inputMode="decimal"
                  id="registrationDollar"
                  {...register('registrationDollar')}
                  aria-invalid={!!errors.registrationDollar}
                  placeholder="0.000000"
                  className={inputClass}
                />
                {errors.registrationDollar && (
                  <p className={errorClass}>{errors.registrationDollar.message}</p>
                )}
              </div>
              <div>
                <label htmlFor="insuranceValue" className={labelClass}>
                  Seguro
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  inputMode="decimal"
                  id="insuranceValue"
                  {...register('insuranceValue')}
                  aria-invalid={!!errors.insuranceValue}
                  placeholder="0.00"
                  className={inputClass}
                />
                {errors.insuranceValue && (
                  <p className={errorClass}>{errors.insuranceValue.message}</p>
                )}
              </div>
              <div>
                <label htmlFor="duimpNumber" className={labelClass}>
                  Numero DUIMP
                </label>
                <input
                  id="duimpNumber"
                  {...register('duimpNumber')}
                  placeholder="Numero da DUIMP"
                  className={inputClass}
                />
              </div>
              <div>
                <label htmlFor="registeredAt" className={labelClass}>
                  Data de Registro
                </label>
                <input
                  type="date"
                  id="registeredAt"
                  {...register('registeredAt')}
                  className={inputClass}
                />
              </div>
              <div>
                <label htmlFor="customsClearanceAt" className={labelClass}>
                  Desembaraco
                </label>
                <input
                  type="date"
                  id="customsClearanceAt"
                  {...register('customsClearanceAt')}
                  className={inputClass}
                />
              </div>
              <div>
                <label htmlFor="customsChannel" className={labelClass}>
                  Canal RFB
                </label>
                <input
                  id="customsChannel"
                  {...register('customsChannel')}
                  placeholder="Ex: verde, amarelo, vermelho"
                  className={inputClass}
                />
              </div>
            </div>
          </div>

          {/* Notes */}
          <div className="rounded-2xl border border-slate-200/60 bg-white dark:bg-slate-800 dark:border-slate-700/60 p-5 shadow-sm space-y-6">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-50 text-amber-600">
                <FileText className="h-5 w-5" />
              </div>
              <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                Observacoes
              </h3>
            </div>
            <textarea
              id="notes"
              aria-label="Observacoes"
              {...register('notes')}
              rows={4}
              placeholder="Observacoes adicionais sobre o processo..."
              className={inputClass}
            />
          </div>
        </fieldset>

        {/* Error message */}
        {mutation.error && (
          <div
            role="alert"
            className="rounded-lg bg-danger-50 border border-danger-200 px-5 py-4 text-sm text-danger-700"
          >
            {mutation.error.message}
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center justify-end gap-3 rounded-2xl border border-slate-200/60 bg-white dark:bg-slate-800 dark:border-slate-700/60 p-5 shadow-sm">
          <button
            type="button"
            onClick={() => navigate(`/importacao/processos/${id}`)}
            className="rounded-lg border border-slate-200 dark:border-slate-600 px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:bg-slate-900 dark:hover:bg-slate-700 active:scale-[0.98] transition-colors"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={isSubmitting || mutation.isPending || !!process.lockedAt}
            className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-primary-700 active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none transition-colors"
          >
            {mutation.isPending ? 'Salvando...' : 'Salvar Alteracoes'}
          </button>
        </div>
      </form>
    </div>
  );
}
