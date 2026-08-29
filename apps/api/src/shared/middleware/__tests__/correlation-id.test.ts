import { describe, it, expect, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

vi.mock('../../utils/logger.js', () => ({
  logger: { child: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() })) },
}));
vi.mock('../../observability/context.js', () => ({
  requestContext: { run: (_ctx: unknown, fn: () => void) => fn() },
}));

const { correlationId } = await import('../correlation-id.js');

function run(header: unknown) {
  const req = { headers: { 'x-correlation-id': header } } as unknown as Request;
  const headers: Record<string, string> = {};
  const res = {
    setHeader(name: string, value: string) {
      // O `res.setHeader` do Node LANCA ERR_INVALID_CHAR para valor com quebra
      // de linha. Reproduzimos isso aqui: sem validacao, um header malformado
      // virava erro 500.
      if (/[\r\n]/.test(value)) throw new Error('ERR_INVALID_CHAR');
      headers[name] = value;
    },
  } as unknown as Response;
  const next = vi.fn() as unknown as NextFunction;
  correlationId(req, res, next);
  return { req, headers, next };
}

/**
 * O `x-correlation-id` do cliente era aceito CRU: ia para todas as linhas de
 * log da requisicao e voltava no header da resposta. Correlacao e conveniencia
 * de diagnostico, nao dado de negocio — quando o valor nao serve, gerar um
 * proprio e melhor que confiar ou que falhar.
 */
describe('middleware de correlation id', () => {
  it('aceita um id bem formado enviado pelo cliente', () => {
    const { req, headers } = run('req-abc_123');

    expect(req.correlationId).toBe('req-abc_123');
    expect(headers['x-correlation-id']).toBe('req-abc_123');
  });

  it('gera um proprio quando o header tem quebra de linha, em vez de estourar 500', () => {
    const { req, next } = run('abc' + String.fromCharCode(13, 10) + 'X-Injetado: 1');

    expect(req.correlationId).not.toContain('Injetado');
    expect(req.correlationId).toMatch(/^[\w-]{1,64}$/);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('gera um proprio quando o valor e longo demais para poluir o log', () => {
    const { req } = run('x'.repeat(5000));

    expect(req.correlationId.length).toBeLessThanOrEqual(64);
  });

  it('gera um proprio quando o header vem vazio ou ausente', () => {
    expect(run('').req.correlationId).toMatch(/^[\w-]{1,64}$/);
    expect(run(undefined).req.correlationId).toMatch(/^[\w-]{1,64}$/);
  });

  it('ignora header repetido, que o Node entrega como array', () => {
    const { req } = run(['a', 'b']);

    expect(req.correlationId).toMatch(/^[\w-]{1,64}$/);
    expect(Array.isArray(req.correlationId)).toBe(false);
  });
});
