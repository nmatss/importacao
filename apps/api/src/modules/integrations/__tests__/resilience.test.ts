import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Resiliencia das integracoes externas.
 *
 * Ate 29/08/2026 nenhuma chamada ao Drive, ao Sheets, ao Groups ou ao Odoo
 * tinha retry ou backoff: um 503 de dois segundos do Google derrubava o sweep
 * inteiro. E o timeout local era `Promise.race` — a promessa perdedora era
 * descartada, mas a requisicao seguia em voo.
 *
 * Estes testes cobrem as duas metades e, principalmente, o LIMITE do retry:
 * escrita nao pode ser re-tentada, sob pena de duplicar pasta ou arquivo no
 * Drive quando so a resposta se perde.
 */

const driveMocks = vi.hoisted(() => ({
  filesGet: vi.fn(),
  filesList: vi.fn(),
  filesCreate: vi.fn(),
  filesUpdate: vi.fn(),
  Drive: vi.fn(),
  GoogleAuth: vi.fn(),
}));

const sheetsMocks = vi.hoisted(() => ({
  valuesGet: vi.fn(),
  Sheets: vi.fn(),
  GoogleAuth: vi.fn(),
}));

vi.mock('@googleapis/drive', () => ({
  auth: { GoogleAuth: driveMocks.GoogleAuth },
  drive_v3: { Drive: driveMocks.Drive },
}));

vi.mock('@googleapis/sheets', () => ({
  auth: { GoogleAuth: sheetsMocks.GoogleAuth },
  sheets_v4: { Sheets: sheetsMocks.Sheets },
}));

vi.mock('../../../shared/database/connection.js', () => ({ db: {} }));

