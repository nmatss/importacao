import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sheetsMocks = vi.hoisted(() => ({
  valuesGet: vi.fn(),
  Sheets: vi.fn(),
  GoogleAuth: vi.fn(),
}));

vi.mock('@googleapis/sheets', () => ({
  auth: { GoogleAuth: sheetsMocks.GoogleAuth },
  sheets_v4: { Sheets: sheetsMocks.Sheets },
}));

vi.mock('../../../shared/utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const ENV_KEYS = [
  'GOOGLE_DRIVE_CLIENT_EMAIL',
  'GOOGLE_DRIVE_PRIVATE_KEY',
  'GOOGLE_SHEETS_FOLLOW_UP_ID',
  'GOOGLE_SHEETS_FOLLOW_UP_TAB',
] as const;
const originalEnv = new Map(ENV_KEYS.map((key) => [key, process.env[key]]));

async function loadService() {
  vi.resetModules();
  return (await import('../google-sheets.service.js')).googleSheetsService;
}

describe('googleSheetsService Follow Up ranges', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sheetsMocks.Sheets.mockImplementation(function MockSheets() {
      return { spreadsheets: { values: { get: sheetsMocks.valuesGet } } };
    });
    process.env.GOOGLE_DRIVE_CLIENT_EMAIL = 'service@example.test';
    process.env.GOOGLE_DRIVE_PRIVATE_KEY = 'test-key';
    process.env.GOOGLE_SHEETS_FOLLOW_UP_ID = 'follow-up-sheet';
    delete process.env.GOOGLE_SHEETS_FOLLOW_UP_TAB;
  });

  afterEach(() => {
    vi.useRealTimers();
    for (const key of ENV_KEYS) {
      const value = originalEnv.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('reads process references from the explicit Processos tab by default', async () => {
    sheetsMocks.valuesGet.mockResolvedValue({
      data: { values: [['PK2052602TJ'], [''], ['IM0712602NB']] },
    });
    const service = await loadService();

    await expect(service.readProcessReferences()).resolves.toEqual(['PK2052602TJ', 'IM0712602NB']);
    expect(sheetsMocks.valuesGet).toHaveBeenCalledWith(
      { spreadsheetId: 'follow-up-sheet', range: "'Processos'!A2:A" },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('escapes a configured tab name instead of falling back to the first sheet', async () => {
    process.env.GOOGLE_SHEETS_FOLLOW_UP_TAB = "Processos '2026'";
    sheetsMocks.valuesGet.mockResolvedValue({ data: { values: [] } });
    const service = await loadService();

    await service.readProcessReferences();

    expect(sheetsMocks.valuesGet).toHaveBeenCalledWith(
      { spreadsheetId: 'follow-up-sheet', range: "'Processos ''2026'''!A2:A" },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('returns null only when a successful lookup does not contain the process', async () => {
    sheetsMocks.valuesGet.mockResolvedValue({ data: { values: [['Processo'], ['OUTRO']] } });
    const service = await loadService();
    await expect(service.readProcessRow('PK220')).resolves.toBeNull();
    expect(sheetsMocks.valuesGet).toHaveBeenCalledTimes(1);
  });

  it('reports unavailable after bounded timeout retries instead of a missing process', async () => {
    vi.useFakeTimers();
    sheetsMocks.valuesGet.mockImplementation(() => new Promise(() => {}));
    const service = await loadService();
    const result = expect(service.readProcessRow('PK220')).rejects.toMatchObject({
      statusCode: 503,
      code: 'SERVICE_UNAVAILABLE',
    });
    await vi.runAllTimersAsync();
    await result;
    expect(sheetsMocks.valuesGet).toHaveBeenCalledTimes(3);
    for (const [, options] of sheetsMocks.valuesGet.mock.calls) {
      expect(options.signal.aborted).toBe(true);
    }
  });

  it('recovers a transient lookup failure without changing source columns or text values', async () => {
    vi.useFakeTimers();
    sheetsMocks.valuesGet
      .mockRejectedValueOnce(Object.assign(new Error('network timeout'), { code: 'ETIMEDOUT' }))
      .mockResolvedValueOnce({ data: { values: [['Processo'], ['PK220']] } })
      .mockResolvedValueOnce({ data: { values: [['PK220', '050404509', '31/12/2026']] } })
      .mockResolvedValueOnce({ data: { values: [['Processo', 'SKU', 'ETA Final']] } });
    const service = await loadService();
    const result = service.readProcessRow('PK220');
    await vi.runAllTimersAsync();
    await expect(result).resolves.toEqual({
      Processo: 'PK220',
      SKU: '050404509',
      'ETA Final': '31/12/2026',
    });
    expect(sheetsMocks.valuesGet.mock.calls.map(([request]) => request.range)).toEqual([
      "'Processos'!A:A",
      "'Processos'!A:A",
      "'Processos'!A2:DZ2",
      "'Processos'!A1:DZ1",
    ]);
  });

  it('does not treat a header permission failure as a missing process or expose provider details', async () => {
    sheetsMocks.valuesGet
      .mockResolvedValueOnce({ data: { values: [['Processo'], ['PK220']] } })
      .mockResolvedValueOnce({ data: { values: [['PK220']] } })
      .mockRejectedValueOnce(Object.assign(new Error('private provider details'), { code: 403 }));
    const service = await loadService();
    await expect(service.readProcessRow('PK220')).rejects.toMatchObject({
      statusCode: 503,
      message: 'Nao foi possivel ler o Follow-Up no Google Sheets. Tente novamente.',
    });
    expect(sheetsMocks.valuesGet).toHaveBeenCalledTimes(3);
  });
});
