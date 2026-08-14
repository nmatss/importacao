import { JWT } from 'google-auth-library';
import { normalizeGooglePrivateKey } from '../../shared/utils/google-private-key.js';
import { logger } from '../../shared/utils/logger.js';
import { isNetworkError } from '../../shared/utils/resilience.js';
import { cache } from '../../shared/cache/redis.js';
import { ServiceUnavailableError } from '../../shared/errors/index.js';

const GOOGLE_DRIVE_CLIENT_EMAIL = process.env.GOOGLE_DRIVE_CLIENT_EMAIL || '';
const GOOGLE_DRIVE_PRIVATE_KEY =
  normalizeGooglePrivateKey(process.env.GOOGLE_DRIVE_PRIVATE_KEY) || '';
const GOOGLE_ADMIN_EMAIL = process.env.GOOGLE_ADMIN_EMAIL || '';
const GOOGLE_GROUP_ALLOWED = process.env.GOOGLE_GROUP_ALLOWED || '';
const GOOGLE_GROUP_ALLOW_ALL_WHEN_UNSET = process.env.GOOGLE_GROUP_ALLOW_ALL_WHEN_UNSET === 'true';

const SCOPE = 'https://www.googleapis.com/auth/admin.directory.group.member.readonly';

/**
 * Caminho rapido: enquanto fresco, nao chama o Google. Curto de proposito —
 * remover alguem do grupo deve tirar o acesso em minutos, nao em horas.
 */
const FRESH_TTL_SECONDS = 10 * 60;
/**
 * Sobrevida usada *somente* quando o Google esta inalcancavel. Sem isso, um
 * soluco de rede tranca todo mundo para fora (07-14/08/2026: o container ficou
 * sem saida e ninguem conseguia logar). Negativas nao entram no cache, entao
 * incluir alguem no grupo continua valendo na hora.
 */
const GRACE_TTL_SECONDS = 12 * 60 * 60;

let jwtClient: JWT | null = null;

function cacheKey(userEmail: string): string {
  return `google-groups:${GOOGLE_GROUP_ALLOWED}:${userEmail.toLowerCase()}`;
}

function getClient(): JWT {
  if (jwtClient) return jwtClient;

  if (!GOOGLE_DRIVE_CLIENT_EMAIL || !GOOGLE_DRIVE_PRIVATE_KEY || !GOOGLE_ADMIN_EMAIL) {
    throw new Error(
      'Google Groups: missing credentials (GOOGLE_DRIVE_CLIENT_EMAIL, GOOGLE_DRIVE_PRIVATE_KEY, GOOGLE_ADMIN_EMAIL)',
    );
  }

  jwtClient = new JWT({
    email: GOOGLE_DRIVE_CLIENT_EMAIL,
    key: GOOGLE_DRIVE_PRIVATE_KEY,
    scopes: [SCOPE],
    subject: GOOGLE_ADMIN_EMAIL,
  });

  return jwtClient;
}

async function isAllowed(userEmail: string): Promise<boolean> {
  if (!GOOGLE_GROUP_ALLOWED) {
    // Fail-closed: sem grupo configurado ninguém entra. O allow-all antigo só
    // permanece atrás de opt-in explícito, para não virar porta aberta por
    // omissão de configuração.
    if (GOOGLE_GROUP_ALLOW_ALL_WHEN_UNSET) {
      logger.warn(
        'Google Groups: GOOGLE_GROUP_ALLOWED not configured; GOOGLE_GROUP_ALLOW_ALL_WHEN_UNSET=true, allowing all domain users',
      );
      return true;
    }
    logger.error(
      'Google Groups: GOOGLE_GROUP_ALLOWED not configured — denying login (fail-closed). Set GOOGLE_GROUP_ALLOWED or, explicitly, GOOGLE_GROUP_ALLOW_ALL_WHEN_UNSET=true.',
    );
    return false;
  }

  const key = cacheKey(userEmail);
  const cached = await readCache(key);

  if (cached && Date.now() < cached.freshUntil) return true;

  const url = `https://admin.googleapis.com/admin/directory/v1/groups/${encodeURIComponent(GOOGLE_GROUP_ALLOWED)}/hasMember/${encodeURIComponent(userEmail)}`;

  try {
    const client = getClient();
    const res = await client.request<{ isMember: boolean }>({ url });
    const isMember = res.data.isMember === true;

    if (isMember) {
      await cache.set(
        key,
        JSON.stringify({ freshUntil: Date.now() + FRESH_TTL_SECONDS * 1000 }),
        GRACE_TTL_SECONDS,
      );
    } else {
      // Saiu do grupo: derruba a sobrevida junto, senao ele continuaria
      // entrando enquanto o Google estivesse fora.
      await cache.del(key);
    }
    return isMember;
  } catch (err: any) {
    if (err?.response?.status === 404) {
      await cache.del(key);
      return false;
    }

    // Daqui para baixo nao sabemos se a pessoa tem acesso — sabemos que nao
    // conseguimos perguntar. Isso nunca pode virar "acesso negado".
    logger.error(
      { err, userEmail, network: isNetworkError(err), grace: Boolean(cached) },
      'Google Groups: error checking membership',
    );

    if (cached) {
      logger.warn({ userEmail }, 'Google Groups: usando membership em cache (Google inacessivel)');
      return true;
    }

    throw new ServiceUnavailableError(
      'Nao foi possivel validar seu acesso com o Google agora. Tente novamente em alguns minutos.',
    );
  }
}

async function readCache(key: string): Promise<{ freshUntil: number } | null> {
  try {
    const raw = await cache.get(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { freshUntil?: unknown };
    return typeof parsed.freshUntil === 'number' ? { freshUntil: parsed.freshUntil } : null;
  } catch {
    // Cache indisponivel ou corrompido nao pode bloquear login: segue e pergunta
    // ao Google.
    return null;
  }
}

export const googleGroupsService = { isAllowed };
