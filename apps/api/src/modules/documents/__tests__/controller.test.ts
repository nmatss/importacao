import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';

const mocks = vi.hoisted(() => ({
  getFileResource: vi.fn(),
}));

vi.mock('../service.js', () => ({
  documentService: {
    getFileResource: mocks.getFileResource,
  },
}));

const { documentController, isActiveContent } = await import('../controller.js');
const { setDriveSweepStatus, __resetDriveSweepStatus } = await import('../drive-sweep-status.js');

function response(): Response {
  return {
    setHeader: vi.fn(),
    sendFile: vi.fn(),
    redirect: vi.fn(),
  } as unknown as Response;
}

describe('documentController.getFile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('forces active HTML content to download as octet-stream', async () => {
    mocks.getFileResource.mockResolvedValueOnce({
      kind: 'local',
      absolutePath: '/uploads/payload.html',
      filename: 'payload.html',
      mimeType: 'text/html',
    });
    const req = { params: { id: '10' }, query: {} } as unknown as Request;
    const res = response();

    await documentController.getFile(req, res);

    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'application/octet-stream');
    expect(res.setHeader).toHaveBeenCalledWith(
      'Content-Disposition',
      "attachment; filename*=UTF-8''payload.html",
    );
    expect(res.setHeader).toHaveBeenCalledWith('X-Content-Type-Options', 'nosniff');
    expect(res.sendFile).toHaveBeenCalledWith('/uploads/payload.html');
  });

  it('keeps safe documents inline unless download is requested', async () => {
    mocks.getFileResource.mockResolvedValueOnce({
      kind: 'local',
      absolutePath: '/uploads/invoice.pdf',
      filename: 'invoice.pdf',
      mimeType: 'application/pdf',
    });
    const req = { params: { id: '11' }, query: {} } as unknown as Request;
    const res = response();

    await documentController.getFile(req, res);

    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'application/pdf');
    expect(res.setHeader).toHaveBeenCalledWith(
      'Content-Disposition',
      "inline; filename*=UTF-8''invoice.pdf",
    );
    expect(res.setHeader).toHaveBeenCalledWith('X-Content-Type-Options', 'nosniff');
  });
});

describe('isActiveContent', () => {
  it('detects HTML by mime type or extension', () => {
    expect(isActiveContent('text/html', 'invoice.pdf')).toBe(true);
    expect(isActiveContent('application/octet-stream', 'payload.htm')).toBe(true);
    expect(isActiveContent('application/pdf', 'invoice.pdf')).toBe(false);
  });
});

/**
 * DRV-08: a tela do processo precisa conseguir dizer "o Drive olhou aqui e nao
 * achou nada", em vez de deixar o processo vazio sem explicacao — foi assim que
 * o PK220 chegou a reuniao de 11/09.
 */
describe('documentController.driveStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetDriveSweepStatus();
    delete process.env.DOCUMENT_SOURCE;
  });

  function jsonResponse() {
    const res = { json: vi.fn(), status: vi.fn() } as unknown as Response;
    (res.status as any).mockReturnValue(res);
    return res;
  }

  it('devolve a politica de fonte mesmo sem varredura nenhuma', async () => {
    const res = jsonResponse();

    await documentController.driveStatus({ params: { processId: '288' } } as any, res);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          varredura: null,
          processo: null,
          fonte: expect.objectContaining({ source: 'drive' }),
        }),
      }),
    );
  });

  it('devolve o resultado DESTE processo, com pastas e motivos', async () => {
    setDriveSweepStatus(
      {
        startedAt: '2026-09-11T12:00:00.000Z',
        finishedAt: '2026-09-11T12:01:00.000Z',
        areas: { pendentes: true, espelhos: true, imaginarium: true, puket: true },
        totals: { processes: 1, imported: 1, skipped: 2, failed: 0 },
        orphanFolders: [],
        duplicatedFolders: [],
      },
      [
        {
          processId: 288,
          processCode: 'PK2202608SZ',
          imported: 1,
          skipped: 2,
          failed: 0,
          folders: [
            {
              area: 'puket',
              path: '03. PUKET/2027/HIGH SUMMER/PK2202608SZ',
              folderId: 'p-220',
            },
          ],
          ignored: [{ name: 'fat_138902_73839.pdf', reason: 'arquivo fora do fluxo' }],
        },
      ],
    );
    const res = jsonResponse();

    await documentController.driveStatus({ params: { processId: '288' } } as any, res);

    const payload = (res.json as any).mock.calls[0][0].data;
    expect(payload.processo.folders[0].path).toBe('03. PUKET/2027/HIGH SUMMER/PK2202608SZ');
    expect(payload.processo.ignored[0].reason).toBe('arquivo fora do fluxo');
    expect(payload.processo.checkedAt).toBe('2026-09-11T12:01:00.000Z');
  });
});
