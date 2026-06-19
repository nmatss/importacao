import { ArrowDownToLine } from 'lucide-react';

interface FupComparisonPanelProps {
  // Kept for call-site compatibility; the comparison data now lives in the
  // Comparativo Geral (DocumentComparison), which is the single canonical
  // surface for cross-document and document-vs-system checks.
  processId?: string;
}

/**
 * The standalone "Documentos vs Sistema" and "Cruzamento entre Documentos"
 * quadros used to live here. They were merged INTO the Comparativo Geral
 * (DocumentComparison) to remove the duplicated panels Eduarda flagged, so the
 * deterministic comparison is the single source of truth for unmatched items.
 *
 * This component is intentionally a thin pointer now — it carries no validation
 * actions (those live in ValidationChecklist) and no comparison tables.
 */
export function FupComparisonPanel(_props: FupComparisonPanelProps) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50/60 dark:bg-slate-900/40 px-4 py-3">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary-50 dark:bg-primary-950/30 border border-primary-100 dark:border-primary-800">
        <ArrowDownToLine className="h-4.5 w-4.5 text-primary-400" />
      </div>
      <p className="text-sm text-slate-600 dark:text-slate-400">
        O cruzamento entre documentos e a comparacao com o sistema agora ficam no{' '}
        <span className="font-semibold text-slate-700 dark:text-slate-300">Comparativo Geral</span>{' '}
        abaixo, em um unico quadro.
      </p>
    </div>
  );
}
