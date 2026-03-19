import { AlertTriangle } from 'lucide-react';

interface ErrorStateProps {
  message?: string;
  onRetry?: () => void;
}

export function ErrorState({
  message = 'Erro ao carregar dados. Tente novamente.',
  onRetry,
}: ErrorStateProps) {
  return (
    <div role="alert" className="flex flex-col items-center justify-center py-16 text-center">
      <div className="mb-4 rounded-2xl bg-red-50 p-4">
        <AlertTriangle className="h-8 w-8 text-red-400" />
      </div>
      <h3 className="text-base font-semibold text-slate-900">Erro</h3>
      <p className="mt-1 max-w-sm text-sm text-slate-500">{message}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="mt-4 rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700"
        >
          Tentar novamente
        </button>
      )}
    </div>
  );
}
