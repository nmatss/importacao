import { eq, sql, count } from 'drizzle-orm';
import { db } from '../../shared/database/connection.js';
import { followUpTracking, importProcesses } from '../../shared/database/schema.js';
import type { FollowUpTracking } from '../../shared/database/schema.js';
import { googleSheetsService } from '../integrations/google-sheets.service.js';
import { logger } from '../../shared/utils/logger.js';

const TRACKING_STEPS = [
  'documentsReceivedAt',
  'preInspectionAt',
  'ncmVerifiedAt',
  'espelhoGeneratedAt',
  'sentToFeniciaAt',
  'liSubmittedAt',
  'liApprovedAt',
] as const;

function calculateProgress(tracking: Partial<FollowUpTracking>): number {
  const stepWeight = Math.floor(100 / TRACKING_STEPS.length);
  let progress = 0;

  for (const step of TRACKING_STEPS) {
    if (tracking[step]) {
      progress += stepWeight;
    }
  }

  return Math.min(progress, 100);
}

export const followUpService = {
  async getAll(page = 1, limit = 20) {
    const offset = (page - 1) * limit;

    const [data, [{ total }]] = await Promise.all([
      db.select({
        id: followUpTracking.id,
        processId: followUpTracking.processId,
        processCode: importProcesses.processCode,
        brand: importProcesses.brand,
        status: importProcesses.status,
        documentsReceivedAt: followUpTracking.documentsReceivedAt,
        preInspectionAt: followUpTracking.preInspectionAt,
        ncmVerifiedAt: followUpTracking.ncmVerifiedAt,
        espelhoGeneratedAt: followUpTracking.espelhoGeneratedAt,
        sentToFeniciaAt: followUpTracking.sentToFeniciaAt,
        liSubmittedAt: followUpTracking.liSubmittedAt,
        liApprovedAt: followUpTracking.liApprovedAt,
        liDeadline: followUpTracking.liDeadline,
        overallProgress: followUpTracking.overallProgress,
        notes: followUpTracking.notes,
        createdAt: followUpTracking.createdAt,
        updatedAt: followUpTracking.updatedAt,
      })
        .from(followUpTracking)
        .innerJoin(importProcesses, eq(followUpTracking.processId, importProcesses.id))
        .limit(limit)
        .offset(offset),
      db.select({ total: count() })
        .from(followUpTracking),
    ]);

    return { data, total, page, limit };
  },

  async getByProcess(processId: number) {
    const [tracking] = await db.select()
      .from(followUpTracking)
      .where(eq(followUpTracking.processId, processId))
      .limit(1);

    if (!tracking) throw new Error('Acompanhamento não encontrado');
    return tracking;
  },

  async update(processId: number, data: Record<string, any>) {
    const ALLOWED_FIELDS = ['documentsReceivedAt', 'preInspectionAt', 'ncmVerifiedAt', 'espelhoGeneratedAt', 'sentToFeniciaAt', 'liSubmittedAt', 'liApprovedAt', 'liDeadline', 'notes'] as const;
    const safeData: Record<string, any> = {};
    for (const field of ALLOWED_FIELDS) {
      if (field in data) safeData[field] = data[field];
    }

    const overallProgress = calculateProgress(safeData);

    const [tracking] = await db.update(followUpTracking)
      .set({
        ...safeData,
        overallProgress,
        updatedAt: new Date(),
      })
      .where(eq(followUpTracking.processId, processId))
      .returning();

    if (!tracking) throw new Error('Acompanhamento não encontrado');
    return tracking;
  },

  async compareWithSheet(processCode: string) {
    const sheetData = await googleSheetsService.readProcessRow(processCode);
    if (!sheetData) {
      throw new Error('Processo nao encontrado na planilha Follow-Up');
    }

    // Find the process in DB
    const [process] = await db
      .select()
      .from(importProcesses)
      .where(eq(importProcesses.processCode, processCode));

    if (!process) {
      throw new Error('Processo nao encontrado no sistema');
    }

    // Map common sheet column names to DB fields (flexible mapping)
    const fieldMap: Record<string, { dbField: keyof typeof process; sheetKeys: string[] }> = {
      supplier: { dbField: 'exporterName', sheetKeys: ['Fornecedor', 'Supplier', 'FORNECEDOR'] },
      brand: { dbField: 'brand', sheetKeys: ['Marca', 'Brand', 'MARCA'] },
      fobValue: { dbField: 'totalFobValue', sheetKeys: ['FOB', 'Valor FOB', 'FOB Total', 'VALOR FOB'] },
      freightValue: { dbField: 'freightValue', sheetKeys: ['Frete', 'Freight', 'FRETE'] },
      etd: { dbField: 'etd', sheetKeys: ['ETD', 'Data Embarque', 'EMBARQUE'] },
      eta: { dbField: 'eta', sheetKeys: ['ETA', 'Previsao Chegada', 'CHEGADA'] },
      incoterm: { dbField: 'incoterm', sheetKeys: ['Incoterm', 'INCOTERM'] },
      totalBoxes: { dbField: 'totalBoxes', sheetKeys: ['Caixas', 'Volumes', 'CAIXAS', 'QTD CAIXAS'] },
      containerType: { dbField: 'containerType', sheetKeys: ['Container', 'CONTAINER', 'Tipo Container'] },
      totalCbm: { dbField: 'totalCbm', sheetKeys: ['CBM', 'M3', 'CUBAGEM'] },
      totalGrossWeight: { dbField: 'totalGrossWeight', sheetKeys: ['Peso Bruto', 'PESO BRUTO', 'Gross Weight'] },
    };

    const differences: Array<{
      field: string;
      sheetValue: string;
      systemValue: string;
      sheetColumn: string;
    }> = [];

    const matched: Array<{
      field: string;
      value: string;
      sheetColumn: string;
    }> = [];

    for (const [fieldName, mapping] of Object.entries(fieldMap)) {
      // Find the matching sheet column
      let sheetValue = '';
      let sheetColumn = '';
      for (const key of mapping.sheetKeys) {
        if (sheetData[key] !== undefined && sheetData[key] !== '') {
          sheetValue = sheetData[key];
          sheetColumn = key;
          break;
        }
      }

      if (!sheetColumn) continue; // Column not found in sheet

      const dbValue = process[mapping.dbField];
      const dbStr = dbValue != null ? String(dbValue).trim() : '';
      const sheetStr = sheetValue.trim();

      // Compare (case-insensitive, number-tolerant)
      const dbNum = parseFloat(dbStr.replace(/[^\d.,\-]/g, '').replace(',', '.'));
      const sheetNum = parseFloat(sheetStr.replace(/[^\d.,\-]/g, '').replace(',', '.'));

      const isNumeric = !isNaN(dbNum) && !isNaN(sheetNum);
      const isMatch = isNumeric
        ? Math.abs(dbNum - sheetNum) < 0.01
        : dbStr.toLowerCase() === sheetStr.toLowerCase();

      if (!isMatch && sheetStr) {
        differences.push({
          field: fieldName,
          sheetValue: sheetStr,
          systemValue: dbStr || '(vazio)',
          sheetColumn,
        });
      } else if (sheetStr) {
        matched.push({ field: fieldName, value: sheetStr, sheetColumn });
      }
    }

    return {
      processCode,
      sheetData,
      differences,
      matched,
      hasDifferences: differences.length > 0,
    };
  },

  async syncFromSheet(processCode: string, mode: 'conservative' | 'industrial' = 'conservative') {
    const comparison = await this.compareWithSheet(processCode);

    if (!comparison.hasDifferences) {
      return { updated: false, message: 'Nenhuma diferenca encontrada', comparison };
    }

    if (mode === 'conservative') {
      // Conservative mode: just return differences for manual review
      return { updated: false, message: 'Modo conservador: aprovacao necessaria', comparison };
    }

    // Industrial mode: auto-update DB from sheet
    const [process] = await db
      .select()
      .from(importProcesses)
      .where(eq(importProcesses.processCode, processCode));

    if (!process) throw new Error('Processo nao encontrado');

    const updates: Record<string, any> = {};
    const fieldToDb: Record<string, string> = {
      fobValue: 'totalFobValue',
      freightValue: 'freightValue',
      etd: 'etd',
      eta: 'eta',
      totalBoxes: 'totalBoxes',
      containerType: 'containerType',
      totalCbm: 'totalCbm',
      totalGrossWeight: 'totalGrossWeight',
    };

    for (const diff of comparison.differences) {
      const dbField = fieldToDb[diff.field];
      if (!dbField) continue;

      const numericFields = ['totalFobValue', 'freightValue', 'totalBoxes', 'totalCbm', 'totalGrossWeight'];
      if (numericFields.includes(dbField)) {
        const num = parseFloat(diff.sheetValue.replace(/[^\d.,\-]/g, '').replace(',', '.'));
        if (!isNaN(num)) updates[dbField] = num;
      } else {
        updates[dbField] = diff.sheetValue;
      }
    }

    if (Object.keys(updates).length > 0) {
      updates.updatedAt = new Date();
      await db
        .update(importProcesses)
        .set(updates)
        .where(eq(importProcesses.id, process.id));

      logger.info({ processCode, updates: Object.keys(updates) }, 'Process updated from Follow-Up sheet');
    }

    return { updated: true, message: `${Object.keys(updates).length} campo(s) atualizado(s)`, comparison, updatedFields: Object.keys(updates) };
  },

  async getLiDeadlines() {
    const results = await db.select({
      processId: importProcesses.id,
      processCode: importProcesses.processCode,
      brand: importProcesses.brand,
      status: importProcesses.status,
      shipmentDate: importProcesses.shipmentDate,
      liDeadline: sql<string>`${importProcesses.shipmentDate}::date + 13`,
      daysRemaining: sql<number>`${importProcesses.shipmentDate}::date + 13 - CURRENT_DATE`,
      liSubmittedAt: followUpTracking.liSubmittedAt,
      liApprovedAt: followUpTracking.liApprovedAt,
    })
      .from(importProcesses)
      .innerJoin(followUpTracking, eq(followUpTracking.processId, importProcesses.id))
      .where(eq(importProcesses.hasLiItems, true));

    return results;
  },
};
