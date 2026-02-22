import { CheckCircle2, XCircle, AlertTriangle, Search, Package } from "lucide-react"
import { cn } from "@/shared/lib/utils"

interface StatsData {
  total: number
  ok: number
  missing: number
  inconsistent: number
  not_found: number
}

const CARDS = [
  { key: "total", label: "Total Produtos", icon: Package, color: "text-blue-600 bg-blue-50" },
  { key: "ok", label: "OK", icon: CheckCircle2, color: "text-emerald-600 bg-emerald-50" },
  { key: "missing", label: "Missing", icon: XCircle, color: "text-red-600 bg-red-50" },
  { key: "inconsistent", label: "Inconsistente", icon: AlertTriangle, color: "text-amber-600 bg-amber-50" },
  { key: "not_found", label: "Nao Encontrado", icon: Search, color: "text-slate-500 bg-slate-100" },
] as const

export function CertStatsCards({ data, loading }: { data?: StatsData; loading?: boolean }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
      {CARDS.map((card) => (
        <div
          key={card.key}
          className="bg-white rounded-xl border border-slate-200 p-4"
        >
          <div className="flex items-center gap-3">
            <div className={cn("p-2 rounded-lg", card.color)}>
              <card.icon className="w-4 h-4" />
            </div>
            <div>
              <p className="text-2xl font-bold text-slate-900">
                {loading ? "-" : (data?.[card.key] ?? 0)}
              </p>
              <p className="text-xs text-slate-500">{card.label}</p>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}
