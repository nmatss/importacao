import { JWT } from 'google-auth-library';
import { logger } from '../../shared/utils/logger.js';

const GOOGLE_DRIVE_CLIENT_EMAIL = process.env.GOOGLE_DRIVE_CLIENT_EMAIL || '';
const GOOGLE_DRIVE_PRIVATE_KEY = (process.env.GOOGLE_DRIVE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
const GOOGLE_ADMIN_EMAIL = process.env.GOOGLE_ADMIN_EMAIL || '';
const GOOGLE_GROUP_ALLOWED = process.env.GOOGLE_GROUP_ALLOWED || '';

const SCOPE = 'https://www.googleapis.com/auth/admin.directory.group.member.readonly';

let jwtClient: JWT | null = null;

function getClient(): JWT {
  if (jwtClient) return jwtClient;

  if (!GOOGLE_DRIVE_CLIENT_EMAIL || !GOOGLE_DRIVE_PRIVATE_KEY || !GOOGLE_ADMIN_EMAIL) {
    throw new Error('Google Groups: missing credentials (GOOGLE_DRIVE_CLIENT_EMAIL, GOOGLE_DRIVE_PRIVATE_KEY, GOOGLE_ADMIN_EMAIL)');
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
    logger.warn('Google Groups: GOOGLE_GROUP_ALLOWED not configured, allowing all domain users');
    return true;
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
