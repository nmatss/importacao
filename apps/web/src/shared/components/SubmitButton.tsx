import { Loader2 } from 'lucide-react';
import { cn } from '@/shared/lib/utils';

interface SubmitButtonProps {
  loading?: boolean;
  disabled?: boolean;
  className?: string;
  onClick?: () => void;
  type?: 'submit' | 'button' | 'reset';
  children: React.ReactNode;
  variant?: 'primary' | 'danger';
}

export function SubmitButton({
  loading = false,
  disabled = false,
  className,
  onClick,
  type = 'submit',
  children,
  variant = 'primary',
}: SubmitButtonProps) {
  const base =
    'inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none focus-visible:ring-2 focus-visible:ring-offset-2 focus:outline-none';
  const variants = {
    primary: 'bg-primary-600 hover:bg-primary-700 focus-visible:ring-primary-500',
    danger: 'bg-danger-600 hover:bg-danger-700 focus-visible:ring-danger-500',
  };

  return (
    <button
      type={type}
      disabled={disabled || loading}
      onClick={onClick}
      className={cn(base, variants[variant], className)}
    >
      {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
      {children}
    </button>
  );
}
