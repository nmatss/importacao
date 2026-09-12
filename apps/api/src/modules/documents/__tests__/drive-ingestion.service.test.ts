import fs from 'fs/promises';
import { logger } from '../../../shared/utils/logger.js';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createMockDb, createResolvedChain } from '../../../__tests__/helpers/mock-db.js';

const { mockDb, queryQueue } = createMockDb();

vi.mock('../../../shared/database/connection.js', () => ({ db: mockDb }));

vi.mock('../../../shared/utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../../shared/config/paths.js', () => ({ UPLOAD_DIR: '/tmp/uploads-test' }));

const mockListFolderEntries = vi.fn();
const mockDownloadFileBuffer = vi.fn();
const mockExportSpreadsheet = vi.fn();
const mockIsRootConfigured = vi.fn();
const mockBuildIndex = vi.fn();

vi.mock('../../integrations/google-drive.service.js', () => ({
  googleDriveService: {
    listFolderEntries: (...a: unknown[]) => mockListFolderEntries(...a),
    downloadFileBuffer: (...a: unknown[]) => mockDownloadFileBuffer(...a),
    exportSpreadsheetAsXlsx: (...a: unknown[]) => mockExportSpreadsheet(...a),
    isRootConfigured: (...a: unknown[]) => mockIsRootConfigured(...a),
    buildProcessFolderIndex: (...a: unknown[]) => mockBuildIndex(...a),
  },
}));

const mockUpload = vi.fn();
vi.mock('../service.js', () => ({
  documentService: { upload: (...a: unknown[]) => mockUpload(...a) },
}));

const mockGetFollowUpReferences = vi.fn();
vi.mock('../../follow-up/reference-registry.js', () => ({
  getReferenceSource: () =>
    process.env.PROCESS_REFERENCE_SOURCE === 'legacy' ? 'legacy' : 'follow_up',
  getFollowUpReferences: (...a: unknown[]) => mockGetFollowUpReferences(...a),
  normalizeReference: (value: string) => value.toUpperCase().replace(/[^A-Z0-9]/g, ''),
}));

vi.mock('fs/promises', () => ({
  default: {
    mkdir: vi.fn().mockResolvedValue(undefined),
    writeFile: vi.fn().mockResolvedValue(undefined),
    unlink: vi.fn().mockResolvedValue(undefined),
    realpath: vi.fn(async (value: string) => value),
    open: vi.fn(),
  },
}));

const {
  ingestProcessFromDrive,
  ingestAllProcessesFromDrive,
  getDriveSweepStatus,
  getDriveSweepStatusForProcess,
  __resetDriveSweepLock,
  __resetDriveSweepStatus,
  getDocumentSource,
  isDriveIngestionEnabled,
  isEmailIngestionEnabled,
  isManualDocumentUploadEnabled,
} = await import('../drive-ingestion.service.js');

const PROCESS = { id: 1, processCode: 'PK2192607SZ', brand: 'puket' };

const PDF = Buffer.from('%PDF-1.4 conteudo');

function areas() {
  return {
    pendentes: { id: 'pend', name: '04. PENDENTES DE CORREÇÃO' },
    espelhos: { id: 'esp', name: '01. ESPELHOS' },
    imaginarium: { id: 'img', name: '02. IMAGINARIUM' },
    puket: { id: 'puk', name: '03. PUKET' },
  };
}

function makeIndex(
  options: {
    pastas?: Array<{ folderId: string; area: string; path: string; name?: string }>;
    espelhos?: any[];
  } = {},
) {
  const byCode = new Map<string, any[]>();
  if (options.pastas?.length) {
    byCode.set(
      'PK2192607SZ',
      options.pastas.map((p) => ({
        folderId: p.folderId,
        name: p.name ?? 'PK2192607SZ',
        area: p.area,
        path: p.path,
        normalizedCode: 'PK2192607SZ',
      })),
    );
  }
  const espelhosByCode = new Map<string, any[]>();
  if (options.espelhos?.length) espelhosByCode.set('PK2192607SZ', options.espelhos);

  return {
    areas: areas(),
    byCode,
    espelhosByCode,
    unknownFolders: [],
    builtAt: new Date(),
  } as any;
}

/**
 * Tres consultas por processo: documentos, espelhos e tombstones.
 */
function estadoLimpo() {
  queryQueue.push(createResolvedChain([]));
  queryQueue.push(createResolvedChain([]));
  queryQueue.push(createResolvedChain([]));
}

