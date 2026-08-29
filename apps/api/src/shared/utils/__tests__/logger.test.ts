import pino from 'pino';
import { describe, expect, it } from 'vitest';

import { REDACT_PATHS } from '../logger.js';

/**
 * Exercita a lista real de redacao contra um destino em memoria. O `logger`
 * exportado escreve em stdout (ou no transport pino-pretty em dev), entao o
 * teste reconstroi um pino com a MESMA lista.
 */
function captureLog(obj: Record<string, unknown>): string {
  const lines: string[] = [];
  const log = pino(
    { redact: { paths: REDACT_PATHS, censor: '[REDACTED]' } },
    { write: (chunk: string) => lines.push(chunk) },
  );
  log.warn(obj, 'teste');
  return lines.join('');
}

describe('redação do logger', () => {
  it('redige userEmail — a chave que google-groups.service.ts loga a cada falha', () => {
    // `email`/`*.email` nao cobriam `userEmail`: a redacao do pino compara a
    // chave inteira, entao o endereco corporativo saia em claro no log, contra
    // a mesma politica de LGPD que `recordLoginFailure` documenta.
    const line = captureLog({ userEmail: 'odett.hammes@grupounico.com', network: true });

    expect(line).not.toContain('odett.hammes@grupounico.com');
    expect(line).toContain('[REDACTED]');
    expect(line).toContain('"network":true');
  });

  it('redige userEmail aninhado um nivel abaixo', () => {
    const line = captureLog({ ctx: { userEmail: 'odett.hammes@grupounico.com' } });

    expect(line).not.toContain('odett.hammes@grupounico.com');
  });

  it('mantem as chaves de e-mail e segredo que ja eram cobertas', () => {
    const line = captureLog({
      email: 'a@grupounico.com',
      recipientEmail: 'kiom@example.com',
      client_email: 'svc@projeto.iam.gserviceaccount.com',
      payload: { email: 'b@grupounico.com', token: 'tok-123' },
    });

    expect(line).not.toContain('a@grupounico.com');
    expect(line).not.toContain('kiom@example.com');
    expect(line).not.toContain('svc@projeto.iam.gserviceaccount.com');
    expect(line).not.toContain('b@grupounico.com');
    expect(line).not.toContain('tok-123');
  });
});
