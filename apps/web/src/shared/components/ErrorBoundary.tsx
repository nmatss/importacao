import { Component, type ReactNode } from 'react';

interface Props { children: ReactNode; }
interface State { hasError: boolean; error: Error | null; }

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
        <div className="flex min-h-screen flex-col items-center justify-center p-8">
          <div className="max-w-md rounded-xl border border-red-200 bg-red-50 p-8 text-center">
            <h2 className="text-lg font-semibold text-red-800">Algo deu errado</h2>
            <p className="mt-2 text-sm text-red-600">{this.state.error?.message}</p>
            <button
              onClick={() => window.location.reload()}
              className="mt-4 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
            >
              Recarregar Pagina
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
