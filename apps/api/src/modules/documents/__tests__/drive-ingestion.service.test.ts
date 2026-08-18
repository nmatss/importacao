import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createMockDb, createResolvedChain } from '../../../__tests__/helpers/mock-db.js';

const { mockDb, queryQueue } = createMockDb();

vi.mock('../../../shared/database/connection.js', () => ({ db: mockDb }));

vi.mock('../../../shared/utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../../shared/config/paths.js', () => ({ UPLOAD_DIR: '/tmp/uploads-test' }));

const mockListProcessFiles = vi.fn();
const mockDownloadFileBuffer = vi.fn();
const mockFindProcessFolder = vi.fn();
const mockIsRootConfigured = vi.fn();

vi.mock('../../integrations/google-drive.service.js', () => ({
  googleDriveService: {
    listProcessFiles: (...a: unknown[]) => mockListProcessFiles(...a),
    downloadFileBuffer: (...a: unknown[]) => mockDownloadFileBuffer(...a),
    findProcessFolder: (...a: unknown[]) => mockFindProcessFolder(...a),
    isRootConfigured: (...a: unknown[]) => mockIsRootConfigured(...a),
  },
}));

const mockUpload = vi.fn();
vi.mock('../service.js', () => ({
  documentService: { upload: (...a: unknown[]) => mockUpload(...a) },
}));

vi.mock('fs/promises', () => ({
  default: {
    mkdir: vi.fn().mockResolvedValue(undefined),
    writeFile: vi.fn().mockResolvedValue(undefined),
    unlink: vi.fn().mockResolvedValue(undefined),
  },
}));

const {
  ingestProcessFromDrive,
  ingestAllProcessesFromDrive,
  __resetDriveSweepLock,
  getDocumentSource,
  isDriveIngestionEnabled,
  isEmailIngestionEnabled,
} = await import('../drive-ingestion.service.js');

const PROCESS = {
  id: 1,
  processCode: 'IM0712602NB',
  brand: 'imaginarium',
  driveFolderId: 'folder-1',
};

/**
 * Two dedupe lookups happen per process when there are candidates: `documents`
 * first, then `espelhos`.
 */
function noKnownDocuments() {
  queryQueue.push(createResolvedChain([]));
  queryQueue.push(createResolvedChain([]));
}

describe('DOCUMENT_SOURCE', () => {
  beforeEach(() => {
    delete process.env.DOCUMENT_SOURCE;
  });

  it('defaults to email so nothing changes until the team opts in', () => {
    expect(getDocumentSource()).toBe('email');
    expect(isDriveIngestionEnabled()).toBe(false);
    expect(isEmailIngestionEnabled()).toBe(true);
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

  it('falls back to email on an unknown value instead of ingesting nothing', () => {
    process.env.DOCUMENT_SOURCE = 'sharepoint';
    expect(getDocumentSource()).toBe('email');
  });
});

describe('ingestProcessFromDrive()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryQueue.length = 0;
    mockUpload.mockResolvedValue({ id: 10 });
    mockDownloadFileBuffer.mockResolvedValue(Buffer.from('%PDF-1.4 conteudo'));
  });

  it('imports a supported file and tags it with the Drive file id', async () => {
    mockListProcessFiles.mockResolvedValue([
      { id: 'f1', name: 'invoice IM0712602NB.pdf', mimeType: 'application/pdf', size: '2048' },
    ]);
    noKnownDocuments();

    const result = await ingestProcessFromDrive(PROCESS);

    expect(result.imported).toBe(1);
    expect(mockUpload).toHaveBeenCalledWith(
      1,
      'invoice',
      expect.objectContaining({ originalname: 'invoice IM0712602NB.pdf' }),
      null,
      { driveFileId: 'f1' },
    );
  });

  it('does not re-import a file already ingested for the process', async () => {
    mockListProcessFiles.mockResolvedValue([
      { id: 'f1', name: 'invoice.pdf', mimeType: 'application/pdf', size: '2048' },
    ]);
    queryQueue.push(createResolvedChain([{ driveFileId: 'f1' }]));
    queryQueue.push(createResolvedChain([]));

    const result = await ingestProcessFromDrive(PROCESS);

    expect(result.imported).toBe(0);
    expect(result.skipped).toBe(1);
    expect(mockUpload).not.toHaveBeenCalled();
  });

  it('does not re-import an espelho the system itself published to the folder', async () => {
    // O espelho vai para a subpasta "Espelho" da MESMA pasta do processo, mas o
    // driveFileId dele mora em `espelhos`. Conferindo so `documents`, cada
    // espelho publicado voltava como documento novo.
    mockListProcessFiles.mockResolvedValue([
      {
        id: 'esp1',
        name: 'espelho_IM0712602NB.xlsx',
        mimeType: 'application/vnd.ms-excel',
        size: '5120',
      },
    ]);
    queryQueue.push(createResolvedChain([]));
    queryQueue.push(createResolvedChain([{ driveFileId: 'esp1' }]));

    const result = await ingestProcessFromDrive(PROCESS);

    expect(result.imported).toBe(0);
    expect(result.skipped).toBe(1);
    expect(mockUpload).not.toHaveBeenCalled();
  });

  it('skips folders and Google-native files rather than downloading an error page', async () => {
    mockListProcessFiles.mockResolvedValue([
      { id: 'd1', name: 'Invoice', mimeType: 'application/vnd.google-apps.folder' },
      { id: 'd2', name: 'Notas', mimeType: 'application/vnd.google-apps.document' },
    ]);
    noKnownDocuments();

    const result = await ingestProcessFromDrive(PROCESS);

    expect(result.imported).toBe(0);
    expect(result.skipped).toBe(2);
    expect(mockDownloadFileBuffer).not.toHaveBeenCalled();
  });

  it('skips a file over the size limit', async () => {
    process.env.DRIVE_INGESTION_MAX_FILE_BYTES = '1024';
    mockListProcessFiles.mockResolvedValue([
      { id: 'big', name: 'scan.pdf', mimeType: 'application/pdf', size: '999999' },
    ]);
    noKnownDocuments();

    const result = await ingestProcessFromDrive(PROCESS);

    expect(result.skipped).toBe(1);
    expect(mockDownloadFileBuffer).not.toHaveBeenCalled();
    delete process.env.DRIVE_INGESTION_MAX_FILE_BYTES;
  });

  it('one unreadable file does not abort the rest of the folder', async () => {
    mockListProcessFiles.mockResolvedValue([
      { id: 'bad', name: 'a.pdf', mimeType: 'application/pdf', size: '10' },
      { id: 'good', name: 'b.pdf', mimeType: 'application/pdf', size: '10' },
    ]);
    noKnownDocuments();
    mockDownloadFileBuffer
      .mockRejectedValueOnce(new Error('403'))
      .mockResolvedValueOnce(Buffer.from('ok'));

    const result = await ingestProcessFromDrive(PROCESS);

    expect(result.failed).toBe(1);
    expect(result.imported).toBe(1);
  });

  it('resolves the folder by brand/code when the process has none stored', async () => {
    mockFindProcessFolder.mockResolvedValue('found-folder');
    mockListProcessFiles.mockResolvedValue([]);

    const result = await ingestProcessFromDrive({ ...PROCESS, driveFolderId: null });

    expect(mockFindProcessFolder).toHaveBeenCalledWith('IM0712602NB', 'imaginarium');
    expect(mockListProcessFiles).toHaveBeenCalledWith('found-folder');
    expect(result.skippedReason).toBeUndefined();
  });

  it('reports a process with no Drive folder instead of creating one', async () => {
    mockFindProcessFolder.mockResolvedValue(null);

    const result = await ingestProcessFromDrive({ ...PROCESS, driveFolderId: null });

    expect(result.skippedReason).toBe('process has no Drive folder');
    expect(mockListProcessFiles).not.toHaveBeenCalled();
  });
});

