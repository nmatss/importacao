import { JWT } from 'google-auth-library';
import { normalizeGooglePrivateKey } from '../../shared/utils/google-private-key.js';
import { logger } from '../../shared/utils/logger.js';

const GOOGLE_DRIVE_CLIENT_EMAIL = process.env.GOOGLE_DRIVE_CLIENT_EMAIL || '';
const GOOGLE_DRIVE_PRIVATE_KEY =
  normalizeGooglePrivateKey(process.env.GOOGLE_DRIVE_PRIVATE_KEY) || '';
const GOOGLE_ADMIN_EMAIL = process.env.GOOGLE_ADMIN_EMAIL || '';
const GOOGLE_GROUP_ALLOWED = process.env.GOOGLE_GROUP_ALLOWED || '';
const GOOGLE_GROUP_ALLOW_ALL_WHEN_UNSET = process.env.GOOGLE_GROUP_ALLOW_ALL_WHEN_UNSET === 'true';

const SCOPE = 'https://www.googleapis.com/auth/admin.directory.group.member.readonly';

let jwtClient: JWT | null = null;

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

  const client = getClient();
  const url = `https://admin.googleapis.com/admin/directory/v1/groups/${encodeURIComponent(GOOGLE_GROUP_ALLOWED)}/hasMember/${encodeURIComponent(userEmail)}`;

  try {
    const res = await client.request<{ isMember: boolean }>({ url });
    return res.data.isMember === true;
  } catch (err: any) {
    if (err?.response?.status === 404) {
      return false;
    }
    logger.error({ err, userEmail }, 'Google Groups: error checking membership');
    throw err;
  }
}

export const googleGroupsService = { isAllowed };
