import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getSydleConfigStatus, SYDLE_ENRICHMENT_CLASSES, SydleClient } from '../client.js';

describe('SydleClient', () => {
  const originalEnv = { ...process.env };
  const fetchMock = vi.fn();

  beforeEach(() => {
    process.env = { ...originalEnv };
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    process.env = { ...originalEnv };
  });

  it('does not require SYDLE_API_TOKEN when Sydle One class mode is configured', () => {
    process.env = {
      ...originalEnv,
      SYDLE_SYNC_ENABLED: 'true',
      SYDLE_SOURCE_TYPE: 'sydle_one_class',
      SYDLE_BASE_URL: 'https://sydle.example.test',
      SYDLE_USER: 'service@example.test',
      SYDLE_PASSWORD: 'secret',
      SYDLE_CLASS_ID: '68bf1179b042c72f03993928',
    };

    expect(getSydleConfigStatus()).toMatchObject({
      configured: true,
      missing: [],
      sourceType: 'sydle_one_class',
      classId: '68bf1179b042c72f03993928',
    });
  });

  it('fetches Sydle One international payment rows via login and _classId/_search', async () => {
    process.env = {
      ...originalEnv,
      SYDLE_SYNC_ENABLED: 'true',
      SYDLE_SOURCE_TYPE: 'sydle_one_class',
      SYDLE_BASE_URL: 'https://sydle.example.test',
      SYDLE_USER: 'service@example.test',
      SYDLE_PASSWORD: 'secret',
      SYDLE_CLASS_ID: '68bf1179b042c72f03993928',
      SYDLE_PAGE_SIZE: '50',
    };

    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ accessToken: { token: 'jwt-token' } }), {
          status: 200,
          headers: { 'set-cookie': 'JW-UserToken_main=session-token; Path=/; HttpOnly' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            hits: {
              hits: [
                {
                  _id: 'REQ-1',
                  sort: ['2026-06-18T20:20:31.914Z', 'REQ-1'],
                  _source: {
                    _id: 'REQ-1',
                    _lastUpdateDate: '2026-06-18T20:20:31.914Z',
                    approved: true,
                    ticket: { _id: 'TICKET-1' },
                    paymentData: [
                      {
                        _id: 'PAY-1',
                        paymentAmount: 4460,
                        expirationDate: '2026-06-18T00:00:00Z',
                        paymentDeadlineAfterShipment: 30,
                        paymentCurrency: { _id: 'USD-ID' },
                      },
                    ],
                  },
                },
              ],
            },
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            hits: {
              hits: [
                {
                  _id: 'TICKET-1',
                  _source: {
                    _id: 'TICKET-1',
                    code: '5337',
                    status: { _id: 'OPEN' },
                    _lastUpdateDate: '2026-06-18T20:30:00.000Z',
                  },
                },
              ],
            },
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            hits: { hits: [{ _id: 'OPEN', _source: { _id: 'OPEN', name: 'Em andamento' } }] },
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            hits: { hits: [{ _id: 'USD-ID', _source: { _id: 'USD-ID', iso: 'USD' } }] },
          }),
          { status: 200 },
        ),
      );

    const result = await new SydleClient().fetchPayments(new Date('2026-06-18T20:00:00Z'));

    expect(result.records).toHaveLength(1);
    expect(result.records[0]).toMatchObject({
      externalId: 'sydle-one:REQ-1:PAY-1',
      purchaseRef: 'SYDLE-5337',
      currency: 'USD',
      purchaseAmount: 4460,
      paidAmount: 0,
      openAmount: 4460,
      paymentType: 'balance',
      paymentStatus: 'open',
    });
    expect(result.cursorTo?.toISOString()).toBe('2026-06-18T20:20:31.914Z');

    const authUrl = String(fetchMock.mock.calls[0][0]);
    expect(authUrl).toContain('/api/1/main/sys/auth/signIn');
    const searchUrl = String(fetchMock.mock.calls[1][0]);
    expect(searchUrl).toContain('/api/1/main/_classId/68bf1179b042c72f03993928/_search');
    expect(fetchMock.mock.calls[1][1]).toMatchObject({
      method: 'POST',
      headers: expect.objectContaining({
        Cookie: 'JW-UserToken_main=session-token',
        Authorization: 'Bearer jwt-token',
      }),
    });
    const searchBody = JSON.parse(String(fetchMock.mock.calls[1][1]?.body));
    expect(searchBody.query).toEqual({
      range: { _lastUpdateDate: { gte: '2026-06-18T20:00:00.000Z' } },
    });
  });

  // ── Enriquecimento de campos complementares (flag-gated) ──────────────────
  const enrichmentBaseEnv = {
    SYDLE_SYNC_ENABLED: 'true',
    SYDLE_SOURCE_TYPE: 'sydle_one_class',
    SYDLE_BASE_URL: 'https://sydle.example.test',
    SYDLE_USER: 'service@example.test',
    SYDLE_PASSWORD: 'secret',
    SYDLE_CLASS_ID: '68bf1179b042c72f03993928',
  } as const;

  function mockSydleOneSequence(
    requestSource: Record<string, unknown>,
    ticketSource: Record<string, unknown>,
  ) {
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ accessToken: { token: 'jwt-token' } }), {
          status: 200,
          headers: { 'set-cookie': 'JW-UserToken_main=session-token; Path=/; HttpOnly' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            hits: {
              hits: [
                {
                  _id: 'REQ-1',
                  sort: ['2026-06-18T20:20:31.914Z', 'REQ-1'],
                  _source: requestSource,
                },
              ],
            },
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ hits: { hits: [{ _id: 'TICKET-1', _source: ticketSource }] } }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            hits: { hits: [{ _id: 'OPEN', _source: { _id: 'OPEN', name: 'Em andamento' } }] },
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            hits: { hits: [{ _id: 'USD-ID', _source: { _id: 'USD-ID', iso: 'USD' } }] },
          }),
          { status: 200 },
        ),
      );
  }

  const REQUEST_WITH_EXTRA = {
    _id: 'REQ-1',
    _lastUpdateDate: '2026-06-18T20:20:31.914Z',
    approved: true,
    ticket: { _id: 'TICKET-1' },
    // campos complementares no request
    supplier: 'ACME EXPORT LTD',
    processCode: 'IMP-0099',
    purchaseOrder: 'PO-777',
    exchangeRate: 5.12,
    valorBrl: 22835.2,
    requestData: {
      paymentType: 'afterShipment',
      emissionDate: '2026-05-07T00:00:00Z',
      endDateForm: '2026-06-16T12:39:04Z',
      departureDate: '2026-05-08T00:00:00Z',
    },
    // ruído não-escalar: deve ser ignorado pelo guard de escalar
    process: { _id: 'X', _classId: 'Y' },
    paymentData: [
      {
        _id: 'PAY-1',
        paymentAmount: 4460,
        expirationDate: '2026-06-18T00:00:00Z',
        paymentDeadlineAfterShipment: 30,
        paymentCurrency: { _id: 'USD-ID' },
      },
    ],
  };

  const TICKET_WITH_OPENFORM = {
    _id: 'TICKET-1',
    code: '5337',
    status: { _id: 'OPEN' },
    _lastUpdateDate: '2026-06-18T20:30:00.000Z',
    // campos complementares no openForm do ticket
    openForm: {
      proforma: 'PI-2026-001',
      invoice: 'CI-555',
      contrato: 'FX-123',
      remessa: 'SWIFT-XY',
    },
  };

  it('uses per-installment payment date instead of ticket conclusion date', async () => {
    process.env = { ...originalEnv, ...enrichmentBaseEnv };
    mockSydleOneSequence(
      {
        _id: 'REQ-1',
        _lastUpdateDate: '2026-07-01T20:20:31.914Z',
        approved: true,
        ticket: { _id: 'TICKET-1' },
        paymentData: [
          {
            _id: 'PAY-1',
            paymentAmount: 4460,
            expirationDate: '2026-06-18T00:00:00Z',
            paymentDate: '2026-06-15T00:00:00Z',
            paymentCurrency: { _id: 'USD-ID' },
          },
          {
            _id: 'PAY-2',
            paymentAmount: 1200,
            expirationDate: '2026-07-10T00:00:00Z',
            paymentCurrency: { _id: 'USD-ID' },
          },
        ],
      },
      {
        _id: 'TICKET-1',
        code: '5201',
        status: { _id: 'OPEN' },
        attendanceConclusionDate: '2026-07-01T00:00:00Z',
        _lastUpdateDate: '2026-07-01T20:30:00.000Z',
      },
    );

    const result = await new SydleClient().fetchPayments(null);

    expect(result.records).toHaveLength(2);
    expect(result.records[0]).toMatchObject({
      externalId: 'sydle-one:REQ-1:PAY-1',
      paidAmount: 4460,
      openAmount: 0,
      paymentStatus: 'paid',
    });
    expect((result.records[0].paidAt as Date).toISOString()).toBe('2026-06-15T00:00:00.000Z');
    expect(result.records[1]).toMatchObject({
      externalId: 'sydle-one:REQ-1:PAY-2',
      paidAmount: 0,
      openAmount: 1200,
      paymentStatus: 'open',
      paidAt: null,
    });
  });

  it('enriches complementary fields from request and ticket openForm when SYDLE_ONE_ENRICH_FIELDS is on', async () => {
    process.env = { ...originalEnv, ...enrichmentBaseEnv, SYDLE_ONE_ENRICH_FIELDS: 'true' };
    mockSydleOneSequence(REQUEST_WITH_EXTRA, TICKET_WITH_OPENFORM);

    const result = await new SydleClient().fetchPayments(null);

    expect(result.records).toHaveLength(1);
    expect(result.records[0]).toMatchObject({
      externalId: 'sydle-one:REQ-1:PAY-1',
      purchaseRef: 'SYDLE-5337',
      supplierName: 'ACME EXPORT LTD',
      processCode: 'IMP-0099',
      purchaseOrder: 'PO-777',
      proformaNumber: 'PI-2026-001',
      invoiceNumber: 'CI-555',
      contractNumber: 'FX-123',
      remittanceId: 'SWIFT-XY',
      exchangeRate: 5.12,
      amountBrl: 22835.2,
      paymentType: 'afterShipment',
      invoiceIssuedDate: '2026-05-07T00:00:00Z',
      taskCreatedAt: '2026-06-16T12:39:04Z',
      shipmentDate: '2026-05-08T00:00:00Z',
    });
    // o ruído não-escalar não vira processCode (que veio da chave explícita)
    expect(result.records[0].processCode).toBe('IMP-0099');
    // os campos computados continuam corretos (enrichment não sobrescreve)
    expect(result.records[0]).toMatchObject({ purchaseAmount: 4460, paymentStatus: 'open' });
  });

  it('does not surface complementary fields when SYDLE_ONE_ENRICH_FIELDS is off (default)', async () => {
    process.env = { ...originalEnv, ...enrichmentBaseEnv };
    mockSydleOneSequence(REQUEST_WITH_EXTRA, TICKET_WITH_OPENFORM);

    const result = await new SydleClient().fetchPayments(null);

    expect(result.records).toHaveLength(1);
    const row = result.records[0];
    for (const key of [
      'supplierName',
      'processCode',
      'purchaseOrder',
      'proformaNumber',
      'invoiceNumber',
      'contractNumber',
      'remittanceId',
      'exchangeRate',
      'amountBrl',
    ]) {
      expect(row).not.toHaveProperty(key);
    }
    // comportamento idêntico ao de hoje
    expect(row).toMatchObject({
      externalId: 'sydle-one:REQ-1:PAY-1',
      purchaseRef: 'SYDLE-5337',
      purchaseAmount: 4460,
      paymentStatus: 'open',
    });
  });

  // ── Caso B: classe vizinha referenciada por {_id, _classId} ───────────────
  it('resolves a neighbor enrichment class and maps its fields onto the row', async () => {
    process.env = { ...originalEnv, ...enrichmentBaseEnv, SYDLE_ONE_ENRICH_FIELDS: 'true' };

    const requestWithSupplierRef = {
      _id: 'REQ-1',
      _lastUpdateDate: '2026-06-18T20:20:31.914Z',
      approved: true,
      ticket: { _id: 'TICKET-1' },
      // fornecedor é uma referência a outra classe (não um campo de texto)
      supplier: { _id: 'SUP-1', _classId: 'SUP-CLASS' },
      paymentData: [
        {
          _id: 'PAY-1',
          paymentAmount: 4460,
          expirationDate: '2026-06-18T00:00:00Z',
          paymentDeadlineAfterShipment: 30,
          paymentCurrency: { _id: 'USD-ID' },
        },
      ],
    };

    mockSydleOneSequence(requestWithSupplierRef, {
      _id: 'TICKET-1',
      code: '5337',
      status: { _id: 'OPEN' },
      _lastUpdateDate: '2026-06-18T20:30:00.000Z',
    });
    // 6ª chamada: busca da classe vizinha de fornecedor
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          hits: { hits: [{ _id: 'SUP-1', _source: { _id: 'SUP-1', name: 'ACME FACTORY LTD' } }] },
        }),
        { status: 200 },
      ),
    );

    // isola: troca os specs default por um único spec de teste e restaura depois
    const savedSpecs = SYDLE_ENRICHMENT_CLASSES.splice(0);
    SYDLE_ENRICHMENT_CLASSES.push({
      label: 'supplier',
      classId: 'SUP-CLASS',
      source: 'request',
      refPath: ['supplier'],
      includes: ['name'],
      map: { name: 'supplierName' },
    });

    try {
      const result = await new SydleClient().fetchPayments(null);

      expect(result.records).toHaveLength(1);
      expect(result.records[0].supplierName).toBe('ACME FACTORY LTD');

      // a classe vizinha foi consultada pelo classId e pelos _id referenciados
      const supplierUrl = String(fetchMock.mock.calls[5][0]);
      expect(supplierUrl).toContain('/api/1/main/_classId/SUP-CLASS/_search');
      const supplierBody = JSON.parse(String(fetchMock.mock.calls[5][1]?.body));
      expect(supplierBody.query).toEqual({ terms: { _id: ['SUP-1'] } });
    } finally {
      SYDLE_ENRICHMENT_CLASSES.splice(0, SYDLE_ENRICHMENT_CLASSES.length, ...savedSpecs);
    }
  });

  it('resolves a chained neighbor class (supplier: recipient -> enterprise -> legalName)', async () => {
    process.env = { ...originalEnv, ...enrichmentBaseEnv, SYDLE_ONE_ENRICH_FIELDS: 'true' };

    // usa os specs default SHIPPED (brand + supplier 2-hop) com os classIds reais
    const BRAND_CLASS = '685179c16732f5038aaed372';
    const RECIPIENT_CLASS = '689cd3bd27624d322604be16';
    const ENTERPRISE_CLASS = '591365fef5ca53284cd8d159';

    const requestWithRequestData = {
      _id: 'REQ-1',
      _lastUpdateDate: '2026-06-18T20:20:31.914Z',
      approved: true,
      ticket: { _id: 'TICKET-1' },
      requestData: {
        processCode: 'IMP-0099',
        invoiceCode: 'INV-555',
        brand: { _id: 'BR-1', _classId: BRAND_CLASS },
        recipient: { _id: 'REC-1', _classId: RECIPIENT_CLASS },
      },
      paymentData: [
        {
          _id: 'PAY-1',
          paymentAmount: 4460,
          expirationDate: '2026-06-18T00:00:00Z',
          paymentDeadlineAfterShipment: 30,
          paymentCurrency: { _id: 'USD-ID' },
        },
      ],
    };

    mockSydleOneSequence(requestWithRequestData, {
      _id: 'TICKET-1',
      code: '5337',
      status: { _id: 'OPEN' },
      _lastUpdateDate: '2026-06-18T20:30:00.000Z',
    });
    // 6: brand class -> name
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          hits: { hits: [{ _id: 'BR-1', _source: { _id: 'BR-1', name: 'Imaginarium' } }] },
        }),
        { status: 200 },
      ),
    );
    // 7: recipient class -> enterprise ref
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          hits: {
            hits: [
              {
                _id: 'REC-1',
                _source: { _id: 'REC-1', enterprise: { _id: 'ENT-1', _classId: ENTERPRISE_CLASS } },
              },
            ],
          },
        }),
        { status: 200 },
      ),
    );
    // 8: enterprise class -> legalName
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          hits: {
            hits: [
              {
                _id: 'ENT-1',
                _source: { _id: 'ENT-1', legalName: 'ACME ENTERPRISES INC', name: 'ACME' },
              },
            ],
          },
        }),
        { status: 200 },
      ),
    );

    const result = await new SydleClient().fetchPayments(null);

    expect(result.records).toHaveLength(1);
    expect(result.records[0]).toMatchObject({
      processCode: 'IMP-0099', // Caso A: requestData.processCode
      invoiceNumber: 'INV-555', // Caso A: requestData.invoiceCode
      brand: 'Imaginarium', // Caso B 1-hop
      supplierName: 'ACME ENTERPRISES INC', // Caso B 2-hop: legalName da enterprise
    });

    // a cadeia recipient -> enterprise foi seguida
    const enterpriseUrl = String(fetchMock.mock.calls[7][0]);
    expect(enterpriseUrl).toContain(`/_classId/${ENTERPRISE_CLASS}/_search`);
    const enterpriseBody = JSON.parse(String(fetchMock.mock.calls[7][1]?.body));
    expect(enterpriseBody.query).toEqual({ terms: { _id: ['ENT-1'] } });
  });

  it('does not query neighbor classes when the request has no referenced objects', async () => {
    process.env = { ...originalEnv, ...enrichmentBaseEnv, SYDLE_ONE_ENRICH_FIELDS: 'true' };
    // REQUEST_WITH_EXTRA não tem refs em requestData => os specs default não consultam vizinhas
    mockSydleOneSequence(REQUEST_WITH_EXTRA, TICKET_WITH_OPENFORM);

    await new SydleClient().fetchPayments(null);

    // só as 5 chamadas base (signIn + payment + ticket + status + currency)
    expect(fetchMock.mock.calls).toHaveLength(5);
  });
});
