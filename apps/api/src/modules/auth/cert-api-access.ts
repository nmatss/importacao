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
  '/cert-api/api/certificates',
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

  // Same invariant as the POST rule below: the wildcard segment excludes `%`
  // as well as `/`. Nginx resolves percent-encoded traversal before proxying,
  // so `/cert-api/api/products/..%2fadmin` would be decided here as `cert.read`
  // while the cert-api actually serves `/cert-api/api/admin`. No administrative
  // GET route exists today, which is exactly why this must be closed now: the
  // failure would be silent on the day one is added.
  return (
    /^\/cert-api\/api\/products\/[^/%]+$/.test(path) ||
    /^\/cert-api\/api\/validate\/[^/%]+(?:\/stream)?$/.test(path) ||
    /^\/cert-api\/api\/reports\/[^/%]+(?:\/data)?$/.test(path) ||
    /^\/cert-api\/api\/schedules\/[^/%]+\/history$/.test(path) ||
    /^\/cert-api\/api\/certificates\/[^/%]+(?:\/pdf)?$/.test(path) ||
    /^\/cert-api\/api\/stock\/[^/%]+$/.test(path) ||
    /^\/cert-api\/api\/licenciados\/[^/%]+$/.test(path)
  );
}

function isOperatePath(path: string): boolean {
  if (OPERATE_PATHS.has(path)) return true;

  // Retrying the Linx write finishes the cadastro the analyst just submitted;
  // it repeats that same certificate's write and grants nothing broader.
  //
  // This is the only POST rule with a wildcard segment, so the id excludes `%`
  // as well as `/`: Nginx resolves percent-encoded traversal before it proxies,
  // and a scope decided on the raw URI must never out-permit the path the
  // cert-api actually serves. Certificate ids are uuid4 — never percent-encoded.
  return /^\/cert-api\/api\/certificates\/[^/%]+\/retry-linx$/.test(path);
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
  if (method === 'POST' && isOperatePath(path)) return 'cert.operate';

  return 'cert.admin';
}

/**
 * The project currently has only `admin` and `analyst` roles. Analysts may
 * consult certification data, trigger bounded validation/export operations and
 * register certificates (the cert team's own routine — the actor is recorded via
 * `X-Cert-Actor-Email`); synchronization, schedule changes, user management,
 * certificate deletion and future routes remain administrative until a
 * finer-grained role model is introduced.
 */
export function canAccessCertApi(role: string | undefined, scope: CertApiScope): boolean {
  if (role === 'admin') return true;
  return role === 'analyst' && (scope === 'cert.read' || scope === 'cert.operate');
}
