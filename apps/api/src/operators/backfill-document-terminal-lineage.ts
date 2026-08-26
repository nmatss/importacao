/**
 * Append-only backfill for terminal documents created before full extraction
 * lineage existed, including `other` and deterministic espelho paths.
 *
 * This does not manufacture field provenance: source hash/fields stay empty
 * and provider=`historical_backfill` makes that limitation explicit. It only
 * records the already-observed terminal outcome. Dry-run is the default.
 */

import { chmod, writeFile } from 'node:fs/promises';
import { sql } from 'drizzle-orm';
import { db, pool } from '../shared/database/connection.js';
import { auditLogs, documentExtractionRuns, documents } from '../shared/database/schema.js';

function terminalStatus(doc: typeof documents.$inferSelect): string {
  const data = (doc.aiParsedData as Record<string, unknown> | null) ?? {};
  if (data.extractionFailed === true || typeof data.error === 'string') return 'failed';
  if (data.skipped === true || doc.type === 'other') return 'skipped';
  if (doc.type === 'espelho') return 'deterministic';
  return 'completed';
}

async function main() {
  const execute = process.argv.includes('--execute');
  const outArg = process.argv.find((arg) => arg.startsWith('--out='));
  const batchId = `lineage-backfill-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  const outPath = outArg?.slice('--out='.length) ?? `/tmp/${batchId}.json`;

  const allDocuments = await db.select().from(documents);
  const existingRuns = await db
    .select({
      documentId: documentExtractionRuns.documentId,
      provider: documentExtractionRuns.provider,
    })
    .from(documentExtractionRuns);
  const covered = new Set(
    existingRuns
      .filter((run) => run.documentId != null && run.provider !== 'reconciliation')
      .map((run) => run.documentId),
  );
  const targets = allDocuments.filter((doc) => !covered.has(doc.id));
  const plan = targets.map((doc) => ({
    documentId: doc.id,
    processId: doc.processId,
    documentType: doc.type,
    extractionStatus: terminalStatus(doc),
    confidence: doc.confidenceScore,
  }));

  if (execute && targets.length > 0) {
    await db.transaction(async (tx) => {
      // One global lock prevents two operators from creating duplicate
      // historical runs in the absence of a dedicated unique constraint.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(2026082601)`);
      const recheckedRuns = await tx
        .select({
          documentId: documentExtractionRuns.documentId,
          provider: documentExtractionRuns.provider,
        })
        .from(documentExtractionRuns);
      const recheckedCovered = new Set(
        recheckedRuns
          .filter((run) => run.documentId != null && run.provider !== 'reconciliation')
          .map((run) => run.documentId),
      );
      const pending = targets.filter((doc) => !recheckedCovered.has(doc.id));
      if (pending.length > 0) {
        await tx.insert(documentExtractionRuns).values(
          pending.map((doc) => ({
            documentId: doc.id,
            processId: doc.processId,
            documentType: doc.type,
            provider: 'historical_backfill',
            model: null,
            confidence: doc.confidenceScore,
            sourceTextHash: null,
            sourceTextLength: null,
            extractionStatus: terminalStatus(doc),
          })),
        );
      }
      await tx.insert(auditLogs).values({
        action: 'backfill_document_terminal_lineage',
        entityType: 'document_batch',
        details: {
          batchId,
          planned: targets.length,
          inserted: pending.length,
          documentIds: pending.map((doc) => doc.id),
          limitation: 'terminal outcome only; no historical source text or field provenance',
        },
      });
    });
  }

  const evidence = {
    batchId,
    generatedAt: new Date().toISOString(),
    mode: execute ? 'execute' : 'dry-run',
    totalDocuments: allDocuments.length,
    alreadyCovered: allDocuments.length - targets.length,
    planned: targets.length,
    plan,
  };
  await writeFile(outPath, `${JSON.stringify(evidence, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
  await chmod(outPath, 0o600);
  console.log(
    JSON.stringify({
      mode: evidence.mode,
      totalDocuments: evidence.totalDocuments,
      alreadyCovered: evidence.alreadyCovered,
      planned: evidence.planned,
      evidence: outPath,
    }),
  );
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : 'Falha desconhecida');
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end().catch(() => undefined);
  });