describe('ingestAllProcessesFromDrive()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryQueue.length = 0;
    process.env.DOCUMENT_SOURCE = 'drive';
    mockIsRootConfigured.mockResolvedValue(true);
    __resetDriveSweepLock();
  });

  afterEach(() => {
    delete process.env.DOCUMENT_SOURCE;
  });

  it('nao faz nada quando a raiz do Drive nao esta configurada', async () => {
    mockIsRootConfigured.mockResolvedValue(false);

    await expect(ingestAllProcessesFromDrive()).resolves.toEqual([]);
    expect(mockListProcessFiles).not.toHaveBeenCalled();
  });

  it('nao roda quando DOCUMENT_SOURCE nao inclui drive', async () => {
    process.env.DOCUMENT_SOURCE = 'email';

    await expect(ingestAllProcessesFromDrive()).resolves.toEqual([]);
    expect(mockIsRootConfigured).not.toHaveBeenCalled();
  });

  it('pula o tick quando uma varredura anterior ainda esta rodando', async () => {
    // A varredura e sequencial sobre todos os processos e pode passar dos 10
    // minutos do cron. Duas passadas concorrentes correriam entre o SELECT de
    // dedupe e o INSERT, e o mesmo arquivo entraria duas vezes.
    queryQueue.push(createResolvedChain([PROCESS]));

    let sinalizarEntrada: () => void = () => {};
    const entrou = new Promise<void>((resolve) => {
      sinalizarEntrada = resolve;
    });
    let liberar: () => void = () => {};
    mockListProcessFiles.mockImplementation(
      () =>
        new Promise((resolve) => {
          liberar = () => resolve([]);
          sinalizarEntrada();
        }),
    );

    const primeira = ingestAllProcessesFromDrive();
    try {
      // Espera a primeira varredura estar comprovadamente DENTRO do trecho
      // protegido, em vez de contar microtasks — contar tick e frágil.
      await entrou;

      const segunda = await ingestAllProcessesFromDrive();

      expect(segunda).toEqual([]);
      expect(mockListProcessFiles).toHaveBeenCalledTimes(1);
    } finally {
      // Sempre libera, mesmo se a asserção falhar: senão a trava vaza para os
      // casos seguintes e eles falham por contaminação, escondendo a causa.
      liberar();
      await primeira;
    }
  });

  it('libera a trava depois de terminar, para o proximo tick rodar', async () => {
    queryQueue.push(createResolvedChain([PROCESS]));
    mockListProcessFiles.mockResolvedValue([]);
    await ingestAllProcessesFromDrive();

    queryQueue.push(createResolvedChain([PROCESS]));
    await ingestAllProcessesFromDrive();

    expect(mockListProcessFiles).toHaveBeenCalledTimes(2);
  });

  it('um processo que explode nao aborta a varredura inteira', async () => {
    queryQueue.push(
      createResolvedChain([PROCESS, { ...PROCESS, id: 2, processCode: 'PK2042602NB' }]),
    );
    mockListProcessFiles.mockRejectedValueOnce(new Error('Drive 500')).mockResolvedValueOnce([]);

    const results = await ingestAllProcessesFromDrive();

    expect(results).toHaveLength(2);
    expect(results[0].failed).toBe(1);
    expect(results[1].failed).toBe(0);
  });
});
