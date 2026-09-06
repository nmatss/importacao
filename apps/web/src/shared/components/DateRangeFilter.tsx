import { Calendar } from 'lucide-react';

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
          value={startDate}
          onChange={(e) => onStartDateChange(e.target.value)}
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
          value={endDate}
          onChange={(e) => onEndDateChange(e.target.value)}
          className="w-full sm:w-auto rounded-lg border border-slate-200 dark:border-slate-600 dark:bg-slate-800 px-3 py-2 text-sm text-slate-700 dark:text-slate-200 focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 focus:outline-none transition-all"
        />
      </label>
    </fieldset>
  );
}
