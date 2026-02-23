import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts"
import { BarChart3 } from "lucide-react"

interface BrandData {
  brand: string
  ok: number
  missing: number
  inconsistent: number
  not_found: number
}

export function CertBrandChart({ data }: { data?: BrandData[] }) {
  if (!data || data.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-slate-400 gap-3">
        <BarChart3 className="w-10 h-10 text-slate-300" />
        <span className="text-sm font-medium">Nenhum dado disponível</span>
      </div>
    )
  }

  return (
    <div className="rounded-2xl border border-slate-200/80 shadow-sm bg-white p-6">
      <ResponsiveContainer width="100%" height={300}>
        <BarChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" strokeOpacity={0.7} vertical={false} />
          <XAxis
            dataKey="brand"
            tick={{ fontSize: 12, fill: "#64748b", fontWeight: 500 }}
            axisLine={{ stroke: '#e2e8f0' }}
            tickLine={false}
          />
          <YAxis
            tick={{ fontSize: 12, fill: "#94a3b8" }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: "#fff",
              border: "1px solid #e2e8f0",
              borderRadius: "12px",
              fontSize: "12px",
              boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.07), 0 2px 4px -2px rgb(0 0 0 / 0.05)",
              padding: "10px 14px",
            }}
            cursor={{ fill: 'rgba(148, 163, 184, 0.08)' }}
          />
          <Legend
            wrapperStyle={{ fontSize: "12px", fontWeight: 500, paddingTop: "16px" }}
            iconType="circle"
            iconSize={8}
          />
          <Bar dataKey="ok" name="Conforme" fill="#10b981" radius={[4, 4, 0, 0]} />
          <Bar dataKey="missing" name="Ausente" fill="#ef4444" radius={[4, 4, 0, 0]} />
          <Bar dataKey="inconsistent" name="Inconsistente" fill="#f59e0b" radius={[4, 4, 0, 0]} />
          <Bar dataKey="not_found" name="Não Encontrado" fill="#94a3b8" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
