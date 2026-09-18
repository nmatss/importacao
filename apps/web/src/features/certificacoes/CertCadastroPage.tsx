import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import {
  FilePlus2,
  CheckCircle2,
  AlertTriangle,
  Info,
  Loader2,
  Upload,
  RefreshCw,
  FileText,
  Search,
  Boxes,
  Trash2,
  X,
} from 'lucide-react';
import { SubmitButton } from '@/shared/components/SubmitButton';
import { cn, formatDateOnly } from '@/shared/lib/utils';
import {
  createCertificate,
  downloadCertificatePdf,
  fetchCertProductDetail,
  fetchCertificateDetail,
  fetchCertificates,
  linkCertificateItems,
  lookupCertificateLinx,
  removeCertificateItem,
  updateCertificateItemRestriction,
  retryCertificateLinx,
  type CertCertificate,
  type CertCertificateItem,
  type CertLinkResult,
  type CertSituacao,
  type CertLinxLookup,
  type CertProduct,
  type LinxStatus,
} from '@/shared/lib/cert-api-client';

const BRANDS = [
  { value: 'imaginarium', label: 'Imaginarium' },
  { value: 'puket', label: 'Puket' },
  { value: 'puket_escolares', label: 'Puket Escolares' },
];

const ORGAOS = ['INMETRO', 'ANATEL', 'ANVISA', 'Outro'];

const LINX_BADGE: Record<LinxStatus, { label: string; cls: string }> = {
  applied: {
    label: 'Gravado no Linx',
    cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  },
  pending: {
    label: 'Pendente',
    cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  },
  disabled: {
    label: 'Não gravado (Linx off)',
    cls: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
  },
  error: {
    label: 'Erro no Linx',
    cls: 'bg-danger-100 text-danger-700 dark:bg-danger-900/40 dark:text-danger-300',
  },
};

function LinxBadge({ status }: { status: LinxStatus }) {
  const b = LINX_BADGE[status] ?? LINX_BADGE.pending;
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium',
        b.cls,
      )}
    >
      {b.label}
    </span>
  );
}

function linxPropertyLabel(
  lookup: CertLinxLookup,
  field: 'validade_certificado' | 'vencimento_licenciamento',
): string {
  const isoDate = lookup[field];
  const detail = lookup.properties[field];
  if (isoDate) return formatDateOnly(isoDate);
  if (detail.state === 'invalid') return `valor inválido (${detail.raw_value || 'vazio'})`;
  return 'sem data efetiva';
}

const PER_PAGE = 10;

const LINX_STATUS_FILTERS: Array<{ value: string; label: string }> = [
  { value: '', label: 'Todos os status' },
  { value: 'applied', label: 'Gravado no Linx' },
  { value: 'pending', label: 'Pendente' },
  { value: 'error', label: 'Erro no Linx' },
  { value: 'disabled', label: 'Não gravado (Linx off)' },
];

/**
 * Data de hoje no fuso LOCAL, em ISO (AAAA-MM-DD).
 * `new Date().toISOString()` devolve a data em UTC — depois das 21:00 de
 * Brasília isso já é o dia seguinte.
 */
export function todayLocalIso(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/**
 * Lê a lista de SKUs colada da planilha (uma por linha, vírgula ou ';').
 * Espelha `_parse_skus` do cert-api: preserva a ordem e remove repetidos, para
 * que a prévia mostre exatamente o que será enviado.
 */
export function parsePastedSkus(raw: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of raw.replace(/[;,]/g, '\n').split(/\r?\n/)) {
    const clean = part.trim();
    if (!clean || seen.has(clean)) continue;
    seen.add(clean);
    out.push(clean);
  }
  return out;
}

const MAX_ITEMS_PER_REQUEST = 500;

const inputCls =
  'w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-slate-800 dark:text-slate-100 shadow-sm focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 focus:outline-none';
const labelCls = 'block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1';

