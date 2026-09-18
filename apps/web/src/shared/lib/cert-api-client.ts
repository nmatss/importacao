import { redirectToLogin } from './session-expired';

// ── Cert-API response types ────────────────────────────────────────────
// These represent the known shape of cert-api responses.
// Consumers may use their own local interfaces; functions are generic
// so callers can override the return type when needed.

export type CertStatusKind = 'ATIVO' | 'ENCERRADO';

export type SiteStatusKind = 'CONFORME' | 'NAO_CONFORME';

export type LicenseStatusKind = 'VALIDO' | 'VENCIDO' | 'NAO_APLICAVEL' | 'PENDENTE';

export type ComercializacaoStatusKind =
  | 'LIBERADA'
  | 'DENTRO_PRAZO'
  | 'ENCERRADA'
  | 'NAO_APLICA'
  | 'PENDENTE';

export interface CertProduct {
  sku: string;
  brand: string;
  name?: string;
  description?: string;
  status?: string;
  sheet_status?: string;
  certification_type?: string;
  expected_cert_text?: string;
  last_validation_status?: string | null;
  last_validation_score?: number | null;
  last_validation_url?: string | null;
  last_validation_date?: string | null;
  last_validation_error?: string | null;
  is_expired?: boolean;
  sale_deadline?: string;
  sale_deadline_date?: string | null;
  // Coluna P das abas Imaginarium/Puket ("Número Certificado") — também é o que
  // liga o produto à linha da aba Encerramentos (coluna A, "CERTIFICADO").
  numero_certificado?: string | null;
  // Coluna U das abas de produto ("SITUAÇÃO").
  situacao?: string | null;
  // Coluna H da aba Encerramentos: 'Comerciação Permitida' /
  // 'Vencido - Venda Bloqueada' / 'Venda até fim do lote'. É o veredito do time
  // fiscal sobre poder faturar, e existe para SKUs que não têm data em G.
  encerramento_status?: string | null;
  // Prazo de licenciamento — distinto do prazo de venda (sale_deadline).
  // Alimenta a coluna "Licen. - Prazo". Backend ainda precisa expor este campo
  // a partir da planilha "Licenciamentos Vencidos" (ver followups).
  license_deadline?: string | null;
  license_deadline_date?: string | null;
  // Contrato D11 (reunião 11/09/2026). Dois eixos separados: o STATUS do
  // certificado vem da validade/situação, e a TRAVA de venda é a menor data real
  // entre o fim de venda da certificação e o fim do licenciamento.
  validade_certificado?: string | null;
  /** Texto original da planilha, quando a data não pôde ser interpretada. */
  validade_certificado_raw?: string | null;
  status_venda?: 'LIBERADA' | 'BLOQUEADA' | null;
  status_venda_reason?: string | null;
  cert_status_reason?: string | null;
  license_status_reason?: string | null;
  trava_venda?: string | null;
  trava_origem?: 'certificacao' | 'licenciamento' | null;
  // Grife/licença lida do Linx (PRODUTOS.GRIFFE na Puket, IMG_LICENCIAMENTO na
  // Imaginarium). Cobertura parcial: vazio significa "não preenchido no ERP",
  // nunca "sem licenciamento".
  grife?: string | null;
  // Propriedades do Linx copiadas pelo sync de atributos (somente leitura).
  // `null` = sem data real (a sentinela 01/01/1900 do ERP já foi normalizada).
  linx_fim_licenciamento?: string | null;
  linx_prop_certificacao?: string | null;
  linx_fim_vendas?: string | null;
  linx_synced_at?: string | null;
  cert_url?: string | null;
  cert_expiry?: string | null;
  last_checked?: string | null;
  stock_cd?: number | null;
  stock_ecommerce?: number | null;
  stock_total?: number | null;
  stock_detail?: Array<{
    source: string;
    warehouse: string;
    quantity: number;
    available: number;
    synced_at?: string | null;
  }>;
  // Sync de estoque mais recente entre as fontes deste SKU.
  stock_synced_at?: string | null;
  // Status semânticos derivados (port Verificao_status — sessão 2026-05-22):
  cert_status?: CertStatusKind | null;
  site_status?: SiteStatusKind | null;
  // Frase explicativa emitida pelo backend quando site_status === 'NAO_CONFORME'
  // (ex.: 'Verificacao pendente - revisar'). Exibida sob o badge Status Ecommerce.
  site_status_reason?: string | null;
  license_status?: LicenseStatusKind | null;
  comercializacao_status?: ComercializacaoStatusKind | null;
  created_at?: string;
  updated_at?: string;
  [key: string]: unknown;
}