describe('DOCUMENT_SOURCE', () => {
  beforeEach(() => {
    delete process.env.DOCUMENT_SOURCE;
    delete process.env.MANUAL_UPLOAD_ENABLED;
  });

  it('defaults to Drive-only as requested by the operation', () => {
    expect(getDocumentSource()).toBe('drive');
    expect(isDriveIngestionEnabled()).toBe(true);
    expect(isEmailIngestionEnabled()).toBe(false);
  });

  it('drive turns the e-mail path off and the Drive path on', () => {
    process.env.DOCUMENT_SOURCE = 'drive';
    expect(isDriveIngestionEnabled()).toBe(true);
    expect(isEmailIngestionEnabled()).toBe(false);
  });

  it('both keeps the two sources alive', () => {
    process.env.DOCUMENT_SOURCE = 'both';
    expect(isDriveIngestionEnabled()).toBe(true);
    expect(isEmailIngestionEnabled()).toBe(true);
  });

  it('falls back to Drive-only on an unknown value', () => {
    process.env.DOCUMENT_SOURCE = 'sharepoint';
    expect(getDocumentSource()).toBe('drive');
  });

  it('upload manual tem flag PROPRIA e continua ligado com o Drive como fonte', () => {
    // Em 11/09 o time dependeu do upload manual para os tres processos-piloto;
    // ate aqui DOCUMENT_SOURCE=drive devolvia 409 em POST /documents/upload.
    process.env.DOCUMENT_SOURCE = 'drive';
    expect(isManualDocumentUploadEnabled()).toBe(true);

    process.env.MANUAL_UPLOAD_ENABLED = 'false';
    expect(isManualDocumentUploadEnabled()).toBe(false);

    process.env.MANUAL_UPLOAD_ENABLED = '';
    expect(isManualDocumentUploadEnabled()).toBe(true);
  });
});

function legacyHandle(content: Buffer, size = content.length) {
  let offset = 0;
  return {
    stat: vi.fn(async () => ({ isFile: () => true, size, mtimeMs: 1 })),
    read: vi.fn(async (buffer: Buffer) => {
      const bytesRead = content.copy(buffer, 0, offset);
      offset += bytesRead;
      return { bytesRead, buffer };
    }),
    close: vi.fn().mockResolvedValue(undefined),
  };
}