export default function CertCadastroPage() {
  const [brand, setBrand] = useState('imaginarium');
  const [sku, setSku] = useState('');
  const [skusText, setSkusText] = useState('');
  const [validade, setValidade] = useState('');
  // Certificado ATIVO não tem fim de venda: o campo só existe quando a situação
  // é ENCERRADO. A tela precisa mandar `situacao` — sem ela o cert-api assume
  // ATIVO e recusa qualquer cadastro com fim de venda (400).
  const [situacao, setSituacao] = useState<CertSituacao>('ATIVO');
  const [fimVenda, setFimVenda] = useState('');
  const [vencimento, setVencimento] = useState('');
  const [numero, setNumero] = useState('');
  const [ocp, setOcp] = useState('');
  const [orgao, setOrgao] = useState('');
  const [pdf, setPdf] = useState<File | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<CertCertificate | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [recent, setRecent] = useState<CertCertificate[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [filterSkuInput, setFilterSkuInput] = useState('');
  const [filterSku, setFilterSku] = useState('');
  const [filterBrand, setFilterBrand] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [retrying, setRetrying] = useState<string | null>(null);
  const [downloadingPdf, setDownloadingPdf] = useState<string | null>(null);
  const [lookingUpLinx, setLookingUpLinx] = useState(false);
  const [linxLookup, setLinxLookup] = useState<CertLinxLookup | null>(null);
  const [portalProduct, setPortalProduct] = useState<CertProduct | null>(null);
  const [linxLookupError, setLinxLookupError] = useState<string | null>(null);
  const linxLookupRequest = useRef(0);

  // Gestão de itens do certificado selecionado na lista.
  const [openCert, setOpenCert] = useState<CertCertificate | null>(null);
  const [openItems, setOpenItems] = useState<CertCertificateItem[]>([]);
  const [itemsSkus, setItemsSkus] = useState('');
  const [preview, setPreview] = useState<CertLinkResult | null>(null);
  const [itemsBusy, setItemsBusy] = useState(false);
  const [itemsError, setItemsError] = useState<string | null>(null);
  const [removingSku, setRemovingSku] = useState<string | null>(null);
  const [restrictionForm, setRestrictionForm] = useState<{
    sku: string;
    inherit: boolean;
    date: string;
    reason: string;
  } | null>(null);

  const pastedSkus = parsePastedSkus(itemsSkus);
  const formSkus = parsePastedSkus(skusText);

  // Os inputs type="date" produzem ISO (AAAA-MM-DD); o cert-api aceita esse formato
  // e o converte para dd/mm/AAAA somente na escrita do Linx (_format_date).
  // `toISOString()` converte para UTC: depois das 21:00 de Brasília o "hoje" em
  // UTC já é o dia seguinte, e um certificado que vence HOJE era sinalizado como
  // vencido. A data tem de ser calculada no fuso local.
  const todayIso = todayLocalIso();
  const hasPastDate =
    (validade !== '' && validade < todayIso) ||
    (fimVenda !== '' && fimVenda < todayIso) ||
    (vencimento !== '' && vencimento < todayIso);

  const loadRecent = useCallback(async () => {
    setListLoading(true);
    try {
      const data = await fetchCertificates({
        page,
        per_page: PER_PAGE,
        sku: filterSku || undefined,
        brand: filterBrand || undefined,
        linx_status: filterStatus || undefined,
      });
      setRecent(data.items);
      setTotalPages(data.total_pages || 1);
      setTotal(data.total ?? 0);
      setListError(null);
    } catch (err) {
      // "Vazio" e "indisponível" são coisas diferentes: engolir a falha exibia
      // "Nenhum certificado cadastrado ainda." para uma API fora do ar.
      setListError(
        err instanceof Error ? err.message : 'Não foi possível carregar os certificados.',
      );
      setRecent([]);
      setTotal(0);
      setTotalPages(1);
    } finally {
      setListLoading(false);
    }
  }, [page, filterSku, filterBrand, filterStatus]);

  useEffect(() => {
    loadRecent();
  }, [loadRecent]);

  function applyFilters(e: FormEvent) {
    e.preventDefault();
    setPage(1);
    setFilterSku(filterSkuInput.trim());
  }

  function clearListFilters() {
    setFilterSkuInput('');
    setFilterSku('');
    setFilterBrand('');
    setFilterStatus('');
    setPage(1);
  }

  function resetForm() {
    setSku('');
    setSkusText('');
    setValidade('');
    setSituacao('ATIVO');
    setFimVenda('');
    setVencimento('');
    setNumero('');
    setOcp('');
    setOrgao('');
    setPdf(null);
    setLinxLookup(null);
    setPortalProduct(null);
    setLinxLookupError(null);
  }

  async function handleLinxLookup() {
    const cleanSku = sku.trim();
    if (!cleanSku) {
      setLinxLookupError('Informe o SKU antes de consultar o Linx.');
      return;
    }
    const requestId = ++linxLookupRequest.current;
    setLookingUpLinx(true);
    setLinxLookup(null);
    setLinxLookupError(null);
    try {
      const [data, product] = await Promise.all([
        lookupCertificateLinx(brand, cleanSku),
        fetchCertProductDetail(cleanSku).catch(() => null),
      ]);
      if (requestId !== linxLookupRequest.current) return;
      setLinxLookup(data);
      setPortalProduct(product);
      // Preserve anything the operator already typed. Existing Linx dates only
      // fill empty fields, avoiding a silent overwrite during the review.
      setValidade((current) => current || product?.validade_certificado || '');
      setVencimento(data.vencimento_licenciamento || '');
      setNumero((current) => current || String(product?.numero_certificado || ''));
    } catch (err) {
      if (requestId !== linxLookupRequest.current) return;
      setLinxLookupError(err instanceof Error ? err.message : 'Falha ao consultar o Linx.');
    } finally {
      if (requestId === linxLookupRequest.current) setLookingUpLinx(false);
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setResult(null);

    if (!sku.trim() && formSkus.length === 0) {
      setError('Informe o SKU do produto (ou cole a lista de SKUs).');
      return;
    }
    if (formSkus.length > MAX_ITEMS_PER_REQUEST) {
      setError(`Vincule no máximo ${MAX_ITEMS_PER_REQUEST} SKUs por vez.`);
      return;
    }
    const encerrado = situacao === 'ENCERRADO';
    if (encerrado && !fimVenda) {
      setError('Informe o fim de venda do certificado encerrado.');
      return;
    }
    if (!validade && !fimVenda) {
      setError(
        encerrado
          ? 'Informe a validade do certificado ou o fim de venda por certificação.'
          : 'Informe a validade do certificado.',
      );
      return;
    }

    setSubmitting(true);
    try {
      const created = await createCertificate({
        sku: sku.trim() || undefined,
        skus: formSkus.length > 0 ? formSkus.join('\n') : undefined,
        brand,
        validade_certificado: validade || undefined,
        // Defesa em profundidade: o estado já é limpo ao voltar para Ativo.
        fim_venda: encerrado ? fimVenda || undefined : undefined,
        situacao,
        numero_certificado: numero || undefined,
        ocp: ocp || undefined,
        orgao_certificador: orgao || undefined,
        pdf,
      });
      setResult(created);
      resetForm();
      loadRecent();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao cadastrar certificado.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRetry(id: string) {
    setRetrying(id);
    try {
      const updated = await retryCertificateLinx(id);
      setRecent((prev) => prev.map((c) => (c.id === id ? updated : c)));
      if (result?.id === id) setResult(updated);
      if (updated.linx_status === 'applied') {
        toast.success('Gravado no Linx com sucesso');
      } else if (updated.linx_status === 'error') {
        toast.error(`Linx retornou erro: ${updated.linx_error || 'verifique o detalhe do item'}`);
      }
    } catch (err) {
      // Auditoria 2026-07-17: a falha era engolida — o operador reenviava ao
      // Linx e não sabia se funcionou.
      toast.error(err instanceof Error ? err.message : 'Falha ao reenviar ao Linx');
    } finally {
      setRetrying(null);
    }
  }

  async function openItemsPanel(cert: CertCertificate) {
    if (itemsBusy) return;
    setOpenCert(cert);
    setItemsSkus('');
    setPreview(null);
    setRestrictionForm(null);
    setItemsError(null);
    setItemsBusy(true);
    try {
      const detail = await fetchCertificateDetail(cert.id);
      setOpenCert(detail);
      setOpenItems(detail.items ?? []);
    } catch (err) {
      setOpenItems([]);
      setItemsError(err instanceof Error ? err.message : 'Falha ao carregar os itens.');
    } finally {
      setItemsBusy(false);
    }
  }

  /**
   * `dryRun` primeiro, sempre: o vínculo grava no Linx de cada SKU, então a
   * prévia é a única chance do operador ver o que a lista colada realmente faz
   * antes de mexer no ERP.
   */
  async function handleLinkItems(dryRun: boolean) {
    if (!openCert) return;
    setItemsBusy(true);
    setItemsError(null);
    try {
      const result = await linkCertificateItems(openCert.id, pastedSkus, dryRun);
      setPreview(result);
      if (!dryRun) {
        setOpenItems(result.items ?? openItems);
        setItemsSkus('');
        toast.success(`${result.added.length} SKU(s) vinculado(s) ao certificado.`);
        loadRecent();
      }
    } catch (err) {
      setItemsError(err instanceof Error ? err.message : 'Falha ao vincular os SKUs.');
    } finally {
      setItemsBusy(false);
    }
  }

  async function handleRemoveItem(skuToRemove: string) {
    if (!openCert) return;
    setRemovingSku(skuToRemove);
    try {
      const result = await removeCertificateItem(openCert.id, skuToRemove);
      setOpenItems(result.items ?? []);
      toast.success(`${skuToRemove} removido do certificado.`);
      loadRecent();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Falha ao remover o item.');
    } finally {
      setRemovingSku(null);
    }
  }

  async function handleSaveRestriction(event: FormEvent) {
    event.preventDefault();
    if (!openCert || !restrictionForm || !restrictionForm.reason.trim()) return;
    setItemsBusy(true);
    setItemsError(null);
    try {
      const updated = await updateCertificateItemRestriction(openCert.id, restrictionForm.sku, {
        situacao: restrictionForm.inherit ? null : 'ENCERRADO',
        fim_venda: restrictionForm.inherit ? null : restrictionForm.date || null,
        motivo: restrictionForm.reason.trim(),
      });
      setOpenItems((items) => items.map((item) => (item.sku === updated.sku ? updated : item)));
      setRestrictionForm(null);
      toast.success('Restrição do item salva no portal. O envio ao Linx permanece pendente.');
      void loadRecent();
    } catch (err) {
      setItemsError(err instanceof Error ? err.message : 'Falha ao salvar a restrição do item.');
    } finally {
      setItemsBusy(false);
    }
  }

  async function handleDownloadPdf(id: string) {
    setDownloadingPdf(id);
    try {
      await downloadCertificatePdf(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao baixar PDF.');
    } finally {
      setDownloadingPdf(null);
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
          <FilePlus2 className="h-5 w-5" />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100">
            Cadastrar Certificado
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Registra a validade e o fim de venda por certificação. O licenciamento é mantido pelo
            time de Produto no Linx.
          </p>
        </div>
      </div>

      {/* Resultado */}
      {result && (
        <div
          className={cn(
            'rounded-xl border p-4 text-sm',
            result.linx_status === 'applied'
              ? 'border-emerald-200 bg-emerald-50 dark:border-emerald-900/50 dark:bg-emerald-900/20'
              : result.linx_status === 'error'
                ? 'border-danger-200 bg-danger-50 dark:border-danger-900/50 dark:bg-danger-900/20'
                : 'border-amber-200 bg-amber-50 dark:border-amber-900/50 dark:bg-amber-900/20',
          )}
        >
          <div className="flex items-start gap-2">
            {result.linx_status === 'applied' ? (
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-300" />
            ) : (
              <Info className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-300" />
            )}
            <div className="space-y-1">
              <p className="font-medium text-slate-800 dark:text-slate-100">
                Certificado salvo (SKU {result.sku}). <LinxBadge status={result.linx_status} />
              </p>
              {result.produto_codigo && (
                <p className="text-slate-600 dark:text-slate-300">
                  Produto no Linx: <code className="font-mono">{result.produto_codigo}</code>
                </p>
              )}
              {result.linx_error && (
                <p className="text-danger-700 dark:text-danger-300">{result.linx_error}</p>
              )}
              {result.linx_detail && result.linx_detail.length > 0 && (
                <ul className="mt-1 list-disc pl-5 text-xs text-slate-600 dark:text-slate-300">
                  {result.linx_detail.map((d, i) => (
                    <li key={i}>
                      {d.field} (prop {d.prop}){d.valor ? ` = ${d.valor}` : ''} → {d.action}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-danger-200 bg-danger-50 p-4 text-sm text-danger-700 dark:border-danger-900/50 dark:bg-danger-900/20 dark:text-danger-300">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Formulário */}
      <form
        onSubmit={handleSubmit}
        className="space-y-5 rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900"
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="cert-brand" className={labelCls}>
              Marca / Loja *
            </label>
            <select
              id="cert-brand"
              className={inputCls}
              value={brand}
              onChange={(e) => {
                linxLookupRequest.current += 1;
                setBrand(e.target.value);
                setVencimento('');
                setLookingUpLinx(false);
                setLinxLookup(null);
                setPortalProduct(null);
                setLinxLookupError(null);
              }}
            >
              {BRANDS.map((b) => (
                <option key={b.value} value={b.value}>
                  {b.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="cert-sku" className={labelCls}>
              SKU do produto *
            </label>
            <div className="flex gap-2">
              <input
                id="cert-sku"
                className={inputCls}
                value={sku}
                onChange={(e) => {
                  linxLookupRequest.current += 1;
                  setSku(e.target.value);
                  setVencimento('');
                  setLookingUpLinx(false);
                  setLinxLookup(null);
                  setPortalProduct(null);
                  setLinxLookupError(null);
                }}
                placeholder="Ex.: 12345 ou produto+cor+tamanho"
              />
              <button
                type="button"
                onClick={handleLinxLookup}
                disabled={lookingUpLinx || !sku.trim()}
                className="inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-lg border border-emerald-300 bg-emerald-50 px-3 text-xs font-medium text-emerald-700 transition-colors hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300 dark:hover:bg-emerald-900/50"
              >
                {lookingUpLinx ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Search className="h-4 w-4" />
                )}
                <span className="hidden md:inline">Buscar no Linx</span>
                <span className="md:hidden">Linx</span>
              </button>
            </div>
          </div>
          {(linxLookup || linxLookupError) && (
            <div className="sm:col-span-2" aria-live="polite">
              {linxLookup ? (
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-200">
                  <p className="font-medium">
                    Produto Linx {linxLookup.produto_codigo}: dados atuais consultados.
                  </p>
                  <p className="mt-1">
                    Fim de venda por certificação (prop{' '}
                    {linxLookup.properties.validade_certificado.property_code}):{' '}
                    {linxPropertyLabel(linxLookup, 'validade_certificado')} · Licenciamento (prop{' '}
                    {linxLookup.properties.vencimento_licenciamento.property_code}):{' '}
                    {linxPropertyLabel(linxLookup, 'vencimento_licenciamento')}
                  </p>
                  {portalProduct?.numero_certificado && (
                    <p className="mt-1">
                      Nº do certificado na planilha: {portalProduct.numero_certificado}.
                    </p>
                  )}
                  <p className="mt-1 text-emerald-700/80 dark:text-emerald-300/80">
                    A validade vem do cadastro no portal. O fim de venda do Linx é informativo e não
                    preenche a validade. O licenciamento permanece somente leitura.
                  </p>
                </div>
              ) : (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
                  {linxLookupError}
                </div>
              )}
            </div>
          )}
          <div className="sm:col-span-2">
            <label htmlFor="cert-skus" className={labelCls}>
              SKUs adicionais (um por linha)
            </label>
            <textarea
              id="cert-skus"
              rows={3}
              className={cn(inputCls, 'font-mono text-xs')}
              value={skusText}
              onChange={(e) => setSkusText(e.target.value)}
              placeholder={'Cole aqui a coluna de SKUs da planilha\nPI5555Y\nPI7001Y'}
            />
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              {formSkus.length > 0
                ? `${formSkus.length} SKU(s) serão vinculados a este certificado.`
                : `Opcional. Um certificado pode cobrir vários produtos (até ${MAX_ITEMS_PER_REQUEST} por vez).`}
            </p>
          </div>
          <div>
            <label htmlFor="cert-validade" className={labelCls}>
              Validade do Certificado
            </label>
            <input
              id="cert-validade"
              type="date"
              className={inputCls}
              value={validade}
              onChange={(e) => setValidade(e.target.value)}
            />
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              Fica só no portal: não é enviada como trava para o Linx.
            </p>
          </div>
          <div>
            <label htmlFor="cert-vencimento" className={labelCls}>
              Vencimento do Licenciamento
            </label>
            <input
              id="cert-vencimento"
              type="date"
              className={inputCls}
              value={vencimento}
              readOnly
              aria-describedby="cert-licenciamento-origem"
            />
            <p
              id="cert-licenciamento-origem"
              className="mt-1 text-xs text-slate-500 dark:text-slate-400"
            >
              Somente leitura: consulte o Linx para atualizar. Este cadastro não altera o
              licenciamento.
            </p>
          </div>
          <div>
            <label htmlFor="cert-situacao" className={labelCls}>
              Situação do certificado *
            </label>
            <select
              id="cert-situacao"
              className={inputCls}
              value={situacao}
              onChange={(e) => {
                const next = e.target.value as CertSituacao;
                setSituacao(next);
                // Voltar para Ativo descarta a trava: um certificado ativo com
                // fim de venda é exatamente o que o cert-api recusa.
                if (next === 'ATIVO') setFimVenda('');
              }}
            >
              <option value="ATIVO">Ativo</option>
              <option value="ENCERRADO">Encerrado</option>
            </select>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              Ativo: o produto pode ser vendido, sem data de trava. Encerrado: exige o fim de venda.
            </p>
          </div>
          <div>
            <label htmlFor="cert-fim-venda" className={labelCls}>
              Fim de venda (trava)
            </label>
            <input
              id="cert-fim-venda"
              type="date"
              className={cn(inputCls, 'disabled:cursor-not-allowed disabled:opacity-50')}
              value={fimVenda}
              onChange={(e) => setFimVenda(e.target.value)}
              disabled={situacao !== 'ENCERRADO'}
              aria-required={situacao === 'ENCERRADO'}
              aria-describedby="cert-fim-venda-ajuda"
            />
            <p
              id="cert-fim-venda-ajuda"
              className="mt-1 text-xs text-slate-500 dark:text-slate-400"
            >
              {situacao === 'ENCERRADO'
                ? 'Obrigatório para certificado encerrado. É esta data que trava o faturamento no Linx.'
                : 'Certificado ativo não tem fim de venda. Mude a situação para Encerrado para informar a trava.'}
            </p>
          </div>
          <div>
            <label htmlFor="cert-numero" className={labelCls}>
              Nº do Certificado
            </label>
            <input
              id="cert-numero"
              className={inputCls}
              value={numero}
              onChange={(e) => setNumero(e.target.value)}
              placeholder="Ex.: 006083/2024"
            />
          </div>
          <div>
            <label htmlFor="cert-ocp" className={labelCls}>
              OCP / Organismo
            </label>
            <input
              id="cert-ocp"
              className={inputCls}
              value={ocp}
              onChange={(e) => setOcp(e.target.value)}
              placeholder="Ex.: OCP 0004"
            />
          </div>
          <div>
            <label htmlFor="cert-orgao" className={labelCls}>
              Órgão certificador
            </label>
            <select
              id="cert-orgao"
              className={inputCls}
              value={orgao}
              onChange={(e) => setOrgao(e.target.value)}
            >
              <option value="">—</option>
              {ORGAOS.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls}>PDF do certificado</label>
            <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-slate-300 px-3 py-2 text-sm text-slate-500 hover:border-emerald-400 dark:border-slate-700 dark:text-slate-400">
              <Upload className="h-4 w-4" />
              <span className="truncate">{pdf ? pdf.name : 'Selecionar PDF…'}</span>
              <input
                type="file"
                accept="application/pdf"
                className="hidden"
                onChange={(e) => setPdf(e.target.files?.[0] ?? null)}
              />
            </label>
          </div>
        </div>

        <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between border-t border-slate-100 pt-4 dark:border-slate-800">
          <div className="space-y-1">
            <p className="text-xs text-slate-500 dark:text-slate-400">
              * campos obrigatórios. Informe ao menos uma data.
            </p>
            {hasPastDate && (
              <p className="text-xs font-medium text-amber-600 dark:text-amber-400">
                Atenção: há data no passado — o certificado será gravado como já vencido.
              </p>
            )}
          </div>
          <SubmitButton loading={submitting}>
            {submitting ? 'Salvando…' : 'Cadastrar e gravar no Linx'}
          </SubmitButton>
        </div>
      </form>

      {/* Recentes */}
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3 dark:border-slate-800">
          <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">
            Certificados cadastrados
            {!listError && !listLoading && (
              <span className="ml-2 text-xs font-normal text-slate-500 dark:text-slate-400">
                {total} no total
              </span>
            )}
          </h3>
          <button
            type="button"
            onClick={loadRecent}
            className="text-slate-400 hover:text-emerald-600 dark:hover:text-emerald-300"
            title="Atualizar"
            aria-label="Atualizar lista de certificados"
          >
            <RefreshCw className={cn('h-4 w-4', listLoading && 'animate-spin')} />
          </button>
        </div>

        {/* Filtros: sem eles não havia como achar um certificado antigo nem
            revisar o backlog de linx_status='error'. */}
        <form
          onSubmit={applyFilters}
          className="flex flex-wrap items-end gap-3 border-b border-slate-100 px-5 py-3 dark:border-slate-800"
        >
          <div className="min-w-[160px] flex-1">
            <label htmlFor="cert-filter-sku" className={labelCls}>
              SKU
            </label>
            <input
              id="cert-filter-sku"
              className={inputCls}
              value={filterSkuInput}
              onChange={(e) => setFilterSkuInput(e.target.value)}
              placeholder="Filtrar por SKU"
            />
          </div>
          <div className="min-w-[150px]">
            <label htmlFor="cert-filter-brand" className={labelCls}>
              Marca
            </label>
            <select
              id="cert-filter-brand"
              className={inputCls}
              value={filterBrand}
              onChange={(e) => {
                setPage(1);
                setFilterBrand(e.target.value);
              }}
            >
              <option value="">Todas as marcas</option>
              {BRANDS.map((b) => (
                <option key={b.value} value={b.value}>
                  {b.label}
                </option>
              ))}
            </select>
          </div>
          <div className="min-w-[170px]">
            <label htmlFor="cert-filter-status" className={labelCls}>
              Status Linx
            </label>
            <select
              id="cert-filter-status"
              className={inputCls}
              value={filterStatus}
              onChange={(e) => {
                setPage(1);
                setFilterStatus(e.target.value);
              }}
            >
              {LINX_STATUS_FILTERS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <button
            type="submit"
            className="inline-flex min-h-10 items-center gap-1.5 rounded-lg bg-emerald-600 px-4 text-xs font-semibold text-white transition-colors hover:bg-emerald-700"
          >
            <Search className="h-4 w-4" />
            Filtrar
          </button>
          {(filterSku || filterBrand || filterStatus) && (
            <button
              type="button"
              onClick={clearListFilters}
              className="inline-flex min-h-10 items-center rounded-lg border border-slate-200 px-3 text-xs font-medium text-slate-500 transition-colors hover:text-danger-600 dark:border-slate-700 dark:hover:text-danger-300"
            >
              Limpar
            </button>
          )}
        </form>

        {listError ? (
          <div
            role="alert"
            className="flex flex-col items-center gap-3 px-5 py-6 text-center text-sm text-danger-700 dark:text-danger-300"
          >
            <span>Não foi possível carregar os certificados.</span>
            <button
              type="button"
              onClick={loadRecent}
              className="rounded-lg border border-danger-200 px-3 py-1.5 text-xs font-semibold text-danger-700 transition-colors hover:bg-danger-50 dark:border-danger-800 dark:text-danger-300 dark:hover:bg-danger-950/30"
            >
              Tentar novamente
            </button>
          </div>
        ) : listLoading ? (
          <p className="px-5 py-6 text-center text-sm text-slate-500 dark:text-slate-400">
            Carregando…
          </p>
        ) : recent.length === 0 ? (
          <p className="px-5 py-6 text-center text-sm text-slate-500 dark:text-slate-400">
            {filterSku || filterBrand || filterStatus
              ? 'Nenhum certificado corresponde aos filtros.'
              : 'Nenhum certificado cadastrado ainda.'}
          </p>
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {recent.map((c) => (
              <div key={c.id} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
                <span className="font-medium text-slate-800 dark:text-slate-100">{c.sku}</span>
                <span className="text-xs text-slate-500 dark:text-slate-400">{c.brand}</span>
                {/* `formatDateOnly` já estava importado — as datas saíam em ISO cru. */}
                {c.validade_certificado && (
                  <span className="text-xs text-slate-500 dark:text-slate-400">
                    Cert: {formatDateOnly(c.validade_certificado)}
                  </span>
                )}
                {c.fim_venda && (
                  <span className="text-xs text-slate-500 dark:text-slate-400">
                    Fim de venda: {formatDateOnly(c.fim_venda)}
                  </span>
                )}
                {c.vencimento_licenciamento && (
                  <span className="text-xs text-slate-500 dark:text-slate-400">
                    Lic: {formatDateOnly(c.vencimento_licenciamento)}
                  </span>
                )}
                {c.numero_certificado && (
                  <span className="font-mono text-xs text-slate-500 dark:text-slate-400">
                    {c.numero_certificado}
                  </span>
                )}
                <LinxBadge status={c.linx_status} />
                <div className="ml-auto flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => openItemsPanel(c)}
                    disabled={itemsBusy}
                    className="inline-flex items-center gap-1 text-xs text-emerald-600 hover:underline dark:text-emerald-300"
                  >
                    <Boxes className="h-3.5 w-3.5" />
                    Itens ({c.items_count ?? 0})
                  </button>
                  {c.pdf_filename && (
                    <button
                      type="button"
                      onClick={() => handleDownloadPdf(c.id)}
                      disabled={downloadingPdf === c.id}
                      className="inline-flex items-center gap-1 text-xs text-emerald-600 hover:underline dark:text-emerald-300"
                    >
                      {downloadingPdf === c.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <FileText className="h-3.5 w-3.5" />
                      )}
                      PDF
                    </button>
                  )}
                  {/* `pending` é exatamente a linha cujo UPDATE pós-Linx não
                      completou — o caso que MAIS precisa de retry. */}
                  {(c.linx_status === 'error' ||
                    c.linx_status === 'disabled' ||
                    c.linx_status === 'pending') && (
                    <button
                      type="button"
                      onClick={() => handleRetry(c.id)}
                      disabled={retrying === c.id}
                      className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-emerald-600 disabled:opacity-50 dark:hover:text-emerald-300"
                    >
                      {retrying === c.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <RefreshCw className="h-3.5 w-3.5" />
                      )}
                      Reenviar ao Linx
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {!listError && !listLoading && totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-slate-100 px-5 py-3 dark:border-slate-800">
            <span className="text-xs text-slate-500 dark:text-slate-400">
              Página {page} de {totalPages}
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50 disabled:opacity-40 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                Anterior
              </button>
              <button
                type="button"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50 disabled:opacity-40 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                Próxima
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Itens do certificado: vínculo em massa + remoção individual (D11) */}
      {openCert && (
        <section
          aria-label="Produtos do certificado"
          className="rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900"
        >
          <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-5 py-3 dark:border-slate-800">
            <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">
              Produtos do certificado {openCert.numero_certificado || openCert.id.slice(0, 8)}
            </h3>
            <span className="text-xs text-slate-500 dark:text-slate-400">{openCert.brand}</span>
            <button
              type="button"
              onClick={() => setOpenCert(null)}
              disabled={itemsBusy}
              aria-label="Fechar produtos do certificado"
              className="ml-auto text-slate-400 hover:text-danger-600 dark:hover:text-danger-300"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {itemsError && (
            <p role="alert" className="px-5 pt-3 text-sm text-danger-700 dark:text-danger-300">
              {itemsError}
            </p>
          )}

          <div className="space-y-3 px-5 py-4">
            <div>
              <label htmlFor="cert-items-skus" className={labelCls}>
                Vincular SKUs (um por linha)
              </label>
              <textarea
                id="cert-items-skus"
                rows={3}
                className={cn(inputCls, 'font-mono text-xs')}
                value={itemsSkus}
                onChange={(e) => {
                  setItemsSkus(e.target.value);
                  setPreview(null);
                }}
                placeholder={'PI5555Y\nPI7001Y'}
              />
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => handleLinkItems(true)}
                  disabled={itemsBusy || pastedSkus.length === 0}
                  className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-slate-200 px-3 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                >
                  {itemsBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                  Pré-visualizar ({pastedSkus.length})
                </button>
                <button
                  type="button"
                  onClick={() => handleLinkItems(false)}
                  // `pastedSkus` entra na condição para que o clique não possa
                  // ser repetido depois de confirmar: o textarea é limpo, mas a
                  // prévia continua na tela (é o recibo do que foi feito).
                  disabled={
                    itemsBusy ||
                    pastedSkus.length === 0 ||
                    !preview ||
                    !preview.dry_run ||
                    preview.added.length === 0
                  }
                  title={
                    preview
                      ? 'Grava o vínculo e envia as datas ao Linx'
                      : 'Pré-visualize antes de confirmar'
                  }
                  className="inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-emerald-600 px-4 text-xs font-semibold text-white transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Vincular
                </button>
              </div>
            </div>

            {preview && (
              <div
                aria-live="polite"
                className="space-y-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
              >
                <p>
                  <strong>{preview.added.length}</strong>{' '}
                  {preview.dry_run ? 'serão vinculados' : 'vinculados'}
                  {preview.already_linked.length > 0 &&
                    ` · ${preview.already_linked.length} já estavam neste certificado`}
                </p>
                {preview.linked_to_other_active_cert.length > 0 && (
                  <p className="text-amber-700 dark:text-amber-300">
                    {preview.linked_to_other_active_cert.length} em outro certificado ativo (não
                    serão alterados):{' '}
                    {preview.linked_to_other_active_cert
                      .map(
                        (i) =>
                          `${i.sku}${i.numero_certificado ? ` → ${i.numero_certificado}` : ''}`,
                      )
                      .join(', ')}
                  </p>
                )}
                {preview.not_found_in_linx.length > 0 && (
                  <p className="text-danger-700 dark:text-danger-300">
                    Não encontrados no Linx: {preview.not_found_in_linx.join(', ')}
                  </p>
                )}
                {preview.invalid.length > 0 && (
                  <p className="text-danger-700 dark:text-danger-300">
                    {preview.invalid.length} SKU(s) inválido(s) foram ignorados.
                  </p>
                )}
              </div>
            )}

            {openItems.length === 0 ? (
              <p className="text-sm text-slate-500 dark:text-slate-400">
                {itemsBusy ? 'Carregando…' : 'Nenhum produto vinculado a este certificado.'}
              </p>
            ) : (
              <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                {openItems.map((item) => (
                  <li
                    key={item.id}
                    className="flex flex-wrap items-center gap-2 py-2 text-sm text-slate-700 dark:text-slate-200"
                  >
                    <span className="font-mono text-xs font-semibold">{item.sku}</span>
                    <LinxBadge status={item.linx_status} />
                    <span className="text-xs text-slate-500 dark:text-slate-400">
                      {item.situacao_efetiva ?? openCert.situacao ?? 'Situação não informada'} ·{' '}
                      {item.restricao_origem === 'item' ? 'Regra do item' : 'Herda o certificado'}
                      {item.fim_venda_efetivo
                        ? ` · Fim de venda: ${formatDateOnly(item.fim_venda_efetivo)}`
                        : ''}
                    </span>
                    {item.restricao_pendente && (
                      <span className="text-xs text-amber-700 dark:text-amber-300">
                        Prazo de venda pendente de validação
                      </span>
                    )}
                    <button
                      type="button"
                      disabled={itemsBusy || removingSku !== null}
                      aria-label={`Encerrar item ${item.sku}`}
                      onClick={() =>
                        setRestrictionForm({
                          sku: item.sku,
                          inherit: false,
                          date: item.fim_venda ?? '',
                          reason: '',
                        })
                      }
                      className="text-xs text-amber-700 dark:text-amber-300 disabled:opacity-50"
                    >
                      Encerrar item
                    </button>
                    {item.restricao_origem === 'item' && (
                      <button
                        type="button"
                        disabled={itemsBusy || removingSku !== null}
                        aria-label={`Herdar certificado para ${item.sku}`}
                        onClick={() =>
                          setRestrictionForm({ sku: item.sku, inherit: true, date: '', reason: '' })
                        }
                        className="text-xs text-primary-600 dark:text-primary-300 disabled:opacity-50"
                      >
                        Herdar certificado
                      </button>
                    )}

                    {item.linx_error && (
                      <span className="text-xs text-danger-600 dark:text-danger-300">
                        {item.linx_error}
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => handleRemoveItem(item.sku)}
                      disabled={removingSku !== null || itemsBusy}
                      aria-label={`Remover ${item.sku} do certificado`}
                      className="ml-auto inline-flex items-center gap-1 text-xs text-slate-400 transition-colors hover:text-danger-600 disabled:opacity-50 dark:hover:text-danger-300"
                    >
                      {removingSku === item.sku ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Trash2 className="h-3.5 w-3.5" />
                      )}
                      Remover
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {restrictionForm && (
              <form
                onSubmit={handleSaveRestriction}
                className="space-y-3 rounded-lg border border-amber-200 p-4 dark:border-amber-800"
                aria-label="Restrição individual do item"
              >
                <h4 className="text-sm font-semibold">
                  {restrictionForm.inherit
                    ? 'Herdar a situação e o prazo do certificado'
                    : 'Encerrar somente este item'}{' '}
                  · {restrictionForm.sku}
                </h4>
                {!restrictionForm.inherit && (
                  <div>
                    <label className={labelCls} htmlFor="item-restriction-date">
                      Fim de venda por certificação do item
                    </label>
                    <input
                      id="item-restriction-date"
                      type="date"
                      value={restrictionForm.date}
                      onChange={(e) =>
                        setRestrictionForm({ ...restrictionForm, date: e.target.value })
                      }
                      className={inputCls}
                    />
                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                      Sem prazo aprovado, o encerramento fica pendente de validação. Não será
                      inventada uma data.
                    </p>
                  </div>
                )}
                <div>
                  <label className={labelCls} htmlFor="item-restriction-reason">
                    Motivo da alteração do item
                  </label>
                  <textarea
                    id="item-restriction-reason"
                    required
                    maxLength={1000}
                    value={restrictionForm.reason}
                    onChange={(e) =>
                      setRestrictionForm({ ...restrictionForm, reason: e.target.value })
                    }
                    className={inputCls}
                  />
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Esta alteração fica no portal, preserva os demais itens e não grava imediatamente
                  no Linx.
                </p>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="submit"
                    disabled={itemsBusy || !restrictionForm.reason.trim()}
                    className="rounded-lg bg-primary-600 px-3 py-2 text-sm text-white disabled:opacity-50"
                  >
                    {itemsBusy ? 'Salvando…' : 'Salvar restrição do item'}
                  </button>
                  <button
                    type="button"
                    disabled={itemsBusy}
                    onClick={() => setRestrictionForm(null)}
                    className="rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-600"
                  >
                    Cancelar
                  </button>
                </div>
              </form>
            )}

            <p className="text-xs text-slate-500 dark:text-slate-400">
              Remover um produto desfaz apenas o vínculo: a data já gravada no Linx permanece, para
              que a liberação de venda nunca aconteça por efeito colateral.
            </p>
          </div>
        </section>
      )}
    </div>
  );
}
