import * as XLSX from 'xlsx';
import fs from 'fs/promises';
import path from 'node:path';
import { eq, desc, and, sql } from 'drizzle-orm';
import { db } from '../../shared/database/connection.js';
import {
  espelhos,
  processItems,
  documents,
  importProcesses,
  followUpTracking,
} from '../../shared/database/schema.js';
import { generatePuketSheet } from './templates/puket.template.js';
import { generateImaginariumSheet } from './templates/imaginarium.template.js';
import { logger } from '../../shared/utils/logger.js';
import { auditService } from '../audit/service.js';

const UPLOAD_DIR = 'uploads';

// NCM chapters that typically require LI (import license)
const LI_NCM_PREFIXES = [
  '39', // Plastics
  '42', // Leather articles
  '61', // Knitted apparel
  '62', // Non-knitted apparel
  '63', // Textile articles
  '64', // Footwear
  '65', // Headgear
  '85', // Electrical machinery
  '95', // Toys/games
];

export const espelhoService = {
  async generate(processId: number, userId: number | null = null) {
    const [process] = await db
      .select()
      .from(importProcesses)
      .where(eq(importProcesses.id, processId))
      .limit(1);

    if (!process) throw new Error('Processo nao encontrado');

    let items = await db
      .select()
      .from(processItems)
      .where(eq(processItems.processId, processId));

    if (items.length === 0) {
      items = await this.autoPopulateItems(processId);
    }

    if (items.length === 0) {
      throw new Error('Nenhum item encontrado para gerar o espelho');
    }

    const ws =
      process.brand === 'puket'
        ? generatePuketSheet(items)
        : generateImaginariumSheet(items);

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Espelho');

    // Determine version
    const existing = await db
      .select()
      .from(espelhos)
      .where(
        and(eq(espelhos.processId, processId), eq(espelhos.isPartial, false)),
      )
      .orderBy(desc(espelhos.version));

    const nextVersion = existing.length > 0 ? (existing[0].version ?? 0) + 1 : 1;

    const filename = `espelho_${process.processCode}_v${nextVersion}.xlsx`;
    await fs.mkdir(UPLOAD_DIR, { recursive: true });
    const filePath = path.join(UPLOAD_DIR, filename);
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    await fs.writeFile(filePath, buffer);

    const [espelho] = await db
      .insert(espelhos)
      .values({
        processId,
        brand: process.brand,
        version: nextVersion,
        isPartial: false,
        generatedData: {
          filename,
          filePath,
          itemCount: items.length,
          generatedAt: new Date().toISOString(),
        },
      })
      .returning();

    // Update process status and follow-up
    await db
      .update(importProcesses)
      .set({ status: 'espelho_generated', updatedAt: new Date() })
      .where(eq(importProcesses.id, processId));

    await db
      .update(followUpTracking)
      .set({ espelhoGeneratedAt: new Date(), updatedAt: new Date() })
      .where(eq(followUpTracking.processId, processId));

    auditService.log(userId, 'generate', 'espelho', espelho.id, { processId, version: nextVersion, itemCount: items.length }, null);

    logger.info(
      { processId, espelhoId: espelho.id, version: nextVersion },
      'Espelho generated',
    );

    return espelho;
  },

  async autoPopulateItems(processId: number) {
    const invoiceDocs = await db
      .select()
      .from(documents)
      .where(
        and(
          eq(documents.processId, processId),
          eq(documents.type, 'invoice'),
          eq(documents.isProcessed, true),
        ),
      );

    if (invoiceDocs.length === 0) return [];

    const doc = invoiceDocs[0];
    const parsed = doc.aiParsedData as any;
    if (!parsed?.items || !Array.isArray(parsed.items)) return [];

    const itemsToInsert = parsed.items.map((raw: any) => {
      const unitPrice = Number(raw.unitPrice || raw.unit_price || 0);
      const qty = Number(raw.quantity || raw.qty || 0);
      const desc = String(raw.description || '');

      const isFoc =
        unitPrice === 0 ||
        /\bfoc\b/i.test(desc) ||
        /\bfree\s*(of\s*charge)?\b/i.test(desc);

      const ncm = String(raw.ncmCode || raw.ncm_code || raw.ncm || '');
      const ncmPrefix = ncm.replace(/\D/g, '').substring(0, 2);
      const requiresLi = LI_NCM_PREFIXES.includes(ncmPrefix);

      return {
        processId,
        itemCode: raw.itemCode || raw.item_code || raw.code || null,
        description: raw.description || null,
        color: raw.color || null,
        size: raw.size || null,
        ncmCode: ncm || null,
        unitPrice: unitPrice ? String(unitPrice) : null,
        quantity: qty || null,
        totalPrice: unitPrice && qty ? String(Math.round(unitPrice * qty * 100) / 100) : null,
        boxQuantity: Number(raw.boxQuantity || raw.box_quantity || raw.boxes || 0) || null,
        netWeight: raw.netWeight || raw.net_weight || null,
        grossWeight: raw.grossWeight || raw.gross_weight || null,
        isFreeOfCharge: isFoc,
        requiresLi,
        requiresCertification: false,
      };
    });

    if (itemsToInsert.length === 0) return [];

    const inserted = await db
      .insert(processItems)
      .values(itemsToInsert)
      .returning();

    // Update process flags
    const hasLi = inserted.some((i) => i.requiresLi);
    const hasFoc = inserted.some((i) => i.isFreeOfCharge);

    await db
      .update(importProcesses)
      .set({
        hasLiItems: hasLi,
        hasFreeOfCharge: hasFoc,
        updatedAt: new Date(),
      })
      .where(eq(importProcesses.id, processId));

    logger.info(
      { processId, count: inserted.length },
      'Auto-populated process items from invoice AI data',
    );

    return inserted;
  },

  async getItems(processId: number) {
    return db
      .select()
      .from(processItems)
      .where(eq(processItems.processId, processId));
  },

  async updateItem(itemId: number, data: any) {
    const updateData: Record<string, any> = {};
    const allowedFields = [
      'itemCode',
      'description',
      'color',
      'size',
      'ncmCode',
      'unitPrice',
      'quantity',
      'boxQuantity',
      'netWeight',
      'grossWeight',
      'isFreeOfCharge',
      'requiresLi',
      'requiresCertification',
    ];

    for (const field of allowedFields) {
      if (data[field] !== undefined) {
        updateData[field] = data[field];
      }
    }

    // Recalculate total price if unit price or quantity changed
    if (updateData.unitPrice !== undefined || updateData.quantity !== undefined) {
      const [existing] = await db
        .select()
        .from(processItems)
        .where(eq(processItems.id, itemId))
        .limit(1);

      if (existing) {
        const price = Number(updateData.unitPrice ?? existing.unitPrice) || 0;
        const qty = updateData.quantity ?? existing.quantity ?? 0;
        updateData.totalPrice = String(Math.round(price * qty * 100) / 100);
      }
    }

    const [updated] = await db
      .update(processItems)
      .set(updateData)
      .where(eq(processItems.id, itemId))
      .returning();

    if (!updated) throw new Error('Item nao encontrado');
    return updated;
  },

  async addItem(processId: number, data: any) {
    const unitPrice = Number(data.unitPrice) || 0;
    const qty = Number(data.quantity) || 0;

    const [item] = await db
      .insert(processItems)
      .values({
        processId,
        itemCode: data.itemCode || null,
        description: data.description || null,
        color: data.color || null,
        size: data.size || null,
        ncmCode: data.ncmCode || null,
        unitPrice: unitPrice ? String(unitPrice) : null,
        quantity: qty || null,
        totalPrice: unitPrice && qty ? String(Math.round(unitPrice * qty * 100) / 100) : null,
        boxQuantity: Number(data.boxQuantity) || null,
        netWeight: data.netWeight || null,
        grossWeight: data.grossWeight || null,
        isFreeOfCharge: data.isFreeOfCharge ?? false,
        requiresLi: data.requiresLi ?? false,
        requiresCertification: data.requiresCertification ?? false,
      })
      .returning();

    return item;
  },

  async deleteItem(itemId: number) {
    const [deleted] = await db
      .delete(processItems)
      .where(eq(processItems.id, itemId))
      .returning({ id: processItems.id });

    if (!deleted) throw new Error('Item nao encontrado');
    return deleted;
  },

  async getEspelho(processId: number) {
    const [espelho] = await db
      .select()
      .from(espelhos)
      .where(eq(espelhos.processId, processId))
      .orderBy(desc(espelhos.createdAt))
      .limit(1);

    return espelho ?? null;
  },

  async downloadXlsx(espelhoId: number): Promise<Buffer> {
    const [espelho] = await db
      .select()
      .from(espelhos)
      .where(eq(espelhos.id, espelhoId))
      .limit(1);

    if (!espelho) throw new Error('Espelho nao encontrado');

    const data = espelho.generatedData as any;
    if (!data?.filePath) {
      throw new Error('Arquivo do espelho nao disponivel');
    }

    try {
      const buffer = await fs.readFile(data.filePath);
      return Buffer.from(buffer);
    } catch {
      // File missing on disk, regenerate
      const items = await db
        .select()
        .from(processItems)
        .where(eq(processItems.processId, espelho.processId));

      const ws =
        espelho.brand === 'puket'
          ? generatePuketSheet(items)
          : generateImaginariumSheet(items);

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Espelho');

      return Buffer.from(
        XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }),
      );
    }
  },

  async sendToDrive(processId: number, userId: number | null = null) {
    const espelho = await this.getEspelho(processId);
    if (!espelho) throw new Error('Espelho nao encontrado para este processo');

    const data = espelho.generatedData as any;
    if (!data?.filePath || !data?.filename) {
      throw new Error('Arquivo do espelho nao disponivel');
    }

    const [process] = await db.select({
      processCode: importProcesses.processCode,
      brand: importProcesses.brand,
    })
      .from(importProcesses)
      .where(eq(importProcesses.id, processId))
      .limit(1);

    if (!process) throw new Error('Processo nao encontrado');

    const { googleDriveService } = await import('../integrations/google-drive.service.js');
    const driveFileId = await googleDriveService.uploadToProcessFolder(
      process.processCode,
      process.brand,
      'espelho',
      data.filePath,
      data.filename,
    );

    const [updated] = await db
      .update(espelhos)
      .set({ driveFileId })
      .where(eq(espelhos.id, espelho.id))
      .returning();

    auditService.log(userId, 'send_to_drive', 'espelho', espelho.id, { processId, driveFileId }, null);
    logger.info({ processId, espelhoId: espelho.id, driveFileId }, 'Espelho sent to Drive');

    return updated;
  },

  async markSentToFenicia(espelhoId: number, userId: number | null = null) {
    const [updated] = await db
      .update(espelhos)
      .set({ sentToFenicia: true, sentAt: new Date() })
      .where(eq(espelhos.id, espelhoId))
      .returning();

    if (!updated) throw new Error('Espelho nao encontrado');

    // Update process status and follow-up
    await db
      .update(importProcesses)
      .set({ status: 'sent_to_fenicia', updatedAt: new Date() })
      .where(eq(importProcesses.id, updated.processId));

    await db
      .update(followUpTracking)
      .set({ sentToFeniciaAt: new Date(), updatedAt: new Date() })
      .where(eq(followUpTracking.processId, updated.processId));

    auditService.log(userId, 'sent_to_fenicia', 'espelho', espelhoId, { processId: updated.processId }, null);

    return updated;
  },

  async sendToFeniciaByProcess(processId: number, userId: number | null = null) {
    const espelho = await this.getEspelho(processId);
    if (!espelho) throw new Error('Espelho nao encontrado para este processo');
    return this.markSentToFenicia(espelho.id, userId);
  },

  async generatePartial(processId: number) {
    const [process] = await db
      .select()
      .from(importProcesses)
      .where(eq(importProcesses.id, processId))
      .limit(1);

    if (!process) throw new Error('Processo nao encontrado');

    let items = await db
      .select()
      .from(processItems)
      .where(eq(processItems.processId, processId));

    if (items.length === 0) {
      items = await this.autoPopulateItems(processId);
    }

    // Filter only LI items
    const liItems = items.filter((i) => i.requiresLi);

    if (liItems.length === 0) {
      throw new Error('Nenhum item com LI encontrado para gerar espelho parcial');
    }

    const ws =
      process.brand === 'puket'
        ? generatePuketSheet(liItems)
        : generateImaginariumSheet(liItems);

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Espelho Parcial - LI');

    // Determine next version for partial espelhos
    const [latest] = await db.select({ maxVersion: sql<number>`coalesce(max(${espelhos.version}), 0)` })
      .from(espelhos)
      .where(and(eq(espelhos.processId, processId), eq(espelhos.isPartial, true)));
    const nextPartialVersion = (latest?.maxVersion ?? 0) + 1;

    const filename = `espelho_parcial_${process.processCode}_v${nextPartialVersion}.xlsx`;
    await fs.mkdir(UPLOAD_DIR, { recursive: true });
    const filePath = path.join(UPLOAD_DIR, filename);
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    await fs.writeFile(filePath, buffer);

    const [espelho] = await db
      .insert(espelhos)
      .values({
        processId,
        brand: process.brand,
        version: nextPartialVersion,
        isPartial: true,
        generatedData: {
          filename,
          filePath,
          itemCount: liItems.length,
          totalItems: items.length,
          generatedAt: new Date().toISOString(),
        },
      })
      .returning();

    logger.info(
      { processId, espelhoId: espelho.id, liItems: liItems.length },
      'Partial espelho (LI only) generated',
    );

    return espelho;
  },
};
