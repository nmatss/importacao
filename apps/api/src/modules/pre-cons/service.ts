import * as XLSX from 'xlsx';
import fs from 'fs/promises';
import { eq, and, sql } from 'drizzle-orm';
import { db } from '../../shared/database/connection.js';
import { preConsItems, preConsSyncLog, importProcesses } from '../../shared/database/schema.js';
import { logger } from '../../shared/utils/logger.js';
import { alertService } from '../alerts/service.js';

function safeNum(val: any): number | null {
  if (val == null || val === '') return null;
  const n = Number(val);
  return isNaN(n) ? null : n;
}

function safeInt(val: any): number | null {
  const n = safeNum(val);
  return n != null ? Math.round(n) : null;
}

// Excel serial date → JS Date
function excelDateToISO(serial: number | string | null): string | null {
  if (serial == null || serial === '' || serial === 0) return null;
  const num = Number(serial);
  if (isNaN(num) || num < 1000) return null;
  // Excel epoch: 1900-01-01 with the 1900 leap year bug
  const date = new Date((num - 25569) * 86400 * 1000);
  return date.toISOString().split('T')[0];
}

// Parse the Pre_Cons XLSX and return normalized rows
function parsePreConsXLSX(buffer: Buffer): {
  rows: Array<Record<string, any>>;
  sheets: string[];
  errors: string[];
} {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const allRows: Array<Record<string, any>> = [];
  const errors: string[] = [];

  // Only process relevant sheets (Shipped + To Be Shipped)
  const relevantSheets = wb.SheetNames.filter(
    (name) => name.toLowerCase().includes('shipped') || name.toLowerCase().includes('to be'),
  );

  for (const sheetName of relevantSheets) {
    const sheet = wb.Sheets[sheetName];
    if (!sheet) continue;

    const data = XLSX.utils.sheet_to_json<any[]>(sheet, { header: 1, defval: '' });

    // Find header row (row 1 typically has: Order, Order, ETD, Collection, ...)
    let headerRowIdx = -1;
    for (let i = 0; i < Math.min(5, data.length); i++) {
      const row = data[i] as string[];
      if (row.some((cell) => String(cell).includes('Order') || String(cell).includes('ETD'))) {
        headerRowIdx = i;
        break;
      }
    }

    if (headerRowIdx < 0) {
      errors.push(`Sheet "${sheetName}": header row not found`);
      continue;
    }

    // Parse data rows (skip header)
    for (let i = headerRowIdx + 1; i < data.length; i++) {
      const row = data[i] as any[];
      if (!row || row.length < 10) continue;

      // Skip empty rows (no item code and no product name)
      const itemCode = String(row[9] || '').trim();
      const productName = String(row[8] || '').trim();
      if (!itemCode && !productName) continue;

      // Process code may be empty for "To Be Shipped" items (not yet assigned)
      const processCode = String(row[2] || '').trim() || null;

      try {
        allRows.push({
          processCode,
          orderDescription: String(row[1] || '').trim() || null,
          etd: excelDateToISO(row[3]),
          collection: String(row[4] || '').trim() || null,
          portOfLoading: String(row[6] || '').trim() || null,
          supplier: String(row[7] || '').trim() || null,
          productName: productName || null,
          itemCode: itemCode || null,
          quantity: safeInt(row[10]),
          agreedPrice: safeNum(row[11]),
          ncmCode: String(row[12] || '').trim() || null,
          requiresReorder: String(row[13]).toLowerCase() === 'true',
          requiresImportLicense: String(row[14]).toLowerCase() === 'true',
          amount: safeNum(row[16]),
          ableFactor: safeNum(row[17]),
          cbm: safeNum(row[18]),
          cargoReadyDate: excelDateToISO(row[19]),
          eta: excelDateToISO(row[20]),
          dcEta: excelDateToISO(row[21]),
          piNumber: String(row[22] || '').trim() || null,
          ean13: String(row[23] || '').trim() || null,
          color: String(row[24] || '').trim() || null,
          sheetName,
        });
      } catch (err) {
        errors.push(`Sheet "${sheetName}" row ${i}: ${(err as Error).message}`);
      }
    }
  }

  return { rows: allRows, sheets: relevantSheets, errors };
}

