import { Calendar } from 'lucide-react';

interface DateRangeFilterProps {
  startDate: string;
  endDate: string;
  onStartDateChange: (value: string) => void;
  onEndDateChange: (value: string) => void;
  label?: string;
}

export function DateRangeFilter({
  startDate,
  endDate,
  onStartDateChange,
  onEndDateChange,
  label = 'Periodo',
}: DateRangeFilterProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Calendar className="w-4 h-4 text-slate-400 flex-shrink-0 hidden sm:block" />
      <span className="text-xs font-semibold text-slate-500 whitespace-nowrap hidden sm:inline">
        {label}
      </span>
      <input
        type="date"
        value={startDate}
        onChange={(e) => onStartDateChange(e.target.value)}
        className="w-full sm:w-auto rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-700 focus:border-blue-500 focus:ring-4 focus:ring-blue-500/20 focus:outline-none transition-all"
      />
      <span className="text-xs text-slate-400">ate</span>
      <input
        type="date"
        value={endDate}
        onChange={(e) => onEndDateChange(e.target.value)}
        className="w-full sm:w-auto rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-700 focus:border-blue-500 focus:ring-4 focus:ring-blue-500/20 focus:outline-none transition-all"
      />
    </div>
  );
}
