import { Component, type ReactNode } from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';
import { DocumentComparison } from '@/features/documents/DocumentComparison';
import { ValidationChecklist } from '@/features/validation/ValidationChecklist';

export interface ComparisonTabProps {
  processId: string;
}

interface TabErrorBoundaryProps {
  children: ReactNode;
  /** Short label shown in the fallback so the user knows which area failed. */
  label?: string;
}

interface TabErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

/**
 * Lightweight, reusable boundary scoped to a single tab/section. Unlike the
 * app-level ErrorBoundary (which forces a full page reload and a white screen),
 * this renders a localized "algo deu errado nesta aba" fallback and lets the
 * user retry by remounting the subtree — the rest of the app stays alive.
 */
export class TabErrorBoundary extends Component<TabErrorBoundaryProps, TabErrorBoundaryState> {
  constructor(props: TabErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): TabErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('TabErrorBoundary caught:', error, info);
  }

  reset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div
          role="alert"
          className="flex flex-col items-center justify-center gap-3 rounded-xl border border-danger-200/60 bg-danger-50/40 dark:border-danger-800/60 dark:bg-danger-950/20 px-6 py-10 text-center"
        >
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-danger-100 dark:bg-danger-900/40">
            <AlertTriangle className="h-5 w-5 text-danger-500" />
          </div>
          <div>
            <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Algo deu errado nesta aba
            </p>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              {this.state.error?.message ||
                'Nao foi possivel exibir esta secao. As demais areas continuam disponiveis.'}
            </p>
          </div>
          <button
            type="button"
            onClick={this.reset}
            className="inline-flex items-center gap-2 rounded-lg bg-primary-600 px-3.5 py-2 text-xs font-medium text-white hover:bg-primary-700 transition-colors"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Tentar novamente
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

export function ComparisonTab({ processId }: ComparisonTabProps) {
  return (
    <div className="space-y-8">
      <div>
        <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100">
          Comparativo de documentos
        </h3>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Validação, cruzamento e aceite operacional de divergências em uma única tela.
        </p>
      </div>

      <section className="space-y-3">
        <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
          Validação e e-mail de correção
        </h4>
        {/*
          Each heavy panel gets its own boundary so a crash in the validation
          area does not take down the cruzamento below it (and vice-versa) —
          one tab/section failing must never blank the whole app.
        */}
        <TabErrorBoundary label="Validação">
          <ValidationChecklist processId={processId} />
        </TabErrorBoundary>
      </section>

      <section className="space-y-3">
        <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
          Cruzamento documental
        </h4>
        <TabErrorBoundary label="Cruzamento documental">
          <DocumentComparison processId={processId} />
        </TabErrorBoundary>
      </section>
    </div>
  );
}
