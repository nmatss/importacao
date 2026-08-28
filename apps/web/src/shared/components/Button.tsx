import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '@/shared/lib/utils';

/**
 * Primitivo de botão (auditoria 2026-07-17): o gradiente esmeralda/índigo
 * estava copiado inline em dezenas de telas, com variações acidentais. Fonte
 * única de variante × accent; migração incremental — novas telas usam Button,
 * as existentes migram conforme forem tocadas.
 */

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';
type Accent = 'primary' | 'emerald';

const VARIANT: Record<Accent, Record<Variant, string>> = {
  primary: {
    primary:
      'bg-gradient-to-r from-primary-600 to-primary-700 text-white shadow-sm hover:from-primary-700 hover:to-primary-800',
    secondary:
      'border border-slate-200 bg-white text-slate-700 shadow-sm hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700',
    danger:
      'bg-gradient-to-r from-danger-600 to-danger-700 text-white shadow-sm hover:from-danger-700 hover:to-danger-800',
    ghost:
      'text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200',
  },
  emerald: {
    primary:
      'bg-gradient-to-r from-emerald-600 to-emerald-700 text-white shadow-sm hover:from-emerald-700 hover:to-emerald-800',
    secondary:
      'border border-slate-200 bg-white text-slate-700 shadow-sm hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700',
    danger:
      'bg-gradient-to-r from-danger-600 to-danger-700 text-white shadow-sm hover:from-danger-700 hover:to-danger-800',
    ghost:
      'text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200',
  },
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  accent?: Accent;
  loading?: boolean;
  size?: 'sm' | 'md';
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'primary',
    accent = 'primary',
    loading = false,
    size = 'md',
    className,
    children,
    disabled,
    type,
    ...rest
  },
  ref,
) {
  return (
    <button
      ref={ref}
      // default explícito evita submit acidental dentro de <form>
      type={type ?? 'button'}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition-all disabled:cursor-not-allowed disabled:opacity-50',
        size === 'sm' ? 'px-3 py-1.5 text-xs' : 'px-5 py-2.5 text-sm',
        VARIANT[accent][variant],
        className,
      )}
      {...rest}
    >
      {loading && <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />}
      {children}
    </button>
  );
});
