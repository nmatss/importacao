import bcrypt from 'bcryptjs';
import { db, pool } from './connection.js';
import { users, systemSettings } from './schema.js';

async function main() {
  console.log('Seeding database...');

  const passwordHash = await bcrypt.hash('admin123', 10);

  await db.insert(users).values({
    name: 'Admin',
    email: 'admin@importacao.com',
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
