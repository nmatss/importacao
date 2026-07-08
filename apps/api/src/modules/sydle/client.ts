import {
  extractSydleRecords,
  findSydleField,
  parseSydleDateTime,
  SYDLE_FIELD_KEYS,
} from './normalizer.js';

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
  enrichFields: boolean;
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
    // Default OFF: integração financeira, deploy-gated. Liga em staging só depois
    // que o probe (scripts/sydle-class-discovery.mjs) confirmar que os campos
    // complementares realmente vêm no payload do request/ticket. Ver
    // docs/SYDLE-ENRICHMENT-PLAN.md.
    enrichFields: ['1', 'true', 'yes'].includes(
      String(process.env.SYDLE_ONE_ENRICH_FIELDS ?? '').toLowerCase(),
    ),
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
      // Caso B (docs/SYDLE-ENRICHMENT-PLAN.md): resolve classes vizinhas
      // referenciadas por {_id,_classId}. Config-driven e inerte enquanto
      // SYDLE_ENRICHMENT_CLASSES estiver vazio (nenhum fetch extra).
      const enrichmentClasses = this.config.enrichFields
        ? await this.resolveEnrichmentClasses(records, authHeaders, ticketById, lookupFailures)
        : [];
      allRecords.push(
        ...flattenSydleOneInternationalPaymentRows(records, {
          ticketById,
          statusById,
          currencyById,
          enrichFields: this.config.enrichFields,
          enrichmentClasses,
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
        enrichFields: this.config.enrichFields || undefined,
        enrichClasses: this.config.enrichFields
          ? SYDLE_ENRICHMENT_CLASSES.filter((spec) => spec.classId).length || undefined
          : undefined,
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

  /**
   * Caso B: para cada spec em SYDLE_ENRICHMENT_CLASSES, coleta os _id referenciados
   * (no request ou no ticket) e busca a classe vizinha em lote. Reusa
   * lookupSydleOneByIds, então erros/403 viram entradas em `failures` sem derrubar
   * o sync. Retorna [] quando não há specs válidas (inerte por padrão).
   */
  private async resolveEnrichmentClasses(
    records: Record<string, unknown>[],
    headers: Record<string, string>,
    ticketById: Map<string, Record<string, unknown>>,
    failures: Record<string, unknown>[],
  ): Promise<EnrichmentResolved[]> {
    const specs = SYDLE_ENRICHMENT_CLASSES.filter(
      (spec) => spec.classId && spec.refPath.length > 0 && Object.keys(spec.map).length > 0,
    );
    if (!specs.length) return [];

    const resolved: EnrichmentResolved[] = [];
    for (const spec of specs) {
      const chain = [spec.classId, ...(spec.via ?? []).map((hop) => hop.classId)];
      const maps: Map<string, Record<string, unknown>>[] = [];

      // ids do primeiro elo: vêm do request/ticket no caminho refPath.
      let ids = uniqueStrings(
        records.map((record) => {
          const sourceObj =
            spec.source === 'ticket'
              ? (ticketById.get(getNestedString(record, ['ticket', '_id']) ?? '') ?? null)
              : record;
          return getNestedString(sourceObj, [...spec.refPath, '_id']);
        }),
      );

      for (let i = 0; i < chain.length; i += 1) {
        const isLast = i === chain.length - 1;
        const refField = spec.via?.[i]?.refField; // campo que aponta para o próximo elo
        const includes = isLast
          ? uniqueStrings([
              '_id',
              ...spec.includes,
              ...Object.keys(spec.map).map((field) => field.split('.')[0]),
            ])
          : uniqueStrings(['_id', refField ?? '']);
        const byId = await this.lookupSydleOneByIds(
          chain[i],
          ids,
          includes,
          `enrich:${spec.label}:${i}`,
          headers,
          failures,
        );
        maps.push(byId);
        if (!isLast) {
          ids = uniqueStrings(
            [...byId.values()].map((rec) => getNestedString(rec, [refField ?? '', '_id'])),
          );
        }
      }
      resolved.push({ spec, maps });
    }
    return resolved;
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
    enrichFields?: boolean;
    enrichmentClasses?: EnrichmentResolved[];
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
    // Campos complementares aflorados do request/ticket (flag-gated, default off).
    const enrichment = lookups.enrichFields
      ? extractComplementaryFields(record, ticket, status)
      : {};
    // Caso B: campos vindos de classes vizinhas resolvidas (mais autoritativo que
    // o enriquecimento por campo de texto livre, então prevalece sobre ele).
    const classEnrichment = lookups.enrichmentClasses?.length
      ? applyEnrichmentClasses(record, ticket, lookups.enrichmentClasses)
      : {};

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
        // Complementares primeiro (classe vizinha > campo de texto); os explícitos
        // abaixo sempre prevalecem.
        ...enrichment,
        ...classEnrichment,
        externalId: `sydle-one:${stringValue(record._id) ?? 'unknown'}:${paymentId}`,
        sydleProtocol: ticketCode ?? searchCode ?? null,
        purchaseRef: ticketCode ? `SYDLE-${ticketCode}` : searchCode ? `SYDLE-${searchCode}` : null,
        currency: stringValue(currency?.iso) ?? stringValue(currency?.symbol) ?? 'USD',
        purchaseAmount: amount,
        paidAmount: ticketClosed ? amount : 0,
        openAmount: ticketClosed ? 0 : amount,
        paymentType:
          parseNumber(payment?.paymentDeadlineAfterShipment) === 0 ? 'deposit' : 'balance',
        paymentStatus: ticketClosed ? 'paid' : 'open',
        dueDate,
        taskCreatedAt: ticket?._creationDate ?? record._creationDate ?? null,
        paymentDeadlineAfterShipment: payment?.paymentDeadlineAfterShipment ?? null,
        exceptionStatus: payment?.exception ?? null,
        exceptionReason: payment?.reason ?? null,
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

// Campos complementares promovidos a colunas tipadas/indexadas de
// sydle_purchase_payments. As colunas JÁ existem (migration 0017); o caminho
// Sydle One é que não as populava. São lidos do request/ticket e o normalizer
// faz a coerção (stringOrNull/parseSydleNumber) e o matchProcess os usa.
const COMPLEMENTARY_FIELDS = [
  'processCode',
  'sydleProtocol',
  'purchaseOrder',
  'proformaNumber',
  'invoiceNumber',
  'supplierName',
  'brand',
  'invoiceIssuedDate',
  'shipmentDate',
  'paymentDeadlineAfterShipment',
  'exceptionStatus',
  'exceptionReason',
  'exchangeRate',
  'amountBrl',
  'contractNumber',
  'remittanceId',
] as const;

function extractComplementaryFields(
  request: Record<string, unknown>,
  ticket: Record<string, unknown> | null,
  status: Record<string, unknown> | null,
): Record<string, unknown> {
  // Superfície de busca: ticket -> openForm do ticket -> status -> request ->
  // request.requestData (o form é autoritativo: processCode/invoiceCode moram nele).
  // findSydleField casa por chave exata e por chave normalizada (sem acento/caixa).
  const openForm =
    ticket && typeof ticket.openForm === 'object' && !Array.isArray(ticket.openForm)
      ? (ticket.openForm as Record<string, unknown>)
      : null;
  const requestData =
    request.requestData &&
    typeof request.requestData === 'object' &&
    !Array.isArray(request.requestData)
      ? (request.requestData as Record<string, unknown>)
      : null;
  const surface: Record<string, unknown> = {
    ...(ticket ?? {}),
    ...(openForm ?? {}),
    ...(status ?? {}),
    ...request,
    ...(requestData ?? {}),
  };

  const out: Record<string, unknown> = {};
  for (const field of COMPLEMENTARY_FIELDS) {
    const value = findSydleField(surface, SYDLE_FIELD_KEYS[field]);
    // Só escalares: evita poluir colunas com objetos (ex.: um campo "process" que
    // seja o objeto inteiro viraria "[object Object]" no stringOrNull do normalizer).
    if (typeof value === 'string' && value.trim() !== '') out[field] = value;
    else if (typeof value === 'number' && Number.isFinite(value)) out[field] = value;
  }
  return out;
}

/**
 * Caso B (docs/SYDLE-ENRICHMENT-PLAN.md): dado complementar que mora numa CLASSE
 * VIZINHA referenciada por {_id, _classId}. Preencha SYDLE_ENRICHMENT_CLASSES
 * DEPOIS que o probe (scripts/sydle-class-discovery.mjs) revelar o classId, o
 * caminho da referência e os nomes dos campos. Lista vazia => nenhum fetch extra,
 * comportamento idêntico ao de hoje.
 */
/** Hop adicional para encadear referências (ex.: recipient -> enterprise). */
export interface SydleEnrichmentHop {
  /** classId do próximo objeto na cadeia. */
  classId: string;
  /** Campo do registro atual que referencia o próximo objeto ({_id}). Ex.: 'enterprise'. */
  refField: string;
}

export interface SydleEnrichmentClassSpec {
  /** Rótulo único (vai para metadata/failures como `enrich:<label>`). */
  label: string;
  /** classId da PRIMEIRA classe a buscar. */
  classId: string;
  /** Onde mora a referência {_id}: no request (default) ou no ticket. */
  source?: 'request' | 'ticket';
  /** Caminho até o objeto-referência. Ex.: ['requestData','recipient']. */
  refPath: string[];
  /** Hops extras para seguir a cadeia até a classe final (ex.: enterprise). */
  via?: SydleEnrichmentHop[];
  /** Campos do _source a pedir na classe FINAL. */
  includes: string[];
  /** Mapa campoDaClasseFinal (dot-path) -> coluna complementar da linha. */
  map: Record<string, string>;
}

interface EnrichmentResolved {
  spec: SydleEnrichmentClassSpec;
  /** Um Map por elo da cadeia: [classe0, ...via]. */
  maps: Map<string, Record<string, unknown>>[];
}

/**
 * Classes vizinhas confirmadas pelo probe (scripts/sydle-class-discovery.mjs) na
 * instância grupounico.sydle.one. Só ativa quando SYDLE_ONE_ENRICH_FIELDS=true.
 * classIds com override por env (mesmo padrão de ticketClassId etc.).
 *  - marca:     requestData.brand -> classe brand -> name
 *  - fornecedor: requestData.recipient -> classe recipient -> enterprise -> legalName
 */
export const SYDLE_ENRICHMENT_CLASSES: SydleEnrichmentClassSpec[] = [
  {
    label: 'brand',
    classId: process.env.SYDLE_BRAND_CLASS_ID ?? '685179c16732f5038aaed372',
    source: 'request',
    refPath: ['requestData', 'brand'],
    includes: ['name'],
    map: { name: 'brand' },
  },
  {
    label: 'supplier',
    classId: process.env.SYDLE_RECIPIENT_CLASS_ID ?? '689cd3bd27624d322604be16',
    source: 'request',
    refPath: ['requestData', 'recipient'],
    via: [
      {
        classId: process.env.SYDLE_ENTERPRISE_CLASS_ID ?? '591365fef5ca53284cd8d159',
        refField: 'enterprise',
      },
    ],
    includes: ['legalName', 'name'],
    map: { legalName: 'supplierName' },
  },
];

function applyEnrichmentClasses(
  request: Record<string, unknown>,
  ticket: Record<string, unknown> | null,
  resolved: EnrichmentResolved[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const { spec, maps } of resolved) {
    const sourceObj = spec.source === 'ticket' ? ticket : request;
    const refId = getNestedString(sourceObj, [...spec.refPath, '_id']);
    if (!refId) continue;
    // Caminha a cadeia: classe0[refId] -> via[0].refField -> classe1[...] -> ...
    let neighbor = maps[0]?.get(refId);
    for (let i = 1; i < maps.length && neighbor; i += 1) {
      const refField = spec.via?.[i - 1]?.refField;
      const nextId = refField ? getNestedString(neighbor, [refField, '_id']) : null;
      neighbor = nextId ? maps[i].get(nextId) : undefined;
    }
    if (!neighbor) continue;
    for (const [neighborField, column] of Object.entries(spec.map)) {
      const value = getNestedValue(neighbor, neighborField.split('.'));
      // Só escalares (mesma regra do enriquecimento por campo): evita objetos.
      if (typeof value === 'string' && value.trim() !== '') out[column] = value;
      else if (typeof value === 'number' && Number.isFinite(value)) out[column] = value;
    }
  }
  return out;
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
  return stringValue(getNestedValue(record, path));
}

function getNestedValue(record: Record<string, unknown> | null, path: string[]): unknown {
  let current: unknown = record;
  for (const segment of path) {
    if (!current || typeof current !== 'object' || Array.isArray(current)) return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
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
