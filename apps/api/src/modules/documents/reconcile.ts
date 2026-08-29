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
  documentExtractionHistory,
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
import { MIN_OPERATIONAL_CONFIDENCE } from './constants.js';

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
  originalFilename?: string | null;
  storagePath?: string | null;
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
        originalFilename: documents.originalFilename,
        storagePath: documents.storagePath,
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

      // Auditoria 2026-07-17: conflito com o espelho confiável era só um
      // contador de log — o operador nunca ficava sabendo que a fonte mais
      // confiável do processo discorda do documento. Vira alerta acionável.
      if (report.conflicts.length > 0) {
        await raiseConflictAlert(processId, doc, report).catch((err) =>
          logger.warn({ err, documentId: doc.id }, 'Reconciliation conflict alert failed'),
        );
      }

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

/**
 * Alerta o operador quando o espelho confiável DISCORDA de valores extraídos.
 * Deduplicado por documento+conjunto de campos via título/mensagem estáveis —
 * o alertService já suprime duplicatas idênticas não tratadas; ainda assim a
 * mensagem é determinística para não gerar variações a cada reconciliação.
 */
async function raiseConflictAlert(
  processId: number,
  doc: DocRow,
  report: ReconcileReport,
): Promise<void> {
  const { alertService } = await import('../alerts/service.js');
  // doc.id no título: distingue dois documentos do MESMO tipo no processo.
  // hasActiveAlert (sem janela): enquanto o alerta anterior não for tratado,
  // não re-cria a cada reconciliação/backfill — evita tempestade de alertas
  // (revisão R1) e re-alertas de conflitos estagnados a cada 24h.
  const title = `Espelho diverge do documento ${doc.type} #${doc.id}`;
  if (await alertService.hasActiveAlert(processId, title)) return;
  const [proc] = await db
    .select({ processCode: importProcesses.processCode })
    .from(importProcesses)
    .where(eq(importProcesses.id, processId))
    .limit(1);
  const examples = report.conflicts
    .slice(0, 5)
    .map((c) => `${c.path}: documento="${String(c.target)}" vs espelho="${String(c.source)}"`)
    .join('; ');
  const extra = report.conflicts.length > 5 ? ` (+${report.conflicts.length - 5} campos)` : '';
  await alertService.create({
    processId,
    severity: 'warning',
    title,
    message:
      `O Espelho (fonte confiável) discorda de ${report.conflicts.length} campo(s) do ` +
      `documento ${doc.type} no processo ${proc?.processCode ?? processId}: ${examples}${extra}. ` +
      `Revise o comparativo — os valores do documento NÃO foram alterados.`,
    processCode: proc?.processCode,
  });
}

async function persistReconciliation(
  processId: number,
  doc: DocRow,
  data: Record<string, any>,
  score: number,
  espelho: EspelhoSource | null,
  report: ReconcileReport,
): Promise<void> {
  // Este update DESTRÓI o payload original da extração. Arquivar antes, como
  // fazem reprocess/reclassify/reextract/delete — reconcileProcessConfidence
  // roda a cada extração de documento irmão, então isto é rotina, não exceção,
  // e sem o arquivamento o payload de origem não é recuperável.
  if (doc.aiParsedData != null) {
    await db.insert(documentExtractionHistory).values({
      documentId: doc.id,
      processId,
      documentType: doc.type,
      originalFilename: doc.originalFilename ?? null,
      storagePath: doc.storagePath ?? null,
      aiParsedData: doc.aiParsedData,
      confidence: doc.confidenceScore != null ? String(doc.confidenceScore) : null,
      reason: 'reconcile',
    });
  }

  await db
    .update(documents)
    .set({ aiParsedData: data, confidenceScore: String(score), updatedAt: new Date() })
    .where(eq(documents.id, doc.id));

  // Re-project the flattened payload into the process aggregate (atomic merge).
  // Auditoria 2026-07-17: a re-projeção respeita o MESMO piso operacional da
  // extração — sem isso, um documento de 0.30 (não projetado no gate original)
  // entrava no agregado por efeito colateral de um boost aritmético parcial.
  if (score >= MIN_OPERATIONAL_CONFIDENCE) {
    const patch = { [doc.type]: flattenAiData(data) };
    await db
      .update(importProcesses)
      .set({
        aiExtractedData: sql`coalesce(${importProcesses.aiExtractedData}, '{}'::jsonb) || ${JSON.stringify(patch)}::jsonb`,
        updatedAt: new Date(),
      })
      .where(eq(importProcesses.id, processId));
  } else {
    logger.info(
      { processId, documentId: doc.id, score: Number(score.toFixed(4)) },
      'Reconciliation below operational floor — confidence updated, projection withheld',
    );
  }

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
