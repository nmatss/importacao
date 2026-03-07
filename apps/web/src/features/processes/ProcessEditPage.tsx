import { useEffect } from 'react';
import { useParams, useNavigate, Navigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { ArrowLeft, Ship, Building2, Warehouse, FileText, DollarSign } from 'lucide-react';
import { useApiQuery, useApiMutation } from '@/shared/hooks/useApi';
import { LoadingSpinner } from '@/shared/components/LoadingSpinner';

const processSchema = z.object({
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
  totalFobValue: z.string().optional(),
  freightValue: z.string().optional(),
  totalCbm: z.string().optional(),
  totalBoxes: z.coerce.number().optional(),
  totalNetWeight: z.string().optional(),
  totalGrossWeight: z.string().optional(),
  shipmentDate: z.string().optional(),
});

type ProcessFormData = z.infer<typeof processSchema>;

interface Process {
  id: string;
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
  totalCbm: string | null;
  totalBoxes: number | null;
  totalNetWeight: string | null;
  totalGrossWeight: string | null;
  shipmentDate: string | null;
}

export function ProcessEditPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  if (!id) return <Navigate to="/importacao/processos" replace />;

  const { data: process, isLoading } = useApiQuery<Process>(
    ['process', id],
    `/api/processes/${id}`,
  );

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
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
        totalCbm: process.totalCbm || '',
        totalBoxes: process.totalBoxes ?? undefined,
        totalNetWeight: process.totalNetWeight || '',
        totalGrossWeight: process.totalGrossWeight || '',
        shipmentDate: process.shipmentDate ? process.shipmentDate.slice(0, 10) : '',
      });
    }
  }, [process, reset]);

  const mutation = useApiMutation<Process, ProcessFormData>(
    `/api/processes/${id}`,
    'put',
    {
      onSuccess: () => {
        navigate(`/importacao/processos/${id}`);
      },
    },
  );

  const onSubmit = (data: ProcessFormData) => {
    mutation.mutate(data);
  };

  if (isLoading) {
    return <LoadingSpinner size="lg" className="py-24" />;
  }

  if (!process) {
    return (
      <div className="flex flex-col items-center justify-center py-24">
        <p className="text-sm text-slate-500">Processo nao encontrado.</p>
        <button
          onClick={() => navigate('/importacao/processos')}
          className="mt-4 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors"
        >
          Voltar para lista
        </button>
      </div>
    );
  }

  const inputClass =
    'w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:ring-4 focus:ring-blue-500/20 focus:outline-none transition-all';
  const labelClass = 'block text-sm font-medium text-slate-700 mb-1.5';
  const errorClass = 'mt-1.5 text-xs text-red-600';

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => navigate(`/importacao/processos/${id}`)}
          className="rounded-xl p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-all"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div>
          <h2 className="text-2xl font-bold text-slate-900 tracking-tight">
            Editar Processo
          </h2>
          <p className="text-sm text-slate-500">{process.processCode}</p>
        </div>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
        {/* Main Fields */}
        <div className="rounded-2xl border border-slate-200/80 bg-white p-7 shadow-sm space-y-6">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
              <Ship className="h-5 w-5" />
            </div>
            <h3 className="text-lg font-semibold text-slate-900">Dados Gerais</h3>
          </div>
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <div>
              <label className={labelClass}>
                Codigo do Processo <span className="text-red-500">*</span>
              </label>
              <input
                {...register('processCode')}
                placeholder="Ex: IMP-2024-001"
                className={inputClass}
              />
              {errors.processCode && (
                <p className={errorClass}>{errors.processCode.message}</p>
              )}
            </div>
            <div>
              <label className={labelClass}>
                Marca <span className="text-red-500">*</span>
              </label>
              <select {...register('brand')} className={inputClass}>
                <option value="">Selecione a marca...</option>
                <option value="puket">Puket</option>
                <option value="imaginarium">Imaginarium</option>
              </select>
              {errors.brand && (
                <p className={errorClass}>{errors.brand.message}</p>
              )}
            </div>
            <div>
              <label className={labelClass}>Incoterm</label>
              <input {...register('incoterm')} placeholder="FOB" className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Porto de Embarque</label>
              <input
                {...register('portOfLoading')}
                placeholder="Ex: Shanghai"
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>Porto de Destino</label>
              <input
                {...register('portOfDischarge')}
                placeholder="Ex: Santos"
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>ETD</label>
              <input type="date" {...register('etd')} className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>ETA</label>
              <input type="date" {...register('eta')} className={inputClass} />
            </div>
          </div>
        </div>

        {/* Exporter */}
        <div className="rounded-2xl border border-slate-200/80 bg-white p-7 shadow-sm space-y-6">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
              <Building2 className="h-5 w-5" />
            </div>
            <h3 className="text-lg font-semibold text-slate-900">Exportador</h3>
          </div>
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <div className="sm:col-span-1">
              <label className={labelClass}>Nome</label>
              <input
                {...register('exporterName')}
                placeholder="Nome do exportador"
                className={inputClass}
              />
            </div>
            <div className="sm:col-span-2">
              <label className={labelClass}>Endereco</label>
              <textarea
                {...register('exporterAddress')}
                rows={2}
                placeholder="Endereco completo do exportador"
                className={inputClass}
              />
            </div>
          </div>
        </div>

        {/* Importer */}
        <div className="rounded-2xl border border-slate-200/80 bg-white p-7 shadow-sm space-y-6">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-violet-50 text-violet-600">
              <Warehouse className="h-5 w-5" />
            </div>
            <h3 className="text-lg font-semibold text-slate-900">Importador</h3>
          </div>
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <div className="sm:col-span-1">
              <label className={labelClass}>Nome</label>
              <input
                {...register('importerName')}
                placeholder="Nome do importador"
                className={inputClass}
              />
            </div>
            <div className="sm:col-span-2">
              <label className={labelClass}>Endereco</label>
              <textarea
                {...register('importerAddress')}
                rows={2}
                placeholder="Endereco completo do importador"
                className={inputClass}
              />
            </div>
          </div>
        </div>

        {/* Financial & Cargo */}
        <div className="rounded-2xl border border-slate-200/80 bg-white p-7 shadow-sm space-y-6">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-green-50 text-green-600">
              <DollarSign className="h-5 w-5" />
            </div>
            <h3 className="text-lg font-semibold text-slate-900">Dados Financeiros e Carga</h3>
          </div>
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <div>
              <label className={labelClass}>Valor FOB USD</label>
              <input
                type="number"
                step="0.01"
                {...register('totalFobValue')}
                placeholder="0.00"
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>Valor Frete USD</label>
              <input
                type="number"
                step="0.01"
                {...register('freightValue')}
                placeholder="0.00"
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>Tipo Container</label>
              <input
                {...register('containerType')}
                placeholder="Ex: 40HC"
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>Quantidade Caixas</label>
              <input
                type="number"
                step="1"
                {...register('totalBoxes')}
                placeholder="0"
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>Peso Liquido kg</label>
              <input
                type="number"
                step="0.01"
                {...register('totalNetWeight')}
                placeholder="0.00"
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>Peso Bruto kg</label>
              <input
                type="number"
                step="0.01"
                {...register('totalGrossWeight')}
                placeholder="0.00"
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>CBM m3</label>
              <input
                type="number"
                step="0.01"
                {...register('totalCbm')}
                placeholder="0.00"
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>Data Embarque</label>
              <input type="date" {...register('shipmentDate')} className={inputClass} />
            </div>
          </div>
        </div>

        {/* Notes */}
        <div className="rounded-2xl border border-slate-200/80 bg-white p-7 shadow-sm space-y-6">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-50 text-amber-600">
              <FileText className="h-5 w-5" />
            </div>
            <h3 className="text-lg font-semibold text-slate-900">Observacoes</h3>
          </div>
          <textarea
            {...register('notes')}
            rows={4}
            placeholder="Observacoes adicionais sobre o processo..."
            className={inputClass}
          />
        </div>

        {/* Error message */}
        {mutation.error && (
          <div className="rounded-xl bg-red-50 border border-red-200 px-5 py-4 text-sm text-red-700">
            {mutation.error.message}
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center justify-end gap-3 rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm">
          <button
            type="button"
            onClick={() => navigate(`/importacao/processos/${id}`)}
            className="rounded-xl border border-slate-200 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 active:scale-[0.98] transition-all"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={isSubmitting || mutation.isPending}
            className="rounded-xl bg-gradient-to-r from-blue-600 to-blue-700 px-6 py-2.5 text-sm font-semibold text-white shadow-sm hover:from-blue-700 hover:to-blue-800 active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none transition-all"
          >
            {mutation.isPending ? 'Salvando...' : 'Salvar Alteracoes'}
          </button>
        </div>
      </form>
    </div>
  );
}
