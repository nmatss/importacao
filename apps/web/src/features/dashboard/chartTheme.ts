import type { CSSProperties } from 'react';
import { useTheme } from '@/shared/contexts/ThemeContext';

/**
 * Cores dos graficos Recharts derivadas do tema ativo.
 *
 * Recharts recebe cor por prop/inline style, entao as classes `dark:` do
 * Tailwind nao alcancam grade, eixos, tooltip e contorno das fatias. Estavam
 * fixos em claro (`#e2e8f0`, `#fff`) dentro de paginas que TEM tema escuro —
 * tooltip branco e grade clara sobre fundo escuro.
 *
 * Consome o ThemeContext (shared/) sem alterar nada la.
 */
export interface ChartTheme {
  /** Linhas da grade e dos eixos. */
  grid: string;
  /** Texto de ticks, legenda e rotulos. */
  axis: string;
  /** Contorno das fatias do pie — casa com o fundo do cartao. */
  surface: string;
  tooltip: CSSProperties;
  legend: CSSProperties;
}

export function useChartTheme(): ChartTheme {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';

  const grid = isDark ? '#334155' : '#e2e8f0';
  const axis = isDark ? '#94a3b8' : '#64748b';
  const surface = isDark ? '#1e293b' : '#ffffff';

  return {
    grid,
    axis,
    surface,
    tooltip: {
      backgroundColor: surface,
      border: `1px solid ${grid}`,
      borderRadius: '12px',
      boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
      fontSize: '14px',
      color: isDark ? '#e2e8f0' : '#0f172a',
    },
    legend: { fontSize: '12px', color: axis },
  };
}
