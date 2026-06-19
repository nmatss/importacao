import bcrypt from 'bcryptjs';
import { db, pool } from './connection.js';
import { users, systemSettings } from './schema.js';

async function main() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to run default seed in production');
  }

  console.log('Seeding database...');

  const adminEmail = process.env.SEED_ADMIN_EMAIL || 'admin@importacao.local';
  const adminPassword = process.env.SEED_ADMIN_PASSWORD;
  if (!adminPassword && process.env.NODE_ENV !== 'development') {
    throw new Error('SEED_ADMIN_PASSWORD is required outside development');
  }

  const passwordHash = await bcrypt.hash(adminPassword || 'admin123', 10);

  await db.insert(users).values({
    name: 'Admin',
    email: adminEmail,
    passwordHash,
    role: 'admin',
  });

  console.log('Default admin user created.');

  await db.insert(systemSettings).values({
    key: 'google_chat_webhook_url',
    value: '',
    description: 'Google Chat webhook URL for sending alerts',
  });

  console.log('Default system settings created.');

  await pool.end();
  process.exit(0);
}

main().catch((err) => {
  console.error('Seeding failed:', err);
  process.exit(1);
});
