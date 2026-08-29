import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const driveMocks = vi.hoisted(() => ({
  filesGet: vi.fn(),
  filesList: vi.fn(),
  Drive: vi.fn(),
  GoogleAuth: vi.fn(),
}));

vi.mock('@googleapis/drive', () => ({
  auth: { GoogleAuth: driveMocks.GoogleAuth },
  drive_v3: { Drive: driveMocks.Drive },
}));

vi.mock('../../../shared/database/connection.js', () => ({ db: {} }));

vi.mock('../../../shared/utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const ENV_KEYS = [
  'GOOGLE_DRIVE_CLIENT_EMAIL',
  'GOOGLE_DRIVE_PRIVATE_KEY',
  'GOOGLE_DRIVE_ROOT_FOLDER_ID',
] as const;
const originalEnv = new Map(ENV_KEYS.map((key) => [key, process.env[key]]));

async function loadService() {
  vi.resetModules();
  return (await import('../google-drive.service.js')).googleDriveService;
}

describe('googleDriveService root health', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    driveMocks.Drive.mockImplementation(function MockDrive() {
      return { files: { get: driveMocks.filesGet, list: driveMocks.filesList } };
    });
    process.env.GOOGLE_DRIVE_CLIENT_EMAIL = 'service@example.test';
    process.env.GOOGLE_DRIVE_PRIVATE_KEY = 'test-key';
    process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID = 'root-folder';
  });

  it('finds the real shared-drive layout Marca/Importado/Processo Nº codigo', async () => {
    driveMocks.filesList.mockImplementation(({ q }: { q: string }) => {
      if (q.includes("'root-folder' in parents") && q.includes("name = 'Puket'")) {
        return Promise.resolve({ data: { files: [{ id: 'brand-folder', name: 'Puket' }] } });
      }
      if (q.includes("'brand-folder' in parents") && !q.includes('name =')) {
        return Promise.resolve({
          data: { files: [{ id: 'imported-folder', name: 'Importado' }] },
        });
      }
      if (
        q.includes("'imported-folder' in parents") &&
        q.includes("name = 'Processo Nº PK2052602TJ'")
      ) {
        return Promise.resolve({
          data: { files: [{ id: 'process-folder', name: 'Processo Nº PK2052602TJ' }] },
        });
      }
      return Promise.resolve({ data: { files: [] } });
    });
    const service = await loadService();

    await expect(service.findProcessFolder('PK2052602TJ', 'puket')).resolves.toBe('process-folder');
    // O segundo argumento (MethodOptions) passou a carregar o `signal` do
    // timeout — e o que de fato cancela a requisicao em voo.
    expect(driveMocks.filesList).toHaveBeenCalledWith(
      expect.objectContaining({
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
      }),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      const value = originalEnv.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('confirms an accessible, non-trashed folder without mutating Drive', async () => {
    driveMocks.filesGet.mockResolvedValue({
      data: { id: 'root-folder', mimeType: 'application/vnd.google-apps.folder', trashed: false },
    });
    const service = await loadService();

    await expect(service.testRootAccess()).resolves.toBe(true);
    expect(driveMocks.filesGet).toHaveBeenCalledWith(
      {
        fileId: 'root-folder',
        fields: 'id,mimeType,trashed',
        supportsAllDrives: true,
      },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('reports false when the configured folder is inaccessible', async () => {
    driveMocks.filesGet.mockRejectedValue(Object.assign(new Error('not found'), { code: 404 }));
    const service = await loadService();

    await expect(service.testRootAccess()).resolves.toBe(false);
  });

  it('does not call Drive when the root is missing or a placeholder', async () => {
    process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID = 'your-root-folder-id';
    const service = await loadService();

    await expect(service.testRootAccess()).resolves.toBe(false);
    expect(driveMocks.filesGet).not.toHaveBeenCalled();
  });
});

describe('Shared Drive: supportsAllDrives em toda chamada', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    driveMocks.Drive.mockImplementation(function MockDrive() {
      return { files: { get: driveMocks.filesGet, list: driveMocks.filesList } };
    });
    process.env.GOOGLE_DRIVE_CLIENT_EMAIL = 'service@example.test';
    process.env.GOOGLE_DRIVE_PRIVATE_KEY = 'test-key';
    process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID = 'root-folder';
  });

  it('downloadFileBuffer envia supportsAllDrives', async () => {
    // A pasta operacional fica num Shared Drive. Sem esta flag a API v3
    // responde 404 "File not found" — a listagem funcionava (ja tinha a flag) e
    // TODO download falhava, o que faria o rollout Drive-only entregar zero
    // documento com o sweep aparentemente saudavel.
    driveMocks.filesGet.mockResolvedValue({ data: new ArrayBuffer(4) });

    const service = await loadService();
    await service.downloadFileBuffer('file-123');

    expect(driveMocks.filesGet).toHaveBeenCalledWith(
      expect.objectContaining({ fileId: 'file-123', alt: 'media', supportsAllDrives: true }),
      expect.objectContaining({ responseType: 'arraybuffer' }),
    );
  });

  it('nenhuma chamada da API do Drive fica sem a flag', async () => {
    // Guarda estatica: qualquer `files.create/get/update/list` novo precisa
    // declarar `supportsAllDrives`. Esta asercao e o que impede a regressao,
    // porque a maioria dessas chamadas so falha contra um Shared Drive real.
    const { readFile } = await import('node:fs/promises');
    const source = await readFile(new URL('../google-drive.service.ts', import.meta.url), 'utf-8');

    const calls = [...source.matchAll(/drive\.files\.(create|get|update|list)\(/g)];
    expect(calls.length).toBeGreaterThan(0);

    const semFlag: string[] = [];
    for (const match of calls) {
      const start = match.index ?? 0;
      // Recorta o argumento da chamada equilibrando parenteses.
      let depth = 0;
      let end = start;
      for (let i = source.indexOf('(', start); i < source.length; i += 1) {
        if (source[i] === '(') depth += 1;
        else if (source[i] === ')') {
          depth -= 1;
          if (depth === 0) {
            end = i;
            break;
          }
        }
      }
      const snippet = source.slice(start, end + 1);
      if (!snippet.includes('supportsAllDrives')) {
        semFlag.push(`${match[0]} em torno do offset ${start}`);
      }
    }

    expect(semFlag).toEqual([]);
  });

  it('listagens que percorrem pastas tambem pedem itens de shared drive', async () => {
    const { readFile } = await import('node:fs/promises');
    const source = await readFile(new URL('../google-drive.service.ts', import.meta.url), 'utf-8');
    const listCalls = source.split('drive.files.list(').length - 1;
    const includeFlags = source.split('includeItemsFromAllDrives: true').length - 1;
    expect(includeFlags).toBe(listCalls);
  });
});
