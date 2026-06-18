import { extractSydleRecords } from './normalizer.js';

export interface SydleClientConfig {
  enabled: boolean;
  baseUrl: string;
  apiToken: string;
  paymentsPath: string;
  authHeader: string;
  authScheme: string;
  updatedAfterParam: string;
  pageParam: string;
  pageSizeParam: string;
  pageSize: number;
  timeoutMs: number;
}

export interface SydleFetchResult {
  records: Record<string, unknown>[];
  cursorTo: Date;
  metadata: Record<string, unknown>;
}

export function getSydleClientConfig(): SydleClientConfig {
  const pageSize = Number(process.env.SYDLE_PAGE_SIZE ?? 200);
  const timeoutMs = Number(process.env.SYDLE_TIMEOUT_MS ?? 30_000);

  return {
    enabled: ['1', 'true', 'yes'].includes(
      String(process.env.SYDLE_SYNC_ENABLED ?? '').toLowerCase(),
    ),
    baseUrl: process.env.SYDLE_BASE_URL ?? '',
    apiToken: process.env.SYDLE_API_TOKEN ?? '',
    paymentsPath: process.env.SYDLE_PAYMENTS_PATH ?? '/api/purchase-payments',
    authHeader: process.env.SYDLE_AUTH_HEADER ?? 'Authorization',
    authScheme: process.env.SYDLE_AUTH_SCHEME ?? 'Bearer',
    updatedAfterParam: process.env.SYDLE_UPDATED_AFTER_PARAM ?? 'updatedAfter',
    pageParam: process.env.SYDLE_PAGE_PARAM ?? 'page',
    pageSizeParam: process.env.SYDLE_PAGE_SIZE_PARAM ?? 'pageSize',
    pageSize: Number.isFinite(pageSize) && pageSize > 0 ? Math.min(pageSize, 1000) : 200,
    timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 30_000,
  };
}

export function getSydleConfigStatus(config = getSydleClientConfig()) {
  const missing: string[] = [];
  if (!config.enabled) missing.push('SYDLE_SYNC_ENABLED');
  if (!config.baseUrl) missing.push('SYDLE_BASE_URL');
  if (!config.apiToken) missing.push('SYDLE_API_TOKEN');

  return {
    enabled: config.enabled,
    configured: config.enabled && missing.length === 0,
    missing,
    paymentsPath: config.paymentsPath,
    pageSize: config.pageSize,
  };
}

export class SydleClient {
  constructor(private readonly config = getSydleClientConfig()) {}

  async fetchPayments(updatedAfter: Date | null): Promise<SydleFetchResult> {
    const status = getSydleConfigStatus(this.config);
    if (!status.configured) {
      throw new Error(`SYDLE nao configurada: ${status.missing.join(', ')}`);
    }

    const allRecords: Record<string, unknown>[] = [];
    const startedAt = new Date();
    let page = 1;
    let pagesFetched = 0;

    while (page <= 1000) {
      const url = new URL(this.config.paymentsPath, this.config.baseUrl);
      url.searchParams.set(this.config.pageParam, String(page));
      url.searchParams.set(this.config.pageSizeParam, String(this.config.pageSize));
      if (updatedAfter) {
        url.searchParams.set(this.config.updatedAfterParam, updatedAfter.toISOString());
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);
      try {
        const response = await fetch(url, {
          headers: {
            Accept: 'application/json',
            [this.config.authHeader]:
              this.config.authHeader.toLowerCase() === 'authorization'
                ? `${this.config.authScheme} ${this.config.apiToken}`.trim()
                : this.config.apiToken,
          },
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status} ao consultar pagamentos SYDLE`);
        }

        const payload = (await response.json()) as unknown;
        const records = extractSydleRecords(payload);
        allRecords.push(...records);
        pagesFetched += 1;

        const hasNext = hasNextPage(payload, records.length, this.config.pageSize);
        if (!hasNext) break;
        page += 1;
      } finally {
        clearTimeout(timeout);
      }
    }

    return {
      records: allRecords,
      cursorTo: startedAt,
      metadata: {
        pagesFetched,
        pageSize: this.config.pageSize,
        updatedAfter: updatedAfter?.toISOString() ?? null,
      },
    };
  }
}

function hasNextPage(payload: unknown, returned: number, pageSize: number): boolean {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return returned >= pageSize;
  }

  const obj = payload as Record<string, unknown>;
  if (typeof obj.hasNext === 'boolean') return obj.hasNext;
  if (typeof obj.hasMore === 'boolean') return obj.hasMore;

  const page = Number(obj.page ?? obj.currentPage);
  const totalPages = Number(obj.totalPages ?? obj.pages);
  if (Number.isFinite(page) && Number.isFinite(totalPages) && totalPages > 0) {
    return page < totalPages;
  }

  return returned >= pageSize;
}
