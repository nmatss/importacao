import { eq, desc } from 'drizzle-orm';
import path from 'node:path';
import fs from 'fs/promises';
import pdfParse from 'pdf-parse';
import * as XLSX from 'xlsx';
import mammoth from 'mammoth';
import { db } from '../../shared/database/connection.js';
import {
  documents,
  importProcesses,
  followUpTracking,
  emailIngestionLogs,
} from '../../shared/database/schema.js';
import { aiService, flattenAiData } from '../ai/service.js';
import { alertService } from '../alerts/service.js';
import { googleDriveService } from '../integrations/google-drive.service.js';
import { logger } from '../../shared/utils/logger.js';
import { auditService } from '../audit/service.js';
import { assertTransition } from '../../shared/state-machine/process-states.js';
import type { ProcessStatus } from '../../shared/state-machine/process-states.js';
import { NotFoundError } from '../../shared/errors/index.js';
import { recordProcessEvent } from '../../shared/utils/process-events.js';

function standardizeDocumentName(
  type: string,
  processCode: string,
  aiData: Record<string, any> | null,
): string | null {
  if (type === 'invoice' && aiData) {
    const dateStr = aiData.invoiceDate || aiData.invoice_date;
    if (dateStr) {
      const formatted = String(dateStr).replace(/-/g, '.');
      return `${formatted} KIOM INV ${processCode}.pdf`;
    }
  }
  if (type === 'packing_list' && aiData) {
    const dateStr = aiData.invoiceDate || aiData.invoice_date;
    if (dateStr) {
      const formatted = String(dateStr).replace(/-/g, '.');
      return `${formatted} KIOM PL ${processCode}.pdf`;
    }
  }
  if (type === 'ohbl' && aiData) {
    const dateStr = aiData.shipmentDate || aiData.etd;
    if (dateStr) {
      const formatted = String(dateStr).replace(/-/g, '.');
      return `${formatted} KIOM BL ${processCode}.pdf`;
    }
  }
  if (type === 'draft_bl' && aiData) {
    const dateStr = aiData.shipmentDate || aiData.etd;
    if (dateStr) {
      const formatted = String(dateStr).replace(/-/g, '.');
      return `${formatted} KIOM DRAFT BL ${processCode}.pdf`;
    }
    return `DRAFT BL ${processCode}.pdf`;
  }
  if (type === 'certificate' && aiData) {
    const rawCertType =
      typeof aiData.certificateType === 'object'
        ? aiData.certificateType?.value
        : aiData.certificateType;
    const rawCertNumber =
      typeof aiData.certificateNumber === 'object'
        ? aiData.certificateNumber?.value
        : aiData.certificateNumber;
    const certType = rawCertType || 'CERT';
    const certNumber = rawCertNumber || '';
    return `CERT ${String(certType).toUpperCase()} ${certNumber ? certNumber + ' ' : ''}${processCode}.pdf`;
  }
  return null;
}

