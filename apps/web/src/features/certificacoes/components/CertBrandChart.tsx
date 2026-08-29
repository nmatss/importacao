import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import { BarChart3, AlertTriangle } from 'lucide-react';
import { useTheme } from '@/shared/contexts/ThemeContext';

interface BrandData {
  brand: string;
  ok: number;
  missing?: number;
  inconsistent: number;
  not_found: number;
  never_validated?: number;
}

export function CertBrandChart({ data, error }: { data?: BrandData[]; error?: boolean }) {
  // Recharts recebe cor por prop/inline style: as classes `dark:` do Tailwind
  // nao alcancam grade, eixos e tooltip.
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';
  const gridColor = isDark ? '#334155' : '#e2e8f0';
  const axisColor = isDark ? '#94a3b8' : '#64748b';
  const surfaceColor = isDark ? '#1e293b' : '#ffffff';

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3 text-danger-600 dark:text-danger-400">
        <AlertTriangle className="w-10 h-10 text-danger-400" />
        <span className="text-sm font-medium">Não foi possível carregar</span>
      </div>
    );
  }

  if (!data || data.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-slate-400 gap-3">
        <BarChart3 className="w-10 h-10 text-slate-300 dark:text-slate-600" />
        <span className="text-sm font-medium">Nenhum dado disponível</span>
      </div>
    );
  }

  // Merge missing into not_found for display
  const chartData = data.map((d) => ({
    ...d,
    not_found: (d.not_found || 0) + (d.missing || 0),
    never_validated: d.never_validated || 0,
  }));

  return (
    <div>
      <ResponsiveContainer width="100%" height={300}>
        <BarChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
          <CartesianGrid
            strokeDasharray="3 3"
            stroke={gridColor}
            strokeOpacity={0.7}
            vertical={false}
          />
          <XAxis
            dataKey="brand"
            tick={{ fontSize: 12, fill: axisColor, fontWeight: 500 }}
            axisLine={{ stroke: gridColor }}
            tickLine={false}
          />
          <YAxis tick={{ fontSize: 12, fill: axisColor }} axisLine={false} tickLine={false} />
          <Tooltip
            contentStyle={{
              backgroundColor: surfaceColor,
              border: `1px solid ${gridColor}`,
              borderRadius: '12px',
              fontSize: '12px',
              color: isDark ? '#e2e8f0' : '#0f172a',
              boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.07), 0 2px 4px -2px rgb(0 0 0 / 0.05)',
              padding: '10px 14px',
            }}
            cursor={{ fill: 'rgba(148, 163, 184, 0.08)' }}
          />
          <Legend
            wrapperStyle={{
              fontSize: '12px',
              fontWeight: 500,
              paddingTop: '16px',
              color: axisColor,
            }}
            iconType="circle"
            iconSize={8}
          />
          <Bar dataKey="ok" name="Conforme" fill="#10b981" radius={[4, 4, 0, 0]} />
          <Bar dataKey="inconsistent" name="Inconsistente" fill="#f59e0b" radius={[4, 4, 0, 0]} />
          <Bar dataKey="not_found" name="Não Encontrado" fill="#94a3b8" radius={[4, 4, 0, 0]} />
          {/* Cor neutra e mais clara que "Não Encontrado": ausência de veredito. */}
          <Bar dataKey="never_validated" name="Não validado" fill="#cbd5e1" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
