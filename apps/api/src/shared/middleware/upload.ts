import path from 'node:path';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import multer from 'multer';
import { fileTypeFromFile } from 'file-type';
import type { Request, Response, NextFunction } from 'express';

const UPLOAD_DIR = 'uploads';
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB

const ALLOWED_MIMES = new Set([
  // PDF
  'application/pdf',
  // Excel
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
  'application/vnd.ms-excel', // .xls
  // Word
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
  'application/msword', // .doc
  // Images
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/tiff',
  'image/bmp',
  // Text / CSV / HTML
  'text/plain',
  'text/csv',
  'text/html',
  // Email
  'message/rfc822', // .eml
  'application/vnd.ms-outlook', // .msg
]);

// MIME types that file-type cannot detect (XML-based or text-based formats)
const SKIP_MAGIC_CHECK = new Set([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
  'text/plain',
  'text/csv',
  'text/html',
  'message/rfc822',
  'application/vnd.ms-outlook',
]);

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, UPLOAD_DIR);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    const name = crypto.randomUUID() + ext;
    cb(null, name);
  },
});

export const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIMES.has(file.mimetype)) {
      cb(null, true);
    } else {
      // Also allow by extension for common types that browsers may report differently
      const ext = path.extname(file.originalname).toLowerCase();
      const allowedExts = new Set([
        '.pdf',
        '.xlsx',
        '.xls',
        '.doc',
        '.docx',
        '.jpg',
        '.jpeg',
        '.png',
        '.gif',
        '.webp',
        '.tif',
        '.tiff',
        '.bmp',
        '.csv',
        '.txt',
        '.html',
        '.htm',
        '.eml',
        '.msg',
      ]);
      if (allowedExts.has(ext)) {
        cb(null, true);
      } else {
        cb(
          new Error(
            'Tipo de arquivo não permitido. Aceitos: PDF, Excel, Word, Imagens, CSV, TXT, HTML, EML.',
          ),
        );
      }
    }
  },
});

/**
 * Middleware that validates uploaded file magic bytes match the declared MIME type.
 * Must be used AFTER multer upload middleware.
 */
export async function validateMagicBytes(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const files: Express.Multer.File[] = [];

  if (req.file) {
    files.push(req.file);
  }
  if (req.files) {
    if (Array.isArray(req.files)) {
      files.push(...req.files);
    } else {
      for (const fieldFiles of Object.values(req.files)) {
        files.push(...fieldFiles);
      }
    }
  }

  for (const file of files) {
    if (SKIP_MAGIC_CHECK.has(file.mimetype)) {
      continue;
    }

    const detected = await fileTypeFromFile(file.path);

    if (detected && detected.mime !== file.mimetype) {
      // Clean up the rejected file
      await fs.unlink(file.path).catch(() => {});
      res.status(400).json({
        success: false,
        error: `File "${file.originalname}" magic bytes (${detected.mime}) do not match declared MIME type (${file.mimetype}).`,
      });
      return;
    }
  }

  next();
}
