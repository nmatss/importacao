import { describe, expect, it } from 'vitest';
import { emailLogsQuerySchema, historyScanSchema, triggerCheckSchema } from '../schema.js';

describe('email ingestion query schemas', () => {
  it('parses "false" query booleans as false', () => {
    expect(triggerCheckSchema.parse({ includeRead: 'false' })).toMatchObject({
      includeRead: false,
    });
  });

  it('parses "true" query booleans as true', () => {
    expect(triggerCheckSchema.parse({ includeRead: 'true' })).toMatchObject({
      includeRead: true,
    });
    expect(historyScanSchema.parse({ months: '3' })).toMatchObject({
      months: 3,
    });
  });

  it('nao declara allSenders — nenhum ponto do codigo o lia', () => {
    // O parametro era aceito, tinha default e era descartado: um filtro
    // fantasma. Removido dos dois schemas; agora e chave desconhecida.
    expect(triggerCheckSchema.parse({ allSenders: 'true' })).not.toHaveProperty('allSenders');
    expect(historyScanSchema.parse({ allSenders: 'true' })).not.toHaveProperty('allSenders');
  });
});

describe('emailLogsQuerySchema', () => {
  it('aceita os seis status do enum do banco', () => {
    // Espelha emailIngestionStatusEnum em shared/database/schema.ts:544.
    for (const status of [
      'pending',
      'processing',
      'completed',
      'failed',
      'ignored',
      'reprocessed',
    ]) {
      expect(emailLogsQuerySchema.parse({ status }).status).toBe(status);
    }
  });

  it('rejeita status invalido com o campo na mensagem', () => {
    const resultado = emailLogsQuerySchema.safeParse({ status: 'erro' });
    expect(resultado.success).toBe(false);
    expect(resultado.error!.issues[0].path).toEqual(['status']);
  });

  it('preserva todo parametro que o controller le', () => {
    // `validate(schema, 'query')` descarta chave nao declarada: sem `status`
    // aqui, a tela mandaria o filtro e a API o ignoraria em silencio.
    expect(
      emailLogsQuerySchema.parse({
        page: '2',
        limit: '20',
        processId: '5',
        processCode: 'PK2052602TJ',
        status: 'failed',
        startDate: '2026-08-01',
        endDate: '2026-08-29',
      }),
    ).toEqual({
      page: 2,
      limit: 20,
      processId: 5,
      processCode: 'PK2052602TJ',
      status: 'failed',
      startDate: '2026-08-01',
      endDate: '2026-08-29',
    });
  });

  it('rejeita data de calendario inexistente, nao so formato errado', () => {
    // O regex antigo aceitava '2026-02-30' e o service descartava calado.
    expect(emailLogsQuerySchema.safeParse({ startDate: '2026-02-30' }).success).toBe(false);
    expect(emailLogsQuerySchema.safeParse({ startDate: 'abc' }).success).toBe(false);
    expect(emailLogsQuerySchema.safeParse({ startDate: '2026-08-29' }).success).toBe(true);
  });

  it('rejeita intervalo invertido', () => {
    const resultado = emailLogsQuerySchema.safeParse({
      startDate: '2026-08-30',
      endDate: '2026-08-29',
    });
    expect(resultado.success).toBe(false);
    expect(resultado.error!.issues[0].path).toEqual(['endDate']);
  });
});
