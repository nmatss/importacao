import { z } from 'zod';
import { logger } from '../utils/logger.js';

const envSchema = z
  .object({
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

    // AI (OpenRouter / Vertex)
    AI_PROVIDER: z.enum(['vertex', 'openrouter']).default('openrouter'),
    AI_MONTHLY_BUDGET_USD: z.coerce.number().nonnegative().default(200),
    OPENROUTER_API_KEY: z.string().optional(),
    OPENROUTER_BASE_URL: z.string().url().optional(),

    // Vertex AI (Google self-hosted provider). Credentials fall back to GOOGLE_DRIVE_* if unset.
    GOOGLE_VERTEX_PROJECT: z.string().optional(),
    GOOGLE_VERTEX_LOCATION: z.string().optional(),
    GOOGLE_VERTEX_CLIENT_EMAIL: z.string().optional(),
    GOOGLE_VERTEX_PRIVATE_KEY: z.string().optional(),

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
  })
  .superRefine((env, ctx) => {
    // Fail-fast when Vertex is the selected AI provider: it requires a project,
    // and credentials must resolve (either GOOGLE_VERTEX_* or the GOOGLE_DRIVE_* fallback).
    if (env.AI_PROVIDER === 'vertex') {
      if (!env.GOOGLE_VERTEX_PROJECT) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['GOOGLE_VERTEX_PROJECT'],
          message: 'obrigatório quando AI_PROVIDER=vertex',
        });
      }
      const clientEmail = env.GOOGLE_VERTEX_CLIENT_EMAIL || env.GOOGLE_DRIVE_CLIENT_EMAIL;
      const privateKey = env.GOOGLE_VERTEX_PRIVATE_KEY || env.GOOGLE_DRIVE_PRIVATE_KEY;
      if (!clientEmail || !privateKey) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['GOOGLE_VERTEX_CLIENT_EMAIL'],
          message:
            'credenciais Vertex ausentes: defina GOOGLE_VERTEX_CLIENT_EMAIL/GOOGLE_VERTEX_PRIVATE_KEY ou reutilize GOOGLE_DRIVE_CLIENT_EMAIL/GOOGLE_DRIVE_PRIVATE_KEY',
        });
      }
    }
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
