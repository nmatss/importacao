import { Component, type ReactNode } from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

interface Props {
  children: ReactNode;
}
interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('ErrorBoundary caught:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-screen flex-col items-center justify-center p-8 bg-slate-50">
          <div className="max-w-md rounded-2xl border border-danger-200/60 bg-white p-8 text-center shadow-sm">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-danger-50">
              <AlertTriangle className="h-6 w-6 text-danger-500" />
            </div>
            <h2 className="text-base font-semibold text-slate-900">Algo deu errado</h2>
            <p className="mt-2 text-sm text-slate-500">{this.state.error?.message}</p>
            <button
              onClick={() => window.location.reload()}
              className="mt-5 inline-flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 transition-colors shadow-sm"
            >
              <RotateCcw className="h-4 w-4" />
              Recarregar Página
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
