import { describe, expect, it } from 'vitest';

import {
  computeRowStatus,
  findCorrespondingItem,
  itemsCorrespond,
  mergeValidationChecks,
  ncmValuesDiverge,
  numericValuesDiverge,
  stripTaxIdPrefix,
  sumItemQuantities,
  type ComparisonRow,
} from '../comparison-core.js';
import {
  PK220_INVOICE_ITEMS,
  PK220_PACKING_LIST_ITEMS,
} from '../../../__tests__/fixtures/pk220-itens.js';

function row(overrides: Partial<ComparisonRow> & { label: string }): ComparisonRow {
  return {
    rowKey: `aggregate:${overrides.label}`,
    invoice: null,
    packingList: null,
    bl: null,
    espelho: null,
    system: null,
    status: 'empty',
    criticality: 'critical',
    message: null,
    ...overrides,
  };
}

describe('computeRowStatus — identificador fiscal', () => {
  it('CNPJ com e sem pontuacao e o MESMO CNPJ', () => {
    // Reuniao 11/09 [11:36]. Antes: comparacao de string + fallback
    // parseFloat('58.500.398/0006-10') = 58.5 => 'divergent'.
    expect(
      computeRowStatus(['58500398000610', '58500398000610', '58.500.398/0006-10'], 'taxId'),
    ).toBe('match');
    expect(computeRowStatus(['00.399.603/0006-12', '00399603000612'], 'taxId')).toBe('match');
  });

  it('CNPJ realmente diferente continua divergente', () => {
    expect(computeRowStatus(['58.500.398/0006-10', '58.500.398/0001-10'], 'taxId')).toBe(
      'divergent',
    );
  });

  it('tax id estrangeiro compara letras e numeros', () => {
    expect(computeRowStatus(['VAT GB123456', 'vat-gb 123456'], 'taxId')).toBe('match');
    expect(computeRowStatus(['GB123456', 'GB999999'], 'taxId')).toBe('divergent');
  });

  it('um valor so continua sendo fonte unica, nunca "conforme"', () => {
    expect(computeRowStatus(['58500398000610'], 'taxId')).toBe('single_source');
  });
});

describe('stripTaxIdPrefix', () => {
  it('tira o "CNPJ: ..." que o espelho cola no endereco', () => {
    expect(stripTaxIdPrefix('CNPJ: 58.500.398/0006-10 RUA GERCINO MACHADO, 207')).toBe(
      'RUA GERCINO MACHADO, 207',
    );
  });

  it('nao mexe num endereco normal', () => {
    expect(stripTaxIdPrefix('RUA GERCINO MACHADO, 207 BIGUACU, SC')).toBe(
      'RUA GERCINO MACHADO, 207 BIGUACU, SC',
    );
    expect(stripTaxIdPrefix(null)).toBeNull();
  });
});

describe('casamento de itens', () => {
  it('casa os 14 itens do PK220 nos dois sentidos', () => {
    const used = new Set<Record<string, any>>();
    const matched = PK220_INVOICE_ITEMS.map((item) =>
      findCorrespondingItem(item, PK220_PACKING_LIST_ITEMS, used),
    );

    expect(matched.every(Boolean)).toBe(true);
    // Cada linha da PL e usada UMA vez: o SKU 050404509 aparece em duas linhas
    // com quantidades diferentes (1232 e 2476) e nao pode casar com a mesma.
    expect(matched.map((item) => item?.quantity)).toEqual(
      PK220_INVOICE_ITEMS.map((item) => item.quantity),
    );
    expect(new Set(matched).size).toBe(PK220_INVOICE_ITEMS.length);
  });

  it('nenhum item fica sem correspondencia nos dois sentidos', () => {
    const semPl = PK220_INVOICE_ITEMS.filter(
      (invoiceItem) =>
        !PK220_PACKING_LIST_ITEMS.some((plItem) => itemsCorrespond(plItem, invoiceItem)),
    );
    const semInvoice = PK220_PACKING_LIST_ITEMS.filter(
      (plItem) => !PK220_INVOICE_ITEMS.some((invoiceItem) => itemsCorrespond(invoiceItem, plItem)),
    );

    expect(semPl).toEqual([]);
    expect(semInvoice).toEqual([]);
  });

  it('cai na primeira linha quando todas as candidatas ja foram usadas', () => {
    const invoiceItems = [
      { itemCode: 'PI7752Y', quantity: 60 },
      { itemCode: 'PI7752Y', quantity: 40 },
    ];
    const plItems = [{ itemCode: 'PI7752Y', quantity: 100 }];
    const used = new Set<Record<string, any>>();

    expect(findCorrespondingItem(invoiceItems[0], plItems, used)).toBe(plItems[0]);
    // A segunda linha continua casando (antes ficava "nao localizado na PL").
    expect(findCorrespondingItem(invoiceItems[1], plItems, used)).toBe(plItems[0]);
  });
});

