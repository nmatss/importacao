import { eq, and } from 'drizzle-orm';
import fs from 'fs/promises';
import pdfParse from 'pdf-parse';
import * as XLSX from 'xlsx';
import { db } from '../../shared/database/connection.js';
import { documents, importProcesses, followUpTracking } from '../../shared/database/schema.js';
import { aiService } from '../ai/service.js';
import { googleDriveService } from '../integrations/google-drive.service.js';
import { logger } from '../../shared/utils/logger.js';

export const documentService = {
  async upload(processId: number, type: string, file: Express.Multer.File) {
    const [doc] = await db.insert(documents).values({
      processId,
      type: type as any,
      originalFilename: file.originalname,
      storagePath: file.path,
      mimeType: file.mimetype,
      fileSize: file.size,
    }).returning();

    // Check if all 3 main documents exist → update status
    const processDocs = await db.select()
      .from(documents)
      .where(eq(documents.processId, processId));

    const hasInvoice = processDocs.some(d => d.type === 'invoice');
    const hasPL = processDocs.some(d => d.type === 'packing_list');
    const hasBL = processDocs.some(d => d.type === 'ohbl');

    if (hasInvoice && hasPL && hasBL) {
      await db.update(importProcesses)
        .set({ status: 'documents_received', updatedAt: new Date() })
        .where(eq(importProcesses.id, processId));

      await db.update(followUpTracking)
        .set({ documentsReceivedAt: new Date(), updatedAt: new Date() })
        .where(eq(followUpTracking.processId, processId));
    }

    // Trigger AI extraction in background
    this.processWithAI(doc.id, type).catch(err =>
      logger.error({ err, documentId: doc.id }, 'AI processing failed')
    );

    // Upload to Google Drive in background (non-blocking)
    this.uploadToDrive(doc.id, processId, type, file.path, file.originalname).catch(err =>
      logger.error({ err, documentId: doc.id }, 'Google Drive upload failed')
    );

    return doc;
  },

  async processWithAI(documentId: number, type: string) {
    const [doc] = await db.select().from(documents).where(eq(documents.id, documentId)).limit(1);
    if (!doc) return;

    const text = await this.extractText(doc.storagePath, doc.mimeType || '');

    let result;
    switch (type) {
      case 'invoice':
        result = await aiService.extractInvoiceData(text);
        break;
      case 'packing_list':
        result = await aiService.extractPackingListData(text);
        break;
      case 'ohbl':
        result = await aiService.extractBLData(text);
        break;
      default:
        return;
    }

    await db.update(documents)
      .set({
        aiParsedData: result.data,
        confidenceScore: String(result.confidenceScore),
        isProcessed: true,
        updatedAt: new Date(),
      })
      .where(eq(documents.id, documentId));

    // Update process AI extracted data
    await db.update(importProcesses)
      .set({
        aiExtractedData: { [type]: result.data },
        updatedAt: new Date(),
      })
      .where(eq(importProcesses.id, doc.processId));

    logger.info({ documentId, type, confidence: result.confidenceScore }, 'AI extraction completed');
  },

  async extractText(filePath: string, mimeType: string): Promise<string> {
    const buffer = await fs.readFile(filePath);

    if (mimeType === 'application/pdf') {
      const data = await pdfParse(buffer);
      return data.text;
    }

    if (mimeType?.includes('spreadsheet') || mimeType?.includes('excel') || filePath.endsWith('.xlsx') || filePath.endsWith('.xls')) {
      const workbook = XLSX.read(buffer, { type: 'buffer' });
      let text = '';
      for (const sheetName of workbook.SheetNames) {
        const sheet = workbook.Sheets[sheetName];
        text += XLSX.utils.sheet_to_csv(sheet) + '\n';
      }
      return text;
    }

    return buffer.toString('utf-8');
  },

  async getByProcess(processId: number) {
    return db.select().from(documents).where(eq(documents.processId, processId));
  },

  async getById(id: number) {
    const [doc] = await db.select().from(documents).where(eq(documents.id, id)).limit(1);
    if (!doc) throw new Error('Documento não encontrado');
    return doc;
  },

  async reprocess(documentId: number) {
    const [doc] = await db.select().from(documents).where(eq(documents.id, documentId)).limit(1);
    if (!doc) throw new Error('Documento não encontrado');

    await db.update(documents)
      .set({ isProcessed: false, aiParsedData: null, confidenceScore: null, updatedAt: new Date() })
      .where(eq(documents.id, documentId));

    await this.processWithAI(documentId, doc.type);
    return this.getById(documentId);
  },

  async delete(id: number) {
    const [doc] = await db.select().from(documents).where(eq(documents.id, id)).limit(1);
    if (!doc) throw new Error('Documento não encontrado');

    // Remove file from disk
    try {
      await fs.unlink(doc.storagePath);
    } catch {
      // File might already be gone
    }

    await db.delete(documents).where(eq(documents.id, id));
    return { id };
  },

  async uploadToDrive(documentId: number, processId: number, type: string, filePath: string, fileName: string) {
    const configured = await googleDriveService.isConfigured();
    if (!configured) return;

    const [process] = await db.select({
      processCode: importProcesses.processCode,
      brand: importProcesses.brand,
    })
      .from(importProcesses)
      .where(eq(importProcesses.id, processId))
      .limit(1);

    if (!process) return;

    const driveFileId = await googleDriveService.uploadToProcessFolder(
      process.processCode,
      process.brand,
      type,
      filePath,
      fileName,
    );

    await db.update(documents)
      .set({ driveFileId, updatedAt: new Date() })
      .where(eq(documents.id, documentId));

    logger.info({ documentId, driveFileId }, 'Document uploaded to Google Drive');
  },
};