describe('ingestProcessFromDrive()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryQueue.length = 0;
    mockUpload.mockResolvedValue({ id: 10 });
    vi.mocked(fs.realpath).mockImplementation(async (value: any) => value);
    vi.mocked(fs.open).mockReset();
    mockDownloadFileBuffer.mockResolvedValue(PDF);
    mockListFolderEntries.mockResolvedValue([]);
  });

  it.each([true, false])(
    'compara conteúdo legado sem hash; conteúdo idêntico=%s',
    async (identical) => {
      const handle = legacyHandle(identical ? PDF : Buffer.from('%PDF-1.4 legacy other'));
      vi.mocked(fs.open).mockResolvedValue(handle as any);
      mockListFolderEntries.mockResolvedValueOnce([
        { id: 'new-drive-id', name: 'invoice PK2192607SZ.pdf', mimeType: 'application/pdf' },
      ]);
      queryQueue.push(
        createResolvedChain([
          { id: 44, storagePath: '/tmp/uploads-test/legacy.pdf', contentSha256: null },
        ]),
        createResolvedChain([]),
        createResolvedChain([]),
      );
      const result = await ingestProcessFromDrive(
        PROCESS,
        makeIndex({ pastas: [{ folderId: 'p', area: 'puket', path: 'x' }] }),
      );
      expect(result.imported).toBe(identical ? 0 : 1);
      expect(mockUpload).toHaveBeenCalledTimes(identical ? 0 : 1);
      expect(handle.close).toHaveBeenCalledOnce();
      expect(mockDb.update).not.toHaveBeenCalled();
    },
  );

  it.each(['missing', 'outside', 'symlink', 'oversize'])(
    'hash legado indisponível %s é visível sem bloquear conteúdo novo',
    async (reason) => {
      const handle = legacyHandle(PDF, 26 * 1024 * 1024);
      vi.mocked(fs.open).mockResolvedValue(handle as any);
      let storagePath = '/tmp/uploads-test/legacy.pdf';
      if (reason === 'outside') storagePath = '/tmp/outside.pdf';
      if (reason === 'missing')
        vi.mocked(fs.realpath).mockRejectedValueOnce(
          Object.assign(new Error('private path'), { code: 'ENOENT' }),
        );
      if (reason === 'symlink')
        vi.mocked(fs.realpath).mockImplementation(async (value: any) =>
          value === storagePath ? '/tmp/outside.pdf' : value,
        );
      mockListFolderEntries.mockResolvedValueOnce([
        { id: 'new-drive-id', name: 'invoice PK2192607SZ.pdf', mimeType: 'application/pdf' },
      ]);
      queryQueue.push(
        createResolvedChain([{ id: 44, storagePath, contentSha256: null }]),
        createResolvedChain([]),
        createResolvedChain([]),
      );
      const result = await ingestProcessFromDrive(
        PROCESS,
        makeIndex({ pastas: [{ folderId: 'p', area: 'puket', path: 'x' }] }),
      );
      expect(result.imported).toBe(1);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ documentId: 44 }),
        'Legacy document hash unavailable — content dedupe incomplete',
      );
      expect(handle.read).not.toHaveBeenCalled();
      if (reason !== 'oversize') expect(fs.open).not.toHaveBeenCalled();
      else expect(handle.close).toHaveBeenCalledOnce();
      expect(mockDb.update).not.toHaveBeenCalled();
    },
  );

  it('importa o arquivo com a origem, o hash e a versao do Drive', async () => {
    mockListFolderEntries.mockResolvedValueOnce([
      {
        id: 'f1',
        name: 'KIOM INV - PK2192607SZ.pdf',
        mimeType: 'application/pdf',
        size: '2048',
        md5Checksum: 'md5-inv',
        version: '3',
        modifiedTime: '2026-08-07T10:00:00.000Z',
      },
    ]);
    estadoLimpo();

    const result = await ingestProcessFromDrive(
      PROCESS,
      makeIndex({ pastas: [{ folderId: 'p-219', area: 'puket', path: '03. PUKET/2027/HS/x' }] }),
    );

    expect(result.imported).toBe(1);
    expect(mockUpload).toHaveBeenCalledWith(
      1,
      'invoice',
      expect.objectContaining({ originalname: 'KIOM INV - PK2192607SZ.pdf' }),
      null,
      expect.objectContaining({
        driveFileId: 'f1',
        ingestionSource: 'drive',
        driveMd5: 'md5-inv',
        driveVersion: 3,
        driveArea: 'puket',
        contentSha256: expect.stringMatching(/^[0-9a-f]{64}$/),
      }),
    );
  });

  it.each(['KIOM INV - PK2202608SZ.pdf', 'invoice_PK2202608SZ_draft.pdf'])(
    'arquivo estrangeiro %s em PENDENTES nao suprime invoice correta',
    async (filename) => {
      mockListFolderEntries
        .mockResolvedValueOnce([
          {
            id: 'wrong',
            name: filename,
            mimeType: 'application/pdf',
            size: '10',
          },
        ])
        .mockResolvedValueOnce([
          {
            id: 'right',
            name: 'KIOM INV - PK2192607SZ.pdf',
            mimeType: 'application/pdf',
            size: '10',
          },
        ]);
      estadoLimpo();
      const result = await ingestProcessFromDrive(
        PROCESS,
        makeIndex({
          pastas: [
            { folderId: 'pending', area: 'pendentes', path: 'pendentes' },
            { folderId: 'brand', area: 'puket', path: 'puket' },
          ],
        }),
      );
      expect(result.imported).toBe(1);
      expect(mockDownloadFileBuffer).toHaveBeenCalledWith('right');
      expect(mockDownloadFileBuffer).not.toHaveBeenCalledWith('wrong');
      expect(result.ignored).toContainEqual(
        expect.objectContaining({
          name: filename,
          reason: expect.stringContaining('outro processo'),
        }),
      );
    },
  );

  it('mesmo ID e versao listados em duas pastas sao baixados apenas uma vez', async () => {
    const entry = {
      id: 'same-file',
      version: '7',
      name: 'invoice PK2192607SZ.pdf',
      mimeType: 'application/pdf',
    };
    mockListFolderEntries.mockResolvedValueOnce([entry]).mockResolvedValueOnce([entry]);
    mockDownloadFileBuffer
      .mockResolvedValueOnce(PDF)
      .mockResolvedValueOnce(Buffer.from('%PDF-1.4 changed during sweep'));
    estadoLimpo();
    const result = await ingestProcessFromDrive(
      PROCESS,
      makeIndex({
        pastas: [
          { folderId: 'p1', area: 'puket', path: 'a' },
          { folderId: 'p2', area: 'puket', path: 'b' },
        ],
      }),
    );
    expect(result.imported).toBe(1);
    expect(result.skipped).toBe(1);
    expect(mockDownloadFileBuffer).toHaveBeenCalledTimes(1);
    expect(mockUpload).toHaveBeenCalledTimes(1);
    mockDownloadFileBuffer.mockReset().mockResolvedValue(PDF);
  });

  it('PENDENTES vence POR TIPO e a pasta da marca completa os tipos ausentes', async () => {
    mockListFolderEntries
      .mockResolvedValueOnce([
        {
          id: 'pend-inv',
          name: 'KIOM INV - PK2192607SZ.pdf',
          mimeType: 'application/pdf',
          size: '10',
          md5Checksum: 'a',
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 'marca-inv',
          name: '2026.08.07 KIOM INV - PK2192607SZ.pdf',
          mimeType: 'application/pdf',
          size: '10',
          md5Checksum: 'b',
        },
        {
          id: 'marca-bl',
          name: 'PK2192607SZ OHBL COPY.pdf',
          mimeType: 'application/pdf',
          size: '10',
          md5Checksum: 'c',
        },
      ]);
    estadoLimpo();
    // Conteudos diferentes: aqui o que se testa e a prioridade por tipo, nao a
    // dedupe por conteudo.
    mockDownloadFileBuffer.mockImplementation(async (id: string) => Buffer.from(`%PDF-1.4 ${id}`));

    const result = await ingestProcessFromDrive(
      PROCESS,
      makeIndex({
        pastas: [
          { folderId: 'pend-a', area: 'pendentes', path: '04. PENDENTES/PK2192607SZ' },
          { folderId: 'p-219', area: 'puket', path: '03. PUKET/2027/HS/PK2192607SZ' },
        ],
      }),
    );

    const importados = mockUpload.mock.calls.map((c) => c[4].driveFileId);
    expect(importados).toEqual(['pend-inv', 'marca-bl']);
    expect(result.imported).toBe(2);
  });

  it('o mesmo arquivo em duas pastas do codigo entra uma vez so (md5)', async () => {
    const duplicado = {
      id: 'copia',
      name: 'KIOM INV - PK2192607SZ.pdf',
      mimeType: 'application/pdf',
      size: '10',
      md5Checksum: 'mesmo-md5',
    };
    mockListFolderEntries
      .mockResolvedValueOnce([{ ...duplicado, id: 'orig' }])
      .mockResolvedValueOnce([duplicado]);
    estadoLimpo();

    const result = await ingestProcessFromDrive(
      PROCESS,
      makeIndex({
        pastas: [
          { folderId: 'pend-a', area: 'pendentes', path: '04. PENDENTES/PK2192607SZ' },
          { folderId: 'pend-b', area: 'pendentes', path: '04. PENDENTES/PK2192607SZ' },
        ],
      }),
    );

    expect(result.imported).toBe(1);
    expect(mockDownloadFileBuffer).toHaveBeenCalledTimes(1);
  });

  it('arquivo com id novo e conteudo ja conhecido nao vira documento duplicado', async () => {
    // Arquivo copiado no Drive ganha id novo. Antes, a dedupe era so por
    // driveFileId: entrava como documento novo e pagava extracao de IA de novo.
    const { createHash } = await import('crypto');
    const sha = createHash('sha256').update(PDF).digest('hex');
    mockListFolderEntries.mockResolvedValueOnce([
      {
        id: 'novo-id',
        name: 'KIOM INV - PK2192607SZ.pdf',
        mimeType: 'application/pdf',
        size: '10',
      },
    ]);
    queryQueue.push(createResolvedChain([{ driveFileId: 'antigo', contentSha256: sha }]));
    queryQueue.push(createResolvedChain([]));
    queryQueue.push(createResolvedChain([]));

    const result = await ingestProcessFromDrive(
      PROCESS,
      makeIndex({ pastas: [{ folderId: 'p', area: 'puket', path: 'x' }] }),
    );

    expect(result.imported).toBe(0);
    expect(result.skipped).toBe(1);
    expect(mockUpload).not.toHaveBeenCalled();
  });

  it('documento excluido pelo analista NAO volta na varredura seguinte', async () => {
    // UIP-05 x DRV-05: sem consultar o tombstone, o sweep de 10 em 10 minutos
    // reabre o caso do rascunho anexado no processo errado.
    mockListFolderEntries.mockResolvedValueOnce([
      {
        id: 'excluido',
        name: 'RASCUNHO DUIMP - PK2192607SZ.pdf',
        mimeType: 'application/pdf',
        size: '10',
        md5Checksum: 'x',
      },
    ]);
    queryQueue.push(createResolvedChain([]));
    queryQueue.push(createResolvedChain([]));
    queryQueue.push(createResolvedChain([{ driveFileId: 'excluido', contentSha256: null }]));

    const result = await ingestProcessFromDrive(
      PROCESS,
      makeIndex({ pastas: [{ folderId: 'p', area: 'puket', path: 'x' }] }),
    );

    expect(result.imported).toBe(0);
    expect(mockUpload).not.toHaveBeenCalled();
    expect(result.ignored).toContainEqual({
      name: 'RASCUNHO DUIMP - PK2192607SZ.pdf',
      reason: 'documento excluido por um analista — nao volta pela varredura',
    });
  });

  it('conteudo identico ao de um documento excluido tambem nao volta', async () => {
    const { createHash } = await import('crypto');
    const sha = createHash('sha256').update(PDF).digest('hex');
    mockListFolderEntries.mockResolvedValueOnce([
      {
        id: 'outro-id',
        name: 'KIOM INV - PK2192607SZ.pdf',
        mimeType: 'application/pdf',
        size: '10',
      },
    ]);
    queryQueue.push(createResolvedChain([]));
    queryQueue.push(createResolvedChain([]));
    queryQueue.push(createResolvedChain([{ driveFileId: 'id-antigo', contentSha256: sha }]));

    const result = await ingestProcessFromDrive(
      PROCESS,
      makeIndex({ pastas: [{ folderId: 'p', area: 'puket', path: 'x' }] }),
    );

    expect(result.imported).toBe(0);
    expect(mockUpload).not.toHaveBeenCalled();
  });

  it('nao desce na subpasta Backup e nao importa a invoice antiga', async () => {
    mockListFolderEntries.mockResolvedValueOnce([
      {
        id: 'sub-backup',
        name: 'Backup',
        mimeType: 'application/vnd.google-apps.folder',
      },
      {
        id: 'inv-atual',
        name: '2026.08.20 KIOM INV - PK2192607SZ.pdf',
        mimeType: 'application/pdf',
        size: '10',
        md5Checksum: 'atual',
      },
    ]);
    estadoLimpo();

    const result = await ingestProcessFromDrive(
      PROCESS,
      makeIndex({
        pastas: [{ folderId: 'p-220', area: 'puket', path: '03. PUKET/2027/HS/PK220' }],
      }),
    );

    expect(result.imported).toBe(1);
    // Uma unica listagem: a subpasta de backup nunca foi aberta.
    expect(mockListFolderEntries).toHaveBeenCalledTimes(1);
    expect(result.ignored.some((i) => i.reason.includes('backup'))).toBe(true);
  });

  it('CT-e, manifesto e fatura de transporte nao viram documento `other`', async () => {
    mockListFolderEntries.mockResolvedValueOnce([
      { id: 'a', name: 'manistesto cte 5462.pdf', mimeType: 'application/pdf', size: '10' },
      { id: 'b', name: '2026.09.10 - FATURA2103.pdf', mimeType: 'application/pdf', size: '10' },
      { id: 'c', name: 'fat_138902_73839.pdf', mimeType: 'application/pdf', size: '10' },
    ]);
    estadoLimpo();

    const result = await ingestProcessFromDrive(
      PROCESS,
      makeIndex({ pastas: [{ folderId: 'p', area: 'puket', path: 'x' }] }),
    );

    expect(result.imported).toBe(0);
    expect(result.ignored).toHaveLength(3);
    expect(mockDownloadFileBuffer).not.toHaveBeenCalled();
  });

  it('espelho em Sheets nativo entra por export, como .xlsx', async () => {
    const XLSX = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x06, 0x00]);
    mockExportSpreadsheet.mockResolvedValue(XLSX);
    estadoLimpo();

    const result = await ingestProcessFromDrive(
      PROCESS,
      makeIndex({
        espelhos: [
          {
            fileId: 'esp-219',
            name: 'PK2192607SZ - Espelho',
            mimeType: 'application/vnd.google-apps.spreadsheet',
            nativo: true,
            md5: null,
            size: 33748,
            version: 12,
            modifiedTime: '2026-09-10T19:46:52.332Z',
            normalizedCode: 'PK2192607SZ',
          },
        ],
      }),
    );

    expect(mockExportSpreadsheet).toHaveBeenCalledWith('esp-219');
    expect(mockDownloadFileBuffer).not.toHaveBeenCalled();
    expect(result.imported).toBe(1);
    expect(mockUpload).toHaveBeenCalledWith(
      1,
      'espelho',
      expect.objectContaining({
        originalname: 'PK2192607SZ - Espelho.xlsx',
        mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      }),
      null,
      expect.objectContaining({ driveArea: 'espelhos', driveVersion: 12 }),
    );
  });

  it('espelho na ultima versao nao e reexportado mesmo com historico fora de ordem', async () => {
    queryQueue.push(
      createResolvedChain([
        { driveFileId: 'esp-219', driveVersion: 12 },
        { driveFileId: 'esp-219', driveVersion: 10 },
        { driveFileId: 'esp-219', driveVersion: null },
      ]),
    );
    queryQueue.push(createResolvedChain([]));
    queryQueue.push(createResolvedChain([]));

    const result = await ingestProcessFromDrive(
      PROCESS,
      makeIndex({
        espelhos: [
          {
            fileId: 'esp-219',
            name: 'PK2192607SZ - Espelho',
            mimeType: 'application/vnd.google-apps.spreadsheet',
            nativo: true,
            md5: null,
            size: 1,
            version: 12,
            modifiedTime: '2026-09-10T19:46:52.332Z',
            normalizedCode: 'PK2192607SZ',
          },
        ],
      }),
    );

    expect(mockExportSpreadsheet).not.toHaveBeenCalled();
    expect(result.skipped).toBe(1);
  });

  it('dois espelhos para o mesmo codigo: usa o primeiro e marca ambiguidade', async () => {
    mockExportSpreadsheet.mockResolvedValue(
      Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x06, 0x00]),
    );
    estadoLimpo();

    const espelho = (fileId: string, modifiedTime: string) => ({
      fileId,
      name: `${fileId} - Espelho`,
      mimeType: 'application/vnd.google-apps.spreadsheet',
      nativo: true,
      md5: null,
      size: 1,
      version: 1,
      modifiedTime,
      normalizedCode: 'PK2192607SZ',
    });

    const result = await ingestProcessFromDrive(
      PROCESS,
      makeIndex({
        espelhos: [
          espelho('recente', '2026-09-10T10:00:00.000Z'),
          espelho('antigo', '2026-09-01T10:00:00.000Z'),
        ],
      }),
    );

    expect(result.espelhoAmbiguo).toBe(true);
    expect(mockExportSpreadsheet).toHaveBeenCalledWith('recente');
  });

  it('rejeita arquivo cujo conteudo nao casa com a extensao declarada', async () => {
    mockListFolderEntries.mockResolvedValueOnce([
      { id: 'fake', name: 'invoice PK2192607SZ.pdf', mimeType: 'application/pdf', size: '16' },
    ]);
    mockDownloadFileBuffer.mockResolvedValueOnce(Buffer.from('not a real PDF'));
    estadoLimpo();

    const result = await ingestProcessFromDrive(
      PROCESS,
      makeIndex({ pastas: [{ folderId: 'p', area: 'puket', path: 'x' }] }),
    );

    expect(result).toMatchObject({ imported: 0, failed: 1 });
    expect(mockUpload).not.toHaveBeenCalled();
  });

  it('um arquivo ilegivel nao aborta o resto da pasta', async () => {
    mockListFolderEntries.mockResolvedValueOnce([
      { id: 'bad', name: 'KIOM INV - PK2192607SZ.pdf', mimeType: 'application/pdf', size: '10' },
      { id: 'good', name: 'KIOM PL - PK2192607SZ.pdf', mimeType: 'application/pdf', size: '10' },
    ]);
    estadoLimpo();
    mockDownloadFileBuffer.mockRejectedValueOnce(new Error('403')).mockResolvedValueOnce(PDF);

    const result = await ingestProcessFromDrive(
      PROCESS,
      makeIndex({ pastas: [{ folderId: 'p', area: 'puket', path: 'x' }] }),
    );

    expect(result.failed).toBe(1);
    expect(result.imported).toBe(1);
  });

  it('processo sem pasta devolve o motivo com as areas consultadas', async () => {
    const result = await ingestProcessFromDrive(PROCESS, makeIndex());

    expect(result.skippedReason).toContain('04. PENDENTES DE CORREÇÃO');
    expect(mockListFolderEntries).not.toHaveBeenCalled();
  });

  it('pula arquivo acima do limite sem baixar', async () => {
    process.env.DRIVE_INGESTION_MAX_FILE_BYTES = '1024';
    mockListFolderEntries.mockResolvedValueOnce([
      {
        id: 'big',
        name: 'KIOM INV - PK2192607SZ.pdf',
        mimeType: 'application/pdf',
        size: '999999',
      },
    ]);
    estadoLimpo();

    const result = await ingestProcessFromDrive(
      PROCESS,
      makeIndex({ pastas: [{ folderId: 'p', area: 'puket', path: 'x' }] }),
    );

    expect(result.skipped).toBe(1);
    expect(mockDownloadFileBuffer).not.toHaveBeenCalled();
    delete process.env.DRIVE_INGESTION_MAX_FILE_BYTES;
  });

  it('recusa bytes reais acima do limite mesmo com tamanho ausente na listagem', async () => {
    process.env.DRIVE_INGESTION_MAX_FILE_BYTES = '8';
    try {
      mockListFolderEntries.mockResolvedValueOnce([
        { id: 'changed', name: 'invoice PK2192607SZ.pdf', mimeType: 'application/pdf' },
      ]);
      mockDownloadFileBuffer.mockResolvedValueOnce(PDF);
      estadoLimpo();
      const result = await ingestProcessFromDrive(
        PROCESS,
        makeIndex({ pastas: [{ folderId: 'p', area: 'puket', path: 'x' }] }),
      );
      expect(result.skipped).toBe(1);
      expect(result.ignored[0]?.reason).toContain('conteudo baixado');
      expect(mockUpload).not.toHaveBeenCalled();
    } finally {
      delete process.env.DRIVE_INGESTION_MAX_FILE_BYTES;
    }
  });
});