export interface CertProductsResponse {
  products: CertProduct[];
  total?: number;
  total_pages?: number;
  page?: number;
  per_page?: number;
  last_validation_date?: string | null;
  [key: string]: unknown;
}

export interface CertBrandStats {
  brand: string;
  ok: number;
  missing?: number;
  inconsistent: number;
  /**
   * Validado e NAO localizado/consistente. Desde a correcao do backend
   * (2026-08-29) NAO inclui mais `last_validation_status IS NULL`.
   */
  not_found: number;
  /**
   * Produto que ainda nao passou por nenhuma validacao. E ausencia de veredito,
   * nao veredito negativo — por isso vive num bucket proprio e e pintado com cor
   * neutra na UI.
   */
  never_validated?: number;
  expired: number;
  [key: string]: unknown;
}

export interface CertLastRun {
  date: string;
  total: number;
  ok: number;
  missing?: number;
  inconsistent: number;
  not_found: number;
  [key: string]: unknown;
}

export interface CertStats {
  total_products?: number;
  total_expired?: number;
  total?: number;
  valid?: number;
  missing?: number;
  inconsistent?: number;
  expired?: number;
  last_run?: CertLastRun | null;
  /**
   * Contagens por marca. Cada linha traz `never_validated` desde a correcao do
   * backend; sem exibi-lo a soma das barras fica MENOR que `total_products`.
   */
  by_brand?: CertBrandStats[];
  // Breakdowns por status semântico derivado (port Verificao_status):
  by_cert_status?: Array<{ cert_status: CertStatusKind; count: number }>;
  by_site_status?: Array<{ site_status: SiteStatusKind; count: number }>;
  by_license_status?: Array<{ license_status: LicenseStatusKind; count: number }>;
  by_comercializacao_status?: Array<{
    comercializacao_status: ComercializacaoStatusKind;
    count: number;
  }>;
  [key: string]: unknown;
}

export interface CertValidationRun {
  run_id: string;
  status: string;
  total?: number;
  checked?: number;
  errors?: number;
  started_at?: string;
  finished_at?: string;
  [key: string]: unknown;
}

export interface CertValidationEvent {
  type: 'progress' | 'result' | 'complete' | 'error';
  current?: number;
  total?: number;
  product?: { sku: string; name: string; status: string; score: number; [key: string]: unknown };
  summary?: Record<string, unknown>;
  sku?: string;
  brand?: string;
  status?: string;
  message?: string;
  error?: string;
  [key: string]: unknown;
}

export interface CertVerifyResult {
  sku: string;
  brand: string;
  status: string;
  score?: number | null;
  url?: string | null;
  verified_at?: string | null;
  cert_url?: string | null;
  cert_expiry?: string | null;
  error?: string;
  [key: string]: unknown;
}

export interface CertReport {
  filename: string;
  format?: string;
  created_at?: string;
  date?: string;
  size?: number;
  size_bytes?: number;
  [key: string]: unknown;
}

export interface CertReportResult {
  sku: string;
  name: string;
  brand: string;
  status: string;
  /** Similaridade 0..1 (`compare_cert_texts`), nao percentual. */
  score: number | null;
  url: string | null;
  actual_cert_text?: string | null;
  certification_type?: string | null;
  expected_cert_text?: string | null;
  error?: string | null;
  [key: string]: unknown;
}

