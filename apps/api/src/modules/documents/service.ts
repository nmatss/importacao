import { eq, and, desc } from 'drizzle-orm';
import fs from 'fs/promises';
import pdfParse from 'pdf-parse';
import * as XLSX from 'xlsx';
import { db } from '../../shared/database/connection.js';
import {
  documents,
  importProcesses,
  followUpTracking,
  emailIngestionLogs,
} from '../../shared/database/schema.js';
import { aiService } from '../ai/service.js';
import { alertService } from '../alerts/service.js';
import { googleDriveService } from '../integrations/google-drive.service.js';
import { logger } from '../../shared/utils/logger.js';
import { auditService } from '../audit/service.js';
import { assertTransition } from '../../shared/state-machine/process-states.js';
import type { ProcessStatus } from '../../shared/state-machine/process-states.js';
import { NotFoundError } from '../../shared/errors/index.js';

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
          type: type as any,
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
      if (currentProc) {
        assertTransition(currentProc.status as ProcessStatus, 'documents_received');
      }
      await db
        .update(importProcesses)
        .set({ status: 'documents_received', updatedAt: new Date() })
        .where(eq(importProcesses.id, processId));

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
      alertService
        .create({
          processId,
          severity: 'info',
          title: 'Documentos Completos',
          message: `Todos os 3 documentos recebidos para processo ${proc?.processCode ?? processId}.`,
          processCode: proc?.processCode,
        })
        .catch((err) => logger.error({ err }, 'Failed to create documents-received alert'));

      // Sync milestone to Follow-Up sheet
      if (proc?.processCode) {
        import('../integrations/google-sheets.service.js')
          .then(({ googleSheetsService }) => {
            googleSheetsService.syncMilestone(proc.processCode, 'documentsReceivedAt', new Date());
          })
          .catch(() => {});
      }
    }

    auditService.log(
      userId,
      'upload',
      'document',
      doc.id,
      { processId, type, filename: file.originalname },
      null,
    );

    // Trigger AI extraction in background
    this.processWithAI(doc.id, type).catch((err) =>
      logger.error({ err, documentId: doc.id }, 'AI processing failed'),
    );

    // For invoices, defer Drive upload to after AI processing to get standardized name
    if (type !== 'invoice') {
      this.uploadToDrive(doc.id, processId, type, file.path, file.originalname).catch((err) =>
        logger.error({ err, documentId: doc.id }, 'Google Drive upload failed'),
      );
    }

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
    const [currentProcess] = await db
      .select()
      .from(importProcesses)
      .where(eq(importProcesses.id, doc.processId))
      .limit(1);

    const existingAiData = (currentProcess?.aiExtractedData as Record<string, any>) ?? {};
    const mergedAiData = { ...existingAiData, [type]: result.data };

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

    // Auto-populate currency exchanges from invoice payment terms
    if (type === 'invoice' && result.data) {
      import('../currency-exchange/service.js')
        .then(({ currencyExchangeService }) => {
          currencyExchangeService
            .autoPopulate(doc.processId, result.data)
            .catch((err) =>
              logger.error(
                { err, processId: doc.processId },
                'Currency exchange auto-populate failed',
              ),
            );
        })
        .catch(() => {});
    }

    // Upload to Drive with standardized name after AI extraction
    if (type === 'invoice') {
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

  async extractText(filePath: string, mimeType: string): Promise<string> {
    const buffer = await fs.readFile(filePath);

    if (mimeType === 'application/pdf') {
      const data = await pdfParse(buffer);
      return data.text;
    }

    if (
      mimeType?.includes('spreadsheet') ||
      mimeType?.includes('excel') ||
      filePath.endsWith('.xlsx') ||
      filePath.endsWith('.xls')
    ) {
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
    return db
      .select()
      .from(documents)
      .where(eq(documents.processId, processId))
      .orderBy(desc(documents.createdAt));
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
      const attachments = log.processedAttachments as any[];
      if (Array.isArray(attachments)) {
        const match = attachments.some(
          (a: any) => a.filename === doc.originalFilename || a.documentId === doc.id,
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

    const inv = (invoiceDoc?.aiParsedData as Record<string, any>) ?? null;
    const pl = (plDoc?.aiParsedData as Record<string, any>) ?? null;
    const bl = (blDoc?.aiParsedData as Record<string, any>) ?? null;

    // Build aggregate field comparison
    const aggregateFields = [
      {
        label: 'Exportador / Shipper',
        inv: inv?.exporterName,
        pl: pl?.exporterName,
        bl: bl?.shipperName ?? bl?.shipper,
      },
      {
        label: 'Importador / Consignee',
        inv: inv?.importerName,
        pl: pl?.importerName,
        bl: bl?.consigneeName ?? bl?.consignee,
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
