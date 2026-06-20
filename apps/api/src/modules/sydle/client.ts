import { extractSydleRecords, parseSydleDateTime } from './normalizer.js';

type SydleSourceType = 'generic' | 'sydle_one_class';

export interface SydleClientConfig {
  enabled: boolean;
  sourceType: SydleSourceType;
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
  app: string;
  user: string;
  password: string;
  classId: string;
  dateField: string;
  ticketClassId: string;
  ticketStatusClassId: string;
  currencyClassId: string;
}

export interface SydleFetchResult {
  records: Record<string, unknown>[];
  cursorTo: Date | null;
  metadata: Record<string, unknown>;
}

export function getSydleClientConfig(): SydleClientConfig {
  const pageSize = Number(process.env.SYDLE_PAGE_SIZE ?? 200);
  const timeoutMs = Number(process.env.SYDLE_TIMEOUT_MS ?? 30_000);
  const sourceType = normalizeSourceType(process.env.SYDLE_SOURCE_TYPE);

  return {
    enabled: ['1', 'true', 'yes'].includes(
      String(process.env.SYDLE_SYNC_ENABLED ?? '').toLowerCase(),
    ),
    sourceType,
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
    app: process.env.SYDLE_APP ?? 'main',
    user: process.env.SYDLE_USER ?? '',
    password: process.env.SYDLE_PASSWORD ?? '',
    classId: process.env.SYDLE_CLASS_ID ?? '',
    dateField: process.env.SYDLE_DATE_FIELD ?? '_lastUpdateDate',
    ticketClassId: process.env.SYDLE_TICKET_CLASS_ID ?? '5d446dfc62d9656275a47d69',
    ticketStatusClassId: process.env.SYDLE_TICKET_STATUS_CLASS_ID ?? '5cacdc04a50bfe4c0d3e5c74',
    currencyClassId: process.env.SYDLE_CURRENCY_CLASS_ID ?? '000000000000000000000059',
  };
}