export const preConsService = {
  /**
   * Sync Pre-Cons data from XLSX buffer.
   * Deletes all existing items and re-inserts (full refresh).
   */
  async syncFromXLSX(
    buffer: Buffer,
    fileName: string,
    source: 'email' | 'upload' | 'drive' = 'upload',
  ) {
    const { rows, sheets, errors } = parsePreConsXLSX(buffer);

    logger.info(
      { fileName, sheets, totalRows: rows.length, errors: errors.length },
      'Pre-Cons XLSX parsed',
    );

    if (rows.length === 0) {
      const logEntry = {
        source,
        fileName,
        sheetsProcessed: sheets.length,
        totalRows: 0,
        created: 0,
        updated: 0,
        errors: errors.length,
        details: { errors, message: 'No data rows found' },
      };
      await db.insert(preConsSyncLog).values(logEntry);
      return { ...logEntry, divergences: [] };
    }

    // Full refresh: delete all existing items, then insert new ones
    await db.delete(preConsItems);

    // Batch insert (chunks of 100)
    let created = 0;
    for (let i = 0; i < rows.length; i += 100) {
      const chunk = rows.slice(i, i + 100).map((row) => ({
        processCode: row.processCode,
        orderDescription: row.orderDescription,
        etd: row.etd,
        collection: row.collection,
        portOfLoading: row.portOfLoading,
        supplier: row.supplier,
        productName: row.productName,
        itemCode: row.itemCode,
        quantity: row.quantity,
        agreedPrice: row.agreedPrice != null ? String(row.agreedPrice) : null,
        ncmCode: row.ncmCode,
        requiresReorder: row.requiresReorder,
        requiresImportLicense: row.requiresImportLicense,
        amount: row.amount != null ? String(row.amount) : null,
        ableFactor: row.ableFactor != null ? String(row.ableFactor) : null,
        cbm: row.cbm != null ? String(row.cbm) : null,
        cargoReadyDate: row.cargoReadyDate,
        eta: row.eta,
        dcEta: row.dcEta,
        piNumber: row.piNumber,
        ean13: row.ean13,
        color: row.color,
        sheetName: row.sheetName,
        syncedAt: new Date(),
      }));

      await db.insert(preConsItems).values(chunk);
      created += chunk.length;
    }

    // Find divergences: compare Pre-Cons with existing processes
    const divergences = await this.findDivergences();

    // Log sync
    const logEntry = {
      source,
      fileName,
      sheetsProcessed: sheets.length,
      totalRows: rows.length,
      created,
      updated: 0,
      errors: errors.length,
      details: {
        errors,
        sheets,
        divergenceCount: divergences.length,
      },
    };
    await db.insert(preConsSyncLog).values(logEntry);

    // Create alert
    alertService
      .create({
        processId: null as any,
        severity: divergences.length > 0 ? 'warning' : 'info',
        title: 'Pre-Cons Sincronizado',
        message: `${created} itens importados de "${fileName}" (${sheets.join(', ')}). ${divergences.length} divergências encontradas.`,
      })
      .catch((err) => logger.error({ err }, 'Failed to create pre-cons sync alert'));

    logger.info(
      { created, divergences: divergences.length, errors: errors.length },
      'Pre-Cons sync completed',
    );

    return { ...logEntry, divergences };
  },

  /**
   * Compare Pre-Cons items with existing import processes to find divergences.
   */
  async findDivergences() {
    // Get unique process codes from pre_cons that match existing processes
    const preConsCodes = await db
      .selectDistinct({ processCode: preConsItems.processCode })
      .from(preConsItems);

    const divergences: Array<{
      processCode: string;
      field: string;
      preConsValue: string;
      systemValue: string;
      severity: 'info' | 'warning' | 'critical';
    }> = [];

    for (const { processCode } of preConsCodes) {
      if (!processCode) continue;

      // Find matching process in our system
      const [process] = await db
        .select()
        .from(importProcesses)
        .where(eq(importProcesses.processCode, processCode))
        .limit(1);

      if (!process) continue;

      // Get Pre-Cons items for this process
      const items = await db
        .select()
        .from(preConsItems)
        .where(eq(preConsItems.processCode, processCode));

      // Compare totals
      const preConsTotalAmount = items.reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
      const preConsTotalCbm = items.reduce((sum, item) => sum + (Number(item.cbm) || 0), 0);
      const preConsTotalQty = items.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0);

      // Check FOB value divergence
      if (process.totalFobValue && preConsTotalAmount > 0) {
        const systemFob = Number(process.totalFobValue);
        const diff = Math.abs(systemFob - preConsTotalAmount);
        if (diff > 1) {
          divergences.push({
            processCode,
            field: 'totalFobValue',
            preConsValue: preConsTotalAmount.toFixed(2),
            systemValue: systemFob.toFixed(2),
            severity: diff / systemFob > 0.05 ? 'critical' : 'warning',
          });
        }
      }

      // Check CBM divergence
      if (process.totalCbm && preConsTotalCbm > 0) {
        const systemCbm = Number(process.totalCbm);
        const diff = Math.abs(systemCbm - preConsTotalCbm);
        if (diff > 0.5) {
          divergences.push({
            processCode,
            field: 'totalCbm',
            preConsValue: preConsTotalCbm.toFixed(2),
            systemValue: systemCbm.toFixed(2),
            severity: diff / systemCbm > 0.1 ? 'critical' : 'warning',
          });
        }
      }

      // Check ETD divergence
      if (items[0]?.etd && process.etd) {
        const preConsEtd = items[0].etd;
        const systemEtd = String(process.etd).split('T')[0];
        if (preConsEtd !== systemEtd) {
          divergences.push({
            processCode,
            field: 'etd',
            preConsValue: preConsEtd,
            systemValue: systemEtd,
            severity: 'warning',
          });
        }
      }
    }

    return divergences;
  },

  /**
   * Get Pre-Cons items for a specific process code.
   */
  async getByProcessCode(processCode: string) {
    return db.select().from(preConsItems).where(eq(preConsItems.processCode, processCode));
  },

  /**
   * Get all Pre-Cons items with pagination.
   */
  async getAll(page = 1, limit = 50, processCode?: string) {
    const conditions = processCode ? eq(preConsItems.processCode, processCode) : undefined;

    const [data, [{ total }]] = await Promise.all([
      db
        .select()
        .from(preConsItems)
        .where(conditions)
        .limit(limit)
        .offset((page - 1) * limit),
      db
        .select({ total: sql<number>`count(*)::int` })
        .from(preConsItems)
        .where(conditions),
    ]);

    return { data, total, page, limit };
  },

  /**
   * Get sync history.
   */
  async getSyncLogs(limit = 10) {
    return db
      .select()
      .from(preConsSyncLog)
      .orderBy(sql`synced_at DESC`)
      .limit(limit);
  },
};
