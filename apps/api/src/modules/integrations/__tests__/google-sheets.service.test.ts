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
    expect(sheetsMocks.valuesGet).toHaveBeenCalledWith({
      spreadsheetId: 'follow-up-sheet',
      range: "'Processos'!A2:A",
    });
  });

  it('escapes a configured tab name instead of falling back to the first sheet', async () => {
    process.env.GOOGLE_SHEETS_FOLLOW_UP_TAB = "Processos '2026'";
    sheetsMocks.valuesGet.mockResolvedValue({ data: { values: [] } });
    const service = await loadService();

    await service.readProcessReferences();

    expect(sheetsMocks.valuesGet).toHaveBeenCalledWith({
      spreadsheetId: 'follow-up-sheet',
      range: "'Processos ''2026'''!A2:A",
    });
  });
});
