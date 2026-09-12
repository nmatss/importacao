import * as XLSX from 'xlsx';
import { parseEspelhoBuffer } from '../../espelho-parser/parser.js';
import { describe, expect, it } from 'vitest';
import { buildRegistroComparison, type RegistroDocument } from '../registro-comparison.js';
const cf = (value: unknown) => ({ value, confidence: 0.95 });
function doc(
  type: string,
  id: number,
  overrides: Partial<RegistroDocument> = {},
): RegistroDocument {
  return {
    id,
    processId: 219,
    type,
    originalFilename: `${type}.pdf`,
    isProcessed: true,
    driveVersion: 2,
    driveFileId: `drive-${type}`,
    confidenceScore: 0.95,
    aiParsedData: {
      importerCnpj: cf('00.123.456/0001-90'),
      currency: cf('USD'),
      totalFobValue: cf(100),
      totalNetWeight: cf(20),
      totalGrossWeight: cf(22),
      items: [
        {
          itemCode: cf('050404509'),
          quantity: cf(10),
          unitType: cf('PCS'),
          ncmCode: cf('95030099'),
        },
      ],
    },
    ...overrides,
  };
}
const trio = () => [doc('draft_duimp', 1), doc('invoice', 2), doc('espelho', 3)];
describe('Registro DUIMP x invoice x espelho', () => {
  it('compares three real sources with file, version and field provenance', () => {
    const result = buildRegistroComparison(219, trio());
    expect(result.status).toBe('match');
    expect(result.rows.find((r) => r.key === 'item:050404509:quantity')?.values.duimp).toEqual({
      value: 10,
      documentId: 1,
      fileName: 'draft_duimp.pdf',
      driveVersion: 2,
      field: 'items[0].quantity',
      contentSha256: null,
      unitType: 'PCS',
    });
  });
  it('does not certify missing sources, unprocessed extraction or another process document', () => {
    for (const candidate of [
      [],
      trio().slice(0, 2),
      trio().map((d) => (d.type === 'espelho' ? { ...d, isProcessed: false } : d)),
      trio().map((d) => (d.type === 'espelho' ? { ...d, processId: 220 } : d)),
    ])
      expect(buildRegistroComparison(219, candidate).status).toBe('pending');
  });
  it('blocks low or unmeasured confidence and an extracted reference from another process', () => {
    for (const confidenceScore of [null, undefined, '0.39', 'invalid']) {
      const docs = trio();
      docs[1].confidenceScore = confidenceScore;
      expect(buildRegistroComparison(219, docs).status).toBe('pending');
    }
    const docs = trio();
    docs[0].aiParsedData = {
      ...(docs[0].aiParsedData as object),
      processReference: cf('PK2202608SZ'),
    };
    const result = buildRegistroComparison(219, docs, 'PK2192607SZ');
    expect(result.status).toBe('pending');
    expect(result.issues.some((issue) => issue.includes('referência extraída difere'))).toBe(true);
  });

  it('compares the actual XLSX parser output with nested summary provenance', () => {
    const rows = [
      ['IMPORTADOR TESTE', '', '', 'TOTAL PCS', 10],
      ['CNPJ: 00.123.456/0001-90', '', '', 'PESO BRUTO', 22],
      ['RUA TESTE 100', '', '', 'PESO LIQUIDO', 20],
      ['CIDADE TESTE - SC', '', '', 'CBM', 1],
      ['', '', '', 'TOTAL CAIXAS', 1],
      [],
      ['', '', '', 'FOB', 100],
      ['Process', 'Supplier', 'Code', 'Qty', 'Amount', 'NCM', 'Unit'],
      ['PK2192607SZ', 'FORNECEDOR TESTE', '050404509', 10, 100, '95030099', 'PCS'],
    ];
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), 'Espelho');
    const parsed = parseEspelhoBuffer(
      XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer,
    );
    const documents = trio();
    documents[2].aiParsedData = parsed;
    const result = buildRegistroComparison(219, documents);
    expect(result.status).toBe('match');
    expect(result.rows.find((row) => row.key === 'totalFobValue')?.values.espelho).toMatchObject({
      value: 100,
      field: 'summary.totalAmountUsd',
    });
    expect(result.rows.find((row) => row.key === 'importerCnpj')?.values.espelho.field).toBe(
      'summary.importerCnpj',
    );
  });
  it('requires exact quantities and does not certify monetary differences within legacy tolerance', () => {
    const documents = trio();
    for (const document of documents)
      document.aiParsedData = {
        ...(document.aiParsedData as object),
        totalFobValue: cf(document.type === 'invoice' ? 10040 : 10000),
        totalNetWeight: cf(document.type === 'invoice' ? 20.01 : 20),
        items: [
          {
            itemCode: cf('050404509'),
            quantity: cf(document.type === 'invoice' ? 1001 : 1000),
            unitType: cf('PCS'),
            ncmCode: cf('95030099'),
          },
        ],
      };
    const result = buildRegistroComparison(219, documents);
    expect(result.rows.find((row) => row.key.endsWith(':quantity'))?.status).toBe('divergent');
    expect(result.rows.find((row) => row.key === 'totalFobValue')?.status).toBe('warning');
    expect(result.rows.find((row) => row.key === 'totalNetWeight')?.status).toBe('warning');
  });
  it('does not consume skipped extraction even when previous fields remain', () => {
    const documents = trio();
    documents[0].aiParsedData = { ...(documents[0].aiParsedData as object), skipped: true };
    expect(buildRegistroComparison(219, documents).status).toBe('pending');
  });

  it('does not treat independent manual uploads with identical names as Drive versions', () => {
    const documents = trio();
    documents[1].driveFileId = null;
    const duplicate = { ...documents[1], id: 99 };
    const result = buildRegistroComparison(219, [...documents, duplicate]);
    expect(result.status).toBe('pending');
    expect(result.sources.invoice).toBeNull();
  });
  it('does not fall back past an unknown version or conflicting same-version content', () => {
    for (const overrides of [
      { driveVersion: null },
      { driveVersion: 2, contentSha256: 'second-hash' },
    ]) {
      const documents = trio();
      documents[1].contentSha256 = 'first-hash';
      const result = buildRegistroComparison(219, [
        ...documents,
        { ...documents[1], id: 99, ...overrides },
      ]);
      expect(result.status).toBe('pending');
      expect(result.sources.invoice).toBeNull();
    }
  });
  it('rejects another process named inside an espelho item even if attached to this process', () => {
    const documents = trio();
    documents[2].aiParsedData = {
      ...(documents[2].aiParsedData as object),
      items: [{ codigo: '050404509', qty: 10, ncm: '95030099', processo: 'PK2202608SZ' }],
    };
    const result = buildRegistroComparison(219, documents, 'PK2192607SZ');
    expect(result.status).toBe('pending');
    expect(result.issues.some((issue) => issue.includes('referência extraída difere'))).toBe(true);
  });
  it('does not compare the same physical content against itself under different document types', () => {
    const documents = trio();
    documents[0].contentSha256 = documents[1].contentSha256 = 'same-hash';
    const result = buildRegistroComparison(219, documents);
    expect(result.status).toBe('pending');
    expect(result.issues.some((issue) => issue.includes('fontes independentes'))).toBe(true);
  });
  it('does not certify equal values with incompatible explicit units or espelho currency', () => {
    const cases = [
      { index: 0, fields: { weightUnit: cf('LBS') } },
      { index: 2, fields: { currency: cf('EUR') } },
      {
        index: 1,
        fields: {
          items: [
            {
              itemCode: cf('050404509'),
              quantity: cf(10),
              ncmCode: cf('95030099'),
              unitType: cf('PAR'),
            },
          ],
        },
      },
    ];
    for (const { index, fields } of cases) {
      const documents = trio();
      documents[index].aiParsedData = { ...(documents[index].aiParsedData as object), ...fields };
      expect(buildRegistroComparison(219, documents).status).toBe('pending');
    }
  });
  it('does not certify low-confidence fields hidden behind a high average', () => {
    const documents = trio();
    documents[0].aiParsedData = {
      ...(documents[0].aiParsedData as object),
      totalFobValue: { value: 100, confidence: 0.1 },
    };
    const result = buildRegistroComparison(219, documents);
    expect(result.status).toBe('pending');
    expect(result.issues.some((issue) => issue.includes('campo com confiança insuficiente'))).toBe(
      true,
    );
  });
  it('does not certify identical malformed tax identifiers, negative numbers or zero quantities', () => {
    for (const fields of [
      { importerCnpj: cf('SEM CNPJ') },
      { totalNetWeight: cf(-1) },
      {
        items: [
          {
            itemCode: cf('050404509'),
            quantity: cf(10),
            unitType: cf('PCS'),
            ncmCode: cf('NCM INVALIDO'),
          },
        ],
      },
      { items: [{ itemCode: cf('050404509'), quantity: cf(0), ncmCode: cf('95030099') }] },
    ]) {
      const documents = trio().map((document) => ({
        ...document,
        aiParsedData: { ...(document.aiParsedData as object), ...fields },
      }));
      expect(buildRegistroComparison(219, documents).status).toBe('pending');
    }
  });

  it('honors harness review and rejects conflicting explicit references', () => {
    for (const fields of [
      { _trust: { trust: 'review' } },
      { _trust: { trust: 'trusted', contractFailure: true } },
      { processReference: cf('PK2192607SZ'), processCode: cf('PK2202608SZ') },
    ]) {
      const documents = trio();
      documents[0].aiParsedData = { ...(documents[0].aiParsedData as object), ...fields };
      expect(buildRegistroComparison(219, documents, 'PK2192607SZ').status).toBe('pending');
    }
  });

  it('keeps quantities visible but pending when one source has no unit', () => {
    const documents = trio();
    documents[0].aiParsedData = {
      ...(documents[0].aiParsedData as object),
      items: [{ itemCode: cf('050404509'), quantity: cf(10), ncmCode: cf('95030099') }],
    };
    const result = buildRegistroComparison(219, documents);
    const row = result.rows.find((row) => row.key.endsWith(':quantity'))!;
    expect(result.status).toBe('pending');
    expect(row.status).toBe('skipped');
    expect(row.values.duimp.value).toBe(10);
    expect(row.values.invoice.value).toBe(10);
    expect(row.values.duimp.unitType).toBeNull();
  });
  it('compares documented equivalent units but does not convert pairs to pieces', () => {
    for (const [units, expected] of [
      [['PCS', 'UN', 'PIECES'], 'match'],
      [['PAR', 'PAIR', 'PARES'], 'match'],
      [['PAR', 'PCS', 'UN'], 'pending'],
    ] as const) {
      const documents = trio().map((document, index) => ({
        ...document,
        aiParsedData: {
          ...(document.aiParsedData as object),
          items: [
            {
              itemCode: cf('050404509'),
              quantity: cf(10),
              ncmCode: cf('95030099'),
              unitType: cf(units[index]),
            },
          ],
        },
      }));
      expect(buildRegistroComparison(219, documents).status).toBe(expected);
    }
  });

  it('does not silently choose conflicting item or amount aliases', () => {
    for (const aliases of [
      { qty: 11 },
      { unit: 'PAR' },
      { codigo: 'OTHER-SKU' },
      { ncm: '00000000' },
    ]) {
      const documents = trio();
      documents[0].aiParsedData = {
        ...(documents[0].aiParsedData as object),
        items: [
          {
            itemCode: cf('050404509'),
            quantity: cf(10),
            unitType: cf('PCS'),
            ncmCode: cf('95030099'),
            ...aliases,
          },
        ],
      };
      const result = buildRegistroComparison(219, documents);
      expect(result.status).toBe('pending');
      expect(result.issues.some((issue) => issue.includes('aliases'))).toBe(true);
    }
    const documents = trio();
    documents[0].aiParsedData = {
      ...(documents[0].aiParsedData as object),
      totalAmountUsd: cf(999),
    };
    expect(buildRegistroComparison(219, documents).status).toBe('pending');
  });
  it('allows equivalent documented unit and NCM aliases without losing textual SKU', () => {
    const documents = trio();
    documents[0].aiParsedData = {
      ...(documents[0].aiParsedData as object),
      items: [
        {
          itemCode: cf('050404509'),
          codigo: '050404509',
          quantity: cf(10),
          qty: 10,
          unitType: cf('PCS'),
          unit: 'UN',
          ncmCode: cf('95030099'),
          ncm: '9503.00.99',
        },
      ],
    };
    expect(buildRegistroComparison(219, documents).status).toBe('match');
  });
  it('does not pick a higher id when unhashed same-version extractions conflict', () => {
    const documents = trio();
    const duplicate = {
      ...documents[0],
      id: 99,
      aiParsedData: { ...(documents[0].aiParsedData as object), totalFobValue: cf(999) },
    };
    const result = buildRegistroComparison(219, [...documents, duplicate]);
    expect(result.status).toBe('pending');
    expect(result.sources.duimp).toBeNull();
    expect(result.issues.some((issue) => issue.includes('extrações diferentes'))).toBe(true);
  });

  it('prefers the draft being checked and does not fall back to an old completed version', () => {
    expect(
      buildRegistroComparison(219, [...trio(), doc('duimp', 4)]).sources.duimp?.documentId,
    ).toBe(1);
    const result = buildRegistroComparison(219, [
      ...trio(),
      doc('draft_duimp', 4, { driveVersion: 3, isProcessed: false }),
    ]);
    expect(result.status).toBe('pending');
    expect(result.sources.duimp?.documentId).toBe(4);
  });
  it('flags competing files instead of silently choosing an invoice', () => {
    const result = buildRegistroComparison(219, [
      ...trio(),
      doc('invoice', 4, {
        originalFilename: 'invoice-other.pdf',
        driveFileId: 'different-invoice',
      }),
    ]);
    expect(result.status).toBe('pending');
    expect(result.sources.invoice).toBeNull();
  });
  it('normalizes tax punctuation but preserves textual SKU identity', () => {
    const docs = trio();
    docs[1].aiParsedData = {
      ...(docs[1].aiParsedData as object),
      importerCnpj: cf('00123456000190'),
      items: [
        {
          itemCode: cf('50404509'),
          quantity: cf(10),
          unitType: cf('PCS'),
          ncmCode: cf('95030099'),
        },
      ],
    };
    const result = buildRegistroComparison(219, docs);
    expect(result.rows[0].status).toBe('match');
    expect(result.status).toBe('pending');
    expect(result.rows.filter((r) => r.key.endsWith(':quantity'))).toHaveLength(2);
  });
  it('shows genuine quantity divergence and never substitutes customs value for FOB', () => {
    const docs = trio();
    docs[0].aiParsedData = {
      ...(docs[0].aiParsedData as object),
      totalFobValue: null,
      customsValue: cf(100),
      items: [
        {
          itemCode: cf('050404509'),
          quantity: cf(90),
          unitType: cf('PCS'),
          ncmCode: cf('95030099'),
        },
      ],
    };
    const result = buildRegistroComparison(219, docs);
    expect(result.status).toBe('divergent');
    expect(result.rows.find((r) => r.key === 'totalFobValue')?.status).toBe('skipped');
  });
  it('requires currency evidence and disambiguation of repeated SKU lines', () => {
    const docs = trio();
    docs[0].aiParsedData = {
      ...(docs[0].aiParsedData as object),
      currency: cf('BRL'),
      items: [
        { itemCode: cf('A1'), quantity: cf(2) },
        { itemCode: cf('A1'), quantity: cf(3) },
      ],
    };
    const result = buildRegistroComparison(219, docs);
    expect(result.status).toBe('pending');
    expect(result.issues.some((i) => i.includes('linhas repetidas'))).toBe(true);
    expect(result.rows.find((r) => r.key === 'totalFobValue')?.values.duimp.value).toBeNull();
  });
});