describe('somas e tolerancias', () => {
  it('soma as quantidades dos itens', () => {
    expect(sumItemQuantities(PK220_INVOICE_ITEMS)).toBe(
      PK220_PACKING_LIST_ITEMS.reduce((total, item) => total + item.quantity, 0),
    );
  });

  it('nenhuma quantidade lida vira null, nunca zero', () => {
    expect(sumItemQuantities([{ itemCode: 'A' }, { itemCode: 'B' }])).toBeNull();
    expect(sumItemQuantities([])).toBeNull();
  });

  it('NCM e preco so divergem quando os dois lados existem', () => {
    expect(ncmValuesDiverge('4202.92.00', '42029200')).toBe(false);
    expect(ncmValuesDiverge('42029200', '39264000')).toBe(true);
    expect(ncmValuesDiverge(null, '42029200')).toBe(false);
    expect(numericValuesDiverge(10, null)).toBe(false);
    expect(numericValuesDiverge(10, 10.001)).toBe(false);
    expect(numericValuesDiverge(10, 12)).toBe(true);
  });
});

describe('mergeValidationChecks', () => {
  it('incorpora o cruzamento a linha que ja mostra os mesmos valores', () => {
    const rows = [
      row({
        label: 'Importador / Consignee',
        invoice: 'IMB TEXTIL S.A.',
        packingList: 'IMB TEXTIL S.A.',
        status: 'match',
        message: 'Conforme entre os documentos disponiveis.',
      }),
    ];

    const merged = mergeValidationChecks(rows, [
      {
        id: 1,
        checkName: 'importer-match',
        status: 'failed',
        expectedValue: 'IMB TEXTIL S.A.',
        actualValue: 'OUTRA IMPORTADORA',
        message: 'Importador do BL diverge.',
      },
    ]);

    // Nenhuma linha nova: o cruzamento virou o status e a regra da linha.
    expect(merged).toHaveLength(1);
    expect(merged[0].status).toBe('divergent');
    expect(merged[0].message).toBe('Importador: Importador do BL diverge.');
  });

  it('nao deixa o rotulo tecnico do check aparecer', () => {
    const rows = [row({ label: 'ETD / Shipped On Board', status: 'match' })];

    const merged = mergeValidationChecks(rows, [
      {
        id: 2,
        checkName: 'invoice-pl-date-tolerance',
        status: 'warning',
        message: 'Diferenca maior que 30 dias.',
      },
    ]);

    expect(merged[0].message).toContain('Datas Invoice x Packing List');
    expect(JSON.stringify(merged)).not.toContain('invoice-pl-date-tolerance');
  });

  it('check "skipped" vira "Nao verificado" e nao piora a linha', () => {
    const rows = [
      row({ label: 'Frete', bl: '156.94', status: 'single_source', message: 'Fonte unica.' }),
      row({ label: 'Tipo Container', status: 'empty' }),
    ];

    const merged = mergeValidationChecks(rows, [
      {
        id: 3,
        checkName: 'freight-value-match',
        status: 'skipped',
        message: 'Ignorado: Nenhum valor de frete disponivel nos dados do follow-up.',
      },
      {
        id: 4,
        checkName: 'container-type-vs-fup',
        status: 'skipped',
        message: 'Ignorado: Tipo de container nao cadastrado no processo.',
      },
    ]);

    expect(merged[0].status).toBe('single_source');
    expect(merged[0].message).toContain('Nao verificado — Nenhum valor de frete disponivel');
    // Linha que nao tinha dado nenhum fica visivel como "nao verificado".
    expect(merged[1].status).toBe('skipped');
    expect(merged[1].message).toContain('Nao verificado — Tipo de container nao cadastrado');
  });

  it('NCM BL x Espelho vira linha propria, com os valores nas colunas', () => {
    const merged = mergeValidationChecks(
      [row({ label: 'CBM (m3)', status: 'match' })],
      [
        {
          id: 5,
          checkName: 'ncm-bl-description',
          status: 'failed',
          expectedValue: '4414',
          actualValue: '4419',
          message: 'NCM do BL diverge do espelho.',
        },
      ],
    );

    expect(merged).toHaveLength(2);
    const ncmRow = merged[1];
    expect(ncmRow.label).toBe('NCM (BL x Espelho)');
    expect(ncmRow.espelho).toBe('4414');
    expect(ncmRow.bl).toBe('4419');
    expect(ncmRow.status).toBe('divergent');
  });

  it('descricao do Odoo indisponivel aparece como nao verificada, nao como atencao', () => {
    const merged = mergeValidationChecks(
      [],
      [
        {
          id: 6,
          checkName: 'description-odoo-match',
          status: 'skipped',
          expectedValue: '3 itens a verificar',
          actualValue: '0 de 3 verificadas, 3 indisponiveis',
          message: 'o Odoo nao respondeu para os 3 item(ns) consultados',
        },
      ],
    );

    expect(merged).toHaveLength(1);
    expect(merged[0].status).toBe('skipped');
    expect(merged[0].message).toBe(
      'Nao verificado — o Odoo nao respondeu para os 3 item(ns) consultados',
    );
  });

  it('soma as regras quando mais de uma reprova a mesma linha', () => {
    const merged = mergeValidationChecks(
      [row({ label: 'ETD / Shipped On Board', status: 'match' })],
      [
        { id: 20, checkName: 'dates-match', status: 'failed', message: 'ETD do BL diverge.' },
        {
          id: 21,
          checkName: 'invoice-pl-date-tolerance',
          status: 'warning',
          message: 'Diferenca maior que 30 dias.',
        },
      ],
    );

    expect(merged[0].status).toBe('divergent');
    expect(merged[0].message).toContain('ETD do BL diverge');
    expect(merged[0].message).toContain('Diferenca maior que 30 dias');
  });

  it('a linha avulsa tem rowKey estavel e carrega o aceite vigente', () => {
    // A chave antiga levava o id do check (`cross:<check>:<id>`), e o id muda a
    // cada run: o aceite sumia na revalidacao seguinte.
    const aceite = { id: 5, rowKey: 'aggregate:ncm-bl-x-espelho' };
    const merged = mergeValidationChecks(
      [],
      [
        {
          id: 30,
          checkName: 'ncm-bl-description',
          status: 'failed',
          expectedValue: '4414',
          actualValue: '4419',
          message: 'NCM divergente.',
        },
      ],
      (rowKey) => (rowKey === 'aggregate:ncm-bl-x-espelho' ? aceite : null),
    );

    expect(merged[0].rowKey).toBe('aggregate:ncm-bl-x-espelho');
    expect(merged[0].accepted).toBe(aceite);
  });

  it('ignora os checks que tem painel proprio', () => {
    const merged = mergeValidationChecks(
      [row({ label: 'CBM (m3)', status: 'match' })],
      [
        { id: 7, checkName: 'item-level-match', status: 'failed', message: 'itens' },
        { id: 8, checkName: 'weight-ratio-check', status: 'warning', message: 'peso' },
      ],
    );

    expect(merged).toHaveLength(1);
    expect(merged[0].status).toBe('match');
  });

  it('ports-match entra nas DUAS linhas de porto', () => {
    const merged = mergeValidationChecks(
      [
        row({ label: 'Porto Embarque', status: 'match' }),
        row({ label: 'Porto Destino', status: 'match' }),
      ],
      [{ id: 9, checkName: 'ports-match', status: 'failed', message: 'Portos divergentes.' }],
    );

    expect(merged.map((item) => item.status)).toEqual(['divergent', 'divergent']);
  });
});
