import { describe, expect, it } from 'vitest';
import { alertsQuerySchema } from '../schema.js';

describe('alertsQuerySchema', () => {
  it('preserva todo parametro que o controller le', () => {
    // `validate(schema, 'query')` SUBSTITUI req.query pelo resultado do Zod e
    // `z.object()` descarta chave desconhecida: um campo esquecido aqui vira
    // filtro fantasma — aceito pela tela, ignorado pela API, sem erro nenhum.
    const parsed = alertsQuerySchema.parse({
      page: '2',
      limit: '50',
      processId: '7',
      severity: 'critical',
      acknowledged: 'false',
      startDate: '2026-08-01',
      endDate: '2026-08-29',
    });

    expect(parsed).toEqual({
      page: 2,
      limit: 50,
      processId: 7,
      severity: 'critical',
      acknowledged: 'false',
      startDate: '2026-08-01',
      endDate: '2026-08-29',
    });
  });

  it('aplica os defaults de paginacao', () => {
    expect(alertsQuerySchema.parse({})).toEqual({ page: 1, limit: 20 });
  });

  it('rejeita data fora do formato antes de chegar ao service', () => {
    // Antes a rota nao validava query alguma: '?endDate=abc' descia ate o
    // service e voltava como HTTP 400 "Invalid time value".
    expect(alertsQuerySchema.safeParse({ endDate: 'abc' }).success).toBe(false);
    expect(alertsQuerySchema.safeParse({ startDate: '2026-02-30' }).success).toBe(false);
  });

  it('rejeita intervalo invertido', () => {
    const resultado = alertsQuerySchema.safeParse({
      startDate: '2026-08-30',
      endDate: '2026-08-29',
    });
    expect(resultado.success).toBe(false);
    expect(resultado.error!.issues[0].path).toEqual(['endDate']);
  });
});
