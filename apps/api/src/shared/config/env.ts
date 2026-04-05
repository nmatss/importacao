import { z } from 'zod';
import { logger } from '../utils/logger.js';

const envSchema = z.object({
  // Server
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  API_PORT: z.coerce.number().int().positive().default(3001),

  // Database
  DATABASE_URL: z.string().min(1, 'DATABASE_URL obrigatório'),

  // Auth
  JWT_SECRET: z.string().min(16, 'JWT_SECRET deve ter ao menos 16 caracteres'),

  // Redis
  REDIS_URL: z.string().optional(),

  // CORS (required in production via fail-fast in app.ts)
  CORS_ORIGIN: z.string().optional(),

  // Gmail
  GMAIL_CREDENTIALS_JSON: z.string().optional(),
  GMAIL_SHARED_MAILBOX: z.string().optional(),

  // Google Drive / Sheets
  GOOGLE_DRIVE_CLIENT_EMAIL: z.string().optional(),
  GOOGLE_DRIVE_PRIVATE_KEY: z.string().optional(),
  GOOGLE_SHEETS_FOLLOW_UP_ID: z.string().optional(),

  // AI (OpenRouter / Gemini)
  OPENROUTER_API_KEY: z.string().optional(),
  OPENROUTER_BASE_URL: z.string().url().optional(),

  // Odoo
  ODOO_URL: z.string().url().optional(),
  ODOO_DB: z.string().optional(),
  ODOO_USER: z.string().optional(),
  ODOO_PASSWORD: z.string().optional(),

  // SMTP
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),

  // Email recipients
  KIOM_EMAIL: z.string().email().optional(),
  FENICIA_EMAIL: z.string().email().optional(),
  ISA_EMAIL: z.string().email().optional(),
});

export type Env = z.infer<typeof envSchema>;

let _env: Env | null = null;

/**
 * Validate and return typed environment variables.
 * Throws on first call if required vars are missing.
 * Subsequent calls return cached result.
 */
export function getEnv(): Env {
  if (_env) return _env;

  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    const errors = result.error.errors.map((e) => `  ${e.path.join('.')}: ${e.message}`).join('\n');
    const msg = `[ENV] Variáveis de ambiente inválidas:\n${errors}`;
    logger.fatal(msg);
    throw new Error(msg);
  }

  _env = result.data;
  return _env;
}
