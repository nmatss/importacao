/**
 * Backfill historical Gmail -> document lineage using exact SHA-256 matches.
 *
 * Dry-run is the default. Execute mode writes at most one row per
 * (process_id, content_sha256), matching the database idempotency contract.
 * Source bytes stay in memory and reports never contain filenames, message IDs
 * or content.
 */

import { createHash } from 'node:crypto';
import { chmod, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { eq, sql } from 'drizzle-orm';
import { gmailService } from '../modules/email-ingestion/gmail.service.js';
import { db, pool } from '../shared/database/connection.js';
import {
  auditLogs,
  documents,
  emailAttachmentDocuments,
  emailIngestionLogs,
  importProcesses,
} from '../shared/database/schema.js';
import {
  decideExactHashTarget,
  normalizeProcessCode,
  type ExactHashTarget,
} from './gmail-lineage-match.js';

function sha256(value: Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function extractProcessCodes(text: string): string[] {
  const patterns = [
    /\b(IMP[-_]?\d{4}[-_]?\d{3,})\b/gi,
    /\b(PU?K(?:ET)?[-_]?\d{6,8}[A-Z]{0,4})\b/gi,
    /\b(IMAG(?:INARIUM)?[-_]?\d{6,8}[A-Z]{0,4})\b/gi,
    /\b(IM\d{6,8}[A-Z]{0,4})\b/gi,
  ];
  const matches = new Set<string>();
  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) matches.add(normalizeProcessCode(match[1]));
  }
  return [...matches];
}

