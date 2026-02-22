import { useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { ArrowLeft } from 'lucide-react';
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
}

export function ProcessEditPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const { data: process, isLoading } = useApiQuery<Process>(
    ['process', id!],
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
      <div className="py-12 text-center text-gray-500">
        Processo nao encontrado.
      </div>
    );
  }

  const inputClass =
    'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500';
  const labelClass = 'block text-sm font-medium text-gray-700 mb-1';
  const errorClass = 'mt-1 text-xs text-red-600';

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-center gap-3">
        <button
          onClick={() => navigate(`/importacao/processos/${id}`)}
          className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100 transition-colors"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <h2 className="text-2xl font-bold text-gray-900">
          Editar Processo - {process.processCode}
        </h2>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
        <div className="rounded-lg border border-gray-200 bg-white p-6 space-y-5">
          <h3 className="text-lg font-semibold text-gray-900">Dados Gerais</h3>
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <div>
              <label className={labelClass}>
                Codigo do Processo <span className="text-red-500">*</span>
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

        <div className="rounded-lg border border-gray-200 bg-white p-6 space-y-5">
          <h3 className="text-lg font-semibold text-gray-900">Exportador</h3>
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <div className="sm:col-span-1">
              <label className={labelClass}>Nome</label>
              <input {...register('exporterName')} className={inputClass} />
            </div>
            <div className="sm:col-span-2">
              <label className={labelClass}>Endereco</label>
              <textarea {...register('exporterAddress')} rows={2} className={inputClass} />
            </div>
          </div>
        </div>

        <div className="rounded-lg border border-gray-200 bg-white p-6 space-y-5">
          <h3 className="text-lg font-semibold text-gray-900">Importador</h3>
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <div className="sm:col-span-1">
              <label className={labelClass}>Nome</label>
              <input {...register('importerName')} className={inputClass} />
            </div>
            <div className="sm:col-span-2">
              <label className={labelClass}>Endereco</label>
              <textarea {...register('importerAddress')} rows={2} className={inputClass} />
            </div>
          </div>
        </div>

        <div className="rounded-lg border border-gray-200 bg-white p-6 space-y-5">
          <h3 className="text-lg font-semibold text-gray-900">Observacoes</h3>
          <textarea
            {...register('notes')}
            rows={4}
            placeholder="Observacoes adicionais..."
            className={inputClass}
          />
        </div>

        {mutation.error && (
          <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
            {mutation.error.message}
          </div>
        )}

        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={() => navigate(`/importacao/processos/${id}`)}
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={isSubmitting || mutation.isPending}
            className="rounded-lg bg-blue-600 px-6 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {mutation.isPending ? 'Salvando...' : 'Salvar Alteracoes'}
          </button>
        </div>
      </form>
    </div>
  );
}