export const documentService = {
  async upload(
    processId: number,
    type: string,
    file: Express.Multer.File,
    userId: number | null = null,
  ) {
    let doc;
    try {
      [doc] = await db
        .insert(documents)
        .values({
          processId,
          type: type as (typeof documents.type.enumValues)[number],
          originalFilename: file.originalname,
          storagePath: file.path,
          mimeType: file.mimetype,
          fileSize: file.size,
        })
        .returning();
    } catch (error) {
      // Clean up the uploaded file if DB insert fails
      await fs.unlink(file.path).catch(() => {});
      throw error;
    }

    // Auto-set hasCertification when a certificate is uploaded
    if (type === 'certificate') {
      await db
        .update(importProcesses)
        .set({ hasCertification: true, updatedAt: new Date() })
        .where(eq(importProcesses.id, processId));
    }

    // Check if all 3 main documents exist → update status
    const processDocs = await db.select().from(documents).where(eq(documents.processId, processId));

    const hasInvoice = processDocs.some((d) => d.type === 'invoice');
    const hasPL = processDocs.some((d) => d.type === 'packing_list');
    const hasBL = processDocs.some((d) => d.type === 'ohbl');

    if (hasInvoice && hasPL && hasBL) {
      const [currentProc] = await db
        .select({ status: importProcesses.status })
        .from(importProcesses)
        .where(eq(importProcesses.id, processId))
        .limit(1);
      let canTransition = false;
      if (currentProc) {
        try {
          assertTransition(currentProc.status as ProcessStatus, 'documents_received');
          canTransition = true;
        } catch {
          // Process already past draft — skip status transition but continue upload
          logger.info(
            { processId, currentStatus: currentProc.status },
            'Skipping status transition: process already advanced past draft',
          );
        }
      }
      if (canTransition) {
        await db
          .update(importProcesses)
          .set({ status: 'documents_received', updatedAt: new Date() })
          .where(eq(importProcesses.id, processId));
      }

      await db
        .update(followUpTracking)
        .set({ documentsReceivedAt: new Date(), updatedAt: new Date() })
        .where(eq(followUpTracking.processId, processId));

      // Alert: all 3 documents received
      const [proc] = await db
        .select({ processCode: importProcesses.processCode })
        .from(importProcesses)
        .where(eq(importProcesses.id, processId))
        .limit(1);
      try {
        await alertService.create({
          processId,
          severity: 'info',
          title: 'Documentos Completos',
          message: `Todos os 3 documentos recebidos para processo ${proc?.processCode ?? processId}.`,
          processCode: proc?.processCode,
        });
      } catch (err) {
        logger.error({ err }, 'Failed to create documents-received alert');
      }

      // Sync milestone to Follow-Up sheet
      if (proc?.processCode) {
        try {
          const { googleSheetsService } = await import('../integrations/google-sheets.service.js');
          await googleSheetsService.syncMilestone(proc.processCode, 'documentsReceivedAt', new Date());
        } catch (err) {
          logger.error({ err, processCode: proc.processCode }, 'Failed to sync milestone to Sheets');
        }
      }
    }

    await auditService.log(
      userId,
      'upload',
      'document',
      doc.id,
      { processId, type, filename: file.originalname },
      null,
    );

    // Record timeline event
    await recordProcessEvent(
      processId,
      {
        eventType: 'document_uploaded',
        title: `Documento enviado: ${file.originalname}`,
        metadata: { type, documentId: doc.id, filename: file.originalname },
      },
      userId,
    );

    // Trigger AI extraction in background
    this.processWithAI(doc.id, type).catch((err) =>
      logger.error({ err, documentId: doc.id }, 'AI processing failed'),
    );

    // For invoices and certificates, defer Drive upload to after AI processing to get standardized name
    if (type !== 'invoice' && type !== 'certificate') {
      this.uploadToDrive(doc.id, processId, type, file.path, file.originalname).catch((err) =>
        logger.error({ err, documentId: doc.id }, 'Google Drive upload failed'),
      );
    }

    // Return mapped response matching frontend interface
    return {
      id: doc.id,
      processId: doc.processId,
      fileName: doc.originalFilename,
      documentType: doc.type,
      uploadedAt: doc.createdAt?.toISOString() ?? null,
      aiProcessingStatus: 'processing' as const,
      aiParsedData: null,
      aiConfidence: null,
      driveFileId: null,
    };
  },

  async processWithAI(documentId: number, type: string) {
    const [doc] = await db.select().from(documents).where(eq(documents.id, documentId)).limit(1);
    if (!doc) return;

    const extracted = await this.extractText(doc.storagePath, doc.mimeType || '');

    // Build extraction options with optional image data for multimodal processing
    const extractionOpts = extracted.imageBase64
      ? { imageBase64: extracted.imageBase64, imageMimeType: extracted.imageMimeType }
      : undefined;

    const text = extracted.text;

    let result;
    switch (type) {
      case 'invoice':
        result = await aiService.extractInvoiceData(text, extractionOpts);
        break;
      case 'packing_list':
        result = await aiService.extractPackingListData(text, extractionOpts);
        break;
      case 'ohbl':
        result = await aiService.extractBLData(text, extractionOpts);
        break;
      case 'draft_bl':
        result = await aiService.extractDraftBLData(text, extractionOpts);
        break;
      case 'certificate':
        result = await aiService.extractCertificateData(text, extractionOpts);
        break;
      default:
        return;
    }

    await db
      .update(documents)
      .set({
        aiParsedData: result.data,
        confidenceScore: String(result.confidenceScore),
        isProcessed: true,
        updatedAt: new Date(),
      })
      .where(eq(documents.id, documentId));

    // Merge AI extracted data with existing data (avoid overwriting other doc types)
    // Store FLATTENED data (plain values) in importProcesses for validation/comparison
    const [currentProcess] = await db
      .select()
      .from(importProcesses)
      .where(eq(importProcesses.id, doc.processId))
      .limit(1);

    const flatData = flattenAiData(result.data);
    const existingAiData = (currentProcess?.aiExtractedData as Record<string, any>) ?? {};
    const mergedAiData = { ...existingAiData, [type]: flatData };

    await db
      .update(importProcesses)
      .set({
        aiExtractedData: mergedAiData,
        updatedAt: new Date(),
      })
      .where(eq(importProcesses.id, doc.processId));

    logger.info(
      { documentId, type, confidence: result.confidenceScore },
      'AI extraction completed',
    );

    // Confidence score gate: alert on low-confidence extractions
    if (result.confidenceScore < 0.6) {
      const [proc] = await db
        .select({ processCode: importProcesses.processCode })
        .from(importProcesses)
        .where(eq(importProcesses.id, doc.processId))
        .limit(1);

      const severity = result.confidenceScore < 0.4 ? 'critical' : 'warning';
      const title =
        result.confidenceScore < 0.4
          ? 'Extração IA com Confiança Muito Baixa'
          : 'Extração IA com Confiança Baixa';

      alertService
        .create({
          processId: doc.processId,
          severity,
          title,
          message: `Documento ${type} do processo ${proc?.processCode ?? doc.processId} teve confiança de extração de ${(result.confidenceScore * 100).toFixed(0)}%. ${
            result.confidenceScore < 0.4
              ? 'Recomenda-se upload manual ou re-request ao fornecedor. Validação automática será suspensa.'
              : 'Recomenda-se revisão manual dos dados extraídos.'
          } Campos com baixa confiança: ${result.fieldsWithLowConfidence.join(', ') || 'N/A'}.`,
          processCode: proc?.processCode,
        })
        .catch((err) => logger.error({ err }, 'Failed to create low-confidence alert'));

      // Score < 0.4: still upload to Drive but skip validation and downstream processing
      if (result.confidenceScore < 0.4) {
        logger.warn(
          { documentId, type, confidence: result.confidenceScore },
          'Very low confidence - skipping auto-validation trigger',
        );

        // Upload to Drive with original name (can't trust AI data for standardization)
        if (type === 'invoice' || type === 'certificate') {
          this.uploadToDrive(
            doc.id,
            doc.processId,
            type,
            doc.storagePath,
            doc.originalFilename,
          ).catch((err) =>
            logger.error(
              { err, documentId: doc.id },
              'Google Drive upload failed (low confidence doc)',
            ),
          );
        }
        return;
      }
    }

    // Auto-populate currency exchanges from invoice payment terms
    if (type === 'invoice' && result.data) {
      try {
        const { currencyExchangeService } = await import('../currency-exchange/service.js');
        await currencyExchangeService.autoPopulate(doc.processId, result.data);
      } catch (err) {
        logger.error({ err, processId: doc.processId }, 'Currency exchange auto-populate failed');
      }
    }

    // Upload to Drive with standardized name after AI extraction
    if (type === 'invoice' || type === 'certificate') {
      const [proc] = await db
        .select({ processCode: importProcesses.processCode })
        .from(importProcesses)
        .where(eq(importProcesses.id, doc.processId))
        .limit(1);
      if (proc) {
        const standardName = standardizeDocumentName(type, proc.processCode, result.data);
        const fileName = standardName || doc.originalFilename;
        this.uploadToDrive(doc.id, doc.processId, type, doc.storagePath, fileName).catch((err) =>
          logger.error({ err, documentId: doc.id }, 'Google Drive upload failed'),
        );
      }
    }

    // Auto-trigger validation when all 3 doc types have AI data
    if (mergedAiData.invoice && mergedAiData.packing_list && mergedAiData.ohbl) {
      try {
        const { validationService } = await import('../validation/service.js');
        await validationService.runAllChecks(doc.processId);
        logger.info(
          { processId: doc.processId },
          'Auto-validation triggered after all 3 AI extractions completed',
        );
      } catch (valErr) {
        logger.error({ err: valErr, processId: doc.processId }, 'Auto-validation failed');
      }
    }
  },

  async extractText(
    filePath: string,
    mimeType: string,
  ): Promise<{ text: string; imageBase64?: string; imageMimeType?: string }> {
    const buffer = await fs.readFile(filePath);
    const ext = path.extname(filePath).toLowerCase();

    // ── Images: send as base64 for Gemini multimodal ──
    if (mimeType?.startsWith('image/')) {
      const base64 = buffer.toString('base64');
      return { text: '', imageBase64: base64, imageMimeType: mimeType };
    }

    // ── PDF ──
    if (mimeType === 'application/pdf' || ext === '.pdf') {
      const data = await pdfParse(buffer);
      const text = data.text?.trim() || '';

      // If PDF has very little text, it's likely a scanned image
      if (text.length < 50) {
        logger.info(
          { filePath, textLength: text.length },
          'PDF has minimal text, treating as scanned document for multimodal processing',
        );
        const base64 = buffer.toString('base64');
        return { text, imageBase64: base64, imageMimeType: 'application/pdf' };
      }
      return { text };
    }

    // ── Excel (XLSX/XLS) ──
    if (
      mimeType?.includes('spreadsheet') ||
      mimeType?.includes('excel') ||
      ext === '.xlsx' ||
      ext === '.xls'
    ) {
      const workbook = XLSX.read(buffer, { type: 'buffer' });
      let text = '';
      for (const sheetName of workbook.SheetNames) {
        const sheet = workbook.Sheets[sheetName];
        text += XLSX.utils.sheet_to_csv(sheet) + '\n';
      }
      return { text };
    }

    // ── Word (DOCX) ──
    if (
      mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
      ext === '.docx'
    ) {
      const result = await mammoth.extractRawText({ buffer });
      return { text: result.value };
    }

    // ── Word (DOC) — treat as binary, send to multimodal ──
    if (mimeType === 'application/msword' || ext === '.doc') {
      // Old .doc format: try as text first, fallback to multimodal
      const textAttempt = buffer.toString('utf-8');
      const readable = textAttempt.replace(/[^\x20-\x7E\n\r\t]/g, '').trim();
      if (readable.length > 100) {
        return { text: readable };
      }
      const base64 = buffer.toString('base64');
      return { text: '', imageBase64: base64, imageMimeType: 'application/msword' };
    }

    // ── CSV ──
    if (mimeType === 'text/csv' || ext === '.csv') {
      return { text: buffer.toString('utf-8') };
    }

    // ── HTML ──
    if (mimeType === 'text/html' || ext === '.html' || ext === '.htm') {
      const html = buffer.toString('utf-8');
      // Strip HTML tags, keep text content
      const text = html
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/\s+/g, ' ')
        .trim();
      return { text };
    }

    // ── EML (email files) ──
    if (mimeType === 'message/rfc822' || ext === '.eml') {
      // Extract readable text from email format
      const raw = buffer.toString('utf-8');
      // Find the body after headers (double newline)
      const bodyStart = raw.indexOf('\n\n');
      const body = bodyStart > 0 ? raw.substring(bodyStart + 2) : raw;
      // Strip any remaining HTML
      const text = body
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      return { text };
    }

    // ── TIFF / BMP — send as image for multimodal ──
    if (ext === '.tif' || ext === '.tiff' || ext === '.bmp') {
      const base64 = buffer.toString('base64');
      const mime = ext === '.bmp' ? 'image/bmp' : 'image/tiff';
      return { text: '', imageBase64: base64, imageMimeType: mime };
    }

    // ── Fallback: plain text ──
    return { text: buffer.toString('utf-8') };
  },

  async getByProcess(processId: number) {
    const rows = await db
      .select()
      .from(documents)
      .where(eq(documents.processId, processId))
      .orderBy(desc(documents.createdAt));

    return rows.map((row) => ({
      id: row.id,
      processId: row.processId,
      fileName: row.originalFilename,
      documentType: row.type,
      uploadedAt: row.createdAt?.toISOString() ?? null,
      aiProcessingStatus: row.isProcessed
        ? row.aiParsedData
          ? 'completed'
          : 'failed'
        : 'processing',
      aiParsedData: row.aiParsedData,
      aiConfidence: row.confidenceScore != null ? Number(row.confidenceScore) : null,
      driveFileId: row.driveFileId,
      storagePath: row.storagePath,
      mimeType: row.mimeType,
      fileSize: row.fileSize,
    }));
  },

  async getById(id: number) {
    const [doc] = await db.select().from(documents).where(eq(documents.id, id)).limit(1);
    if (!doc) throw new NotFoundError('Documento', id);
    return doc;
  },

  async getSource(id: number) {
    const [doc] = await db.select().from(documents).where(eq(documents.id, id)).limit(1);
    if (!doc) throw new NotFoundError('Documento', id);

    // Check if this document came from email ingestion
    const emailLogs = await db
      .select()
      .from(emailIngestionLogs)
      .where(eq(emailIngestionLogs.processId, doc.processId))
      .limit(10);

    for (const log of emailLogs) {
      type AttachmentEntry = { filename?: string; documentId?: number | null };
      const raw = log.processedAttachments as
        | AttachmentEntry[]
        | { attachments?: AttachmentEntry[] }
        | null;
      // Support both old format (direct array) and enriched format (object with .attachments)
      const attachments: AttachmentEntry[] | undefined = Array.isArray(raw)
        ? raw
        : (raw?.attachments ?? undefined);
      if (Array.isArray(attachments)) {
        const match = attachments.some(
          (a) => a.filename === doc.originalFilename || a.documentId === doc.id,
        );
        if (match) {
          return { source: 'email' as const, emailSubject: log.subject };
        }
      }
    }

    return { source: 'manual' as const };
  },

  async reprocess(documentId: number, userId: number | null = null) {
    const [doc] = await db.select().from(documents).where(eq(documents.id, documentId)).limit(1);
    if (!doc) throw new NotFoundError('Documento', documentId);

    await db
      .update(documents)
      .set({ isProcessed: false, aiParsedData: null, confidenceScore: null, updatedAt: new Date() })
      .where(eq(documents.id, documentId));

    auditService.log(userId, 'reprocess', 'document', documentId, { type: doc.type }, null);

    await this.processWithAI(documentId, doc.type);
    return this.getById(documentId);
  },

  async delete(id: number, userId: number | null = null) {
    const [doc] = await db.select().from(documents).where(eq(documents.id, id)).limit(1);
    if (!doc) throw new NotFoundError('Documento', id);

    // Remove file from disk
    try {
      await fs.unlink(doc.storagePath);
    } catch {
      // File might already be gone
    }

    await db.delete(documents).where(eq(documents.id, id));
    auditService.log(
      userId,
      'delete',
      'document',
      id,
      { processId: doc.processId, filename: doc.originalFilename },
      null,
    );
    return { id };
  },

  async uploadToDrive(
    documentId: number,
    processId: number,
    type: string,
    filePath: string,
    fileName: string,
  ) {
    const configured = await googleDriveService.isConfigured();
    if (!configured) return;

    const [process] = await db
      .select({
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

    await db
      .update(documents)
      .set({ driveFileId, updatedAt: new Date() })
      .where(eq(documents.id, documentId));

    logger.info({ documentId, driveFileId }, 'Document uploaded to Google Drive');
  },

  async getComparison(processId: number) {
    const docs = await db.select().from(documents).where(eq(documents.processId, processId));

    const invoiceDoc = docs.find((d) => d.type === 'invoice');
    const plDoc = docs.find((d) => d.type === 'packing_list');
    const blDoc = docs.find((d) => d.type === 'ohbl');

    // Flatten { value, confidence } structures to plain values for comparison
    const rawInv = (invoiceDoc?.aiParsedData as Record<string, any>) ?? null;
    const rawPl = (plDoc?.aiParsedData as Record<string, any>) ?? null;
    const rawBl = (blDoc?.aiParsedData as Record<string, any>) ?? null;

    const inv = rawInv ? flattenAiData(rawInv) : null;
    const pl = rawPl ? flattenAiData(rawPl) : null;
    const bl = rawBl ? flattenAiData(rawBl) : null;

    // Build aggregate field comparison
    const aggregateFields = [
      {
        label: 'Exportador / Shipper',
        inv: inv?.exporterName,
        pl: pl?.exporterName,
        bl: bl?.shipper ?? bl?.shipperName,
      },
      {
        label: 'Importador / Consignee',
        inv: inv?.importerName,
        pl: pl?.importerName,
        bl: bl?.consignee ?? bl?.consigneeName,
      },
      {
        label: 'Invoice Number',
        inv: inv?.invoiceNumber,
        pl: pl?.packingListNumber,
        bl: bl?.blNumber,
      },
      { label: 'Incoterm', inv: inv?.incoterm, pl: null, bl: null },
      { label: 'Moeda', inv: inv?.currency, pl: null, bl: bl?.freightCurrency },
      { label: 'Porto Embarque', inv: inv?.portOfLoading, pl: null, bl: bl?.portOfLoading },
      { label: 'Porto Destino', inv: inv?.portOfDischarge, pl: null, bl: bl?.portOfDischarge },
      { label: 'Total FOB (USD)', inv: inv?.totalFobValue, pl: null, bl: null },
      { label: 'Frete', inv: null, pl: null, bl: bl?.freightValue },
      { label: 'Total Caixas', inv: inv?.totalBoxes, pl: pl?.totalBoxes, bl: bl?.totalBoxes },
      { label: 'Peso Liquido (kg)', inv: inv?.totalNetWeight, pl: pl?.totalNetWeight, bl: null },
      {
        label: 'Peso Bruto (kg)',
        inv: inv?.totalGrossWeight,
        pl: pl?.totalGrossWeight,
        bl: bl?.totalGrossWeight,
      },
      { label: 'CBM (m3)', inv: inv?.totalCbm, pl: pl?.totalCbm, bl: bl?.totalCbm },
      { label: 'ETD / Shipped On Board', inv: null, pl: null, bl: bl?.shipmentDate ?? bl?.etd },
      { label: 'ETA', inv: null, pl: null, bl: bl?.eta },
      { label: 'Container', inv: null, pl: null, bl: bl?.containerNumber },
      { label: 'Navio', inv: null, pl: null, bl: bl?.vesselName },
    ];

    // Compute match status for each field
    const aggregateComparison = aggregateFields.map((f) => {
      const values = [f.inv, f.pl, f.bl].filter((v) => v != null && v !== '');
      const allSame =
        values.length <= 1 ||
        values.every((v) => {
          const s1 = String(values[0]).trim().toLowerCase();
          const s2 = String(v).trim().toLowerCase();
          if (s1 === s2) return true;
          const n1 = parseFloat(s1),
            n2 = parseFloat(s2);
          if (!isNaN(n1) && !isNaN(n2)) return Math.abs(n1 - n2) < 0.5;
          return false;
        });

      return {
        label: f.label,
        invoice: f.inv != null ? String(f.inv) : null,
        packingList: f.pl != null ? String(f.pl) : null,
        bl: f.bl != null ? String(f.bl) : null,
        status: values.length === 0 ? 'empty' : allSame ? 'match' : 'divergent',
      };
    });

    // Build item-level comparison
    const invItems = inv?.items ?? [];
    const plItems = pl?.items ?? [];

    const itemComparison = invItems.map((invItem: any) => {
      const plMatch = plItems.find(
        (plItem: any) =>
          plItem.itemCode === invItem.itemCode ||
          (plItem.description &&
            invItem.description &&
            plItem.description
              .toLowerCase()
              .includes(invItem.description.toLowerCase().slice(0, 20))),
      );

      return {
        itemCode: invItem.itemCode ?? invItem.codigo,
        description: invItem.description ?? invItem.descricao,
        ncm: invItem.ncmCode ?? invItem.ncm,
        invoiceQty: invItem.quantity,
        plQty: plMatch?.quantity ?? null,
        invoiceUnitPrice: invItem.unitPrice,
        invoiceTotal: invItem.totalPrice,
        invoiceBoxes: invItem.boxQuantity ?? null,
        plBoxes: plMatch?.boxQuantity ?? null,
        invoiceNetWeight: invItem.netWeight ?? null,
        plNetWeight: plMatch?.netWeight ?? null,
        invoiceGrossWeight: invItem.grossWeight ?? null,
        plGrossWeight: plMatch?.grossWeight ?? null,
        qtyMatch: plMatch ? plMatch.quantity === invItem.quantity : null,
        matched: !!plMatch,
      };
    });

    // Find PL items not matched in invoice
    const unmatchedPlItems = plItems
      .filter(
        (plItem: any) =>
          !invItems.some(
            (invItem: any) =>
              invItem.itemCode === plItem.itemCode ||
              (invItem.description &&
                plItem.description &&
                invItem.description
                  .toLowerCase()
                  .includes(plItem.description.toLowerCase().slice(0, 20))),
          ),
      )
      .map((item: any) => ({
        itemCode: item.itemCode ?? item.codigo,
        description: item.description ?? item.descricao,
        quantity: item.quantity,
        source: 'packing_list',
      }));

    return {
      hasInvoice: !!inv,
      hasPackingList: !!pl,
      hasBl: !!bl,
      aggregateComparison,
      itemComparison,
      unmatchedPlItems,
      invoiceConfidence: invoiceDoc?.confidenceScore,
      plConfidence: plDoc?.confidenceScore,
      blConfidence: blDoc?.confidenceScore,
    };
  },
};