/**
 * Espelha o JSON gravado por `_run_validation` (`app/routes/certifications.py`)
 * e devolvido cru por `GET /api/reports/{filename}/data`: `run_id`, `date`,
 * `summary` e `products`. A lista vem em `products`; `results` e o nome de um
 * formato antigo que `report_service.generate_validation_report_xlsx` tambem aceita. Leia
 * sempre por `certReportItems` para nao repetir o defeito da tabela vazia.
 */
export interface CertReportData {
  run_id?: string;
  date?: string;
  products?: CertReportResult[];
  /** Formato legado; o backend atual nunca grava esta chave. */
  results?: CertReportResult[];
  summary?: {
    total: number;
    ok: number;
    missing: number;
    inconsistent: number;
    not_found: number;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

/**
 * Itens de um relatorio de validacao, na mesma ordem de precedencia do backend
 * (`products`, depois `results`). Valor que nao e lista vira lista vazia para a
 * tela nao quebrar com arquivo corrompido.
 */
export function certReportItems(data: CertReportData | null | undefined): CertReportResult[] {
  if (Array.isArray(data?.products)) return data.products;
  if (Array.isArray(data?.results)) return data.results;
  return [];
}

/**
 * Espelha `_serialize_schedule` (`app/routes/schedules.py`) e as colunas de
 * `cert_schedules`. A API devolve `cron_expression`/`last_run`/`next_run` — os
 * antigos aliases `cron`/`last_run_at`/`next_run_at` NAO existem no payload e
 * foram removidos daqui (auditoria 2026-08-29).
 */
export interface CertSchedule {
  id: string;
  name: string;
  cron_expression: string;
  brand_filter: string | null;
  enabled: boolean;
  last_run: string | null;
  next_run: string | null;
  created_at: string;
  [key: string]: unknown;
}

/**
 * Espelha as colunas de `cert_schedule_history`: id, schedule_id, run_date,
 * status, summary, report_file. `started_at`/`finished_at`/`total_checked`/
 * `errors` nunca existiram na tabela nem na resposta.
 */
export interface CertScheduleHistoryEntry {
  id: string;
  schedule_id: string;
  run_date: string;
  /** 'running' | 'completed' | 'failed' */
  status: string;
  summary: CertHistorySummary | null;
  report_file: string | null;
  [key: string]: unknown;
}

export interface CertHistorySummary {
  total?: number;
  ok?: number;
  missing?: number;
  inconsistent?: number;
  not_found?: number;
  [key: string]: unknown;
}

export interface CertHealthResponse {
  status: string;
  [key: string]: unknown;
}

// ── Client ─────────────────────────────────────────────────────────────

const CERT_BASE = '/cert-api';
const TOKEN_KEY = 'importacao_token';

export async function certApiFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const headers = new Headers(options.headers);
  const token = typeof localStorage !== 'undefined' ? localStorage.getItem(TOKEN_KEY) : null;

  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  if (
    options.body !== undefined &&
    !(options.body instanceof FormData) &&
    !headers.has('Content-Type')
  ) {
    headers.set('Content-Type', 'application/json');
  }

  const res = await fetch(`${CERT_BASE}${path}`, {
    ...options,
    headers,
  });

  if (res.status === 401) {
    localStorage.removeItem(TOKEN_KEY);
    redirectToLogin();
    throw new Error('Unauthorized');
  }

  if (!res.ok) {
    let detail = `${res.status} ${res.statusText}`;
    try {
      const body = await res.clone().json();
      if (body?.detail) detail = String(body.detail);
      if (body?.error) detail = String(body.error);
    } catch {
      // keep status text
    }
    throw new Error(`Erro na API: ${detail}`);
  }

  return res;
}

async function certFetch<T = unknown>(path: string, options?: RequestInit): Promise<T> {
  const res = await certApiFetch(path, options);
  return res.json();
}

export function contentDispositionFilename(header: string | null): string | null {
  if (!header) return null;
  const utfMatch = header.match(/filename\*=UTF-8''([^;]+)/i);
  if (utfMatch?.[1]) return decodeURIComponent(utfMatch[1].replace(/"/g, ''));
  const match = header.match(/filename="?([^";]+)"?/i);
  return match?.[1] ?? null;
}

export async function downloadCertApiResource(
  path: string,
  fallbackFilename: string,
  options?: RequestInit,
): Promise<void> {
  const res = await certApiFetch(path, options);
  const blob = await res.blob();
  const filename =
    contentDispositionFilename(res.headers.get('content-disposition')) ?? fallbackFilename;
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = 'noreferrer';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export async function fetchCertStats(): Promise<CertStats> {
  return certFetch<CertStats>('/api/stats');
}

export async function fetchCertProducts(params?: {
  page?: number;
  per_page?: number;
  search?: string;
  brand?: string;
  status?: string;
  start_date?: string;
  end_date?: string;
  cert_status?: string;
  site_status?: string;
  license_status?: string;
  comercializacao_status?: string;
  grife?: string;
}): Promise<CertProductsResponse> {
  const query = new URLSearchParams();
  if (params?.page) query.set('page', String(params.page));
  if (params?.per_page) query.set('per_page', String(params.per_page));
  if (params?.search) query.set('search', params.search);
  if (params?.brand) query.set('brand', params.brand);
  if (params?.grife) query.set('grife', params.grife);
  if (params?.status) query.set('status', params.status);
  if (params?.start_date) query.set('start_date', params.start_date);
  if (params?.end_date) query.set('end_date', params.end_date);
  if (params?.cert_status) query.set('cert_status', params.cert_status);
  if (params?.site_status) query.set('site_status', params.site_status);
  if (params?.license_status) query.set('license_status', params.license_status);
  if (params?.comercializacao_status)
    query.set('comercializacao_status', params.comercializacao_status);
  const qs = query.toString();
  return certFetch<CertProductsResponse>(`/api/products${qs ? `?${qs}` : ''}`);
}

export async function fetchCertProductDetail(sku: string): Promise<CertProduct> {
  return certFetch<CertProduct>(`/api/products/${encodeURIComponent(sku)}`);
}

export async function verifyCertProduct(sku: string, brand: string): Promise<CertVerifyResult> {
  return certFetch<CertVerifyResult>('/api/products/verify', {
    method: 'POST',
    body: JSON.stringify({ sku, brand }),
  });
}

export async function startCertValidation(params: {
  brand?: string;
  limit?: number;
  source?: 'sheets' | 'excel';
}): Promise<CertValidationRun> {
  return certFetch<CertValidationRun>('/api/validate', {
    method: 'POST',
    body: JSON.stringify(params),
  });
}

export async function fetchCertValidationStatus(runId: string): Promise<CertValidationRun> {
  return certFetch<CertValidationRun>(`/api/validate/${runId}`);
}

export function streamCertValidation(
  runId: string,
  onEvent: (data: CertValidationEvent) => void,
): { close: () => void } {
  const controller = new AbortController();
  let closed = false;

  const close = () => {
    closed = true;
    controller.abort();
  };

  const dispatchEvent = (raw: string) => {
    try {
      const data: CertValidationEvent = JSON.parse(raw);
      onEvent(data);
      if (data.type === 'complete' || data.type === 'error') {
        close();
      }
    } catch {
      // ignore parse errors
    }
  };

  void (async () => {
    const res = await certApiFetch(`/api/validate/${runId}/stream`, {
      headers: { Accept: 'text/event-stream' },
      signal: controller.signal,
    });
    if (!res.body) throw new Error('Stream indisponivel');

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (!closed) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const events = buffer.split(/\r?\n\r?\n/);
      buffer = events.pop() ?? '';
      for (const event of events) {
        const data = event
          .split(/\r?\n/)
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trimStart())
          .join('\n');
        if (data) dispatchEvent(data);
      }
    }
    // Servidor encerrou o stream SEM evento complete/error (restart do
    // cert-api no meio da validação): sem isto o consumidor ficava em
    // "running" para sempre (auditoria 2026-07-17).
    if (!closed) {
      onEvent({ type: 'error', error: 'Stream encerrado pelo servidor antes de concluir' });
      close();
    }
  })().catch((error: unknown) => {
    if (!closed) {
      onEvent({
        type: 'error',
        error: error instanceof Error ? error.message : 'Erro no stream de validacao',
      });
    }
  });

  return { close };
}

export async function checkCertApiHealth(): Promise<{ connected: boolean; latencyMs: number }> {
  const start = performance.now();
  try {
    await certFetch<CertHealthResponse>('/api/health');
    return { connected: true, latencyMs: Math.round(performance.now() - start) };
  } catch {
    return { connected: false, latencyMs: Math.round(performance.now() - start) };
  }
}

// ---------- Schedules ----------

export async function fetchCertSchedules(params?: {
  start_date?: string;
  end_date?: string;
}): Promise<CertSchedule[]> {
  const query = new URLSearchParams();
  if (params?.start_date) query.set('start_date', params.start_date);
  if (params?.end_date) query.set('end_date', params.end_date);
  const qs = query.toString();
  return certFetch<CertSchedule[]>(`/api/schedules${qs ? `?${qs}` : ''}`);
}

export async function createCertSchedule(data: {
  name: string;
  cron: string;
  brand?: string;
  enabled?: boolean;
}): Promise<CertSchedule> {
  const payload: Record<string, unknown> = {
    name: data.name,
    cron: data.cron,
    enabled: data.enabled,
  };
  if (data.brand) payload.brand_filter = data.brand;
  return certFetch<CertSchedule>('/api/schedules', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function updateCertSchedule(
  id: string,
  data: {
    name?: string;
    cron?: string;
    brand?: string;
    enabled?: boolean;
  },
): Promise<CertSchedule> {
  const payload: Record<string, unknown> = {};
  if (data.name !== undefined) payload.name = data.name;
  if (data.cron !== undefined) payload.cron = data.cron;
  if (data.enabled !== undefined) payload.enabled = data.enabled;
  if (data.brand !== undefined) payload.brand_filter = data.brand || null;
  return certFetch<CertSchedule>(`/api/schedules/${id}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
}

export async function deleteCertSchedule(id: string): Promise<void> {
  return certFetch<void>(`/api/schedules/${id}`, { method: 'DELETE' });
}

export async function runCertScheduleNow(id: string): Promise<CertValidationRun> {
  return certFetch<CertValidationRun>(`/api/schedules/${id}/run`, { method: 'POST' });
}

export async function fetchCertScheduleHistory(id: string): Promise<CertScheduleHistoryEntry[]> {
  return certFetch<CertScheduleHistoryEntry[]>(`/api/schedules/${id}/history`);
}

// ---------- Expired Products ----------

export async function fetchCertExpired(params?: {
  page?: number;
  per_page?: number;
  search?: string;
  brand?: string;
}): Promise<CertProductsResponse> {
  const query = new URLSearchParams();
  if (params?.page) query.set('page', String(params.page));
  if (params?.per_page) query.set('per_page', String(params.per_page));
  if (params?.search) query.set('search', params.search);
  if (params?.brand) query.set('brand', params.brand);
  const qs = query.toString();
  return certFetch<CertProductsResponse>(`/api/expired${qs ? `?${qs}` : ''}`);
}

// ---------- Certificates (cadastro + escrita no Linx) ----------

export type LinxStatus = 'pending' | 'applied' | 'disabled' | 'error';

export type CertSituacao = 'ATIVO' | 'ENCERRADO';

/**
 * Um produto vinculado a um certificado (`cert_certificate_items`).
 * A remoção é soft delete: a linha some da lista, `removed_at` fica gravado e a
 * trava do produto no Linx NÃO é apagada.
 */
export interface CertCertificateItem {
  situacao?: CertSituacao | null;
  fim_venda?: string | null;
  situacao_efetiva?: CertSituacao | null;
  fim_venda_efetivo?: string | null;
  restricao_pendente?: boolean;
  restricao_origem?: 'item' | 'certificado';
  id: string;
  certificate_id: string;
  sku: string;
  brand: string;
  produto_codigo?: string | null;
  linx_status: LinxStatus;
  linx_error?: string | null;
  linx_applied_at?: string | null;
  added_by?: string | null;
  added_at?: string;
  [key: string]: unknown;
}

/** Resultado da classificação do vínculo em massa (prévia ou aplicação). */
export interface CertLinkResult {
  dry_run: boolean;
  added: string[];
  already_linked: string[];
  linked_to_other_active_cert: Array<{ sku: string; numero_certificado: string | null }>;
  not_found_in_linx: string[];
  invalid: string[];
  linx?: Array<{ sku: string; status: LinxStatus; error?: string | null }>;
  items?: CertCertificateItem[];
}

export interface CertCertificate {
  id: string;
  /** Legado: o SKU do cadastro antigo. Os produtos moram em `items`. */
  sku: string | null;
  brand: string;
  produto_codigo?: string | null;
  validade_certificado?: string | null;
  /** Trava de venda. Vazio enquanto o certificado estiver ativo. */
  fim_venda?: string | null;
  situacao?: CertSituacao | null;
  items?: CertCertificateItem[];
  items_count?: number;
  link_result?: CertLinkResult;
  vencimento_licenciamento?: string | null;
  numero_certificado?: string | null;
  ocp?: string | null;
  orgao_certificador?: string | null;
  pdf_filename?: string | null;
  linx_status: LinxStatus;
  linx_error?: string | null;
  linx_detail?: Array<{ field: string; prop: string; valor?: string; action: string }> | null;
  linx_applied_at?: string | null;
  created_by?: string | null;
  created_at?: string;
  updated_at?: string;
  [key: string]: unknown;
}

export interface CertCertificatesResponse {
  items: CertCertificate[];
  total: number;
  page: number;
  per_page: number;
  total_pages: number;
}

export interface CreateCertificateInput {
  sku?: string;
  /** Lista colada da planilha: uma SKU por linha. */
  skus?: string;
  brand: string;
  validade_certificado?: string;
  fim_venda?: string;
  situacao?: CertSituacao;
  vencimento_licenciamento?: string;
  numero_certificado?: string;
  ocp?: string;
  orgao_certificador?: string;
  created_by?: string;
  pdf?: File | null;
}

export type LinxPropertyState = 'found' | 'empty' | 'invalid';

export interface CertLinxLookup {
  fim_venda_certificacao?: string | null;
  status: 'found' | 'empty';
  sku: string;
  brand: string;
  produto_codigo: string;
  validade_certificado: string | null;
  vencimento_licenciamento: string | null;
  properties: Record<
    'validade_certificado' | 'vencimento_licenciamento',
    {
      property_code: string;
      raw_value: string | null;
      state: LinxPropertyState;
    }
  >;
}

export async function createCertificate(input: CreateCertificateInput): Promise<CertCertificate> {
  const fd = new FormData();
  if (input.sku) fd.set('sku', input.sku);
  if (input.skus) fd.set('skus', input.skus);
  fd.set('brand', input.brand);
  if (input.validade_certificado) fd.set('validade_certificado', input.validade_certificado);
  if (input.fim_venda) fd.set('fim_venda', input.fim_venda);
  if (input.situacao) fd.set('situacao', input.situacao);
  if (input.vencimento_licenciamento)
    fd.set('vencimento_licenciamento', input.vencimento_licenciamento);
  if (input.numero_certificado) fd.set('numero_certificado', input.numero_certificado);
  if (input.ocp) fd.set('ocp', input.ocp);
  if (input.orgao_certificador) fd.set('orgao_certificador', input.orgao_certificador);
  if (input.created_by) fd.set('created_by', input.created_by);
  if (input.pdf) fd.set('pdf', input.pdf);

  // multipart: let the browser set the Content-Type boundary.
  const res = await certApiFetch('/api/certificates', { method: 'POST', body: fd });
  return res.json();
}

export async function fetchCertificates(params?: {
  page?: number;
  per_page?: number;
  sku?: string;
  brand?: string;
  numero?: string;
  situacao?: string;
  linx_status?: string;
}): Promise<CertCertificatesResponse> {
  const query = new URLSearchParams();
  if (params?.page) query.set('page', String(params.page));
  if (params?.per_page) query.set('per_page', String(params.per_page));
  if (params?.sku) query.set('sku', params.sku);
  if (params?.brand) query.set('brand', params.brand);
  if (params?.numero) query.set('numero', params.numero);
  if (params?.situacao) query.set('situacao', params.situacao);
  if (params?.linx_status) query.set('linx_status', params.linx_status);
  const qs = query.toString();
  return certFetch<CertCertificatesResponse>(`/api/certificates${qs ? `?${qs}` : ''}`);
}

export async function lookupCertificateLinx(brand: string, sku: string): Promise<CertLinxLookup> {
  const query = new URLSearchParams({ brand, sku });
  return certFetch<CertLinxLookup>(`/api/certificates/linx-lookup?${query.toString()}`);
}

export async function retryCertificateLinx(id: string): Promise<CertCertificate> {
  return certFetch<CertCertificate>(`/api/certificates/${encodeURIComponent(id)}/retry-linx`, {
    method: 'POST',
  });
}

export async function downloadCertificatePdf(id: string): Promise<void> {
  await downloadCertApiResource(`/api/certificates/${encodeURIComponent(id)}/pdf`, `${id}.pdf`);
}

export async function fetchCertificateDetail(id: string): Promise<CertCertificate> {
  return certFetch<CertCertificate>(`/api/certificates/${encodeURIComponent(id)}`);
}

/**
 * Vincula SKUs em massa. `dryRun` é o padrão: a tela mostra a prévia antes de
 * qualquer gravação no Linx.
 */
export async function linkCertificateItems(
  id: string,
  skus: string[],
  dryRun = true,
): Promise<CertLinkResult> {
  return certFetch<CertLinkResult>(`/api/certificates/${encodeURIComponent(id)}/items`, {
    method: 'POST',
    body: JSON.stringify({ skus, dry_run: dryRun }),
  });
}

export async function updateCertificateItemRestriction(
  certificateId: string,
  sku: string,
  restriction: { situacao: CertSituacao | null; fim_venda: string | null; motivo: string },
): Promise<CertCertificateItem> {
  return certFetch<CertCertificateItem>(
    `/api/certificates/${encodeURIComponent(certificateId)}/items/${encodeURIComponent(sku)}/restriction`,
    {
      method: 'PATCH',
      body: JSON.stringify(restriction),
    },
  );
}

export async function removeCertificateItem(
  id: string,
  sku: string,
): Promise<{ ok: boolean; items: CertCertificateItem[] }> {
  return certFetch<{ ok: boolean; items: CertCertificateItem[] }>(
    `/api/certificates/${encodeURIComponent(id)}/items/${encodeURIComponent(sku)}`,
    { method: 'DELETE' },
  );
}

// ---------- Sync da planilha ----------

export interface CertSyncRun {
  id: string;
  trigger: 'manual' | 'startup' | 'schedule' | 'hourly';
  actor: string | null;
  started_at: string;
  finished_at: string | null;
  result: Record<string, unknown> | null;
  error: string | null;
}

export interface CertSyncResult {
  status?: 'error' | 'completed';
  error?: string;
  locked: boolean;
  trigger: string;
  run_id: string | null;
  sheets?: Record<string, unknown>;
  linx?: Record<string, unknown>;
}

/** Força a leitura da planilha (só planilha + atributos do Linx, sem VTEX). */
export async function syncCertSheets(): Promise<CertSyncResult> {
  return certFetch<CertSyncResult>('/api/sync-sheets', { method: 'POST' });
}

export async function fetchLastCertSync(): Promise<{ last_run: CertSyncRun | null }> {
  return certFetch<{ last_run: CertSyncRun | null }>('/api/sync-sheets/last');
}

export async function fetchCertGrifes(): Promise<{
  grifes: Array<{ grife: string; count: number }>;
  sem_grife: number;
}> {
  return certFetch('/api/grifes');
}

// ---------- Marketplace (auditoria Inmetro de quebra-cabeças) ----------

export type MarketplaceVerdict = 'OK' | 'NAO_OK' | 'REVISAR' | 'NAO_EXIGE';

export interface CertMarketplaceItem {
  id: string;
  vtex_product_id: string;
  seller_id: string | null;
  seller_name: string | null;
  name: string | null;
  url: string | null;
  pieces: number | null;
  cert_text: string | null;
  verdict: MarketplaceVerdict;
  reason: string | null;
  checked_at: string | null;
  run_id: string | null;
}

export interface CertMarketplaceResponse {
  items: CertMarketplaceItem[];
  run_id: string | null;
  checked_at: string | null;
  summary: Partial<Record<MarketplaceVerdict, number>>;
}

export async function fetchMarketplaceItems(params?: {
  verdict?: string;
  seller?: string;
}): Promise<CertMarketplaceResponse> {
  const query = new URLSearchParams();
  if (params?.verdict) query.set('verdict', params.verdict);
  if (params?.seller) query.set('seller', params.seller);
  const qs = query.toString();
  return certFetch<CertMarketplaceResponse>(`/api/marketplace/items${qs ? `?${qs}` : ''}`);
}

export async function startMarketplaceAudit(): Promise<{ run_id: string; status: string }> {
  return certFetch<{ run_id: string; status: string }>('/api/marketplace/audit', {
    method: 'POST',
  });
}

export interface MarketplaceAuditState {
  run_id: string;
  status: string;
  /** Nome do tipo da falha (sempre presente em `status: 'error'`). */
  error?: string;
  /** Texto legível da falha, só quando a API o escreveu (ex.: categoria vazia). */
  message?: string;
  summary?: Record<string, number>;
  /** Itens de seller terceiro gravados nesta execução. */
  total?: number;
  /** Produtos lidos na categoria. */
  scanned?: number;
  /** Produtos malformados que não puderam ser verificados. */
  unverified?: number;
}

export async function fetchMarketplaceAudit(runId: string): Promise<MarketplaceAuditState> {
  return certFetch<MarketplaceAuditState>(`/api/marketplace/audit/${encodeURIComponent(runId)}`);
}

export async function deleteCertificate(id: string): Promise<{ ok: boolean }> {
  return certFetch<{ ok: boolean }>(`/api/certificates/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

// ---------- Reports ----------

export async function fetchCertReports(): Promise<CertReport[]> {
  return certFetch<CertReport[]>('/api/reports');
}

export async function fetchCertReportDetail(filename: string): Promise<CertReportData> {
  return certFetch<CertReportData>(`/api/reports/${encodeURIComponent(filename)}/data`);
}

function getCertReportDownloadPath(filename: string, format: 'xlsx' | 'json' = 'xlsx'): string {
  if (filename.endsWith('.xlsx') && format === 'xlsx') {
    return `/api/reports/${encodeURIComponent(filename)}`;
  }
  return `/api/reports/${encodeURIComponent(filename)}?format=${format}`;
}

export async function downloadCertReport(
  filename: string,
  format: 'xlsx' | 'json' = 'xlsx',
): Promise<void> {
  const fallbackFilename =
    format === 'json'
      ? filename.replace(/\.xlsx$/i, '.json')
      : filename.replace(/\.json$/i, '.xlsx');
  await downloadCertApiResource(getCertReportDownloadPath(filename, format), fallbackFilename);
}