async function main() {
  const execute = process.argv.includes('--execute');
  const afterArg = process.argv.find((arg) => arg.startsWith('--after='));
  const outArg = process.argv.find((arg) => arg.startsWith('--out='));
  const after = afterArg?.slice('--after='.length) ?? '2025/05/01';
  if (!/^\d{4}\/\d{2}\/\d{2}$/.test(after)) throw new Error('--after deve usar YYYY/MM/DD');
  const batchId = `gmail-lineage-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  const outPath = outArg?.slice('--out='.length) ?? `/tmp/${batchId}.json`;

  const allowedSenders = (process.env.EMAIL_ALLOWED_SENDERS ?? '')
    .split(',')
    .map((sender) => sender.trim())
    .filter(Boolean);
  if (allowedSenders.length === 0) {
    throw new Error('EMAIL_ALLOWED_SENDERS ausente; backfill amplo recusado sem allowlist');
  }
  if (!gmailService.isConfigured()) throw new Error('Gmail API nao configurada');

  const senderFilter = `{${allowedSenders.map((sender) => `from:${sender}`).join(' ')}}`;
  const query = `after:${after} has:attachment ${senderFilter}`;
  const [emails, documentRows, emailLogs, existingLinks] = await Promise.all([
    gmailService.fetchUnseenEmails(true, query),
    db
      .select({
        documentId: documents.id,
        processId: documents.processId,
        processCode: importProcesses.processCode,
        storagePath: documents.storagePath,
        documentType: documents.type,
      })
      .from(documents)
      .innerJoin(importProcesses, eq(importProcesses.id, documents.processId)),
    db
      .select({ id: emailIngestionLogs.id, messageId: emailIngestionLogs.messageId })
      .from(emailIngestionLogs),
    db.select().from(emailAttachmentDocuments),
  ]);

  const documentsByHash = new Map<
    string,
    Array<ExactHashTarget & { storagePath: string; documentType: string }>
  >();
  let unreadableDocuments = 0;
  for (const document of documentRows) {
    try {
      const absolutePath = path.isAbsolute(document.storagePath)
        ? document.storagePath
        : path.resolve(document.storagePath);
      const hash = sha256(await readFile(absolutePath));
      const matches = documentsByHash.get(hash) ?? [];
      matches.push(document);
      documentsByHash.set(hash, matches);
    } catch {
      unreadableDocuments += 1;
    }
  }

  const emailLogByMessageId = new Map(emailLogs.map((log) => [log.messageId, log.id]));
  const existingProcessHashes = new Set(
    existingLinks
      .filter((link) => link.processId != null)
      .map((link) => `${link.processId}\u0000${link.contentSha256}`),
  );
  const candidates = new Map<string, typeof emailAttachmentDocuments.$inferInsert>();
  const counts = {
    sourceMessages: emails.length,
    sourceAttachments: 0,
    exactMatchedAttachments: 0,
    exactDistinctDocuments: 0,
    processCodeAligned: 0,
    noRecognizedProcessCode: 0,
    missingHash: 0,
    ambiguousHash: 0,
    processConflict: 0,
    alreadyLinked: 0,
    repeatedSource: 0,
    unreadableDocuments,
  };
  const matchedDocuments = new Set<number>();

  for (const email of emails) {
    const messageCodes = extractProcessCodes(`${email.subject}\n${email.body.slice(0, 3000)}`);
    for (const [attachmentIndex, attachment] of email.attachments.entries()) {
      counts.sourceAttachments += 1;
      const contentSha256 = sha256(attachment.content);
      const attachmentCodes = extractProcessCodes(attachment.filename);
      const knownProcessCodes = attachmentCodes.length > 0 ? attachmentCodes : messageCodes;
      const decision = decideExactHashTarget(
        documentsByHash.get(contentSha256) ?? [],
        knownProcessCodes,
      );
      if (decision.kind !== 'exact') {
        counts[
          decision.kind === 'missing_hash'
            ? 'missingHash'
            : decision.kind === 'ambiguous_hash'
              ? 'ambiguousHash'
              : 'processConflict'
        ] += 1;
        continue;
      }

      counts.exactMatchedAttachments += 1;
      matchedDocuments.add(decision.target.documentId);
      if (decision.processCodeAligned) counts.processCodeAligned += 1;
      else counts.noRecognizedProcessCode += 1;
      const target = documentsByHash.get(contentSha256)![0];
      const key = `${target.processId}\u0000${contentSha256}`;
      if (existingProcessHashes.has(key)) {
        counts.alreadyLinked += 1;
        continue;
      }
      if (candidates.has(key)) {
        counts.repeatedSource += 1;
        continue;
      }
      candidates.set(key, {
        emailLogId: emailLogByMessageId.get(email.messageId) ?? null,
        documentId: target.documentId,
        processId: target.processId,
        processCode: target.processCode,
        messageId: email.messageId,
        transportId: email.gmailId,
        attachmentIndex,
        filename: attachment.filename,
        contentSha256,
        fileSize: attachment.size,
        storagePath: target.storagePath,
        documentType: target.documentType,
        status: 'historical_exact_hash',
        orphaned: false,
        recoverable: false,
        updatedAt: new Date(),
      });
    }
  }
  counts.exactDistinctDocuments = matchedDocuments.size;

  let inserted = 0;
  if (execute && candidates.size > 0) {
    await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(2026082603)`);
      for (const candidate of candidates.values()) {
        const rows = await tx
          .insert(emailAttachmentDocuments)
          .values(candidate)
          .onConflictDoNothing()
          .returning({ id: emailAttachmentDocuments.id });
        inserted += rows.length;
      }
      await tx.insert(auditLogs).values({
        action: 'backfill_gmail_attachment_lineage',
        entityType: 'email_attachment_batch',
        details: {
          batchId,
          mode: 'exact_sha256_only',
          planned: candidates.size,
          inserted,
          exactMatchedAttachments: counts.exactMatchedAttachments,
          exactDistinctDocuments: counts.exactDistinctDocuments,
          processConflict: counts.processConflict,
          ambiguousHash: counts.ambiguousHash,
        },
      });
    });
  }

  const evidence = {
    batchId,
    generatedAt: new Date().toISOString(),
    mode: execute ? 'execute' : 'dry-run',
    cutoff: after,
    allowedSenderCount: allowedSenders.length,
    ...counts,
    planned: candidates.size,
    inserted,
  };
  await writeFile(outPath, `${JSON.stringify(evidence, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
  await chmod(outPath, 0o600);
  console.log(JSON.stringify({ ...evidence, evidence: outPath }));
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : 'Falha desconhecida');
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end().catch(() => undefined);
  });
