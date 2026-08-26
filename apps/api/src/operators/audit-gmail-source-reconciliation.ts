/**
 * Read-only Gmail source-to-target reconciliation.
 *
 * It downloads allowed historical attachments in memory to compute SHA-256,
 * but never changes Gmail labels and never persists message content, sender,
 * subject, filename or attachment bytes. Output contains only business process
 * codes, hashes, counts and exception categories.
 */

import { createHash } from 'node:crypto';
import { chmod, writeFile } from 'node:fs/promises';
import { db, pool } from '../shared/database/connection.js';
import { emailAttachmentDocuments, importProcesses } from '../shared/database/schema.js';
import { gmailService } from '../modules/email-ingestion/gmail.service.js';

function sha256(value: Buffer | string): string {
  return createHash('sha256').update(value).digest('hex');
}

function normalizeProcessCode(value: string): string {
  return value.toUpperCase().replace(/[-_\s]/g, '');
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
  const afterArg = process.argv.find((arg) => arg.startsWith('--after='));
  const outArg = process.argv.find((arg) => arg.startsWith('--out='));
  const after = afterArg?.slice('--after='.length) ?? '2025/05/01';
  if (!/^\d{4}\/\d{2}\/\d{2}$/.test(after)) {
    throw new Error('--after deve usar YYYY/MM/DD');
  }
  const outPath =
    outArg?.slice('--out='.length) ??
    `/tmp/gmail-reconciliation-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;

  const allowedSenders = (process.env.EMAIL_ALLOWED_SENDERS ?? '')
    .split(',')
    .map((sender) => sender.trim())
    .filter(Boolean);
  if (allowedSenders.length === 0) {
    throw new Error('EMAIL_ALLOWED_SENDERS ausente; auditoria ampla recusada sem allowlist');
  }
  if (!gmailService.isConfigured()) throw new Error('Gmail API nao configurada');

  const senderFilter = `{${allowedSenders.map((sender) => `from:${sender}`).join(' ')}}`;
  const query = `after:${after} has:attachment ${senderFilter}`;
  const [emails, processRows, targetRows] = await Promise.all([
    gmailService.fetchUnseenEmails(true, query),
    db
      .select({ id: importProcesses.id, processCode: importProcesses.processCode })
      .from(importProcesses),
    db.select().from(emailAttachmentDocuments),
  ]);

  const processByCode = new Map(
    processRows.map((process) => [normalizeProcessCode(process.processCode), process]),
  );
  const targetByMessageHash = new Map(
    targetRows.map((row) => [`${row.messageId}\u0000${row.contentSha256}`, row]),
  );
  const perProcess = new Map<
    number,
    {
      processId: number;
      processCode: string;
      sourceMessages: Set<string>;
      sourceAttachments: number;
      exactMatches: number;
      missingTargets: number;
      orphanTargets: number;
    }
  >();
  const exceptions: Array<Record<string, unknown>> = [];
  let sourceAttachments = 0;
  let exactMatches = 0;
  let emailsWithoutKnownProcess = 0;

  for (const email of emails) {
    const messageCodes = extractProcessCodes(`${email.subject}\n${email.body.slice(0, 3000)}`);
    const emailCodes = [
      ...new Set([
        ...messageCodes,
        ...email.attachments.flatMap((attachment) => extractProcessCodes(attachment.filename)),
      ]),
    ];
    const emailProcesses = emailCodes
      .map((code) => processByCode.get(code))
      .filter((process): process is NonNullable<typeof process> => Boolean(process));
    if (emailProcesses.length === 0) emailsWithoutKnownProcess += 1;

    for (const attachment of email.attachments) {
      const attachmentCodes = extractProcessCodes(attachment.filename);
      const scopedCodes = attachmentCodes.some((code) => processByCode.has(code))
        ? attachmentCodes
        : messageCodes;
      const matchedProcesses = scopedCodes
        .map((code) => processByCode.get(code))
        .filter((process): process is NonNullable<typeof process> => Boolean(process));
      sourceAttachments += 1;
      const contentSha256 = sha256(attachment.content);
      const target = targetByMessageHash.get(`${email.messageId}\u0000${contentSha256}`);
      if (target?.documentId && !target.orphaned) exactMatches += 1;

      for (const process of matchedProcesses) {
        const state = perProcess.get(process.id) ?? {
          processId: process.id,
          processCode: process.processCode,
          sourceMessages: new Set<string>(),
          sourceAttachments: 0,
          exactMatches: 0,
          missingTargets: 0,
          orphanTargets: 0,
        };
        state.sourceMessages.add(sha256(email.messageId));
        state.sourceAttachments += 1;
        if (target?.documentId && target.processId === process.id && !target.orphaned) {
          state.exactMatches += 1;
        } else if (target?.orphaned || target?.documentId == null) {
          state.orphanTargets += 1;
        } else {
          state.missingTargets += 1;
        }
        perProcess.set(process.id, state);
      }

      if (!target?.documentId || target.orphaned) {
        exceptions.push({
          messageIdHash: sha256(email.messageId),
          contentSha256,
          knownProcessCodes: matchedProcesses.map((process) => process.processCode),
          category: target?.orphaned ? 'orphan_target' : 'missing_target',
          recoverable: target?.recoverable ?? false,
        });
      }
    }
  }

  const processEvidence = [...perProcess.values()]
    .map((state) => ({
      ...state,
      sourceMessages: state.sourceMessages.size,
      reconciled: state.missingTargets === 0 && state.orphanTargets === 0,
    }))
    .sort((a, b) => a.processCode.localeCompare(b.processCode));

  const evidence = {
    generatedAt: new Date().toISOString(),
    cutoff: after,
    allowedSenderCount: allowedSenders.length,
    sourceMessages: emails.length,
    sourceAttachments,
    exactMatches,
    emailsWithoutKnownProcess,
    targetAttachmentRows: targetRows.length,
    targetOrphans: targetRows.filter((row) => row.orphaned).length,
    targetRecoverable: targetRows.filter((row) => row.recoverable).length,
    processesWithEmailSource: processEvidence.length,
    processEvidence,
    exceptions,
  };
  await writeFile(outPath, `${JSON.stringify(evidence, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
  await chmod(outPath, 0o600);
  console.log(
    JSON.stringify({
      sourceMessages: evidence.sourceMessages,
      sourceAttachments: evidence.sourceAttachments,
      exactMatches: evidence.exactMatches,
      exceptions: evidence.exceptions.length,
      processesWithEmailSource: evidence.processesWithEmailSource,
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
