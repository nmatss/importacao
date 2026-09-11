/**
 * Contrato dos fixtures de API usados pela auditoria responsiva (e2e).
 *
 * Cada handler casa pelo pathname (sem query string) e pelo metodo. O primeiro
 * handler que casar responde. `body` pode ser um valor fixo ou uma funcao que
 * recebe a URL (para reagir a query params como `page`, `status`, `processId`).
 *
 * Convencao de envelope:
 * - `/api/*` (Express): `{ success: true, data, pagination? }` — o api-client
 *   do frontend desembrulha `data`; listas paginadas trazem
 *   `pagination: { total, page, limit, pages }`.
 * - `/cert-api/*` (FastAPI): objeto cru, sem envelope.
 */
export interface FixtureHandler {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** pathname exato (string) ou RegExp testada contra o pathname. */
  path: string | RegExp;
  status?: number;
  body: unknown | ((url: URL, method: string) => unknown);
}

export function paginated<T>(items: T[], url: URL, defaultLimit = 20) {
  const page = Math.max(1, Number(url.searchParams.get('page') ?? 1));
  const limit = Math.max(1, Math.min(100, Number(url.searchParams.get('limit') ?? defaultLimit)));
  const start = (page - 1) * limit;
  return {
    success: true,
    data: items.slice(start, start + limit),
    pagination: { total: items.length, page, limit, pages: Math.ceil(items.length / limit) },
  };
}

export function ok<T>(data: T) {
  return { success: true, data };
}
