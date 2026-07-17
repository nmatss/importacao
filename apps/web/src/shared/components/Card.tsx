import { type HTMLAttributes } from 'react';
import { cn } from '@/shared/lib/utils';

/**
 * Primitivo de card (auditoria 2026-07-17): o wrapper
 * `rounded-2xl border … bg-white dark:bg-slate-800` estava repetido em dezenas
 * de telas com variações acidentais. Migração incremental — novas telas usam
 * Card, as existentes migram conforme forem tocadas.
 */
export function Card({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'rounded-2xl border border-slate-200/60 bg-white shadow-sm dark:border-slate-700/60 dark:bg-slate-800',
        className,
      )}
      {...rest}
    />
  );
}

export function CardHeader({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('border-b border-slate-100 px-4 py-4 dark:border-slate-700 sm:px-6', className)}
      {...rest}
    />
  );
}

export function CardBody({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('p-4 sm:p-6', className)} {...rest} />;
}
