import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * Reproduz o incidente de 2026-08-29: o deploy passou a repassar ao container 34
 * variaveis que antes nao chegavam la, usando `${VAR:-}` — que entrega string
 * VAZIA quando a variavel nao existe no `.env`.
 *
 * Para o Zod, vazio NAO e ausente. `z.coerce.number()` sobre `''` da 0, que
 * falha em `.positive()`; `z.enum(['0','1'])` recusa `''` em vez de cair no
 * `.optional()`. O boot passou a lancar em `getEnv()` logo apos as migrations,
 * em loop, e a API ficou fora do ar.
 *
 * As doze variaveis abaixo sao exatamente as que apareceram na mensagem de erro
 * do container.
 */
const VAZIAS_NO_INCIDENTE = [
  'EMAIL_BODY_MAX_CHARS',
  'AI_DEFAULT_MAX_OUTPUT_TOKENS',
  'AI_SELF_REPAIR',
  'AI_UPGRADE_ON_LOW_CONFIDENCE',
  'AI_UPGRADE_ON_CONTRACT_ERROR',
  'ASSISTANT_MAX_OUTPUT_TOKENS',
  'IA_LOCAL_NUM_PREDICT',
  'IA_LOCAL_NUM_CTX',
  'AI_CHAT_TIMEOUT_MS',
  'DOCUMENT_AI_EXTRACTION_TIMEOUT_MS',
  'DOCUMENT_SPREADSHEET_MAX_CHARS',
  'DOCUMENT_PDF_RASTERIZE_ENABLED',
];

const OBRIGATORIAS = {
  DATABASE_URL: 'postgres://u:p@postgres:5432/db',
  JWT_SECRET: 'segredo-de-teste-com-16-ou-mais',
  // O provider default e `ialocal`, que exige o bearer do gateway.
  IA_LOCAL_API_KEY: 'chave-de-teste',
};

const antes = { ...process.env };

beforeEach(() => {
  vi.resetModules();
  for (const [k, v] of Object.entries(OBRIGATORIAS)) process.env[k] = v;
});

afterEach(() => {
  process.env = { ...antes };
});

describe('getEnv() com variaveis definidas VAZIAS', () => {
  it('nao lanca — vazio e tratado como ausente', async () => {
    for (const nome of VAZIAS_NO_INCIDENTE) process.env[nome] = '';

    const { getEnv } = await import('../env.js');
    expect(() => getEnv()).not.toThrow();
  });

  it('vazio cai no default do schema, e nao em zero', async () => {
    process.env.AI_DAILY_BUDGET_BRL = '';
    process.env.AI_BRL_PER_USD = '';

    const { getEnv } = await import('../env.js');
    const env = getEnv();

    // O defeito de origem: `Number('')` e 0, e 0 DESATIVA o teto de custo.
    expect(env.AI_DAILY_BUDGET_BRL).toBe(100);
    expect(env.AI_BRL_PER_USD).toBe(5);
  });

  it('valor de verdade continua vencendo o default', async () => {
    process.env.AI_DAILY_BUDGET_BRL = '250';

    const { getEnv } = await import('../env.js');
    expect(getEnv().AI_DAILY_BUDGET_BRL).toBe(250);
  });

  it('variavel obrigatoria VAZIA continua sendo erro, e nao some', async () => {
    process.env.DATABASE_URL = '';

    const { getEnv } = await import('../env.js');
    expect(() => getEnv()).toThrow(/DATABASE_URL/);
  });
});
