import { useEffect, useState, useCallback } from "react"
import { Link } from "react-router-dom"
import { CertStatusBadge } from "@/features/certificacoes/components/CertStatusBadge"
import { fetchCertProducts, verifyCertProduct } from "@/shared/lib/cert-api-client"
import { cn, formatDateTime } from "@/shared/lib/utils"
import {
  Search,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Package,
  RefreshCw,
  ExternalLink,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  ChevronDown,
  ShieldCheck,
} from "lucide-react"

const BRANDS = [
  { value: "", label: "Todas as Marcas" },
  { value: "imaginarium", label: "Imaginarium" },
  { value: "puket", label: "Puket" },
  { value: "puket_escolares", label: "Puket Escolares" },
]

const STATUSES = [
  { value: "", label: "Todos os Status" },
  { value: "OK", label: "OK" },
  { value: "MISSING", label: "Missing" },
  { value: "INCONSISTENT", label: "Inconsistent" },
  { value: "URL_NOT_FOUND", label: "Not Found" },
  { value: "API_ERROR", label: "API Error" },
  { value: "NO_EXPECTED", label: "No Expected" },
]

interface CertProduct {
  sku: string;
  name: string;
  brand: string;
  last_validation_status: string | null;
  last_validation_score: number | null;
  last_validation_url: string | null;
  last_validation_date: string | null;
}

type SortField = "sku" | "name" | "brand" | "last_validation_status" | "last_validation_score"
type SortDir = "asc" | "desc"