vi.mock('../../../shared/utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { shouldRetryIntegration, retryAfterMsOf, httpStatusOf } = await import('../retry-policy.js');

/** Erro no formato do Gaxios: houve resposta HTTP, entao nao e erro de rede. */
function httpError(status: number, headers: Record<string, string> = {}) {
  return Object.assign(new Error(`HTTP ${status}`), {
    response: { status, headers },
  });
}

const ENV_KEYS = [
  'GOOGLE_DRIVE_CLIENT_EMAIL',
  'GOOGLE_DRIVE_PRIVATE_KEY',
  'GOOGLE_DRIVE_ROOT_FOLDER_ID',
  'GOOGLE_SHEETS_FOLLOW_UP_ID',
] as const;
const originalEnv = new Map(ENV_KEYS.map((key) => [key, process.env[key]]));

function setEnv() {
  process.env.GOOGLE_DRIVE_CLIENT_EMAIL = 'service@example.test';
  process.env.GOOGLE_DRIVE_PRIVATE_KEY = 'test-key';
  process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID = 'root-folder';
  process.env.GOOGLE_SHEETS_FOLLOW_UP_ID = 'follow-up-sheet';
}

function restoreEnv() {
  for (const key of ENV_KEYS) {
    const value = originalEnv.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

async function loadDrive() {
  vi.resetModules();
  return (await import('../google-drive.service.js')).googleDriveService;
}

async function loadSheets() {
  vi.resetModules();
  return (await import('../google-sheets.service.js')).googleSheetsService;
}

describe('politica de re-tentativa das integracoes', () => {
  it('re-tenta 429, 408 e 5xx', () => {
    expect(shouldRetryIntegration(httpError(429))).toBe(true);
    expect(shouldRetryIntegration(httpError(408))).toBe(true);
    expect(shouldRetryIntegration(httpError(500))).toBe(true);
    expect(shouldRetryIntegration(httpError(503))).toBe(true);
  });

  it('NAO re-tenta 4xx de cliente — 401, 403 e 404 sao configuracao, nao soluco', () => {
    expect(shouldRetryIntegration(httpError(400))).toBe(false);
    expect(shouldRetryIntegration(httpError(401))).toBe(false);
    expect(shouldRetryIntegration(httpError(403))).toBe(false);
    expect(shouldRetryIntegration(httpError(404))).toBe(false);
  });

  it('re-tenta erro de rede (sem resposta HTTP nenhuma)', () => {
    expect(shouldRetryIntegration(Object.assign(new Error('reset'), { code: 'ECONNRESET' }))).toBe(
      true,
    );
    expect(shouldRetryIntegration(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' }))).toBe(
      true,
    );
  });

  it('NAO re-tenta erro que nao da para classificar', () => {
    expect(shouldRetryIntegration(new Error('coisa estranha'))).toBe(false);
    expect(shouldRetryIntegration(null)).toBe(false);
  });

  it('le o status tambem no formato do googleapis (code numerico)', () => {
    expect(httpStatusOf({ code: 503 })).toBe(503);
    expect(httpStatusOf({ status: 429 })).toBe(429);
    // `code` string e codigo de rede (ECONNRESET), nao status HTTP.
    expect(httpStatusOf({ code: 'ECONNRESET' })).toBeNull();
  });

  describe('Retry-After', () => {
    it('respeita o cabecalho em segundos', () => {
      expect(retryAfterMsOf(httpError(429, { 'retry-after': '3' }))).toBe(3000);
    });

    it('aceita o cabecalho com caixa diferente e no formato Headers do fetch', () => {
      expect(retryAfterMsOf(httpError(429, { 'Retry-After': '2' }))).toBe(2000);

      const withHeaders = Object.assign(new Error('429'), {
        response: { status: 429, headers: new Headers({ 'retry-after': '5' }) },
      });
      expect(retryAfterMsOf(withHeaders)).toBe(5000);
    });

    it('aceita data HTTP', () => {
      const future = new Date(Date.now() + 4000).toUTCString();
      const ms = retryAfterMsOf(httpError(503, { 'retry-after': future }));
      expect(ms).toBeGreaterThan(2000);
      expect(ms).toBeLessThanOrEqual(5000);
    });

    it('limita um cabecalho absurdo a 60s e ignora o que nao faz sentido', () => {
      expect(retryAfterMsOf(httpError(429, { 'retry-after': '86400' }))).toBe(60_000);
      expect(retryAfterMsOf(httpError(429, { 'retry-after': 'depois' }))).toBeNull();
      expect(retryAfterMsOf(httpError(429))).toBeNull();
      expect(retryAfterMsOf(new Error('sem resposta'))).toBeNull();
    });
  });
});

describe('Google Drive: retry apenas nas leituras', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    driveMocks.Drive.mockImplementation(function MockDrive() {
      return {
        files: {
          get: driveMocks.filesGet,
          list: driveMocks.filesList,
          create: driveMocks.filesCreate,
          update: driveMocks.filesUpdate,
        },
      };
    });
    setEnv();
  });

  afterEach(() => {
    vi.useRealTimers();
    restoreEnv();
  });

  it('LEITURA: um 503 transitorio nao derruba mais o sweep', async () => {
    driveMocks.filesList
      .mockRejectedValueOnce(httpError(503))
      .mockResolvedValueOnce({ data: { files: [{ id: 'brand-folder', name: 'Puket' }] } });

    const service = await loadDrive();

    await expect(service.findFolder('root-folder', 'Puket')).resolves.toBe('brand-folder');
    expect(driveMocks.filesList).toHaveBeenCalledTimes(2);
  });

  it('LEITURA: 403 falha na primeira tentativa — permissao nao melhora insistindo', async () => {
    driveMocks.filesList.mockRejectedValue(httpError(403));

    const service = await loadDrive();

    await expect(service.findFolder('root-folder', 'Puket')).rejects.toThrow('HTTP 403');
    expect(driveMocks.filesList).toHaveBeenCalledTimes(1);
  });

  /**
   * A guarda que importa. `files.create` nao e idempotente: se a primeira
   * chamada criou a pasta e so a resposta se perdeu, re-tentar cria uma
   * SEGUNDA pasta com o mesmo nome. Por isso escrita fica fora do retry, mesmo
   * diante de um 503 que seria re-tentavel numa leitura.
   */
  it('ESCRITA: files.create NAO e re-tentado, nem com 503', async () => {
    driveMocks.filesCreate.mockRejectedValue(httpError(503));

    const service = await loadDrive();

    await expect(service.createFolder('Puket')).rejects.toThrow('HTTP 503');
    expect(driveMocks.filesCreate).toHaveBeenCalledTimes(1);
  });

  it('ESCRITA: files.update (mover pasta) NAO e re-tentado', async () => {
    driveMocks.filesList.mockResolvedValue({
      data: { files: [{ id: 'algum-folder', name: 'x' }] },
    });
    driveMocks.filesUpdate.mockRejectedValue(httpError(503));

    const service = await loadDrive();

    await expect(service.moveToCorrection('PK2052602TJ', 'puket')).rejects.toThrow('HTTP 503');
    expect(driveMocks.filesUpdate).toHaveBeenCalledTimes(1);
  });

  /**
   * Sonda de health nao insiste: `/health/integrations` chama isto, e tres
   * tentativas de 30s transformariam o endpoint de diagnostico em 90s de
   * espera justamente quando o Drive esta inalcancavel.
   */
  it('testRootAccess (sonda de health) NAO re-tenta', async () => {
    driveMocks.filesGet.mockRejectedValue(httpError(503));

    const service = await loadDrive();

    await expect(service.testRootAccess()).resolves.toBe(false);
    expect(driveMocks.filesGet).toHaveBeenCalledTimes(1);
  });
});

describe('Google Drive: o timeout cancela a requisicao em voo', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    driveMocks.Drive.mockImplementation(function MockDrive() {
      return {
        files: {
          get: driveMocks.filesGet,
          list: driveMocks.filesList,
          create: driveMocks.filesCreate,
          update: driveMocks.filesUpdate,
        },
      };
    });
    setEnv();
  });

  afterEach(() => {
    vi.useRealTimers();
    restoreEnv();
  });

  /**
   * O `Promise.race` antigo abandonava a promessa e pronto: o cliente do Google
   * continuava esperando a resposta, segurando socket e custo. Agora o
   * `AbortSignal` chega ao cliente (`MethodOptions` estende `GaxiosOptions`,
   * que estende `RequestInit`) e a requisicao e de fato abortada.
   */
  it('aborta o signal entregue ao cliente quando estoura o timeout', async () => {
    let capturedSignal: AbortSignal | undefined;
    driveMocks.filesGet.mockImplementation((_params: unknown, options: { signal: AbortSignal }) => {
      capturedSignal = options.signal;
      // Como o gaxios/fetch de verdade: a requisicao fica pendurada ate alguem
      // abortar, e ai ela rejeita com AbortError.
      return new Promise((_resolve, reject) => {
        options.signal.addEventListener('abort', () =>
          reject(Object.assign(new Error('The operation was aborted'), { name: 'AbortError' })),
        );
      });
    });

    // O import fica fora dos fake timers: carregar modulo usa I/O real.
    const service = await loadDrive();
    vi.useFakeTimers();

    const pending = service.testRootAccess();
    await vi.advanceTimersByTimeAsync(0); // deixa o service chegar ate a chamada

    expect(capturedSignal).toBeInstanceOf(AbortSignal);
    expect(capturedSignal!.aborted).toBe(false);

    await vi.advanceTimersByTimeAsync(30_000);

    expect(capturedSignal!.aborted).toBe(true);
    await expect(pending).resolves.toBe(false);
  });

  /**
   * Garantia que o `Promise.race` antigo dava e nao pode ser perdida: se o
   * cliente ignorar o `signal`, o chamador ainda desiste no prazo em vez de
   * ficar pendurado para sempre.
   */
  it('desiste no prazo mesmo se o cliente ignorar o signal', async () => {
    driveMocks.filesGet.mockImplementation(() => new Promise(() => {}));

    const service = await loadDrive();
    vi.useFakeTimers();

    const pending = service.testRootAccess();
    await vi.advanceTimersByTimeAsync(30_000);

    await expect(pending).resolves.toBe(false);
  });
});

describe('Google Sheets: retry nas leituras do Follow Up', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sheetsMocks.Sheets.mockImplementation(function MockSheets() {
      return { spreadsheets: { values: { get: sheetsMocks.valuesGet } } };
    });
    setEnv();
  });

  afterEach(() => {
    vi.useRealTimers();
    restoreEnv();
  });

  it('um 503 no meio da allow-list nao vira "a planilha nao tem processos"', async () => {
    sheetsMocks.valuesGet
      .mockRejectedValueOnce(httpError(503))
      .mockResolvedValueOnce({ data: { values: [['PK2052602TJ']] } });

    const service = await loadSheets();

    await expect(service.readProcessReferences()).resolves.toEqual(['PK2052602TJ']);
    expect(sheetsMocks.valuesGet).toHaveBeenCalledTimes(2);
  });

  it('401 (credencial errada) falha de imediato, sem queimar tentativas', async () => {
    sheetsMocks.valuesGet.mockRejectedValue(httpError(401));

    const service = await loadSheets();

    await expect(service.readProcessReferences()).rejects.toThrow('HTTP 401');
    expect(sheetsMocks.valuesGet).toHaveBeenCalledTimes(1);
  });
});
