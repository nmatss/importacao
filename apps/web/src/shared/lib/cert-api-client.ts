const CERT_BASE = '/cert-api';

async function certFetch<T = any>(path: string, options?: RequestInit): Promise<T> {
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

export async function fetchCertStats() {
  return certFetch('/api/stats');
}

export async function fetchCertProducts(params?: {
  page?: number;
  per_page?: number;
  search?: string;
  brand?: string;
  status?: string;
}) {
  const query = new URLSearchParams();
  if (params?.page) query.set('page', String(params.page));
  if (params?.per_page) query.set('per_page', String(params.per_page));
  if (params?.search) query.set('search', params.search);
  if (params?.brand) query.set('brand', params.brand);
  if (params?.status) query.set('status', params.status);
  const qs = query.toString();
  return certFetch(`/api/products${qs ? `?${qs}` : ''}`);
}

export async function fetchCertProductDetail(sku: string) {
  return certFetch(`/api/products/${encodeURIComponent(sku)}`);
}

export async function verifyCertProduct(sku: string, brand: string) {
  return certFetch('/api/products/verify', {
    method: 'POST',
    body: JSON.stringify({ sku, brand }),
  });
}

export async function startCertValidation(params: {
  brand?: string;
  limit?: number;
  source?: 'sheets' | 'excel';
}) {
  return certFetch('/api/validate', {
    method: 'POST',
    body: JSON.stringify(params),
  });
}

export async function fetchCertValidationStatus(runId: string) {
  return certFetch(`/api/validate/${runId}`);
}

export function streamCertValidation(runId: string, onEvent: (data: any) => void) {
  const eventSource = new EventSource(`${CERT_BASE}/api/validate/${runId}/stream`);

  eventSource.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
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
    await certFetch('/api/health');
    return { connected: true, latencyMs: Math.round(performance.now() - start) };
  } catch {
    return { connected: false, latencyMs: Math.round(performance.now() - start) };
  }
}

// ---------- Schedules ----------

export async function fetchCertSchedules() {
  return certFetch('/api/schedules');
}

export async function createCertSchedule(data: {
  name: string;
  cron: string;
  brand?: string;
  enabled?: boolean;
}) {
  const payload: Record<string, unknown> = { name: data.name, cron: data.cron, enabled: data.enabled };
  if (data.brand) payload.brand_filter = data.brand;
  return certFetch('/api/schedules', {
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
) {
  const payload: Record<string, unknown> = {};
  if (data.name !== undefined) payload.name = data.name;
  if (data.cron !== undefined) payload.cron = data.cron;
  if (data.enabled !== undefined) payload.enabled = data.enabled;
  if (data.brand !== undefined) payload.brand_filter = data.brand || null;
  return certFetch(`/api/schedules/${id}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
}

export async function deleteCertSchedule(id: string) {
  return certFetch(`/api/schedules/${id}`, { method: 'DELETE' });
}

export async function runCertScheduleNow(id: string) {
  return certFetch(`/api/schedules/${id}/run`, { method: 'POST' });
}

export async function fetchCertScheduleHistory(id: string) {
  return certFetch(`/api/schedules/${id}/history`);
}

// ---------- Expired Products ----------

export async function fetchCertExpired(params?: {
  page?: number;
  per_page?: number;
  search?: string;
  brand?: string;
}) {
  const query = new URLSearchParams();
  if (params?.page) query.set('page', String(params.page));
  if (params?.per_page) query.set('per_page', String(params.per_page));
  if (params?.search) query.set('search', params.search);
  if (params?.brand) query.set('brand', params.brand);
  const qs = query.toString();
  return certFetch(`/api/expired${qs ? `?${qs}` : ''}`);
}

// ---------- Export ----------

export function exportCertProductsExcel(params?: { brand?: string; status?: string }) {
  const query = new URLSearchParams();
  if (params?.brand) query.set('brand', params.brand);
  if (params?.status) query.set('status', params.status);
  const qs = query.toString();
  return `${CERT_BASE}/api/reports/export${qs ? `?${qs}` : ''}`;
}

// ---------- Reports ----------

export async function fetchCertReports() {
  return certFetch('/api/reports');
}

export async function fetchCertReportDetail(filename: string) {
  return certFetch(`/api/reports/${encodeURIComponent(filename)}/data`);
}

export function getCertReportDownloadUrl(filename: string) {
  return `${CERT_BASE}/api/reports/${encodeURIComponent(filename)}?format=xlsx`;
}
