import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { ArrowLeft, Ship, Building2, Warehouse, FileText, DollarSign } from 'lucide-react';
import { SubmitButton } from '@/shared/components/SubmitButton';
import { useApiMutation } from '@/shared/hooks/useApi';

const decimalPattern = /^(?:0|[1-9]\d*)(?:[.,]\d{1,4})?$/;

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
    totalCbm: optionalDecimalString('CBM'),
    totalBoxes: optionalNonNegativeInteger,
    totalNetWeight: optionalDecimalString('Peso liquido'),
    totalGrossWeight: optionalDecimalString('Peso bruto'),
    shipmentDate: z.string().optional(),
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

export function ProcessCreatePage() {
  const navigate = useNavigate();

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ProcessFormData>({
    resolver: zodResolver(processSchema),
    defaultValues: {
      incoterm: 'FOB',
    },
  });

  const mutation = useApiMutation<{ id: string }, ProcessFormData>('/api/processes', 'post', {
    onSuccess: (data) => {
      toast.success('Processo criado com sucesso');
      navigate(`/importacao/processos/${data.id}`);
    },
  });

  const onSubmit = (data: ProcessFormData) => {
    mutation.mutate(data);
  };

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
          onClick={() => navigate('/importacao/processos')}
          className="rounded-lg p-2 text-slate-400 hover:text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:bg-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200 transition-all"
          aria-label="Voltar para lista de processos"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div>
          <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100 tracking-tight">
            Novo processo
          </h2>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Preencha os dados para criar um novo processo de importação.
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
        {/* Main Fields */}
        <div className="rounded-2xl border border-slate-200/60 bg-white dark:bg-slate-800 dark:border-slate-700/60 p-5 shadow-sm space-y-6">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary-50 text-primary-600">
              <Ship className="h-5 w-5" />
            </div>
            <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">
              Dados gerais
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
            <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Exportador</h3>
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
            <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Importador</h3>
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
              {errors.totalFobValue && <p className={errorClass}>{errors.totalFobValue.message}</p>}
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
          <label htmlFor="notes" className="sr-only">
            Observacoes
          </label>
          <textarea
            id="notes"
            {...register('notes')}
            rows={4}
            placeholder="Observacoes adicionais sobre o processo..."
            className={inputClass}
          />
        </div>

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
            onClick={() => navigate('/importacao/processos')}
            className="rounded-lg border border-slate-200 dark:border-slate-600 px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:bg-slate-900 dark:hover:bg-slate-700 active:scale-[0.98] transition-colors"
          >
            Cancelar
          </button>
          <SubmitButton
            type="submit"
            loading={mutation.isPending}
            disabled={isSubmitting || mutation.isPending}
          >
            Criar Processo
          </SubmitButton>
        </div>
      </form>
    </div>
  );
}
