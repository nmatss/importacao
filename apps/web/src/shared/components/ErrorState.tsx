import { AlertTriangle, RotateCcw } from 'lucide-react';

interface ErrorStateProps {
  message?: string;
  onRetry?: () => void;
}

export function ErrorState({
  message = 'Erro ao carregar dados. Tente novamente.',
  onRetry,
}: ErrorStateProps) {
  return (
    <div
      role="alert"
      className="flex flex-col items-center justify-center py-16 text-center animate-fade-in"
    >
      <div className="mb-4 rounded-2xl bg-danger-50 dark:bg-danger-900/30 p-5">
        <AlertTriangle className="h-7 w-7 text-danger-500" />
      </div>
      <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Erro</h3>
      <p className="mt-1.5 max-w-sm text-sm text-slate-500 dark:text-slate-400 leading-relaxed">
        {message}
      </p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="mt-5 inline-flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white transition-all hover:bg-primary-700 active:scale-[0.98] shadow-sm"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          Tentar novamente
        </button>
      )}
    </div>
  );
}