describe('ingestAllProcessesFromDrive()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryQueue.length = 0;
    process.env.DOCUMENT_SOURCE = 'drive';
    mockIsRootConfigured.mockResolvedValue(true);
    mockListFolderEntries.mockResolvedValue([]);
    mockBuildIndex.mockResolvedValue(makeIndex());
    mockGetFollowUpReferences.mockResolvedValue({
      byNormalized: new Map([[PROCESS.processCode, PROCESS.processCode]]),
      fetchedAt: new Date(),
      stale: false,
    });
    __resetDriveSweepLock();
    __resetDriveSweepStatus();
  });

  afterEach(() => {
    delete process.env.DOCUMENT_SOURCE;
  });

  it('nao faz nada quando a raiz do Drive nao esta configurada', async () => {
    mockIsRootConfigured.mockResolvedValue(false);

    await expect(ingestAllProcessesFromDrive()).resolves.toEqual([]);
    expect(mockBuildIndex).not.toHaveBeenCalled();
    expect(getDriveSweepStatus()?.inactiveReason).toMatch(/GOOGLE_DRIVE_ROOT_FOLDER_ID/);
  });

  it('nao roda quando DOCUMENT_SOURCE nao inclui drive e diz por que', async () => {
    process.env.DOCUMENT_SOURCE = 'email';

    await expect(ingestAllProcessesFromDrive()).resolves.toEqual([]);
    expect(mockIsRootConfigured).not.toHaveBeenCalled();
    expect(getDriveSweepStatus()?.inactiveReason).toBe('Drive inativo: DOCUMENT_SOURCE=email');
  });

  it('falha fechado quando a lista do Follow Up esta indisponivel', async () => {
    mockGetFollowUpReferences.mockResolvedValue(null);

    await expect(ingestAllProcessesFromDrive()).resolves.toEqual([]);
    expect(mockDb.select).not.toHaveBeenCalled();
    expect(mockBuildIndex).not.toHaveBeenCalled();
  });

  it('ignora pastas de processos que nao constam no Follow Up', async () => {
    const foraDaPlanilha = { ...PROCESS, id: 2, processCode: 'PI7223Y' };
    queryQueue.push(createResolvedChain([PROCESS, foraDaPlanilha]));

    const results = await ingestAllProcessesFromDrive();

    expect(results[0]).toMatchObject({ processCode: PROCESS.processCode });
    expect(results[1]).toMatchObject({
      processCode: 'PI7223Y',
      skippedReason: 'process not listed in Follow Up',
    });
  });

  it('reporta pasta duplicada e pasta sem processo no sistema', async () => {
    const byCode = new Map<string, any[]>([
      [
        'PK2122607NB',
        [
          { folderId: 'a', name: 'PK2122607NB', area: 'pendentes', path: '04/PK2122607NB' },
          { folderId: 'b', name: 'PK2122607NB', area: 'pendentes', path: '04/PK2122607NB' },
        ],
      ],
    ]);
    mockBuildIndex.mockResolvedValue({
      areas: areas(),
      byCode,
      espelhosByCode: new Map(),
      unknownFolders: [],
      builtAt: new Date(),
    });
    queryQueue.push(createResolvedChain([PROCESS]));

    await ingestAllProcessesFromDrive();

    const status = getDriveSweepStatus()!;
    expect(status.duplicatedFolders).toEqual([
      { code: 'PK2122607NB', paths: ['04/PK2122607NB', '04/PK2122607NB'] },
    ]);
    // Codigo com pasta e sem processo: so alerta, nunca cria processo.
    expect(status.orphanFolders.map((o) => o.code)).toEqual(['PK2122607NB']);
    expect(status.areas).toEqual({
      pendentes: true,
      espelhos: true,
      imaginarium: true,
      puket: true,
    });
  });

  it('guarda o status por processo para a tela do processo', async () => {
    queryQueue.push(createResolvedChain([PROCESS]));

    await ingestAllProcessesFromDrive();

    const { process: status } = getDriveSweepStatusForProcess(PROCESS.id);
    expect(status?.processCode).toBe(PROCESS.processCode);
    expect(status?.skippedReason).toContain('nenhuma pasta encontrada no Drive');
    expect(status?.checkedAt).toBeTruthy();
  });

  it('pula o tick quando uma varredura anterior ainda esta rodando', async () => {
    queryQueue.push(createResolvedChain([PROCESS]));

    let sinalizarEntrada: () => void = () => {};
    const entrou = new Promise<void>((resolve) => {
      sinalizarEntrada = resolve;
    });
    let liberar: () => void = () => {};
    mockBuildIndex.mockImplementation(
      () =>
        new Promise((resolve) => {
          liberar = () => resolve(makeIndex());
          sinalizarEntrada();
        }),
    );

    const primeira = ingestAllProcessesFromDrive();
    try {
      await entrou;
      const segunda = await ingestAllProcessesFromDrive();

      expect(segunda).toEqual([]);
      expect(mockBuildIndex).toHaveBeenCalledTimes(1);
    } finally {
      liberar();
      await primeira;
    }
  });

  it('trava antes do preflight assíncrono e libera após falha', async () => {
    let rejectPreflight!: (reason: Error) => void;
    mockIsRootConfigured.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          rejectPreflight = reject;
        }),
    );
    const primeira = ingestAllProcessesFromDrive();
    const failed = expect(primeira).rejects.toThrow('Drive unavailable');
    expect(await ingestAllProcessesFromDrive()).toEqual([]);
    expect(mockIsRootConfigured).toHaveBeenCalledTimes(1);
    rejectPreflight(new Error('Drive unavailable'));
    await failed;
    mockIsRootConfigured.mockResolvedValueOnce(false);
    expect(await ingestAllProcessesFromDrive()).toEqual([]);
    expect(mockIsRootConfigured).toHaveBeenCalledTimes(2);
  });

  it('libera a trava depois de terminar, para o proximo tick rodar', async () => {
    queryQueue.push(createResolvedChain([PROCESS]));
    await ingestAllProcessesFromDrive();

    queryQueue.push(createResolvedChain([PROCESS]));
    await ingestAllProcessesFromDrive();

    expect(mockBuildIndex).toHaveBeenCalledTimes(2);
  });

  it('um processo que explode nao aborta a varredura inteira', async () => {
    queryQueue.push(
      createResolvedChain([PROCESS, { ...PROCESS, id: 2, processCode: 'PK2042602NB' }]),
    );
    mockBuildIndex.mockResolvedValue(
      makeIndex({ pastas: [{ folderId: 'p', area: 'puket', path: 'x' }] }),
    );
    mockListFolderEntries.mockRejectedValueOnce(new Error('Drive 500'));
    mockGetFollowUpReferences.mockResolvedValue({
      byNormalized: new Map([
        [PROCESS.processCode, PROCESS.processCode],
        ['PK2042602NB', 'PK2042602NB'],
      ]),
      fetchedAt: new Date(),
      stale: false,
    });

    const results = await ingestAllProcessesFromDrive();

    expect(results).toHaveLength(2);
    expect(results[0]!.failed).toBe(1);
    expect(results[1]!.failed).toBe(0);
  });
});
