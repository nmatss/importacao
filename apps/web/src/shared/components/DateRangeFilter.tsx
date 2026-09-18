import { Calendar } from 'lucide-react';
import { useEffect, useId, useState } from 'react';

interface DateRangeFilterProps {
  startDate: string;
  endDate: string;
  onStartDateChange: (value: string) => void;
  onEndDateChange: (value: string) => void;
  label?: string;
  showLabel?: boolean;
}

export function DateRangeFilter({
  startDate,
  endDate,
  onStartDateChange,
  onEndDateChange,
  label = 'Período',
  showLabel = true,
}: DateRangeFilterProps) {
  const [draftStart, setDraftStart] = useState(startDate);
  const [draftEnd, setDraftEnd] = useState(endDate);
  const errorId = useId();
  useEffect(() => setDraftStart(startDate), [startDate]);
  useEffect(() => setDraftEnd(endDate), [endDate]);
  const invalid = !!(draftStart && draftEnd && draftStart > draftEnd);
  function change(start: string, end: string) {
    setDraftStart(start);
    setDraftEnd(end);
    if (start && end && start > end) return;
    if (start !== startDate) onStartDateChange(start);
    if (end !== endDate) onEndDateChange(end);
  }
  return (
    <fieldset className="grid min-w-0 grid-cols-1 gap-2 sm:flex sm:flex-wrap sm:items-center">
      <legend className="sr-only">{label}</legend>
      <Calendar
        aria-hidden="true"
        className="w-4 h-4 text-slate-400 flex-shrink-0 hidden sm:block"
      />
      {showLabel && (
        <span className="text-xs font-medium text-slate-500 dark:text-slate-400 whitespace-nowrap hidden sm:inline">
          {label}
        </span>
      )}
      <label className="grid min-w-0 gap-1 sm:block">
        <span className="text-xs font-medium text-slate-500 sm:sr-only">De</span>
        <input
          type="date"
          value={draftStart}
          max={draftEnd || undefined}
          aria-invalid={invalid}
          aria-describedby={invalid ? errorId : undefined}
          onChange={(e) => change(e.target.value, draftEnd)}
          className="w-full sm:w-auto rounded-lg border border-slate-200 dark:border-slate-600 dark:bg-slate-800 px-3 py-2 text-sm text-slate-700 dark:text-slate-200 focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 focus:outline-none transition-all"
        />
      </label>
      <span
        aria-hidden="true"
        className="hidden text-xs text-slate-500 dark:text-slate-400 sm:inline"
      >
        até
      </span>
      <label className="grid min-w-0 gap-1 sm:block">
        <span className="text-xs font-medium text-slate-500 sm:sr-only">Até</span>
        <input
          type="date"
          value={draftEnd}
          min={draftStart || undefined}
          aria-invalid={invalid}
          aria-describedby={invalid ? errorId : undefined}
          onChange={(e) => change(draftStart, e.target.value)}
          className="w-full sm:w-auto rounded-lg border border-slate-200 dark:border-slate-600 dark:bg-slate-800 px-3 py-2 text-sm text-slate-700 dark:text-slate-200 focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 focus:outline-none transition-all"
        />
      </label>
      {invalid && (
        <p id={errorId} role="alert" className="text-sm text-red-700 dark:text-red-300">
          A data final deve ser igual ou posterior à inicial. Ajuste o período para aplicar o
          filtro.
        </p>
      )}
    </fieldset>
  );
}
