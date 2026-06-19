import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getSydleConfigStatus, SydleClient } from '../client.js';

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
});