export default function CertProdutosPage() {
  const [products, setProducts] = useState<CertProduct[]>([])
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [total, setTotal] = useState(0)
  const [perPage] = useState(25)
  const [search, setSearch] = useState("")
  const [searchInput, setSearchInput] = useState("")
  const [brand, setBrand] = useState("")
  const [status, setStatus] = useState("")
  const [lastDate, setLastDate] = useState<string | null>(null)
  const [verifying, setVerifying] = useState<string | null>(null)
  const [sortField, setSortField] = useState<SortField>("sku")
  const [sortDir, setSortDir] = useState<SortDir>("asc")

  const loadProducts = useCallback(async () => {
    setLoading(true)
    try {
      const data = await fetchCertProducts({
        page,
        per_page: perPage,
        search: search || undefined,
        brand: brand || undefined,
        status: status || undefined,
      })
      setProducts(data.products || [])
      setTotalPages(data.total_pages || 1)
      setTotal(data.total || 0)
      setLastDate(data.last_validation_date || null)
    } catch {
      setProducts([])
    } finally {
      setLoading(false)
    }
  }, [page, perPage, search, brand, status])

  useEffect(() => {
    loadProducts()
  }, [loadProducts])

  function handleSearch(e: React.FormEvent) {
    e.preventDefault()
    setPage(1)
    setSearch(searchInput)
  }

  function handleSort(field: SortField) {
    if (sortField === field) {
      setSortDir(sortDir === "asc" ? "desc" : "asc")
    } else {
      setSortField(field)
      setSortDir("asc")
    }
  }

  const sortedProducts = [...products].sort((a, b) => {
    const aVal = a[sortField] ?? ""
    const bVal = b[sortField] ?? ""
    if (typeof aVal === "number" && typeof bVal === "number") {
      return sortDir === "asc" ? aVal - bVal : bVal - aVal
    }
    const cmp = String(aVal).localeCompare(String(bVal), "pt-BR", { sensitivity: "base" })
    return sortDir === "asc" ? cmp : -cmp
  })

  async function handleVerify(sku: string, productBrand: string) {
    setVerifying(sku)
    try {
      const brandKey = productBrand.toLowerCase().replaceAll(" ", "_")
      const result = await verifyCertProduct(sku, brandKey)
      setProducts((prev) =>
        prev.map((p) =>
          p.sku === sku
            ? {
                ...p,
                last_validation_status: result.status,
                last_validation_score: result.score,
                last_validation_url: result.url,
                last_validation_date: result.verified_at,
              }
            : p
        )
      )
    } catch {
      // Silently handle - product row stays as-is
    } finally {
      setVerifying(null)
    }
  }

  function SortIcon({ field }: { field: SortField }) {
    if (sortField !== field) return <ArrowUpDown className="w-3 h-3 ml-1 opacity-30" />
    return sortDir === "asc"
      ? <ArrowUp className="w-3 h-3 ml-1 text-emerald-600" />
      : <ArrowDown className="w-3 h-3 ml-1 text-emerald-600" />
  }

  function scoreColor(score: number): string {
    if (score >= 0.9) return "text-emerald-700 bg-emerald-50"
    if (score >= 0.6) return "text-amber-700 bg-amber-50"
    return "text-red-700 bg-red-50"
  }

  return (
    <div className="p-5 md:p-7 space-y-6">
      {/* Filters Bar */}
      <div className="rounded-2xl border border-slate-200/80 shadow-sm bg-white p-5 md:p-6">
        <div className="flex flex-col lg:flex-row items-start lg:items-center gap-4">
          {/* Search */}
          <form onSubmit={handleSearch} className="flex items-center gap-2.5 flex-1 min-w-0">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                type="text"
                placeholder="Buscar por SKU ou nome..."
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-200 bg-white text-sm text-slate-700 placeholder:text-slate-400 focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/20 focus:outline-none transition-all"
              />
            </div>
            <button
              type="submit"
              className="px-5 py-2.5 rounded-xl text-sm font-semibold bg-gradient-to-r from-emerald-600 to-emerald-700 text-white hover:from-emerald-700 hover:to-emerald-800 active:scale-[0.98] transition-all shadow-sm shadow-emerald-600/20"
            >
              Buscar
            </button>
          </form>

          {/* Filter Selects */}
          <div className="flex items-center gap-3">
            <div className="relative">
              <select
                value={brand}
                onChange={(e) => { setBrand(e.target.value); setPage(1) }}
                className="appearance-none pl-4 pr-9 py-2.5 rounded-xl border border-slate-200 bg-white text-sm text-slate-700 focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/20 focus:outline-none transition-all cursor-pointer"
              >
                {BRANDS.map((b) => (
                  <option key={b.value} value={b.value}>{b.label}</option>
                ))}
              </select>
              <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
            </div>
            <div className="relative">
              <select
                value={status}
                onChange={(e) => { setStatus(e.target.value); setPage(1) }}
                className="appearance-none pl-4 pr-9 py-2.5 rounded-xl border border-slate-200 bg-white text-sm text-slate-700 focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/20 focus:outline-none transition-all cursor-pointer"
              >
                {STATUSES.map((s) => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
              <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
            </div>
          </div>
        </div>

        {/* Summary line */}
        <div className="flex items-center justify-between mt-4 pt-4 border-t border-slate-100">
          <p className="text-sm text-slate-500">
            <span className="font-semibold text-slate-700">{total}</span> produto{total !== 1 ? "s" : ""} encontrado{total !== 1 ? "s" : ""}
            {lastDate && (
              <span className="ml-3 text-slate-400">
                Ultima validacao: {formatDateTime(lastDate)}
              </span>
            )}
          </p>
          <button
            onClick={loadProducts}
            disabled={loading}
            className="flex items-center gap-2 px-3.5 py-1.5 rounded-xl text-xs font-medium text-slate-600 border border-slate-200 bg-white hover:bg-slate-50 active:scale-[0.98] transition-all"
          >
            <RefreshCw className={cn("w-3.5 h-3.5", loading && "animate-spin")} />
            Atualizar
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="rounded-2xl border border-slate-200/80 shadow-sm bg-white overflow-hidden">
        {loading ? (
          <div className="p-6 space-y-3">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4">
                <div className="h-4 w-20 bg-slate-100 rounded-lg animate-pulse" />
                <div className="h-4 flex-1 bg-slate-100 rounded-lg animate-pulse" />
                <div className="h-4 w-16 bg-slate-100 rounded-lg animate-pulse" />
                <div className="h-4 w-20 bg-slate-100 rounded-lg animate-pulse" />
                <div className="h-4 w-12 bg-slate-100 rounded-lg animate-pulse" />
                <div className="h-4 w-24 bg-slate-100 rounded-lg animate-pulse" />
              </div>
            ))}
          </div>
        ) : sortedProducts.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-slate-400">
            <div className="p-4 rounded-2xl bg-slate-50 mb-4">
              <Package className="w-8 h-8" />
            </div>
            <p className="text-sm font-semibold text-slate-500">Nenhum produto encontrado</p>
            <p className="text-xs mt-1 text-slate-400">Ajuste os filtros ou busca</p>
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="bg-slate-50/80 border-b border-slate-200/60">
                <th
                  className="text-left px-5 py-3.5 text-xs font-semibold text-slate-500 uppercase tracking-wider cursor-pointer select-none hover:text-slate-700 transition-colors"
                  onClick={() => handleSort("sku")}
                >
                  <span className="flex items-center">SKU <SortIcon field="sku" /></span>
                </th>
                <th
                  className="text-left px-5 py-3.5 text-xs font-semibold text-slate-500 uppercase tracking-wider cursor-pointer select-none hover:text-slate-700 transition-colors"
                  onClick={() => handleSort("name")}
                >
                  <span className="flex items-center">Nome <SortIcon field="name" /></span>
                </th>
                <th
                  className="text-left px-5 py-3.5 text-xs font-semibold text-slate-500 uppercase tracking-wider cursor-pointer select-none hover:text-slate-700 transition-colors"
                  onClick={() => handleSort("brand")}
                >
                  <span className="flex items-center">Marca <SortIcon field="brand" /></span>
                </th>
                <th
                  className="text-left px-5 py-3.5 text-xs font-semibold text-slate-500 uppercase tracking-wider cursor-pointer select-none hover:text-slate-700 transition-colors"
                  onClick={() => handleSort("last_validation_status")}
                >
                  <span className="flex items-center">Status <SortIcon field="last_validation_status" /></span>
                </th>
                <th
                  className="text-right px-5 py-3.5 text-xs font-semibold text-slate-500 uppercase tracking-wider cursor-pointer select-none hover:text-slate-700 transition-colors"
                  onClick={() => handleSort("last_validation_score")}
                >
                  <span className="flex items-center justify-end">Score <SortIcon field="last_validation_score" /></span>
                </th>
                <th className="text-left px-5 py-3.5 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  Acoes
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100/80">
              {sortedProducts.map((p) => (
                <tr key={p.sku} className="group hover:bg-slate-50/60 transition-colors">
                  <td className="px-5 py-3.5 font-mono text-xs font-semibold text-slate-700">
                    <Link
                      to={`/certificacoes/produtos/${encodeURIComponent(p.sku)}`}
                      className="hover:text-emerald-600 transition-colors"
                    >
                      {p.sku}
                    </Link>
                  </td>
                  <td className="px-5 py-3.5 text-sm text-slate-700 max-w-[300px] truncate">
                    <Link
                      to={`/certificacoes/produtos/${encodeURIComponent(p.sku)}`}
                      className="hover:text-emerald-600 transition-colors"
                    >
                      {p.name}
                    </Link>
                  </td>
                  <td className="px-5 py-3.5">
                    <span className="text-xs font-medium text-slate-500 bg-slate-50 px-2.5 py-1 rounded-lg">
                      {p.brand}
                    </span>
                  </td>
                  <td className="px-5 py-3.5">
                    {p.last_validation_status ? (
                      <CertStatusBadge status={p.last_validation_status} />
                    ) : (
                      <span className="text-xs text-slate-300 font-medium">--</span>
                    )}
                  </td>
                  <td className="px-5 py-3.5 text-right">
                    {p.last_validation_score != null ? (
                      <span className={cn(
                        "text-xs font-mono font-semibold px-2.5 py-1 rounded-lg",
                        scoreColor(p.last_validation_score)
                      )}>
                        {(p.last_validation_score * 100).toFixed(0)}%
                      </span>
                    ) : (
                      <span className="text-xs text-slate-300 font-medium">--</span>
                    )}
                  </td>
                  <td className="px-5 py-3.5">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleVerify(p.sku, p.brand)}
                        disabled={verifying === p.sku}
                        className={cn(
                          "flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all",
                          verifying === p.sku
                            ? "bg-slate-100 text-slate-400 cursor-not-allowed"
                            : "bg-emerald-50 text-emerald-700 hover:bg-emerald-100 active:scale-[0.97]"
                        )}
                      >
                        {verifying === p.sku ? (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        ) : (
                          <ShieldCheck className="w-3 h-3" />
                        )}
                        Verificar
                      </button>
                      {p.last_validation_url && (
                        <a
                          href={p.last_validation_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="p-1.5 rounded-lg text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 transition-all"
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                        </a>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {/* Pagination */}
        {!loading && totalPages > 1 && (
          <div className="flex items-center justify-between px-5 py-4 border-t border-slate-100/80 bg-slate-50/40">
            <p className="text-sm text-slate-500">
              Pagina <span className="font-semibold text-slate-700">{page}</span> de <span className="font-semibold text-slate-700">{totalPages}</span>
            </p>
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setPage(Math.max(1, page - 1))}
                disabled={page <= 1}
                className="p-2 rounded-xl text-slate-500 border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
                let pageNum: number
                if (totalPages <= 7) {
                  pageNum = i + 1
                } else if (page <= 4) {
                  pageNum = i + 1
                } else if (page >= totalPages - 3) {
                  pageNum = totalPages - 6 + i
                } else {
                  pageNum = page - 3 + i
                }
                return (
                  <button
                    key={pageNum}
                    onClick={() => setPage(pageNum)}
                    className={cn(
                      "w-9 h-9 rounded-xl text-xs font-semibold transition-all",
                      page === pageNum
                        ? "bg-gradient-to-r from-emerald-600 to-emerald-700 text-white shadow-sm shadow-emerald-600/20"
                        : "text-slate-600 bg-white border border-slate-200 hover:bg-slate-50"
                    )}
                  >
                    {pageNum}
                  </button>
                )
              })}
              <button
                onClick={() => setPage(Math.min(totalPages, page + 1))}
                disabled={page >= totalPages}
                className="p-2 rounded-xl text-slate-500 border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