export function getSydleConfigStatus(config = getSydleClientConfig()) {
  const missing: string[] = [];
  if (!config.enabled) missing.push('SYDLE_SYNC_ENABLED');
  if (!config.baseUrl) missing.push('SYDLE_BASE_URL');
  if (config.sourceType === 'sydle_one_class') {
    if (!config.user) missing.push('SYDLE_USER');
    if (!config.password) missing.push('SYDLE_PASSWORD');
    if (!config.classId) missing.push('SYDLE_CLASS_ID');
  } else if (!config.apiToken) {
    missing.push('SYDLE_API_TOKEN');
  }

  return {
    enabled: config.enabled,
    configured: config.enabled && missing.length === 0,
    missing,
    sourceType: config.sourceType,
    paymentsPath: config.paymentsPath,
    classId: config.sourceType === 'sydle_one_class' ? config.classId : null,
    dateField: config.sourceType === 'sydle_one_class' ? config.dateField : null,
    app: config.sourceType === 'sydle_one_class' ? config.app : null,
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

    if (this.config.sourceType === 'sydle_one_class') {
      return this.fetchSydleOneClassPayments(updatedAfter);
    }

    return this.fetchGenericPayments(updatedAfter);
  }

  private async fetchGenericPayments(updatedAfter: Date | null): Promise<SydleFetchResult> {
    const allRecords: Record<string, unknown>[] = [];
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
      cursorTo: resolveRawSourceCursor(allRecords),
      metadata: {
        sourceType: this.config.sourceType,
        pagesFetched,
        pageSize: this.config.pageSize,
        updatedAfter: updatedAfter?.toISOString() ?? null,
      },
    };
  }

  private async fetchSydleOneClassPayments(updatedAfter: Date | null): Promise<SydleFetchResult> {
    const authHeaders = await this.authenticateSydleOne();
    const allRecords: Record<string, unknown>[] = [];
    const lookupFailures: Record<string, unknown>[] = [];
    let pagesFetched = 0;
    let searchAfter: unknown[] | undefined;

    while (pagesFetched < 1000) {
      const body = buildSydleOneSearchBody(this.config, updatedAfter, searchAfter);
      const payload = await this.postSydleOneSearch(this.config.classId, body, authHeaders);
      const { records, nextSearchAfter } = extractSydleOneSearchRecords(payload);
      if (!records.length) break;

      const { ticketById, statusById, currencyById, failures } =
        await this.lookupSydleOneReferences(records, authHeaders);
      lookupFailures.push(...failures);
      allRecords.push(
        ...flattenSydleOneInternationalPaymentRows(records, {
          ticketById,
          statusById,
          currencyById,
        }),
      );

      pagesFetched += 1;
      if (records.length < this.config.pageSize || !nextSearchAfter) break;
      searchAfter = nextSearchAfter;
    }

    return {
      records: allRecords,
      cursorTo: resolveRawSourceCursor(allRecords),
      metadata: {
        sourceType: this.config.sourceType,
        classId: this.config.classId,
        dateField: this.config.dateField,
        pagesFetched,
        pageSize: this.config.pageSize,
        updatedAfter: updatedAfter?.toISOString() ?? null,
        lookupFailures: lookupFailures.length ? lookupFailures : undefined,
      },
    };
  }

  private async authenticateSydleOne(): Promise<Record<string, string>> {
    const url = new URL(`/api/1/${this.config.app}/sys/auth/signIn`, this.config.baseUrl);
    url.searchParams.set('login', this.config.user);
    url.searchParams.set('password', this.config.password);

    // SECURITY CAVEAT (audit 2026-06-20, P0 — NOT closed): SYDLE One's signIn only
    // accepts GET with credentials in the query string (POST -> HTTP 405, verified
    // in production 2026-06-20). URLs can be logged by proxies/WAFs where pino's
    // redaction does not reach, so SYDLE_USER/SYDLE_PASSWORD may leak into access
    // logs. Mitigation cannot be done client-side here without breaking auth and
    // requires SYDLE-side support (token/header/POST auth) — tracked in
    // docs/KNOWN_ISSUES.md. Until then: restrict/scrub proxy access logs and
    // rotate SYDLE_PASSWORD periodically.
    const response = await timedFetch(url, this.config.timeoutMs, {
      headers: { Accept: 'application/json' },
    });
    const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ao autenticar na SYDLE`);
    }

    const cookie = extractSetCookieHeader(response.headers);
    const token = extractSydleOneAccessToken(payload);
    if (!cookie && !token) {
      throw new Error('SYDLE autenticou, mas nao retornou cookie de sessao nem accessToken');
    }

    return {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...(cookie ? { Cookie: cookie } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
  }

  private async postSydleOneSearch(
    classId: string,
    body: Record<string, unknown>,
    headers: Record<string, string>,
  ): Promise<unknown> {
    const url = new URL(
      `/api/1/${this.config.app}/_classId/${classId}/_search`,
      this.config.baseUrl,
    );
    const response = await timedFetch(url, this.config.timeoutMs, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const hint =
        response.status === 401 || response.status === 403
          ? ' Sessao/usuario sem permissao para a classe SYDLE.'
          : '';
      throw new Error(`HTTP ${response.status} ao consultar classe SYDLE ${classId}.${hint}`);
    }

    return response.json();
  }

  private async lookupSydleOneReferences(
    records: Record<string, unknown>[],
    headers: Record<string, string>,
  ): Promise<{
    ticketById: Map<string, Record<string, unknown>>;
    statusById: Map<string, Record<string, unknown>>;
    currencyById: Map<string, Record<string, unknown>>;
    failures: Record<string, unknown>[];
  }> {
    const failures: Record<string, unknown>[] = [];
    const ticketIds = uniqueStrings(
      records.map((record) => getNestedString(record, ['ticket', '_id'])),
    );
    const currencyIds = uniqueStrings(
      records.flatMap((record) =>
        Array.isArray(record.paymentData)
          ? record.paymentData.map((payment) =>
              getNestedString(payment as Record<string, unknown>, ['paymentCurrency', '_id']),
            )
          : [],
      ),
    );

    const ticketById = await this.lookupSydleOneByIds(
      this.config.ticketClassId,
      ticketIds,
      [
        '_id',
        'code',
        'searchCode',
        'status',
        'attendanceConclusionDate',
        'openForm',
        'classification',
        '_creationDate',
        '_lastUpdateDate',
      ],
      'ticket',
      headers,
      failures,
    );
    const statusIds = uniqueStrings(
      [...ticketById.values()].map((ticket) => getNestedString(ticket, ['status', '_id'])),
    );
    const [statusById, currencyById] = await Promise.all([
      this.lookupSydleOneByIds(
        this.config.ticketStatusClassId,
        statusIds,
        ['_id', 'name', 'identifier'],
        'ticket_status',
        headers,
        failures,
      ),
      this.lookupSydleOneByIds(
        this.config.currencyClassId,
        currencyIds,
        ['_id', 'iso', 'name', 'symbol'],
        'currency',
        headers,
        failures,
      ),
    ]);

    return { ticketById, statusById, currencyById, failures };
  }

  private async lookupSydleOneByIds(
    classId: string,
    ids: string[],
    includes: string[],
    label: string,
    headers: Record<string, string>,
    failures: Record<string, unknown>[],
  ): Promise<Map<string, Record<string, unknown>>> {
    const map = new Map<string, Record<string, unknown>>();
    if (!ids.length) return map;

    try {
      const payload = await this.postSydleOneSearch(
        classId,
        {
          size: Math.min(ids.length, 1000),
          query: { terms: { _id: ids } },
          _source: { includes },
        },
        headers,
      );
      const { records } = extractSydleOneSearchRecords(payload);
      for (const record of records) {
        const id = stringValue(record._id);
        if (id) map.set(id, record);
      }
    } catch (error) {
      failures.push({
        label,
        classId,
        ids: ids.length,
        message: error instanceof Error ? error.message : String(error),
      });
    }

    return map;
  }
}

function normalizeSourceType(value: unknown): SydleSourceType {
  const normalized = String(value ?? 'generic')
    .trim()
    .toLowerCase();
  if (['sydle_one', 'sydle-one', 'sydle_one_class', 'sydle-one-class'].includes(normalized)) {
    return 'sydle_one_class';
  }
  return 'generic';
}

async function timedFetch(url: URL, timeoutMs: number, init: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function buildSydleOneSearchBody(
  config: SydleClientConfig,
  updatedAfter: Date | null,
  searchAfter: unknown[] | undefined,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    size: config.pageSize,
    query: updatedAfter
      ? { range: { [config.dateField]: { gte: updatedAfter.toISOString() } } }
      : { match_all: {} },
    sort: [{ [config.dateField]: { order: 'asc' } }, { _id: { order: 'asc' } }],
    _source: {
      excludes: [
        '*attachment*',
        '*Attachment*',
        '*document*',
        '*Document*',
        '*bank*',
        '*Bank*',
        '*pix*',
        '*Pix*',
        '*description*',
        '*Description*',
        '*observation*',
        '*Observation*',
        '*password*',
        '*Password*',
        '*token*',
        '*Token*',
      ],
    },
  };
  if (searchAfter?.length) body.search_after = searchAfter;
  return body;
}

function extractSydleOneSearchRecords(payload: unknown): {
  records: Record<string, unknown>[];
  nextSearchAfter: unknown[] | undefined;
} {
  if (!payload || typeof payload !== 'object') return { records: [], nextSearchAfter: undefined };
  const root = payload as Record<string, unknown>;
  const hitsContainer = root.hits as Record<string, unknown> | undefined;
  const hits = Array.isArray(hitsContainer?.hits)
    ? (hitsContainer.hits as unknown[])
    : Array.isArray(root.hits)
      ? (root.hits as unknown[])
      : [];

  const records = hits
    .map((hit) => {
      if (!hit || typeof hit !== 'object') return null;
      const obj = hit as Record<string, unknown>;
      const source = obj._source;
      if (!source || typeof source !== 'object' || Array.isArray(source)) return obj;
      return {
        _id: obj._id ?? (source as Record<string, unknown>)._id,
        _classId: obj._classId,
        ...(source as Record<string, unknown>),
      };
    })
    .filter((record): record is Record<string, unknown> =>
      Boolean(record && typeof record === 'object' && !Array.isArray(record)),
    );
  const last = hits[hits.length - 1] as Record<string, unknown> | undefined;
  return {
    records,
    nextSearchAfter: Array.isArray(last?.sort) ? (last.sort as unknown[]) : undefined,
  };
}

function extractSetCookieHeader(headers: Headers): string | null {
  const getSetCookie = (headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.();
  const rawCookies = getSetCookie?.length
    ? getSetCookie
    : splitSetCookieHeader(headers.get('set-cookie'));
  const cookie = rawCookies
    .map((entry) => entry.split(';')[0]?.trim())
    .filter(Boolean)
    .join('; ');
  return cookie || null;
}

function splitSetCookieHeader(value: string | null): string[] {
  if (!value) return [];
  return value.split(/,(?=\s*[^;,]+=)/g);
}

function extractSydleOneAccessToken(payload: Record<string, unknown> | null): string | null {
  if (!payload) return null;
  const accessToken = payload.accessToken;
  if (typeof accessToken === 'string') return accessToken;
  if (accessToken && typeof accessToken === 'object' && !Array.isArray(accessToken)) {
    const token = (accessToken as Record<string, unknown>).token;
    if (typeof token === 'string' && token.trim()) return token.trim();
  }
  for (const key of ['token', 'access_token', 'accessToken']) {
    const value = payload[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

function flattenSydleOneInternationalPaymentRows(
  records: Record<string, unknown>[],
  lookups: {
    ticketById: Map<string, Record<string, unknown>>;
    statusById: Map<string, Record<string, unknown>>;
    currencyById: Map<string, Record<string, unknown>>;
  },
): Record<string, unknown>[] {
  const rows: Record<string, unknown>[] = [];

  for (const record of records) {
    const payments =
      Array.isArray(record.paymentData) && record.paymentData.length
        ? record.paymentData.filter((payment): payment is Record<string, unknown> =>
            Boolean(payment && typeof payment === 'object' && !Array.isArray(payment)),
          )
        : [null];
    const ticket = lookups.ticketById.get(getNestedString(record, ['ticket', '_id']) ?? '') ?? null;
    const status =
      (ticket && lookups.statusById.get(getNestedString(ticket, ['status', '_id']) ?? '')) ?? null;
    const ticketClosed = isClosedTicket(status, ticket);

    payments.forEach((payment, index) => {
      const paymentId = stringValue(payment?._id) ?? `payment-${index + 1}`;
      const amount = payment ? parseNumber(payment.paymentAmount) : null;
      const currency =
        (payment &&
          lookups.currencyById.get(getNestedString(payment, ['paymentCurrency', '_id']) ?? '')) ??
        null;
      const dueDate = payment?.expirationDate ?? null;
      const ticketCode = stringValue(ticket?.code);
      const searchCode = stringValue(ticket?.searchCode);

      rows.push({
        externalId: `sydle-one:${stringValue(record._id) ?? 'unknown'}:${paymentId}`,
        purchaseRef: ticketCode ? `SYDLE-${ticketCode}` : searchCode ? `SYDLE-${searchCode}` : null,
        currency: stringValue(currency?.iso) ?? stringValue(currency?.symbol) ?? 'USD',
        purchaseAmount: amount,
        paidAmount: ticketClosed ? amount : 0,
        openAmount: ticketClosed ? 0 : amount,
        paymentType:
          parseNumber(payment?.paymentDeadlineAfterShipment) === 0 ? 'deposit' : 'balance',
        paymentStatus: ticketClosed ? 'paid' : 'open',
        dueDate,
        paidAt: ticketClosed ? ticket?.attendanceConclusionDate : null,
        sourceUpdatedAt: record._lastUpdateDate ?? ticket?._lastUpdateDate ?? record._creationDate,
        sydleTicketCode: ticketCode,
        sydleTicketSearchCode: searchCode,
        sydleTicketStatus: status?.name ?? status?.identifier ?? null,
        sydleApproved: record.approved,
        sydleBillOfLanding: record.billOfLanding,
        sydlePaymentDeadlineAfterShipment: payment?.paymentDeadlineAfterShipment ?? null,
        sydleRequestId: record._id,
        sydlePaymentId: payment?._id ?? null,
        rawSydleOne: {
          request: record,
          payment,
          ticket,
          ticketStatus: status,
          currency,
        },
      });
    });
  }

  return rows;
}

function isClosedTicket(
  status: Record<string, unknown> | null,
  ticket: Record<string, unknown> | null,
): boolean {
  const statusText = `${status?.identifier ?? ''} ${status?.name ?? ''}`.toLowerCase();
  return (
    Boolean(ticket?.attendanceConclusionDate) ||
    /(closed|concluido|concluído|finalizado)/.test(statusText)
  );
}

function uniqueStrings(values: (string | null | undefined)[]): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function getNestedString(record: Record<string, unknown> | null, path: string[]): string | null {
  let current: unknown = record;
  for (const segment of path) {
    if (!current || typeof current !== 'object' || Array.isArray(current)) return null;
    current = (current as Record<string, unknown>)[segment];
  }
  return stringValue(current);
}

function stringValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text ? text : null;
}

function parseNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(String(value).replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
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

function resolveRawSourceCursor(records: Record<string, unknown>[]): Date | null {
  let cursor: Date | null = null;
  for (const record of records) {
    const sourceUpdatedAt = parseRawDateTime(
      record.sourceUpdatedAt ??
        record._lastUpdateDate ??
        record._creationDate ??
        record.updatedAt ??
        record.ultimaAtualizacao ??
        record.modifiedAt ??
        record.alteradoEm,
    );
    if (sourceUpdatedAt && (!cursor || sourceUpdatedAt > cursor)) {
      cursor = sourceUpdatedAt;
    }
  }
  return cursor;
}

function parseRawDateTime(value: unknown): Date | null {
  return parseSydleDateTime(value);
}
