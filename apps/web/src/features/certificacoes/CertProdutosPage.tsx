import { useEffect, useState, useCallback } from "react"
import { Link } from "react-router-dom"
import { CertStatusBadge } from "@/features/certificacoes/components/CertStatusBadge"
import { fetchCertProducts, verifyCertProduct } from "@/shared/lib/cert-api-client"
import { cn, formatDateTime } from "@/shared/lib/utils"
import {
  Search,
  Filter,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Package,
  RefreshCw,
  ExternalLink,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
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
    if (sortField !== field) return <ArrowUpDown className="w-3 h-3 ml-1 opacity-40" />
    return sortDir === "asc"
      ? <ArrowUp className="w-3 h-3 ml-1" />
      : <ArrowDown className="w-3 h-3 ml-1" />
  }

  return (
    <div className="p-4 md:p-6 space-y-4">
      {/* Filters bar */}
      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
          <form onSubmit={handleSearch} className="flex items-center gap-2 flex-1 min-w-0">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                type="text"
                placeholder="Buscar por SKU ou nome..."
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                className="w-full pl-9 pr-3 py-2 rounded-lg border border-slate-200 bg-white text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <button
              type="submit"
              className="px-3 py-2 rounded-lg text-sm font-medium bg-blue-600 text-white hover:bg-blue-700 transition-colors"
            >
              Buscar
            </button>
          </form>

          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-slate-400" />
            <select
              value={brand}
              onChange={(e) => { setBrand(e.target.value); setPage(1) }}
              className="px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {BRANDS.map((b) => (
                <option key={b.value} value={b.value}>{b.label}</option>
              ))}
            </select>
            <select
              value={status}
              onChange={(e) => { setStatus(e.target.value); setPage(1) }}
              className="px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {STATUSES.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Summary line */}
        <div className="flex items-center justify-between mt-3 pt-3 border-t border-slate-100">
          <p className="text-xs text-slate-500">
            {total} produto{total !== 1 ? "s" : ""} encontrado{total !== 1 ? "s" : ""}
            {lastDate && (
              <span className="ml-2">
                | Ultima validacao: {formatDateTime(lastDate)}
              </span>
            )}
          </p>
          <button
            onClick={loadProducts}
            disabled={loading}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs text-slate-600 hover:bg-slate-100 transition-colors"
          >
            <RefreshCw className={cn("w-3 h-3", loading && "animate-spin")} />
            Atualizar
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        {loading ? (
          <div className="p-4 space-y-3">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-10 w-full bg-slate-200 rounded animate-pulse" />
            ))}
          </div>
        ) : sortedProducts.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-slate-400">
            <Package className="w-10 h-10 mb-3" />
            <p className="text-sm font-medium">Nenhum produto encontrado</p>
            <p className="text-xs mt-1">Ajuste os filtros ou busca</p>
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th
                  className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wider cursor-pointer select-none"
                  onClick={() => handleSort("sku")}
                >
                  <span className="flex items-center">SKU <SortIcon field="sku" /></span>
                </th>
                <th
                  className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wider cursor-pointer select-none"
                  onClick={() => handleSort("name")}
                >
                  <span className="flex items-center">Nome <SortIcon field="name" /></span>
                </th>
                <th
                  className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wider cursor-pointer select-none"
                  onClick={() => handleSort("brand")}
                >
                  <span className="flex items-center">Marca <SortIcon field="brand" /></span>
                </th>
                <th
                  className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wider cursor-pointer select-none"
                  onClick={() => handleSort("last_validation_status")}
                >
                  <span className="flex items-center">Status <SortIcon field="last_validation_status" /></span>
                </th>
                <th
                  className="text-right px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wider cursor-pointer select-none"
                  onClick={() => handleSort("last_validation_score")}
                >
                  <span className="flex items-center justify-end">Score <SortIcon field="last_validation_score" /></span>
                </th>
                <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wider">
                  Acoes
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {sortedProducts.map((p) => (
                <tr key={p.sku} className="group hover:bg-slate-50 transition-colors">
                  <td className="px-4 py-3 font-mono text-xs font-medium text-slate-700">
                    <Link
                      to={`/certificacoes/produtos/${encodeURIComponent(p.sku)}`}
                      className="hover:text-blue-600 transition-colors"
                    >
                      {p.sku}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-700 max-w-[300px] truncate">
                    <Link
                      to={`/certificacoes/produtos/${encodeURIComponent(p.sku)}`}
                      className="hover:text-blue-600 transition-colors"
                    >
                      {p.name}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-500">
                    {p.brand}
                  </td>
                  <td className="px-4 py-3">
                    {p.last_validation_status ? (
                      <CertStatusBadge status={p.last_validation_status} />
                    ) : (
                      <span className="text-xs text-slate-400">--</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {p.last_validation_score != null ? (
                      <span className="text-xs font-mono text-slate-600">
                        {(p.last_validation_score * 100).toFixed(0)}%
                      </span>
                    ) : (
                      <span className="text-xs text-slate-400">--</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => handleVerify(p.sku, p.brand)}
                        disabled={verifying === p.sku}
                        className={cn(
                          "flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium transition-colors",
                          verifying === p.sku
                            ? "bg-slate-100 text-slate-400 cursor-not-allowed"
                            : "bg-blue-50 text-blue-700 hover:bg-blue-100"
                        )}
                      >
                        {verifying === p.sku ? (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        ) : (
                          <RefreshCw className="w-3 h-3" />
                        )}
                        Verificar
                      </button>
                      {p.last_validation_url && (
                        <a
                          href={p.last_validation_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="p-1 rounded-md text-slate-400 hover:text-blue-600 hover:bg-blue-50 transition-colors"
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
          <div className="flex items-center justify-between px-4 py-3 border-t border-slate-100">
            <p className="text-xs text-slate-500">
              Pagina {page} de {totalPages}
            </p>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setPage(Math.max(1, page - 1))}
                disabled={page <= 1}
                className="p-1.5 rounded-md text-slate-500 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
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
                      "w-8 h-8 rounded-md text-xs font-medium transition-colors",
                      page === pageNum
                        ? "bg-blue-600 text-white"
                        : "text-slate-600 hover:bg-slate-100"
                    )}
                  >
                    {pageNum}
                  </button>
                )
              })}
              <button
                onClick={() => setPage(Math.min(totalPages, page + 1))}
                disabled={page >= totalPages}
                className="p-1.5 rounded-md text-slate-500 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
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
