/**
 * DB-bound orchestration for cross-document confidence reconciliation.
 * The pure transform lives in `reconcile-core.ts`; this file loads documents,
 * persists the recalibrated confidence + provenance, and re-projects the
 * flattened data into the process aggregate.
 */
import { eq, desc, sql } from 'drizzle-orm';
import { db } from '../../shared/database/connection.js';
import {
  documents,
  importProcesses,
  documentExtractionRuns,
  documentExtractedFields,
} from '../../shared/database/schema.js';
import { logger } from '../../shared/utils/logger.js';
import { flattenAiData } from '../ai/service.js';
import { computeConfidenceScore } from '../ai/utils/confidence.js';
import {
  reconcileItemizedDoc,
  selectTrustedEspelho,
  RECONCILABLE_TYPES,
  type EspelhoSource,
  type ReconcileReport,
} from './reconcile-core.js';

export {
  reconcileItemizedDoc,
  selectTrustedEspelho,
  type EspelhoSource,
  type ReconcileReport,
} from './reconcile-core.js';

/** A document row carrying the parsed payload we need. */
interface DocRow {
  id: number;
  type: string;
  isProcessed: boolean | null;
  aiParsedData: unknown;
  confidenceScore: string | number | null;
}

/**
 * Reconcile every calibratable document of a process against the trusted
 * espelho + arithmetic, persist the recalibrated confidence, fields and
 * provenance, and re-project the flattened data into the process. Idempotent
 * and safe to call after any document changes. Never throws — logs and returns
 * a per-document summary.
 */
export async function reconcileProcessConfidence(
  processId: number,
): Promise<Array<{ documentId: number; type: string; before: number; after: number }>> {
  const results: Array<{ documentId: number; type: string; before: number; after: number }> = [];
  try {
    const docs = (await db
      .select({
        id: documents.id,
        type: documents.type,
        isProcessed: documents.isProcessed,
        aiParsedData: documents.aiParsedData,
        confidenceScore: documents.confidenceScore,
      })
      .from(documents)
      .where(eq(documents.processId, processId))
      .orderBy(desc(documents.createdAt), desc(documents.id))) as DocRow[];

    const espelho = selectTrustedEspelho(docs);

    for (const doc of docs) {
      if (!RECONCILABLE_TYPES.has(doc.type) || !doc.isProcessed || !doc.aiParsedData) continue;
      // A failed extraction only stores operational error metadata.  It must
      // never be treated as an itemized document and have its confidence
      // "recovered" from the espelho, otherwise the UI would advertise a
      // high-confidence result with no extracted source data.
      if (
        typeof doc.aiParsedData === 'object' &&
        !Array.isArray(doc.aiParsedData) &&
        ((doc.aiParsedData as Record<string, unknown>).extractionFailed ||
          (doc.aiParsedData as Record<string, unknown>).error)
      ) {
        continue;
      }
      const data = structuredCloneSafe(doc.aiParsedData as Record<string, any>);
      const before = computeConfidenceScore(data).score;

      const report = reconcileItemizedDoc(data, doc.type, espelho);
      if (!report.changed) continue;

      const { score: after } = computeConfidenceScore(data);

      await persistReconciliation(processId, doc, data, after, espelho, report);
      results.push({ documentId: doc.id, type: doc.type, before, after });
      logger.info(
        {
          processId,
          documentId: doc.id,
          type: doc.type,
          before: Number(before.toFixed(4)),
          after: Number(after.toFixed(4)),
          boosted: report.boosted.length,
          filled: report.filled.length,
          conflicts: report.conflicts.length,
        },
        'Reconciliation recalibrated document confidence',
      );
    }
  } catch (err) {
    logger.error({ err, processId }, 'reconcileProcessConfidence failed');
  }
  return results;
}

function structuredCloneSafe<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

async function persistReconciliation(
  processId: number,
  doc: DocRow,
  data: Record<string, any>,
  score: number,
  espelho: EspelhoSource | null,
  report: ReconcileReport,
): Promise<void> {
  await db
    .update(documents)
    .set({ aiParsedData: data, confidenceScore: String(score), updatedAt: new Date() })
    .where(eq(documents.id, doc.id));

  // Re-project the flattened payload into the process aggregate (atomic merge).
  const patch = { [doc.type]: flattenAiData(data) };
  await db
    .update(importProcesses)
    .set({
      aiExtractedData: sql`coalesce(${importProcesses.aiExtractedData}, '{}'::jsonb) || ${JSON.stringify(patch)}::jsonb`,
      updatedAt: new Date(),
    })
    .where(eq(importProcesses.id, processId));

  // Audit: one run row + the fields we touched (per-field provenance also lives
  // on each field's `source` tag inside aiParsedData; the run ties them).
  try {
    const [run] = await db
      .insert(documentExtractionRuns)
      .values({
        documentId: doc.id,
        processId,
        documentType: doc.type,
        provider: 'reconciliation',
        model: espelho ? 'espelho+arithmetic' : 'arithmetic',
        confidence: String(score),
        extractionStatus: 'reconciled',
      })
      .returning({ id: documentExtractionRuns.id });

    const touched = [...report.boosted, ...report.filled];
    if (run && touched.length > 0) {
      await db.insert(documentExtractedFields).values(
        touched.slice(0, 1000).map((f) => ({
          runId: run.id,
          documentId: doc.id,
          processId,
          documentType: doc.type,
          fieldPath: f.path.slice(0, 255),
          valueJson: { confidence: f.confidence, source: f.source } as any,
          confidence: String(f.confidence),
        })),
      );
    }
  } catch (err) {
    logger.warn({ err, documentId: doc.id }, 'Reconciliation lineage persist failed (non-fatal)');
  }
}
