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

/**
 * Aceitacao do indice contra o GABARITO real (arvore lida pela conta de servico
 * em 11/09/2026). A fixture e sintetica, mas reproduz cada formato de nome que
 * derrubava o finder antigo.
 */
describe('buildProcessFolderIndex — gabarito da pasta PROCESSOS', () => {
  const FOLDER = 'application/vnd.google-apps.folder';
  let fixture: any;
  let referencias: Set<string>;

  beforeEach(async () => {
    vi.clearAllMocks();
    const { readFile } = await import('node:fs/promises');
    fixture = JSON.parse(
      await readFile(
        new URL('../../documents/__tests__/fixtures/drive-tree.fixture.json', import.meta.url),
        'utf-8',
      ),
    );
    const { normalizeReference } = await import('../../follow-up/reference-registry.js');
    referencias = new Set<string>(
      (fixture.referencias as string[]).map((code) => normalizeReference(code)),
    );

    driveMocks.Drive.mockImplementation(function MockDrive() {
      return { files: { get: driveMocks.filesGet, list: driveMocks.filesList } };
    });
    driveMocks.filesList.mockImplementation(({ q }: { q: string }) => {
      const parent = /'([^']+)' in parents/.exec(q)?.[1] ?? '';
      const somentePastas = q.includes(`mimeType = '${FOLDER}'`);
      const filhos = (fixture.tree[parent] ?? []).map((entry: any) => ({
        ...entry,
        mimeType: entry.mimeType === 'folder' ? FOLDER : entry.mimeType,
      }));
      return Promise.resolve({
        data: { files: somentePastas ? filhos.filter((f: any) => f.mimeType === FOLDER) : filhos },
      });
    });

    process.env.GOOGLE_DRIVE_CLIENT_EMAIL = 'service@example.test';
    process.env.GOOGLE_DRIVE_PRIVATE_KEY = 'test-key';
    process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID = 'root';
    delete process.env.GOOGLE_DRIVE_PENDENTES_FOLDER_ID;
    delete process.env.GOOGLE_DRIVE_ESPELHOS_FOLDER_ID;
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      const value = originalEnv.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('resolve as 4 areas pelo nome acentuado e com prefixo numerico', async () => {
    const service = await loadService();
    const areas = await service.resolveDriveAreas();

    expect(areas.pendentes?.name).toBe('04. PENDENTES DE CORREÇÃO');
    expect(areas.espelhos?.name).toBe('01. ESPELHOS');
    expect(areas.imaginarium?.name).toBe('02. IMAGINARIUM');
    expect(areas.puket?.name).toBe('03. PUKET');
  });

  it('acha o processo na colecao do ANO DA PASTA, nao no ano do codigo', async () => {
    // PK2192607SZ e PK2202608SZ ficam em 03. PUKET/2027/HIGH SUMMER: o ano da
    // pasta e o da COLECAO. Filtrar pelo ano do codigo perderia os dois.
    const service = await loadService();
    const index = await service.buildProcessFolderIndex(referencias);

    expect(index.byCode.get('PK2192607SZ')?.map((f) => f.path)).toEqual(
      expect.arrayContaining(['03. PUKET/2027/HIGH SUMMER/PK2192607SZ']),
    );
    expect(index.byCode.get('PK2202608SZ')?.map((f) => f.path)).toEqual([
      '03. PUKET/2027/HIGH SUMMER/PK2202608SZ',
    ]);
  });

  it('le as DUAS pastas do codigo duplicado em PENDENTES', async () => {
    const service = await loadService();
    const index = await service.buildProcessFolderIndex(referencias);

    // O finder antigo usava pageSize: 1 e via so uma delas, sem criterio.
    expect(index.byCode.get('PK2122607NB')).toHaveLength(2);
  });

  it('aceita processo solto no ano, colecao com espaco no fim e codigo com hifen', async () => {
    const service = await loadService();
    const index = await service.buildProcessFolderIndex(referencias);

    expect(index.byCode.get('PK2072602NB')?.[0]?.path).toBe('03. PUKET/2026/PK2072602NB');
    expect(index.byCode.get('PK2112606SZ')?.[0]?.path).toBe(
      '03. PUKET/2026/HIGH SUMMER - 26/PK2112606SZ',
    );
    expect(index.byCode.has('PKT0032BDSEA')).toBe(true);
  });

  it('cobre as grafias de FAT e o sufixo/espaco no nome da pasta Imaginarium', async () => {
    const service = await loadService();
    const index = await service.buildProcessFolderIndex(referencias);

    expect(index.byCode.get('IM0752606NB')?.[0]?.path).toBe(
      '02. IMAGINARIUM/2026/FAT - 08/IM0752606NB',
    );
    expect(index.byCode.get('IM0802611NB')?.[0]?.path).toBe(
      '02. IMAGINARIUM/2026/FAT 11/IM0802611NB ',
    );
    expect(index.byCode.get('IM0112407NB')?.[0]?.path).toBe(
      '02. IMAGINARIUM/2026/FAT-06/IM0112407NB - Licença de importação',
    );
  });

  it('ignora nome legado curto e reporta a pasta sem codigo conhecido', async () => {
    const service = await loadService();
    const index = await service.buildProcessFolderIndex(referencias);

    expect([...index.byCode.keys()]).not.toContain('2080SZ');
    expect(index.unknownFolders.map((f) => f.name)).toEqual(
      expect.arrayContaining(['2080_SZ', '2066_SZB', 'Documentos avulsos']),
    );
  });

  it('casa o espelho nativo e o .xlsx, e exclui consolidado e "antigo com erro"', async () => {
    const service = await loadService();
    const index = await service.buildProcessFolderIndex(referencias);

    expect(index.espelhosByCode.get('PK2192607SZ')?.[0]).toMatchObject({
      fileId: 'esp-219',
      nativo: true,
    });
    expect(index.espelhosByCode.get('PK2202608SZ')?.map((e) => e.fileId)).toEqual(['esp-220-xlsx']);
    const todos = [...index.espelhosByCode.values()].flat().map((e) => e.fileId);
    expect(todos).not.toContain('esp-cons-puk');
    expect(todos).not.toContain('esp-cons-img');
    expect(todos).not.toContain('esp-220-antigo');
  });

  it('o ID explicito da area vence a busca por nome', async () => {
    process.env.GOOGLE_DRIVE_PENDENTES_FOLDER_ID = 'pend-override';
    const service = await loadService();

    const areas = await service.resolveDriveAreas();
    expect(areas.pendentes?.id).toBe('pend-override');
  });

  it('nao escreve nada no Drive para montar o indice', async () => {
    const filesCreate = vi.fn();
    const filesUpdate = vi.fn();
    driveMocks.Drive.mockImplementation(function MockDrive() {
      return {
        files: {
          get: driveMocks.filesGet,
          list: driveMocks.filesList,
          create: filesCreate,
          update: filesUpdate,
        },
      };
    });
    const service = await loadService();

    await service.buildProcessFolderIndex(referencias);

    expect(filesCreate).not.toHaveBeenCalled();
    expect(filesUpdate).not.toHaveBeenCalled();
  });
});

