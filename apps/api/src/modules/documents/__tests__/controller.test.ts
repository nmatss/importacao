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
