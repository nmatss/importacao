import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';

vi.mock('../service.js', () => ({
  processService: {
    getEvents: vi.fn().mockResolvedValue([]),
  },
}));

const { processController } = await import('../controller.js');
const { processService } = await import('../service.js');

function fakeRes() {
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
  };
  return res as unknown as Response & { statusCode: number; body: unknown };
}

async function callGetEvents(limit?: string) {
  const req = {
    params: { id: '1' },
    query: limit === undefined ? {} : { limit },
  } as unknown as Request;
  await processController.getEvents(req, fakeRes());
  return (processService.getEvents as ReturnType<typeof vi.fn>).mock.calls.at(-1);
}

describe('processController.getEvents() — teto de limit', () => {
  beforeEach(() => vi.clearAllMocks());

  it('usa 50 quando limit nao vem', async () => {
    expect(await callGetEvents()).toEqual([1, 50]);
  });

  it('respeita um limit dentro do teto', async () => {
    expect(await callGetEvents('25')).toEqual([1, 25]);
  });

  // Sem Math.min, `?limit=1000000` era aceito e a timeline inteira ia junto.
  it('trunca ?limit=1000000 em 100, como li-tracking', async () => {
    expect(await callGetEvents('1000000')).toEqual([1, 100]);
  });

  it('trunca exatamente acima do teto', async () => {
    expect(await callGetEvents('101')).toEqual([1, 100]);
  });

  it('nao aceita limit negativo', async () => {
    expect(await callGetEvents('-5')).toEqual([1, 1]);
  });

  it('cai no default com limit nao numerico', async () => {
    expect(await callGetEvents('abc')).toEqual([1, 50]);
  });
});
