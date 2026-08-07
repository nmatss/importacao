import { describe, expect, it } from 'vitest';
import {
  createOperationalRecordSchema,
  processFilterSchema,
  updateProcessSchema,
} from '../schema.js';

describe('processFilterSchema', () => {
  it('normalizes pagination defaults for process search endpoints', () => {
    expect(processFilterSchema.parse({})).toMatchObject({ page: 1, limit: 20 });
    expect(
      processFilterSchema.parse({ page: '2', limit: '20', search: 'PK2052602TJ' }),
    ).toMatchObject({
      page: 2,
      limit: 20,
      search: 'PK2052602TJ',
    });
  });

  it('rejects an oversized process option request', () => {
    expect(processFilterSchema.safeParse({ page: '1', limit: '500' }).success).toBe(false);
  });
});

describe('decimal fields (Postgres numeric)', () => {
  it('normalizes Brazilian comma decimals to dot before persistence', () => {
    const record = createOperationalRecordSchema.parse({
      recordKind: 'extra_cost',
      recordType: 'Frete extra',
      amount: '1234,56',
    });
    expect(record.amount).toBe('1234.56');

    const process = updateProcessSchema.parse({ customsValue: '98765,4' });
    expect(process.customsValue).toBe('98765.4');
  });

  it('rejects a registration dollar beyond numeric(10,6) integer capacity', () => {
    expect(updateProcessSchema.safeParse({ registrationDollar: '12345.6' }).success).toBe(false);
    expect(updateProcessSchema.parse({ registrationDollar: '5,4321' }).registrationDollar).toBe(
      '5.4321',
    );
  });
});

describe('record type catalog', () => {
  const parseType = (recordType: string) =>
    createOperationalRecordSchema.parse({ recordKind: 'extra_cost', recordType }).recordType;

  it('canonicalizes the container cost types regardless of case, accent or spacing', () => {
    expect(parseType('lavacao')).toBe('LAVAÇÃO');
    expect(parseType('Lavação e  Reparo')).toBe('LAVAÇÃO E REPARO');
    expect(parseType('lavagem quimica')).toBe('LAVAGEM QUÍMICA');
    expect(parseType('remocao de detritos')).toBe('REMOÇÃO DE DETRITOS');
    expect(parseType('REPARO')).toBe('REPARO');
  });

  it('keeps an uncatalogued type as free text', () => {
    // A coluna e livre desde a migration 0022 e ja tem valores em producao.
    expect(parseType('Sobreestadia de container')).toBe('Sobreestadia de container');
  });
});
