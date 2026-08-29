import { describe, expect, it } from 'vitest';
import { followUpQuerySchema } from '../schema.js';

describe('followUpQuerySchema', () => {
  it('preserva todo parametro que o controller le', () => {
    // `validate(schema, 'query')` descarta chave nao declarada: se um campo
    // faltar aqui, o filtro correspondente some sem erro.
    expect(
      followUpQuerySchema.parse({
        page: '3',
        limit: '10',
        startDate: '2026-08-01',
        endDate: '2026-08-29',
      }),
    ).toEqual({ page: 3, limit: 10, startDate: '2026-08-01', endDate: '2026-08-29' });
  });

  it('aplica os defaults de paginacao', () => {
    expect(followUpQuerySchema.parse({})).toEqual({ page: 1, limit: 20 });
  });

  it('recorta o limite em 100 em vez de rejeitar o pedido', () => {
    // A tela de follow-up envia limit=200 e ja recebe 100 (o controller aplica
    // Math.min). Rejeitar aqui viraria HTTP 400 numa tela que hoje funciona.
    expect(followUpQuerySchema.parse({ limit: '200' }).limit).toBe(100);
  });

  it('rejeita data fora do formato antes de chegar ao service', () => {
    expect(followUpQuerySchema.safeParse({ endDate: 'abc' }).success).toBe(false);
    expect(followUpQuerySchema.safeParse({ startDate: '2026-02-30' }).success).toBe(false);
  });

  it('rejeita intervalo invertido', () => {
    const resultado = followUpQuerySchema.safeParse({
      startDate: '2026-08-30',
      endDate: '2026-08-29',
    });
    expect(resultado.success).toBe(false);
    expect(resultado.error!.issues[0].path).toEqual(['endDate']);
  });
});
