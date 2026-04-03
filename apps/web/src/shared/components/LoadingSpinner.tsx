import { cn } from '@/shared/lib/utils';

interface LoadingSpinnerProps {
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  label?: string;
}

const sizes = {
  sm: 'h-4 w-4 border-[2px]',
  md: 'h-8 w-8 border-[2.5px]',
  lg: 'h-12 w-12 border-[3px]',
};

export function LoadingSpinner({ size = 'md', className, label }: LoadingSpinnerProps) {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-3', className)}>
      <div
        className={cn(
          'animate-spin rounded-full border-slate-200 border-t-primary-600',
          sizes[size],
        )}
      />
      {label && <span className="text-xs text-slate-500 font-medium">{label}</span>}
    </div>
  );
}
