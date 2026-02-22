import { cn, certStatusColor } from "@/shared/lib/utils"

export function CertStatusBadge({ status }: { status: string }) {
  return (
    <span className={cn("inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium", certStatusColor(status))}>
      {status}
    </span>
  )
}
