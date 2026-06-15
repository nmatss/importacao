import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextFunction, Request, Response } from 'express';

const mocks = vi.hoisted(() => ({
  fileTypeFromFile: vi.fn(),
  unlink: vi.fn(),
}));

vi.mock('file-type', () => ({
  fileTypeFromFile: mocks.fileTypeFromFile,
}));

vi.mock('node:fs/promises', () => ({
  default: { unlink: mocks.unlink },
}));

const { validateMagicBytes } = await import('../upload.js');

function file(overrides: Partial<Express.Multer.File>): Express.Multer.File {
  return {
    fieldname: 'file',
    originalname: 'document.pdf',
    encoding: '7bit',
    mimetype: 'application/pdf',
    size: 100,
    destination: '/tmp',
    filename: 'document.pdf',
    path: '/tmp/document.pdf',
    buffer: Buffer.alloc(0),
    stream: undefined as any,
    ...overrides,
  };
}

function response(): Response {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response;
}

describe('validateMagicBytes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.unlink.mockResolvedValue(undefined);
  });

  it('accepts XLSX files detected as zip containers', async () => {
    mocks.fileTypeFromFile.mockResolvedValueOnce({ mime: 'application/zip', ext: 'zip' });
    const req = {
      file: file({
        originalname: 'pre-cons.xlsx',
        mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        path: '/tmp/pre-cons.xlsx',
      }),
    } as Request;
    const res = response();
    const next = vi.fn() as NextFunction;

    await validateMagicBytes(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
    expect(mocks.unlink).not.toHaveBeenCalled();
  });

  it('rejects files whose magic bytes do not match the expected type', async () => {
    mocks.fileTypeFromFile.mockResolvedValueOnce({ mime: 'image/png', ext: 'png' });
    const req = {
      file: file({
        originalname: 'invoice.pdf',
        mimetype: 'application/pdf',
        path: '/tmp/invoice.pdf',
      }),
    } as Request;
    const res = response();
    const next = vi.fn() as NextFunction;

    await validateMagicBytes(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(mocks.unlink).toHaveBeenCalledWith('/tmp/invoice.pdf');
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: 'Tipo de arquivo incompatível para "invoice.pdf".',
    });
  });

  it('skips text-like formats that do not have reliable magic bytes', async () => {
    const req = {
      file: file({ originalname: 'items.csv', mimetype: 'text/csv', path: '/tmp/items.csv' }),
    } as Request;
    const res = response();
    const next = vi.fn() as NextFunction;

    await validateMagicBytes(req, res, next);

    expect(mocks.fileTypeFromFile).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledOnce();
  });
});