describe('DRIVE_WRITE_MODE — integracao somente leitura', () => {
  const filesCreate = vi.fn();
  const filesUpdate = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    driveMocks.Drive.mockImplementation(function MockDrive() {
      return {
        files: {
          get: driveMocks.filesGet,
          list: driveMocks.filesList,
          create: filesCreate,
          update: filesUpdate,
        },
      };
    });
    driveMocks.filesList.mockResolvedValue({ data: { files: [{ id: 'algum', name: 'algum' }] } });
    driveMocks.filesGet.mockResolvedValue({
      data: { id: 'root-folder', mimeType: 'application/vnd.google-apps.folder', trashed: false },
    });
    process.env.GOOGLE_DRIVE_CLIENT_EMAIL = 'service@example.test';
    process.env.GOOGLE_DRIVE_PRIVATE_KEY = 'test-key';
    process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID = 'root-folder';
    process.env.DOCUMENT_SOURCE = 'drive';
    delete process.env.DRIVE_WRITE_MODE;
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      const value = originalEnv.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    delete process.env.DOCUMENT_SOURCE;
    delete process.env.DRIVE_WRITE_MODE;
  });

  it('com o Drive como fonte, nenhuma escrita chega a PROCESSOS', async () => {
    // A pasta e o acervo da operacao. Antes desta guarda, a validacao reprovada
    // MOVIA a pasta do processo e todo upload criava 'Puket/<codigo>/...'
    // dentro dela assim que a raiz apontasse para PROCESSOS.
    const service = await loadService();

    await service.moveToCorrection('PK2192607SZ', 'puket');
    await service.moveFromCorrection('PK2192607SZ', 'puket');
    await service.moveFromInboxToProcessados('file-1', 'PK2192607SZ', 'invoice');
    await expect(
      service.uploadToProcessFolder('PK2192607SZ', 'puket', 'ohbl', '/tmp/x.pdf', 'x.pdf'),
    ).resolves.toBeNull();
    await expect(service.uploadToSistemaInbox('/tmp/x.pdf', 'x.pdf')).resolves.toBeNull();
    await expect(service.uploadValidationReport('PK2192607SZ', {})).resolves.toBeNull();
    await expect(service.uploadToAlertas('a.json', '{}')).resolves.toBeNull();

    expect(filesCreate).not.toHaveBeenCalled();
    expect(filesUpdate).not.toHaveBeenCalled();
  });

  it('createFolder e uploadFile lancam em vez de criar quando a escrita esta off', async () => {
    const service = await loadService();

    await expect(service.createFolder('Puket', 'root-folder')).rejects.toThrow(
      /DRIVE_WRITE_MODE=off/,
    );
    await expect(service.uploadFile('/tmp/x.pdf', 'x.pdf', 'root-folder')).rejects.toThrow(
      /DRIVE_WRITE_MODE=off/,
    );
    expect(filesCreate).not.toHaveBeenCalled();
  });

  it('DOCUMENT_SOURCE=email mantem a escrita historica do sistema', async () => {
    process.env.DOCUMENT_SOURCE = 'email';
    filesCreate.mockResolvedValue({ data: { id: 'novo' } });
    const service = await loadService();

    await expect(service.createFolder('00. SISTEMA AUTOMATICO', 'root-folder')).resolves.toBe(
      'novo',
    );
  });

  it('o token pede escopo somente leitura quando a escrita esta desligada', async () => {
    const service = await loadService();
    await service.testRootAccess();

    expect(driveMocks.GoogleAuth).toHaveBeenCalledWith(
      expect.objectContaining({ scopes: ['https://www.googleapis.com/auth/drive.readonly'] }),
    );
  });

  it('guarda estatica: toda escrita passa pela verificacao de modo', async () => {
    // O risco nao e o codigo de hoje, e o proximo `files.create` que alguem
    // acrescentar sem lembrar que a pasta e do time.
    const { readFile } = await import('node:fs/promises');
    const source = await readFile(new URL('../google-drive.service.ts', import.meta.url), 'utf-8');

    const semGuarda: string[] = [];
    for (const match of source.matchAll(/drive\.files\.(create|update)\(/g)) {
      const inicioChamada = match.index ?? 0;
      const inicioMetodo = source.slice(0, inicioChamada).lastIndexOf('\n  async ');
      const corpo = source.slice(inicioMetodo, inicioChamada);
      if (!corpo.includes('isDriveWriteEnabled()') && !corpo.includes('writeBlocked(')) {
        semGuarda.push(
          `${match[0]} em ${source.slice(inicioMetodo + 3, inicioMetodo + 40).trim()}`,
        );
      }
    }

    expect(semGuarda).toEqual([]);
  });
});

describe('exportSpreadsheetAsXlsx', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.GOOGLE_DRIVE_CLIENT_EMAIL = 'service@example.test';
    process.env.GOOGLE_DRIVE_PRIVATE_KEY = 'test-key';
    process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID = 'root-folder';
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      const value = originalEnv.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('espelho em Sheets nativo sai por files.export, nao por alt=media', async () => {
    // `alt=media` num arquivo nativo devolve erro: era por isso que 316 dos 376
    // espelhos eram simplesmente pulados pela ingestao.
    const filesExport = vi.fn().mockResolvedValue({ data: new ArrayBuffer(8) });
    driveMocks.Drive.mockImplementation(function MockDrive() {
      return {
        files: { get: driveMocks.filesGet, list: driveMocks.filesList, export: filesExport },
      };
    });
    const service = await loadService();

    const buffer = await service.exportSpreadsheetAsXlsx('esp-219');

    expect(buffer).toHaveLength(8);
    expect(filesExport).toHaveBeenCalledWith(
      {
        fileId: 'esp-219',
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      },
      expect.objectContaining({ responseType: 'arraybuffer' }),
    );
    expect(driveMocks.filesGet).not.toHaveBeenCalled();
  });
});
