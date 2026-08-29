import { describe, expect, it } from 'vitest';
import {
  createOperationalRecordSchema,
  processFilterSchema,
  updateDraftBlChecklistSchema,
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

  it('rejeita data fora do formato de calendario antes de chegar ao service', () => {
    // Com `z.string()` livre, '?endDate=abc' chegava ao service e o
    // `new Date('abc').toISOString()` estourava: o operador via HTTP 400 com a
    // mensagem interna em ingles "Invalid time value".
    const invalido = processFilterSchema.safeParse({ endDate: 'abc' });
    expect(invalido.success).toBe(false);
    expect(invalido.error!.issues[0].message).toBe('Formato inválido (YYYY-MM-DD)');

    expect(processFilterSchema.safeParse({ startDate: '2026-02-30' }).success).toBe(false);
    expect(processFilterSchema.safeParse({ startDate: '2026-08-29' }).success).toBe(true);
  });

  it('rejeita intervalo invertido', () => {
    const resultado = processFilterSchema.safeParse({
      startDate: '2026-08-30',
      endDate: '2026-08-29',
    });
    expect(resultado.success).toBe(false);
    expect(resultado.error!.issues[0].path).toEqual(['endDate']);
  });
});

describe('updateProcessSchema (PUT /api/processes/:id)', () => {
  it('nao aceita status: a transicao so pode passar por PATCH /:id/status', () => {
    // `update()` grava o patch direto, sem assertTransition e sem o evento
    // `status_changed`: aceitar status aqui levava um processo de `draft` a
    // `completed` num salto, sem validacao e sem trilha.
    expect(updateProcessSchema.parse({ status: 'completed' })).not.toHaveProperty('status');
  });
});

describe('updateProcessSchema — "chave ausente" vs "chave null"', () => {
  // O contrato inteiro da limpeza de campo: chave ausente = nao mexer; chave
  // com null = apagar o valor. Sem isso a tela nao consegue limpar campo
  // nenhum — o payload perdia a instrucao e a API respondia 200 com o dado
  // errado ainda no banco.

  it('preserva null explicito nos campos de texto e data', () => {
    const parsed = updateProcessSchema.parse({
      etd: null,
      eta: null,
      shipmentDate: null,
      incoterm: null,
      portOfLoading: null,
      portOfDischarge: null,
      exporterName: null,
      exporterAddress: null,
      importerName: null,
      importerAddress: null,
      notes: null,
      containerType: null,
      duimpNumber: null,
      registeredAt: null,
      customsChannel: null,
      customsClearanceAt: null,
    });

    for (const campo of [
      'etd',
      'eta',
      'shipmentDate',
      'incoterm',
      'portOfLoading',
      'portOfDischarge',
      'exporterName',
      'exporterAddress',
      'importerName',
      'importerAddress',
      'notes',
      'containerType',
      'duimpNumber',
      'registeredAt',
      'customsChannel',
      'customsClearanceAt',
    ]) {
      expect(parsed).toHaveProperty(campo, null);
    }
  });

  it('preserva null nos decimais em vez de colapsar em undefined', () => {
    // Armadilha 1: o preprocess de nonNegativeDecimalString fazia
    // `value == null ? undefined`, e a chave sumia do patch em silencio.
    const parsed = updateProcessSchema.parse({
      totalFobValue: null,
      freightValue: null,
      totalNetWeight: null,
      totalGrossWeight: null,
      totalCbm: null,
      insuranceValue: null,
      customsValue: null,
      registrationDollar: null,
    });

    for (const campo of [
      'totalFobValue',
      'freightValue',
      'totalNetWeight',
      'totalGrossWeight',
      'totalCbm',
      'insuranceValue',
      'customsValue',
      'registrationDollar',
    ]) {
      expect(parsed).toHaveProperty(campo, null);
    }
  });

  it('preserva null em totalBoxes sem passar pela coercao', () => {
    // Armadilha 2: `Number(null) === 0`. Apagar a quantidade de caixas nao
    // pode gravar zero — seria pior que descartar. `.nullable()` curto-circuita
    // o null antes de z.coerce.number() rodar.
    const parsed = updateProcessSchema.parse({ totalBoxes: null });
    expect(parsed.totalBoxes).toBeNull();
    expect(parsed.totalBoxes).not.toBe(0);
  });

  it('mantem a conversao normal dos decimais e do inteiro', () => {
    expect(updateProcessSchema.parse({ totalFobValue: '1234,56' }).totalFobValue).toBe('1234.56');
    expect(updateProcessSchema.parse({ totalBoxes: '12' }).totalBoxes).toBe(12);
    expect(updateProcessSchema.safeParse({ totalFobValue: '-1' }).success).toBe(false);
    expect(updateProcessSchema.safeParse({ totalBoxes: '-1' }).success).toBe(false);
  });

  it('string vazia continua sendo descarte, nao apagamento', () => {
    // Comportamento preservado: quem manda '' nao pediu para apagar. O
    // preprocess devolve `undefined`, e `mapUpdateSet` do Drizzle filtra
    // undefined do SET — ao contrario de null, que vira NULL.
    expect(updateProcessSchema.parse({ totalFobValue: '' }).totalFobValue).toBeUndefined();
    expect(updateProcessSchema.parse({ totalFobValue: '' }).totalFobValue).not.toBeNull();
  });

  it('chave ausente nao entra no payload', () => {
    expect(Object.keys(updateProcessSchema.parse({}))).toEqual([]);
    expect(Object.keys(updateProcessSchema.parse({ notes: 'so isso' }))).toEqual(['notes']);
  });

  it('o cruzamento de datas ignora o lado que veio null', () => {
    // Armadilha 3: validateProcessDates compara etd/eta/shipmentDate. Com um
    // dos lados null nao ha o que cruzar — pula, nao reprova.
    expect(updateProcessSchema.safeParse({ etd: null, eta: '2026-01-01' }).success).toBe(true);
    expect(updateProcessSchema.safeParse({ etd: '2026-05-01', eta: null }).success).toBe(true);
    expect(updateProcessSchema.safeParse({ shipmentDate: null, eta: '2026-01-01' }).success).toBe(
      true,
    );
    // E continua reprovando o cruzamento invalido de verdade.
    expect(updateProcessSchema.safeParse({ etd: '2026-05-01', eta: '2026-01-01' }).success).toBe(
      false,
    );
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

describe('updateDraftBlChecklistSchema', () => {
  it('accepts only known checklist keys and a boolean state', () => {
    expect(updateDraftBlChecklistSchema.parse({ key: 'draftReceivedOk', checked: true })).toEqual({
      key: 'draftReceivedOk',
      checked: true,
    });
    expect(
      updateDraftBlChecklistSchema.safeParse({ key: 'arbitraryKey', checked: true }).success,
    ).toBe(false);
    expect(
      updateDraftBlChecklistSchema.safeParse({ key: 'draftReceivedOk', checked: 'yes' }).success,
    ).toBe(false);
  });
});
