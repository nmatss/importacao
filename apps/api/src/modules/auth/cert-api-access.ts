/**
 * Authorization policy for requests forwarded by the Nginx cert-api gateway.
 *
 * The Python cert-api only receives the gateway API key, not the browser user's
 * JWT. Nginx therefore sends the original URI and method to the Node auth
 * endpoint through `auth_request`; this policy is the single source of truth
 * for the user-facing permission decision.
 *
 * Unknown, malformed, encoded, or newly added routes intentionally resolve to
 * `cert.admin`. This makes the policy fail closed when the cert-api grows.
 */

export type CertApiScope = 'cert.read' | 'cert.operate' | 'cert.admin';

const READ_PATHS = new Set([
  '/cert-api/api/health',
  '/cert-api/api/ready',
  '/cert-api/api/stats',
  '/cert-api/api/expired',
  '/cert-api/api/products',
  '/cert-api/api/reports',
  '/cert-api/api/schedules',
  '/cert-api/api/certificates',
  '/cert-api/api/licenciados',
]);

const OPERATE_PATHS = new Set([
  '/cert-api/api/validate',
  '/cert-api/api/products/verify',
  '/cert-api/api/reports/export',
  '/cert-api/api/reports/export-stock',
]);

function originalPath(value: string | undefined): string | null {
  if (!value || !value.startsWith('/cert-api/')) return null;

  // `$request_uri` includes the query string. Preserve the raw path rather
  // than decoding it: encoded/slash-ambiguous paths must not match an allowlist
  // entry by accident.
  const queryIndex = value.indexOf('?');
  const path = queryIndex >= 0 ? value.slice(0, queryIndex) : value;
  return path || null;
}

function isReadPath(path: string): boolean {
  if (READ_PATHS.has(path)) return true;

  return (
    /^\/cert-api\/api\/products\/[^/]+$/.test(path) ||
    /^\/cert-api\/api\/validate\/[^/]+(?:\/stream)?$/.test(path) ||
    /^\/cert-api\/api\/reports\/[^/]+(?:\/data)?$/.test(path) ||
    /^\/cert-api\/api\/schedules\/[^/]+\/history$/.test(path) ||
    /^\/cert-api\/api\/certificates\/[^/]+(?:\/pdf)?$/.test(path) ||
    /^\/cert-api\/api\/stock\/[^/]+$/.test(path) ||
    /^\/cert-api\/api\/licenciados\/[^/]+$/.test(path)
  );
}

/**
 * Resolve the least-privileged scope required by an original cert-api request.
 */
export function requiredCertApiScope(
  originalMethod: string | undefined,
  originalUri: string | undefined,
): CertApiScope {
  const path = originalPath(originalUri);
  const method = originalMethod?.toUpperCase();

  if (!path || !method) return 'cert.admin';

  if ((method === 'GET' || method === 'HEAD') && isReadPath(path)) return 'cert.read';
  if (method === 'POST' && OPERATE_PATHS.has(path)) return 'cert.operate';

  return 'cert.admin';
}

/**
 * The project currently has only `admin` and `analyst` roles. Analysts may
 * consult certification data and trigger bounded validation/export operations;
 * all synchronization, schedule changes, certificate/Linx writes, and future
 * routes remain administrative until a finer-grained role model is introduced.
 */
export function canAccessCertApi(role: string | undefined, scope: CertApiScope): boolean {
  if (role === 'admin') return true;
  return role === 'analyst' && (scope === 'cert.read' || scope === 'cert.operate');
}
