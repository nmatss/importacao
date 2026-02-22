import { useEffect, useState, useRef } from "react"
import { cn, certStatusColor } from "@/shared/lib/utils"
import { streamCertValidation } from "@/shared/lib/cert-api-client"
import { CheckCircle2, XCircle, Loader2 } from "lucide-react"

interface ProgressEvent {
  type: "progress" | "complete" | "error"
  current?: number
  total?: number
  product?: { sku: string; name: string; status: string; score: number }
  summary?: any
  error?: string
}

export function CertValidationProgress({
  runId,
  onComplete,
}: {
  runId: string | null
  onComplete?: (summary: any) => void
}) {
  const [events, setEvents] = useState<ProgressEvent[]>([])
  const [progress, setProgress] = useState({ current: 0, total: 0 })
  const [status, setStatus] = useState<"running" | "complete" | "error">("running")
  const logRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!runId) return

    setEvents([])
    setProgress({ current: 0, total: 0 })
    setStatus("running")

    const es = streamCertValidation(runId, (data: ProgressEvent) => {
      if (data.type === "progress") {
        setProgress({ current: data.current || 0, total: data.total || 0 })
        setEvents((prev) => [...prev, data])
      } else if (data.type === "complete") {
        setStatus("complete")
        onComplete?.(data.summary)
      } else if (data.type === "error") {
        setStatus("error")
      }
    })

    return () => es.close()
  }, [runId])

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight
    }
  }, [events])

  if (!runId) return null

  const pct = progress.total > 0 ? (progress.current / progress.total) * 100 : 0

  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
      <div className="p-4 border-b border-slate-100">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            {status === "running" && <Loader2 className="w-4 h-4 text-blue-600 animate-spin" />}
            {status === "complete" && <CheckCircle2 className="w-4 h-4 text-emerald-600" />}
            {status === "error" && <XCircle className="w-4 h-4 text-red-600" />}
            <span className="text-sm font-medium text-slate-700">
              {status === "running" && `Validando... ${progress.current}/${progress.total}`}
              {status === "complete" && "Validacao completa!"}
              {status === "error" && "Erro na validacao"}
            </span>
          </div>
          <span className="text-sm text-slate-500">{pct.toFixed(0)}%</span>
        </div>
        <div className="w-full bg-slate-100 rounded-full h-2">
          <div
            className={cn(
              "h-2 rounded-full transition-all duration-300",
              status === "complete" ? "bg-emerald-500" : status === "error" ? "bg-red-500" : "bg-blue-600"
            )}
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      <div ref={logRef} className="max-h-64 overflow-auto p-3 space-y-1 font-mono text-xs">
        {events.map((e, i) => (
          <div key={i} className="flex items-center gap-2">
            <span className="text-slate-400 w-8 text-right">{e.current}</span>
            <span className={cn("px-1.5 py-0.5 rounded text-[10px] font-medium", certStatusColor(e.product?.status || ""))}>
              {e.product?.status}
            </span>
            <span className="text-slate-600">{e.product?.sku}</span>
            <span className="text-slate-400 truncate">{e.product?.name}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
