// ── Cert-API response types ────────────────────────────────────────────
// These represent the known shape of cert-api responses.
// Consumers may use their own local interfaces; functions are generic
// so callers can override the return type when needed.

export interface CertProduct {
  sku: string;
  brand: string;
  name?: string;
  description?: string;
  status?: string;
  last_validation_status?: string | null;
  last_validation_score?: number | null;
  last_validation_url?: string | null;
  last_validation_date?: string | null;
  is_expired?: boolean;
  sale_deadline?: string;
  cert_url?: string | null;
  cert_expiry?: string | null;
  last_checked?: string | null;
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
  missing: number;
  inconsistent: number;
  not_found: number;
  expired: number;
  [key: string]: unknown;
}

export interface CertLastRun {
  date: string;
  total: number;
  ok: number;
  missing: number;
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
  by_brand?: CertBrandStats[];
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
  score: number | null;
  url: string | null;
  [key: string]: unknown;
}

export interface CertReportData {
  results: CertReportResult[];
  summary: {
    total: number;
    ok: number;
    missing: number;
    inconsistent: number;
    not_found: number;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface CertSchedule {
  id: string;
  name: string;
  cron: string;
  cron_expression: string;
  brand_filter: string | null;
  enabled: boolean;
  last_run: string | null;
  last_run_at: string | null;
  next_run: string | null;
  next_run_at: string | null;
  created_at: string;
  [key: string]: unknown;
}

export interface CertScheduleHistoryEntry {
  id: string;
  schedule_id: string;
  started_at: string;
  run_date: string;
  finished_at: string | null;
  status: string;
  total_checked: number;
  errors: number;
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

async function certFetch<T = unknown>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${CERT_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });
  if (!res.ok) {
    throw new Error(`Erro na API: ${res.status} ${res.statusText}`);
  }
  return res.json();
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
}): Promise<CertProductsResponse> {
  const query = new URLSearchParams();
  if (params?.page) query.set('page', String(params.page));
  if (params?.per_page) query.set('per_page', String(params.per_page));
  if (params?.search) query.set('search', params.search);
  if (params?.brand) query.set('brand', params.brand);
  if (params?.status) query.set('status', params.status);
  if (params?.start_date) query.set('start_date', params.start_date);
  if (params?.end_date) query.set('end_date', params.end_date);
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
): EventSource {
  const eventSource = new EventSource(`${CERT_BASE}/api/validate/${runId}/stream`);

  eventSource.onmessage = (event) => {
    try {
      const data: CertValidationEvent = JSON.parse(event.data);
      onEvent(data);
      if (data.type === 'complete' || data.type === 'error') {
        eventSource.close();
      }
    } catch {
      // ignore parse errors
    }
  };

  eventSource.onerror = () => {
    eventSource.close();
  };

  return eventSource;
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

// ---------- Export ----------

export function exportCertProductsExcel(params?: { brand?: string; status?: string }): string {
  const query = new URLSearchParams();
  if (params?.brand) query.set('brand', params.brand);
  if (params?.status) query.set('status', params.status);
  const qs = query.toString();
  return `${CERT_BASE}/api/reports/export${qs ? `?${qs}` : ''}`;
}

// ---------- Reports ----------

export async function fetchCertReports(): Promise<CertReport[]> {
  return certFetch<CertReport[]>('/api/reports');
}

export async function fetchCertReportDetail(filename: string): Promise<CertReportData> {
  return certFetch<CertReportData>(`/api/reports/${encodeURIComponent(filename)}/data`);
}

export function getCertReportDownloadUrl(filename: string): string {
  return `${CERT_BASE}/api/reports/${encodeURIComponent(filename)}?format=xlsx`;
}
