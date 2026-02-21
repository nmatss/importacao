import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { ArrowLeft } from 'lucide-react';
import { useApiMutation } from '@/shared/hooks/useApi';

const processSchema = z.object({
  processCode: z.string().min(1, 'Código do processo é obrigatório'),
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

  const mutation = useApiMutation<{ id: string }, ProcessFormData>(
    '/api/processes',
    'post',
    {
      onSuccess: (data) => {
        navigate(`/processos/${data.id}`);
      },
    },
  );

  const onSubmit = (data: ProcessFormData) => {
    mutation.mutate(data);
  };

  const inputClass =
    'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500';
  const labelClass = 'block text-sm font-medium text-gray-700 mb-1';
  const errorClass = 'mt-1 text-xs text-red-600';

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => navigate('/processos')}
          className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100 transition-colors"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <h2 className="text-2xl font-bold text-gray-900">Novo Processo</h2>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
        {/* Main Fields */}
        <div className="rounded-lg border border-gray-200 bg-white p-6 space-y-5">
          <h3 className="text-lg font-semibold text-gray-900">Dados Gerais</h3>

          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <div>
              <label className={labelClass}>
                Código do Processo <span className="text-red-500">*</span>
              </label>
              <input {...register('processCode')} className={inputClass} />
              {errors.processCode && (
                <p className={errorClass}>{errors.processCode.message}</p>
              )}
            </div>

            <div>
              <label className={labelClass}>
                Marca <span className="text-red-500">*</span>
              </label>
              <select {...register('brand')} className={inputClass}>
                <option value="">Selecione...</option>
                <option value="puket">Puket</option>
                <option value="imaginarium">Imaginarium</option>
              </select>
              {errors.brand && (
                <p className={errorClass}>{errors.brand.message}</p>
              )}
            </div>

            <div>
              <label className={labelClass}>Incoterm</label>
              <input {...register('incoterm')} className={inputClass} />
            </div>

            <div>
              <label className={labelClass}>Porto de Embarque</label>
              <input {...register('portOfLoading')} className={inputClass} />
            </div>

            <div>
              <label className={labelClass}>Porto de Destino</label>
              <input {...register('portOfDischarge')} className={inputClass} />
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
        <div className="rounded-lg border border-gray-200 bg-white p-6 space-y-5">
          <h3 className="text-lg font-semibold text-gray-900">Exportador</h3>
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <div className="sm:col-span-1">
              <label className={labelClass}>Nome</label>
              <input {...register('exporterName')} className={inputClass} />
            </div>
            <div className="sm:col-span-2">
              <label className={labelClass}>Endereço</label>
              <textarea
                {...register('exporterAddress')}
                rows={2}
                className={inputClass}
              />
            </div>
          </div>
        </div>

        {/* Importer */}
        <div className="rounded-lg border border-gray-200 bg-white p-6 space-y-5">
          <h3 className="text-lg font-semibold text-gray-900">Importador</h3>
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <div className="sm:col-span-1">
              <label className={labelClass}>Nome</label>
              <input {...register('importerName')} className={inputClass} />
            </div>
            <div className="sm:col-span-2">
              <label className={labelClass}>Endereço</label>
              <textarea
                {...register('importerAddress')}
                rows={2}
                className={inputClass}
              />
            </div>
          </div>
        </div>

        {/* Notes */}
        <div className="rounded-lg border border-gray-200 bg-white p-6 space-y-5">
          <h3 className="text-lg font-semibold text-gray-900">Observações</h3>
          <textarea
            {...register('notes')}
            rows={4}
            placeholder="Observações adicionais..."
            className={inputClass}
          />
        </div>

        {/* Error message */}
        {mutation.error && (
          <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
            {mutation.error.message}
          </div>
        )}

        {/* Actions */}
        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={() => navigate('/processos')}
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={isSubmitting || mutation.isPending}
            className="rounded-lg bg-blue-600 px-6 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {mutation.isPending ? 'Criando...' : 'Criar Processo'}
          </button>
        </div>
      </form>
    </div>
  );
}
