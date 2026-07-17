import fs from 'fs/promises';
import path from 'path';
import { createHash, randomUUID } from 'crypto';
import { fileTypeFromBuffer } from 'file-type';
import pdfParse from 'pdf-parse';
import * as XLSX from 'xlsx';
import { eq, desc, count, sql, ilike, and, gte } from 'drizzle-orm';
import { db } from '../../shared/database/connection.js';
import {
  emailAttachmentDocuments,
  emailIngestionLogs,
  importProcesses,
  followUpTracking,
} from '../../shared/database/schema.js';
import { documentService } from '../documents/service.js';
import { gmailService } from './gmail.service.js';
import { resolveSharedMailbox } from './gmail.service.js';
import { imapService } from './imap.service.js';
import { logger } from '../../shared/utils/logger.js';
import { auditService } from '../audit/service.js';
import { alertService } from '../alerts/service.js';
import { aiService, type EmailAnalysisResult } from '../ai/service.js';
import {
  extractMailboxAddress,
  isAllowedSenderFromEnv,
  isEmailAllowedByPatterns,
} from './sender-policy.js';

import { UPLOAD_DIR } from '../../shared/config/paths.js';

const MAX_EMAIL_ATTACHMENT_BYTES =
  Number(process.env.EMAIL_ATTACHMENT_MAX_BYTES) || 50 * 1024 * 1024;

const SUPPORTED_ATTACHMENT_MIMES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
];

const EMAIL_ATTACHMENT_EXT_MIME_ALIASES: Record<string, Set<string>> = {
  '.pdf': new Set(['application/pdf']),
  '.xlsx': new Set([
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/zip',
  ]),
  '.xls': new Set(['application/vnd.ms-excel', 'application/x-cfb']),
};

const MAX_STORED_EMAIL_BODY_CHARS = Number(process.env.EMAIL_BODY_MAX_CHARS) || 20000;

type EmailAttachment = {
  filename: string;
  contentType?: string;
  content: Buffer;
  size?: number;
};

type FetchedEmailForProcessing = {
  messageId: string;
  gmailId: string;
  from: string;
  subject: string;
  body: string;
  date: Date;
  attachments: EmailAttachment[];
};

function storedEmailBody(body: string | null | undefined): string | null {
  const normalized = (body ?? '').replace(/\r\n/g, '\n').trim();
  if (!normalized) return null;
  return normalized.slice(0, MAX_STORED_EMAIL_BODY_CHARS);
}

async function markEmailAsReadAfterDurableLog(
  email: FetchedEmailForProcessing,
  usingGmail: boolean,
): Promise<void> {
  try {
    if (usingGmail) {
      await gmailService.markAsRead(email.gmailId);
    } else {
      await imapService.markAsRead(email.gmailId);
    }
  } catch (err) {
    logger.warn(
      { err, messageId: email.messageId, transportId: email.gmailId, usingGmail },
      'Email processed but could not be marked as read',
    );
  }
}

function sha256(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

async function findExistingAttachmentDocument(processId: number, contentSha256: string) {
  const [existing] = await db
    .select({
      documentId: emailAttachmentDocuments.documentId,
      filename: emailAttachmentDocuments.filename,
      messageId: emailAttachmentDocuments.messageId,
    })
    .from(emailAttachmentDocuments)
    .where(
      and(
        eq(emailAttachmentDocuments.processId, processId),
        eq(emailAttachmentDocuments.contentSha256, contentSha256),
        sql`${emailAttachmentDocuments.documentId} IS NOT NULL`,
      ),
    )
    .limit(1);
  return existing ?? null;
}

async function recordEmailAttachmentDocument(values: {
  emailLogId: number;
  documentId?: number | null;
  processId?: number | null;
  processCode?: string | null;
  messageId: string;
  transportId?: string | null;
  attachmentIndex: number;
  filename: string;
  contentSha256: string;
  fileSize?: number | null;
  storagePath?: string | null;
  sistemaFileId?: string | null;
  documentType?: string | null;
  status: string;
  orphaned: boolean;
  recoverable: boolean;
}) {
  await db
    .insert(emailAttachmentDocuments)
    .values({
      emailLogId: values.emailLogId,
      documentId: values.documentId ?? null,
      processId: values.processId ?? null,
      processCode: values.processCode ?? null,
      messageId: values.messageId,
      transportId: values.transportId ?? null,
      attachmentIndex: values.attachmentIndex,
      filename: values.filename,
      contentSha256: values.contentSha256,
      fileSize: values.fileSize ?? null,
      storagePath: values.storagePath ?? null,
      sistemaFileId: values.sistemaFileId ?? null,
      documentType: values.documentType ?? null,
      status: values.status,
      orphaned: values.orphaned,
      recoverable: values.recoverable,
      updatedAt: new Date(),
    })
    .onConflictDoNothing();
}

function isDetectedEmailAttachmentAllowed(filename: string, detectedMime: string): boolean {
  const ext = path.extname(filename).toLowerCase();
  return Boolean(EMAIL_ATTACHMENT_EXT_MIME_ALIASES[ext]?.has(detectedMime));
}

function isSupportedAttachmentByNameOrMime(att: EmailAttachment): boolean {
  const filename = att.filename.toLowerCase();
  const contentType = att.contentType?.toLowerCase() ?? '';
  return (
    SUPPORTED_ATTACHMENT_MIMES.some((mime) => contentType.includes(mime)) ||
    filename.endsWith('.pdf') ||
    filename.endsWith('.xlsx') ||
    filename.endsWith('.xls')
  );
}

async function validateEmailAttachment(att: EmailAttachment): Promise<{
  ok: boolean;
  skipReason?: string;
  detectedMime?: string;
}> {
  const attachmentSize = att.content.byteLength;
  if (attachmentSize > MAX_EMAIL_ATTACHMENT_BYTES) {
    return {
      ok: false,
      skipReason: `Arquivo excede o limite de ${Math.round(MAX_EMAIL_ATTACHMENT_BYTES / 1024 / 1024)} MB`,
    };
  }

  if (!isSupportedAttachmentByNameOrMime(att)) {
    return {
      ok: false,
      skipReason: `Tipo de arquivo não suportado: ${att.contentType}`,
    };
  }

  const detected = await fileTypeFromBuffer(att.content);
  if (!detected || !isDetectedEmailAttachmentAllowed(att.filename, detected.mime)) {
    return {
      ok: false,
      detectedMime: detected?.mime,
      skipReason: 'Tipo de arquivo incompatível com o conteúdo do anexo',
    };
  }

  return { ok: true, detectedMime: detected.mime };
}

// ── Regex-based process code extraction (fast, first pass) ──────────────

/**
 * Extract ALL process codes from text, sorted by specificity (longest first).
 *
 * Patterns are restricted to the REAL Uni.co process-code formats (Imaginarium
 * "IM" + 7 dígitos + sufixo, Puket "PK" + 7 dígitos + sufixo, mais IMP-AAAA-NNN
 * e IMAGINARIUM-…). Os antigos catch-alls genéricos (LETRAS-AAAA-NNN e
 * AAAA/NNNNN) foram removidos porque capturavam números de PI (PI-2024-042),
 * de invoice (INV-2025-00123), NCM, telefones e datas como se fossem código de
 * processo (UAT Odett #1). O gate final continua sendo o fuzzyMatchProcessCode
 * contra o banco — nada vira processo só por casar o regex.
 */
function extractAllProcessCodes(text: string): string[] {
  const patterns = [
    /\b(IMP[-_]?\d{4}[-_]?\d{3,})\b/gi,
    /\b(PU?K(?:ET)?[-_]?\d{6,8}[A-Z]{0,4})\b/gi,
    /\b(IMAG(?:INARIUM)?[-_]?\d{6,8}[A-Z]{0,4})\b/gi,
    /\b(IM\d{6,8}[A-Z]{0,4})\b/gi,
  ];

  const seen = new Set<string>();
  const all: string[] = [];

  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      const code = match[1].toUpperCase();
      if (!seen.has(code)) {
        seen.add(code);
        all.push(code);
      }
    }
  }

  // Sort by length descending — longer codes are more specific
  all.sort((a, b) => b.length - a.length);
  return all;
}

/**
 * A code is "strong" only if it matches the canonical Uni.co process format
 * (IM/PK + exactly 7 digits + optional 0–4 letter suffix, e.g. IM0712602NB,
 * PK2042602NB). Used as the gate for AUTO-CREATING a process: weak candidates
 * (IMP-AAAA-NNN, fuzzy regex hits, AI guesses) must never spawn a new process
 * — they degrade to an operator alert instead (UAT Odett #1).
 */
function isStrongUnicoCode(code: string): boolean {
  return /^(?:IM|PK)\d{7}[A-Z]{0,4}$/i.test(code.replace(/[-_\s]/g, ''));
}

import { classifyDocument } from './classify-document.js';
export { classifyDocument };

// ── AI-enhanced document classification using email body context ─────────

function classifyDocumentWithContext(
  filename: string,
  aiAnalysis: EmailAnalysisResult | null,
): string {
  // First try filename-based classification
  const filenameType = classifyDocument(filename);
  if (filenameType !== 'other') return filenameType;

  // If filename is generic (e.g. "document.pdf", "scan001.pdf"), use AI context
  if (!aiAnalysis || aiAnalysis.documentTypes.length === 0) return filenameType;

  // Map AI document type mentions to our classification types.
  // Note: 'draft' and 'draft_bl' both route to draft_bl so the getComparison
  // draftBlRevisions feature actually receives documents via the email path.
  // 'correction' stays as 'other' — there is no correction type in the DB
  // enum yet; the operator handles these via the manual upload UI.
  const typeMapping: Record<string, string> = {
    invoice: 'invoice',
    fatura: 'invoice',
    commercial_invoice: 'invoice',
    proforma: 'proforma_invoice',
    proforma_invoice: 'proforma_invoice',
    pro_forma: 'proforma_invoice',
    pro_forma_invoice: 'proforma_invoice',
    fatura_pro_forma: 'proforma_invoice',
    packing_list: 'packing_list',
    packing: 'packing_list',
    romaneio: 'packing_list',
    ohbl: 'ohbl',
    bl: 'ohbl',
    bill_of_lading: 'ohbl',
    draft: 'draft_bl',
    draft_bl: 'draft_bl',
    rascunho_bl: 'draft_bl',
    draft_bill_of_lading: 'draft_bl',
    duimp: 'duimp',
    draft_duimp: 'draft_duimp',
    minuta_duimp: 'draft_duimp',
    rascunho_duimp: 'draft_duimp',
    espelho: 'espelho',
    li: 'li',
    licenca: 'li',
    licenca_de_importacao: 'li',
    certificate: 'certificate',
    certificado: 'certificate',
    cert_of_origin: 'certificate',
    certificate_of_origin: 'certificate',
    certificado_de_origem: 'certificate',
    quality_certificate: 'certificate',
    phytosanitary_certificate: 'certificate',
    certificado_fitossanitario: 'certificate',
    fumigation_certificate: 'certificate',
    certificado_de_fumigacao: 'certificate',
    inmetro: 'certificate',
    anvisa: 'certificate',
    correction: 'other',
  };

  // If AI detected exactly one document type, use it for generic filenames
  if (aiAnalysis.documentTypes.length === 1) {
    const aiType = aiAnalysis.documentTypes[0].toLowerCase().replace(/\s+/g, '_');
    return typeMapping[aiType] || filenameType;
  }

  // If multiple types detected, try to match with filename hints
  for (const dt of aiAnalysis.documentTypes) {
    const aiType = dt.toLowerCase().replace(/\s+/g, '_');
    const mapped = typeMapping[aiType];
    if (mapped && mapped !== 'other') return mapped;
  }

  return filenameType;
}

async function extractAttachmentTextForClassification(att: EmailAttachment): Promise<string> {
  const filename = att.filename.toLowerCase();
  const contentType = att.contentType?.toLowerCase() ?? '';
  try {
    if (filename.endsWith('.pdf') || contentType.includes('pdf')) {
      const parsed = await pdfParse(att.content);
      return parsed.text ?? '';
    }
    if (
      filename.endsWith('.xlsx') ||
      filename.endsWith('.xls') ||
      contentType.includes('spreadsheet') ||
      contentType.includes('excel')
    ) {
      const workbook = XLSX.read(att.content, { type: 'buffer' });
      return workbook.SheetNames.slice(0, 5)
        .map((sheetName) => {
          const sheet = workbook.Sheets[sheetName];
          return `--- Sheet: ${sheetName} ---\n${XLSX.utils.sheet_to_csv(sheet)}`;
        })
        .join('\n');
    }
  } catch (err) {
    logger.warn(
      { err, filename: att.filename },
      'Attachment text classification extraction failed',
    );
  }
  return '';
}

// ── Regex-based document type extraction from text ──────────────────────

function extractDocumentTypesFromText(text: string): string[] {
  const lower = text.toLowerCase();
  const types: string[] = [];

  // Proforma MUST be checked before "invoice" to win the type assignment.
  if (/\b(proforma|pro[\s-]?forma)(\s+invoice)?\b/.test(lower)) types.push('proforma_invoice');
  if (
    /\b(invoice|fatura|commercial\s+invoice)\b/.test(lower) &&
    !types.includes('proforma_invoice')
  )
    types.push('invoice');
  if (/\b(packing\s*list|romaneio|lista\s+de\s+embarque)\b/.test(lower)) types.push('packing_list');
  // Draft BL BEFORE final BL so a body mentioning "draft BL" is detected.
  if (/\b(draft\s+bl|draft\s+bill|rascunho\s+(do\s+)?bl|bl\s+draft|preliminary\s+bl)\b/.test(lower))
    types.push('draft_bl');
  if (/\b(draft\s+duimp|minuta\s+duimp|rascunho\s+(da\s+)?duimp)\b/.test(lower))
    types.push('draft_duimp');
  if (/\bduimp\b/.test(lower) && !types.includes('draft_duimp')) types.push('duimp');
  if (
    /\b(bill\s+of\s+lading|conhecimento\s+de\s+embarque|ohbl)\b|(?:^|[^a-z])bl(?:$|[^a-z])/.test(
      lower,
    )
  )
    types.push('ohbl');
  if (/\b(espelho)\b/.test(lower)) types.push('espelho');
  if (/\b(licen[çc]a\s+de\s+importa[çc][aã]o)\b|(?:^|[^a-z])li(?:$|[^a-z])/.test(lower))
    types.push('li');
  if (
    /\b(certificado|certificate|cert\s+of\s+origin|fito(ssanit[aá]rio)?|phyto|fumiga[çc][aã]o|ispm|inmetro|anvisa)\b/.test(
      lower,
    )
  )
    types.push('certificate');

  return [...new Set(types)];
}

// ── Regex-based email category detection ────────────────────────────────

function detectEmailCategory(subject: string, body: string): EmailAnalysisResult['emailCategory'] {
  // KIOM system emails — detect before generic checks
  if (/\[KIOM\]\s*PreConf\b/i.test(subject)) return 'pre_confirmation';
  if (/\[KIOM\]\s*TSent\b/i.test(subject)) return 'tracking_sent';

  const text = `${subject} ${body.substring(0, 1000)}`.toLowerCase();

  if (/\b(corre[çc][aã]o|revis[aã]o|retifica[çc][aã]o|amended|correction|revised)\b/.test(text))
    return 'correction';
  if (/\b(pagamento|payment|c[aâ]mbio|wire\s+transfer|remessa)\b/.test(text)) return 'payment';
  if (/\b(follow[\s-]?up|acompanhamento|status|atualiza[çc][aã]o|update|pend[eê]ncia)\b/.test(text))
    return 'follow_up';
  if (/\b(novo\s+embarque|new\s+shipment|nova\s+importa[çc][aã]o|booking\s+confirm)\b/.test(text))
    return 'new_shipment';
  if (/\b(segue|anexo|attached|enclosed|documento|document)\b/.test(text))
    return 'document_delivery';

  return 'general';
}

// ── Regex-based urgency detection ───────────────────────────────────────

function detectUrgency(subject: string, body: string): EmailAnalysisResult['urgencyLevel'] {
  const text = `${subject} ${body.substring(0, 500)}`.toLowerCase();

  if (/\b(urgent[eí]ssimo|asap|imediato|immediately|critical)\b/.test(text)) return 'critical';
  if (/\b(urgente|urgent|prioridade|priority|prazo\s+curto|deadline)\b/.test(text)) return 'urgent';

  return 'normal';
}

// ── Regex-based invoice number extraction ────────────────────────────────

function extractInvoiceNumbers(text: string): string[] {
  const patterns = [
    /\b(?:INV|INVOICE|FATURA)[-\s#.:]*(\w{2,20}[-/]?\d{3,})\b/gi,
    /\b(\d{2,4}[-/]\d{4,})\b/g,
  ];

  const numbers: string[] = [];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      numbers.push(match[1] || match[0]);
    }
  }

  return [...new Set(numbers)].slice(0, 10);
}

// ── Brand detection ─────────────────────────────────────────────────────

function detectBrand(subject: string, from: string): 'puket' | 'imaginarium' {
  const text = `${subject} ${from}`.toLowerCase();
  if (text.includes('imaginarium') || text.includes('imag')) return 'imaginarium';
  return 'puket';
}

// ── Allowed sender filter ───────────────────────────────────────────────

export function isAllowedSender(from: string): boolean {
  return isAllowedSenderFromEnv(from, process.env.EMAIL_ALLOWED_SENDERS);
}

// ── Fuzzy process code matching against DB ──────────────────────────────

function escapeLikePattern(str: string): string {
  return str.replace(/[%_\\]/g, '\\$&');
}

/**
 * Resolve a candidate code to exactly ONE import process.
 *
 * Hardening (UAT Odett #1): the old version did `ilike '%code%'` plus a
 * per-digit wildcard expansion (`(\d+)` → `%$1%`), so a short candidate like
 * `0712` casava espuriamente com `IM0712602NB`, e qualquer fragmento numérico
 * "achava" um processo. Agora:
 *   1. Exact / case-insensitive match continuam sendo o caminho forte.
 *   2. O partial-match (substring) só roda para candidatos com comprimento
 *      normalizado >= 7 (um código Uni.co tem >= 9 chars: IM + 7 dígitos),
 *      eliminando fragmentos curtos de PI/invoice/NCM.
 *   3. O wildcard de dígitos foi REMOVIDO.
 *   4. ORDER BY determinístico (match exato primeiro, depois updatedAt desc)
 *      para que o resultado não dependa da ordem física das linhas.
 *   5. AMBIGUIDADE: se o substring casar MAIS DE UM processo, NÃO auto-vincula
 *      — retorna null para que o operador revise em vez de adivinharmos.
 */
async function fuzzyMatchProcessCode(
  code: string,
): Promise<{ id: number; processCode: string } | null> {
  // Try exact match first
  const [exact] = await db
    .select({ id: importProcesses.id, processCode: importProcesses.processCode })
    .from(importProcesses)
    .where(eq(importProcesses.processCode, code))
    .limit(1);
  if (exact) return exact;

  // Try case-insensitive match (whole-string equality, ilike with no wildcards)
  const [caseInsensitive] = await db
    .select({ id: importProcesses.id, processCode: importProcesses.processCode })
    .from(importProcesses)
    .where(ilike(importProcesses.processCode, escapeLikePattern(code)))
    .limit(1);
  if (caseInsensitive) return caseInsensitive;

  // Partial (substring) match — only for candidates long enough to be specific.
  // A real Uni.co code normalizes to >= 9 chars; we require >= 7 to allow the
  // IMP-AAAA-NNN family while rejecting short numeric fragments.
  const normalizedCode = code.replace(/[-_]/g, '').toUpperCase();
  if (normalizedCode.length < 7) return null;

  const escaped = escapeLikePattern(normalizedCode);
  const partialMatches = await db
    .select({ id: importProcesses.id, processCode: importProcesses.processCode })
    .from(importProcesses)
    .where(ilike(importProcesses.processCode, `%${escaped}%`))
    // Deterministic: exact-on-normalized first, then most-recently-updated.
    .orderBy(
      sql`CASE WHEN UPPER(REPLACE(REPLACE(${importProcesses.processCode}, '-', ''), '_', '')) = ${normalizedCode} THEN 0 ELSE 1 END`,
      desc(importProcesses.updatedAt),
    )
    .limit(2);

  if (partialMatches.length === 0) return null;

  // Ambiguity guard: more than one candidate process → do NOT auto-link.
  // A single distinct normalized match is still fine even if it appears twice.
  if (partialMatches.length > 1) {
    const distinct = new Set(partialMatches.map((p) => p.id));
    if (distinct.size > 1) {
      logger.warn(
        { code, candidates: partialMatches.map((p) => p.processCode) },
        'Ambiguous process-code match — refusing to auto-link, flagging for review',
      );
      return null;
    }
  }

  return partialMatches[0];
}

// ── AI email analysis (non-blocking) ────────────────────────────────────

async function analyzeEmailWithAI(
  subject: string,
  body: string,
  fromAddress: string,
): Promise<EmailAnalysisResult | null> {
  try {
    const result = await aiService.analyzeEmail(subject, body, fromAddress);
    return result;
  } catch (err) {
    logger.warn({ err }, 'AI email analysis failed, falling back to regex-only');
    return null;
  }
}

// ── Main processor ──────────────────────────────────────────────────────

export const emailProcessor = {
  async processNewEmails(includeRead = false, gmailQuery?: string) {
    // Prefer Gmail API (service account), fall back to IMAP
    let emails: FetchedEmailForProcessing[];
    const usingGmail = gmailService.isConfigured();
    if (usingGmail) {
      logger.info({ includeRead, gmailQuery }, 'Using Gmail API for email ingestion');
      emails = await gmailService.fetchUnseenEmails(includeRead, gmailQuery);
    } else {
      logger.info('Gmail API not configured, falling back to IMAP');
      emails = await imapService.fetchUnseenEmails();
    }

    for (const email of emails) {
      const [existing] = await db
        .select()
        .from(emailIngestionLogs)
        .where(eq(emailIngestionLogs.messageId, email.messageId))
        .limit(1);

      if (existing) {
        logger.debug({ messageId: email.messageId }, 'Email already processed, skipping');
        await markEmailAsReadAfterDurableLog(email, usingGmail);
        continue;
      }

      // Filter by allowed senders. This is enforced even for manual Gmail
      // queries to prevent an operator query from bypassing the allowlist.
      if (!isAllowedSender(email.from)) {
        logger.debug({ from: email.from }, 'Email from non-allowed sender, ignoring');
        await db.insert(emailIngestionLogs).values({
          messageId: email.messageId,
          fromAddress: email.from,
          subject: email.subject,
          receivedAt: email.date,
          attachmentsCount: email.attachments.length,
          bodyText: storedEmailBody(email.body),
          status: 'ignored',
          errorMessage: 'Remetente não autorizado',
        });
        await markEmailAsReadAfterDurableLog(email, usingGmail);
        continue;
      }

      const [logEntry] = await db
        .insert(emailIngestionLogs)
        .values({
          messageId: email.messageId,
          fromAddress: email.from,
          subject: email.subject,
          receivedAt: email.date,
          attachmentsCount: email.attachments.length,
          bodyText: storedEmailBody(email.body),
          status: 'processing',
        })
        .returning();

      try {
        // Detect email category early for KIOM handling
        const earlyCategory = detectEmailCategory(email.subject, email.body || '');
        const isKiomEmail =
          earlyCategory === 'pre_confirmation' || earlyCategory === 'tracking_sent';

        if (email.attachments.length === 0 && !isKiomEmail) {
          await db
            .update(emailIngestionLogs)
            .set({ status: 'ignored', errorMessage: 'Sem anexos relevantes' })
            .where(eq(emailIngestionLogs.id, logEntry.id));
          await markEmailAsReadAfterDurableLog(email, usingGmail);
          continue;
        }

        // ── Step 1: Extract ALL process codes from subject (fast) ────
        const allCodes = extractAllProcessCodes(email.subject);
        let detectionMethod: 'regex_subject' | 'regex_body' | 'ai' | null =
          allCodes.length > 0 ? 'regex_subject' : null;

        // ── Step 2: Also try regex on body for more candidates ───────
        if (email.body) {
          const bodyCodes = extractAllProcessCodes(email.body.substring(0, 3000));
          for (const bc of bodyCodes) {
            if (!allCodes.includes(bc)) allCodes.push(bc);
          }
          if (!detectionMethod && allCodes.length > 0) detectionMethod = 'regex_body';
        }

        // Pick the first candidate for now; Step 6 will try all against DB
        let processCode = allCodes.length > 0 ? allCodes[0] : null;

        // ── Step 3: Regex-based document type & category detection ────
        const regexDocTypes = extractDocumentTypesFromText(
          `${email.subject} ${(email.body || '').substring(0, 3000)}`,
        );
        const regexCategory = detectEmailCategory(email.subject, email.body || '');
        const regexInvoiceNumbers = extractInvoiceNumbers(
          `${email.subject} ${(email.body || '').substring(0, 3000)}`,
        );

        // ── Step 4: AI analysis - SKIP only if regex resolved the process
        //    code AND every attachment classifies by filename. If ANY
        //    attachment falls into 'other' (e.g. an INV named only with the
        //    process code, IM0712602NB.pdf), we MUST run the AI so the email
        //    body can lend the document type — never skip into a silent
        //    'other' without an extractor (UAT Odett #7a). ─────────
        let aiAnalysis: EmailAnalysisResult | null = null;
        const hasUnclassifiedAttachment = email.attachments.some(
          (att) => classifyDocument(att.filename) === 'other',
        );
        const allAttachmentsClassified = !hasUnclassifiedAttachment;

        if (processCode && allAttachmentsClassified) {
          // Regex fully resolved - build a synthetic analysis from regex results
          logger.info(
            { processCode, detectionMethod, docTypes: regexDocTypes, category: regexCategory },
            'Skipping AI analysis: regex fully resolved',
          );
          aiAnalysis = {
            processCode,
            documentTypes: regexDocTypes,
            invoiceNumbers: regexInvoiceNumbers,
            urgencyLevel: detectUrgency(email.subject, email.body || ''),
            emailCategory: regexCategory,
            keyDates: [],
            supplierName: null,
          };
        } else if (email.body || email.subject) {
          aiAnalysis = await analyzeEmailWithAI(email.subject, email.body || '', email.from);
        }

        // ── Step 5: Use AI process code if regex failed ──────────────
        // The AI-suggested code is gated through the SAME restricted Uni.co
        // regex used by the regex pass: an LLM can disobey the prompt and
        // return a PI/INV/PO/NCM number, which must NEVER enter the candidate
        // list and substring-match a real process (UAT Odett #1).
        const aiPlausibleCode = aiAnalysis?.processCode
          ? (extractAllProcessCodes(aiAnalysis.processCode)[0] ?? null)
          : null;
        if (aiAnalysis?.processCode && !aiPlausibleCode) {
          logger.info(
            { aiCode: aiAnalysis.processCode },
            'AI process code ignored — does not match Uni.co format',
          );
        }
        if (!processCode && aiPlausibleCode) {
          processCode = aiPlausibleCode;
          detectionMethod = 'ai';
          logger.info({ processCode, method: 'ai' }, 'Process code detected via AI');
        }

        // ── Step 6: Resolve process in DB — try ALL candidates ────────
        let processId: number | null = null;

        // Add AI-detected code to candidates ONLY when it matches the Uni.co format.
        if (aiPlausibleCode && !allCodes.includes(aiPlausibleCode)) {
          allCodes.push(aiPlausibleCode);
        }

        // Try each candidate code against the DB, best match first
        if (allCodes.length > 0) {
          for (const candidate of allCodes) {
            const matched = await fuzzyMatchProcessCode(candidate);
            if (matched) {
              processId = matched.id;
              processCode = matched.processCode;
              logger.info(
                { candidate, processCode, processId, allCodes },
                'Process resolved from candidate list',
              );
              break;
            }
          }
        }

        if (processCode && !processId) {
          // None of the candidates matched — fall back to auto-create logic
          const matched = await fuzzyMatchProcessCode(processCode);
          if (matched) {
            processId = matched.id;
            processCode = matched.processCode;
          } else if (!isStrongUnicoCode(processCode)) {
            // Weak candidate (generic/low-confidence code that didn't match the
            // DB). NÃO criar processo — só códigos no formato forte Uni.co
            // (IM/PK + 7 dígitos) justificam auto-criação. Anexa como "não
            // classificado" e alerta o operador (UAT Odett #1).
            try {
              await alertService.create({
                severity: 'warning',
                title: 'Email recebido com código de processo não reconhecido',
                message: `O codigo "${processCode}" nao casa nenhum processo existente e nao tem o formato forte Uni.co (IM/PK + 7 digitos), portanto NAO foi criado automaticamente. Revise manualmente. Assunto: ${email.subject}`,
              });
            } catch (alertErr) {
              logger.warn(
                { err: alertErr, processCode },
                'Failed to create alert for weak/unmatched process code',
              );
            }
            logger.info(
              { processCode, allCodes },
              'Weak process-code candidate — not auto-creating; attachments stay unclassified',
            );
            // Leave processId null: attachments are saved locally below and the
            // log is marked accordingly (Step 9 handles the unlinked case).
          } else {
            const autoCreateEnabled = process.env.FOLLOW_UP_AUTO_CREATE !== '0';

            if (!autoCreateEnabled) {
              // Feature flag disabled: do not create, just alert operator
              try {
                await alertService.create({
                  severity: 'warning',
                  title: 'Email recebido para processo inexistente',
                  message: `O codigo "${processCode}" nao foi encontrado no sistema e a criacao automatica via follow-up esta desativada. Crie o processo manualmente a partir do Pre-Cons. Assunto: ${email.subject}`,
                });
              } catch (alertErr) {
                logger.warn(
                  { err: alertErr, processCode },
                  'Failed to create alert for missing process (auto-create disabled)',
                );
              }
              await db
                .update(emailIngestionLogs)
                .set({
                  status: 'ignored',
                  errorMessage:
                    'Processo nao encontrado e FOLLOW_UP_AUTO_CREATE=0 — criacao automatica desativada',
                })
                .where(eq(emailIngestionLogs.id, logEntry.id));
              await markEmailAsReadAfterDurableLog(email, usingGmail);
              continue;
            }

            // Create new process (fallback path — tagged for operator review)
            const brand = detectBrand(email.subject, email.from);
            const [newProcess] = await db
              .insert(importProcesses)
              .values({
                processCode,
                brand,
                status: 'draft',
                logisticStatus: 'consolidation',
                notes: 'Criado via follow-up — confirme referência no Pre-Cons.',
              })
              .returning();
            processId = newProcess.id;

            await db.insert(followUpTracking).values({ processId: newProcess.id });
            logger.info(
              { processCode, processId: newProcess.id },
              'New process created from email (follow-up fallback)',
            );

            try {
              await alertService.create({
                processId: newProcess.id,
                severity: 'warning',
                title: 'Processo criado via follow-up (confirme no Pre-Cons)',
                message: `O processo "${processCode}" foi criado automaticamente a partir de um email (assunto: ${email.subject}). Confirme a referencia na planilha Pre-Cons antes de prosseguir.`,
              });
            } catch (alertErr) {
              logger.warn(
                { err: alertErr, processCode, processId: newProcess.id },
                'Failed to create warning alert for follow-up auto-created process',
              );
            }
          }
        }

        // ── Step 6.5: KIOM email handling (PreConf / TSent) ──────────
        if (isKiomEmail && processId) {
          const kiomNote =
            earlyCategory === 'pre_confirmation'
              ? `Pré-confirmação KIOM recebida via email: ${email.subject}`
              : `Tracking KIOM enviado via email: ${email.subject}`;

          if (earlyCategory === 'tracking_sent') {
            // Set shipmentDate to email date
            await db
              .update(importProcesses)
              .set({
                ...(email.date
                  ? { shipmentDate: new Date(email.date).toISOString().split('T')[0] }
                  : {}),
                notes: sql`COALESCE(${importProcesses.notes}, '') || ${'\n' + kiomNote}`,
              })
              .where(eq(importProcesses.id, processId));
          } else {
            // PreConf — just add a note
            await db
              .update(importProcesses)
              .set({
                notes: sql`COALESCE(${importProcesses.notes}, '') || ${'\n' + kiomNote}`,
              })
              .where(eq(importProcesses.id, processId));
          }

          logger.info({ processId, category: earlyCategory }, 'KIOM email processed');
        }

        // If KIOM email with no attachments, mark as completed and continue
        if (isKiomEmail && email.attachments.length === 0) {
          await db
            .update(emailIngestionLogs)
            .set({
              status: 'completed',
              processId,
              processCode,
              processedAttachments: {
                attachments: [],
                detectionMethod,
                kiomCategory: earlyCategory,
              },
            })
            .where(eq(emailIngestionLogs.id, logEntry.id));

          logger.info(
            {
              messageId: email.messageId,
              processCode,
              category: earlyCategory,
            },
            'KIOM email processed (no attachments)',
          );
          await markEmailAsReadAfterDurableLog(email, usingGmail);
          continue;
        }

        // ── Step 6.7: Detect Vimbar approval — lock the process ──────
        // Nicolas (2026-05-21): "A partir da aprovação aqui não é pra ter
        // mais mudança." The freight agent's approval email closes the
        // process for further automated edits. Subject "é sempre o mesmo
        // assunto" — we match on "vimbar" + an approval signal.
        // Operator kill switch: set VIMBAR_AUTO_LOCK=0 to disable.
        // Sender safety: require sender domain to match VIMBAR_SENDER_DOMAINS
        // (comma-separated). Without this, any external sender could lock
        // a process by including the right keywords.
        if (processId && process.env.VIMBAR_AUTO_LOCK !== '0') {
          const VIMBAR_RE = /\bvimbar\b/i;
          const APPROVAL_RE = /\b(aprov|approv|liberad|libera[cç][aã]o)/i;
          const haystack = `${email.subject ?? ''}\n${email.body ?? ''}`;
          const isVimbarApproval = VIMBAR_RE.test(haystack) && APPROVAL_RE.test(haystack);

          const allowedDomains = (process.env.VIMBAR_SENDER_DOMAINS ?? '')
            .split(',')
            .map((d) => d.trim().toLowerCase())
            .filter(Boolean);
          const senderLower = extractMailboxAddress(email.from ?? '');
          const senderAllowed =
            allowedDomains.length === 0
              ? false /* fail-closed when no allowlist configured */
              : isEmailAllowedByPatterns(senderLower, allowedDomains);

          if (isVimbarApproval && senderAllowed) {
            try {
              const { processService } = await import('../processes/service.js');
              await processService.lock(processId, 'vimbar_approval', null);
              logger.info(
                { processId, processCode, subject: email.subject, sender: senderLower },
                'Process locked via Vimbar approval email',
              );
            } catch (lockErr) {
              logger.error(
                { err: lockErr, processId, processCode },
                'Failed to lock process after Vimbar approval',
              );
            }
          } else if (isVimbarApproval && !senderAllowed) {
            logger.warn(
              { processId, processCode, sender: senderLower, allowedDomains },
              'Vimbar keywords detected but sender domain not in VIMBAR_SENDER_DOMAINS allowlist — lock skipped',
            );
          }
        }

        // ── Step 6.8: Detect Pre-Cons spreadsheet ─────────────────────
        const isPreCons =
          /pre.?cons/i.test(email.subject) ||
          email.attachments.some((att) => /pre.?cons/i.test(att.filename));

        if (isPreCons) {
          const preConsAttachment =
            email.attachments.find((att) => {
              const filename = att.filename.toLowerCase();
              return (
                (filename.endsWith('.xlsx') || filename.endsWith('.xls')) &&
                /pre.?cons/i.test(filename)
              );
            }) ||
            email.attachments.find((att) => {
              const filename = att.filename.toLowerCase();
              return filename.endsWith('.xlsx') || filename.endsWith('.xls');
            });

          if (preConsAttachment) {
            try {
              const validation = await validateEmailAttachment(preConsAttachment);
              if (!validation.ok) {
                logger.warn(
                  {
                    filename: preConsAttachment.filename,
                    contentType: preConsAttachment.contentType,
                    detectedMime: validation.detectedMime,
                    skipReason: validation.skipReason,
                  },
                  'Pre-Cons sync skipped: invalid email attachment',
                );
              } else {
                const { preConsService } = await import('../pre-cons/service.js');
                const result = await preConsService.syncFromXLSX(
                  preConsAttachment.content,
                  preConsAttachment.filename,
                  'email',
                );

                logger.info(
                  {
                    messageId: email.messageId,
                    fileName: preConsAttachment.filename,
                    totalRows: result.totalRows,
                    divergences: result.divergences?.length ?? 0,
                  },
                  'Pre-Cons auto-synced from email attachment',
                );

                await db
                  .update(emailIngestionLogs)
                  .set({
                    status: 'completed',
                    processCode: 'PRE_CONS_SYNC',
                    processedAttachments: {
                      attachments: [
                        {
                          filename: preConsAttachment.filename,
                          type: 'pre_cons',
                          status: 'processed',
                        },
                      ],
                      syncResult: {
                        totalRows: result.totalRows,
                        created: result.created,
                        divergences: result.divergences?.length ?? 0,
                      },
                    },
                  })
                  .where(eq(emailIngestionLogs.id, logEntry.id));

                await markEmailAsReadAfterDurableLog(email, usingGmail);
                continue; // Skip normal attachment processing
              }
            } catch (preConsErr) {
              logger.error(
                { err: preConsErr, filename: preConsAttachment.filename },
                'Pre-Cons sync from email failed, continuing with normal processing',
              );
            }
          }
        }

        // ── Step 7: Process attachments ──────────────────────────────
        const processedAttachments: Array<{
          filename: string;
          type: string;
          status?: 'processed' | 'skipped';
          skipReason?: string;
          documentId?: number;
          sourceMessageId?: string;
          sourceTransportId?: string;
          sourceAttachmentIndex?: number;
          contentSha256?: string;
          size?: number;
          storagePath?: string;
          sistemaFileId?: string;
          orphaned?: boolean;
          recoverable?: boolean;
        }> = [];

        for (const [attachmentIndex, att] of email.attachments.entries()) {
          const contentSha256 = sha256(att.content);
          const sourceMetadata = {
            sourceMessageId: email.messageId,
            sourceTransportId: email.gmailId,
            sourceAttachmentIndex: attachmentIndex,
            contentSha256,
            size: att.size ?? att.content.byteLength,
          };
          const validation = await validateEmailAttachment(att);
          if (!validation.ok) {
            logger.warn(
              {
                filename: att.filename,
                contentType: att.contentType,
                detectedMime: validation.detectedMime,
              },
              'Attachment skipped: unsupported or invalid file type',
            );
            processedAttachments.push({
              filename: att.filename,
              type: 'unsupported',
              status: 'skipped',
              skipReason: validation.skipReason,
              ...sourceMetadata,
            });
            await recordEmailAttachmentDocument({
              emailLogId: logEntry.id,
              processId,
              processCode,
              messageId: email.messageId,
              transportId: email.gmailId,
              attachmentIndex,
              filename: att.filename,
              contentSha256,
              fileSize: sourceMetadata.size,
              documentType: 'unsupported',
              status: 'skipped',
              orphaned: processId == null,
              recoverable: false,
            });
            continue;
          }

          // Use AI-enhanced classification (falls back to filename-only).
          let docType = classifyDocumentWithContext(att.filename, aiAnalysis);

          // Last-resort guarantee (UAT Odett #7a): an attachment must never be
          // silently stored as 'other'. If filename + email-context still yield
          // 'other' but this is the *only* supported attachment and the email
          // detected exactly one document type, adopt that single type.
          if (docType === 'other' && aiAnalysis?.documentTypes?.length === 1) {
            const single = classifyDocumentWithContext('__unknown__.pdf', aiAnalysis);
            if (single !== 'other') {
              docType = single;
              logger.info(
                { filename: att.filename, docType },
                "Recovered 'other' attachment via single email document type",
              );
            }
          }

          if (docType === 'other') {
            const attachmentText = await extractAttachmentTextForClassification(att);
            const contentTypes = extractDocumentTypesFromText(attachmentText.slice(0, 10000));
            if (contentTypes.length === 1) {
              docType = contentTypes[0];
              logger.info(
                { filename: att.filename, docType },
                'Recovered attachment type from attachment content',
              );
            }
          }

          if (docType === 'other') {
            logger.warn(
              { filename: att.filename, processCode },
              "Attachment classified as 'other' after filename, email-context and content checks; flagged for manual review",
            );
          }

          if (processId) {
            const duplicate = await findExistingAttachmentDocument(processId, contentSha256);
            if (duplicate?.documentId) {
              processedAttachments.push({
                filename: att.filename,
                type: docType,
                status: 'skipped',
                skipReason: `duplicate:${duplicate.documentId}`,
                documentId: duplicate.documentId,
                orphaned: false,
                recoverable: false,
                ...sourceMetadata,
              });
              await recordEmailAttachmentDocument({
                emailLogId: logEntry.id,
                documentId: duplicate.documentId,
                processId,
                processCode,
                messageId: email.messageId,
                transportId: email.gmailId,
                attachmentIndex,
                filename: att.filename,
                contentSha256,
                fileSize: sourceMetadata.size,
                documentType: docType,
                status: 'duplicate',
                orphaned: false,
                recoverable: false,
              });
              logger.info(
                { processId, documentId: duplicate.documentId, filename: att.filename },
                'Email attachment skipped: duplicate content hash for process',
              );
              continue;
            }
          }

          await fs.mkdir(UPLOAD_DIR, { recursive: true });
          const safeName = `${Date.now()}-${randomUUID()}-${att.filename.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
          const filePath = path.join(UPLOAD_DIR, safeName);
          await fs.writeFile(filePath, att.content);

          // Upload to Sistema Automatico INBOX
          let sistemaFileId: string | undefined;
          try {
            const { googleDriveService } = await import('../integrations/google-drive.service.js');
            const configured = await googleDriveService.isRootConfigured();
            if (configured) {
              sistemaFileId = await googleDriveService.uploadToSistemaInbox(filePath, att.filename);
            }
          } catch (driveErr) {
            logger.warn(
              { err: driveErr, filename: att.filename },
              'Failed to upload to Sistema INBOX',
            );
          }

          if (processId) {
            const fakeFile = {
              originalname: att.filename,
              path: filePath,
              mimetype: att.contentType,
              size: att.size,
            } as Express.Multer.File;

            const doc = await documentService.upload(processId, docType, fakeFile);

            // Move from INBOX to PROCESSADOS
            if (sistemaFileId && processCode) {
              try {
                const { googleDriveService } =
                  await import('../integrations/google-drive.service.js');
                await googleDriveService.moveFromInboxToProcessados(
                  sistemaFileId,
                  processCode,
                  docType,
                );
              } catch (err) {
                logger.warn({ err }, 'Failed to move file from INBOX to PROCESSADOS');
              }
            }

            processedAttachments.push({
              filename: att.filename,
              type: docType,
              status: 'processed',
              documentId: doc.id,
              storagePath: filePath,
              sistemaFileId,
              orphaned: false,
              recoverable: false,
              ...sourceMetadata,
            });
            await recordEmailAttachmentDocument({
              emailLogId: logEntry.id,
              documentId: doc.id,
              processId,
              processCode,
              messageId: email.messageId,
              transportId: email.gmailId,
              attachmentIndex,
              filename: att.filename,
              contentSha256,
              fileSize: sourceMetadata.size,
              storagePath: filePath,
              sistemaFileId,
              documentType: docType,
              status: 'processed',
              orphaned: false,
              recoverable: false,
            });
          } else {
            processedAttachments.push({
              filename: att.filename,
              type: docType,
              status: 'processed',
              storagePath: filePath,
              sistemaFileId,
              orphaned: true,
              recoverable: true,
              ...sourceMetadata,
            });
            await recordEmailAttachmentDocument({
              emailLogId: logEntry.id,
              processId: null,
              processCode,
              messageId: email.messageId,
              transportId: email.gmailId,
              attachmentIndex,
              filename: att.filename,
              contentSha256,
              fileSize: sourceMetadata.size,
              storagePath: filePath,
              sistemaFileId,
              documentType: docType,
              status: 'orphaned',
              orphaned: true,
              recoverable: true,
            });
          }
        }

        // ── Step 8: Build enriched metadata for storage ──────────────
        const enrichedData: Record<string, any> = {
          attachments: processedAttachments,
          detectionMethod,
        };

        if (aiAnalysis) {
          enrichedData.aiAnalysis = {
            emailCategory: aiAnalysis.emailCategory,
            urgencyLevel: aiAnalysis.urgencyLevel,
            documentTypes: aiAnalysis.documentTypes,
            invoiceNumbers: aiAnalysis.invoiceNumbers,
            keyDates: aiAnalysis.keyDates,
            supplierName: aiAnalysis.supplierName,
          };
        }

        // ── Step 9: Update log with results ──────────────────────────
        const actuallyProcessed = processedAttachments.filter((a) => a.status !== 'skipped');
        const linkedToProcess = actuallyProcessed.some((a) => a.documentId != null);
        const finalStatus = actuallyProcessed.length === 0 ? 'ignored' : 'completed';

        await db
          .update(emailIngestionLogs)
          .set({
            status: finalStatus,
            processId,
            processCode,
            processedAttachments: enrichedData,
            ...(finalStatus === 'ignored'
              ? { errorMessage: 'Todos os anexos possuem tipo não suportado' }
              : !linkedToProcess && actuallyProcessed.length > 0
                ? {
                    errorMessage:
                      'Anexos processados mas nenhum processo identificado — arquivos salvos localmente',
                  }
                : {}),
          })
          .where(eq(emailIngestionLogs.id, logEntry.id));

        // Auditoria 2026-07-17: os dois desfechos abaixo eram INVISÍVEIS fora
        // da tela de email-logs — documento legítimo sumia do radar. Viram
        // alerta acionável. O ASSUNTO entra no TÍTULO de propósito: o dedup do
        // alertService é por título+processId em 24h, e sem o assunto um 2º
        // e-mail DIFERENTE ignorado no mesmo dia seria suprimido (revisão R1).
        const subjectTag = (email.subject || 'sem assunto').slice(0, 60);
        // Só alerta "formato não suportado" quando houve anexo pulado POR
        // FORMATO — e-mail cujos anexos foram todos pulados como DUPLICATA já
        // está no processo; alertar induziria upload manual duplicado.
        const hasUnsupportedSkip = enrichedData.some(
          (att: { status?: string; skipReason?: string }) =>
            att.status === 'skipped' &&
            typeof att.skipReason === 'string' &&
            !att.skipReason.startsWith('duplicate'),
        );
        if (finalStatus === 'ignored' && hasUnsupportedSkip) {
          await alertService
            .create({
              severity: 'warning',
              title: `E-mail ignorado — anexos não suportados: ${subjectTag}`,
              message:
                `Todos os anexos do e-mail "${email.subject}" (de ${email.from}) foram pulados ` +
                `(formato não suportado pela ingestão — aceitos: PDF/XLSX/XLS — ou incompatível ` +
                `com o conteúdo). Se houver documento legítimo (foto, Word), suba manualmente ` +
                `pelo portal — o upload manual aceita imagem/DOCX.`,
            })
            .catch((alertErr) =>
              logger.warn({ err: alertErr }, 'Failed to create unsupported-attachments alert'),
            );
        } else if (!linkedToProcess && actuallyProcessed.length > 0) {
          await alertService
            .create({
              severity: 'warning',
              title: `Anexos sem processo identificado: ${subjectTag}`,
              message:
                `O e-mail "${email.subject}" (de ${email.from}) trouxe ${actuallyProcessed.length} ` +
                `anexo(s) processado(s), mas nenhum código de processo foi identificado. Os ` +
                `arquivos estão salvos e recuperáveis na tela de Ingestão de E-mail — vincule-os ` +
                `ao processo correto.`,
            })
            .catch((alertErr) =>
              logger.warn({ err: alertErr }, 'Failed to create orphaned-attachments alert'),
            );
        }

        auditService.log(
          null,
          'email_processed',
          'email',
          logEntry.id,
          {
            from: email.from,
            subject: email.subject,
            processCode,
            detectionMethod,
            emailCategory: aiAnalysis?.emailCategory,
            urgencyLevel: aiAnalysis?.urgencyLevel,
            attachments: processedAttachments.length,
          },
          null,
        );

        logger.info(
          {
            messageId: email.messageId,
            processCode,
            detectionMethod,
            emailCategory: aiAnalysis?.emailCategory,
            urgencyLevel: aiAnalysis?.urgencyLevel,
            attachments: processedAttachments.length,
          },
          'Email processed successfully',
        );
        await markEmailAsReadAfterDurableLog(email, usingGmail);
      } catch (error: any) {
        await db
          .update(emailIngestionLogs)
          .set({ status: 'failed', errorMessage: error.message })
          .where(eq(emailIngestionLogs.id, logEntry.id));
        logger.error({ err: error, messageId: email.messageId }, 'Failed to process email');
        await markEmailAsReadAfterDurableLog(email, usingGmail);
      }
    }
  },

  async getStatus() {
    const enabled = process.env.EMAIL_INGESTION_ENABLED === 'true';
    const gmailConfigured = gmailService.isConfigured();
    const imapConfigured = !!(process.env.IMAP_USER && process.env.IMAP_PASS);

    const [lastLog] = await db
      .select()
      .from(emailIngestionLogs)
      .orderBy(desc(emailIngestionLogs.createdAt))
      .limit(1);

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayStr = today.toISOString();

    const stats = await db
      .select({
        status: emailIngestionLogs.status,
        count: count(),
      })
      .from(emailIngestionLogs)
      .where(sql`${emailIngestionLogs.createdAt} >= ${todayStr}`)
      .groupBy(emailIngestionLogs.status);

    return {
      enabled,
      method: gmailConfigured ? 'gmail_api' : imapConfigured ? 'imap' : 'none',
      gmailConfigured,
      imapConfigured,
      sharedMailbox: resolveSharedMailbox(),
      allowedSenders: process.env.EMAIL_ALLOWED_SENDERS || '(bloqueado - configure allowlist)',
      lastRun: lastLog?.createdAt || null,
      todayStats: stats,
    };
  },

  async getLogs(
    page = 1,
    limit = 20,
    startDate?: string,
    endDate?: string,
    filters: { processId?: number; processCode?: string } = {},
  ) {
    const offset = (page - 1) * limit;
    const conditions = [];

    if (filters.processId) {
      conditions.push(eq(emailIngestionLogs.processId, filters.processId));
    }
    if (filters.processCode) {
      conditions.push(ilike(emailIngestionLogs.processCode, filters.processCode));
    }
    if (startDate) {
      conditions.push(gte(emailIngestionLogs.receivedAt, new Date(startDate)));
    }
    if (endDate) {
      const end = new Date(endDate);
      end.setDate(end.getDate() + 1);
      conditions.push(sql`${emailIngestionLogs.receivedAt} < ${end.toISOString()}`);
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [rawData, [{ total }]] = await Promise.all([
      db
        .select()
        .from(emailIngestionLogs)
        .where(where)
        .orderBy(desc(emailIngestionLogs.createdAt))
        .limit(limit)
        .offset(offset),
      db.select({ total: count() }).from(emailIngestionLogs).where(where),
    ]);

    // Transform jsonb processedAttachments into frontend-friendly shape
    const data = rawData.map((row) => {
      type AttachmentEntry = {
        filename: string;
        type: string;
        status?: string;
        documentId?: number | null;
      };
      const raw = row.processedAttachments as
        | AttachmentEntry[]
        | { attachments?: AttachmentEntry[] }
        | null;
      const attachments: AttachmentEntry[] | undefined = Array.isArray(raw)
        ? raw
        : (raw?.attachments ?? undefined);
      const processedCount = attachments?.filter((a) => a.status !== 'skipped').length ?? 0;
      const details =
        attachments
          ?.filter((a) => a.status !== 'skipped')
          .map((a) => ({
            filename: a.filename,
            type: a.type,
            documentId: a.documentId ?? null,
          })) ?? [];

      return {
        ...row,
        processedAttachments: processedCount,
        processedAttachmentsCount: processedCount,
        processedAttachmentDetails: details.length > 0 ? details : undefined,
      };
    });

    return { data, total, page, limit };
  },

  async reprocess(logId: number) {
    const [log] = await db
      .select()
      .from(emailIngestionLogs)
      .where(eq(emailIngestionLogs.id, logId))
      .limit(1);

    if (!log) throw new Error('Log não encontrado');
    if (log.status !== 'failed') throw new Error('Apenas emails com falha podem ser reprocessados');

    try {
      // Try to re-fetch from Gmail if configured
      if (gmailService.isConfigured() && log.messageId) {
        // Preserve original log: rename messageId so processNewEmails won't skip it
        await db
          .update(emailIngestionLogs)
          .set({
            messageId: `${log.messageId}_reprocessed_${Date.now()}`,
            status: 'reprocessed',
            errorMessage: `Reprocessado em ${new Date().toISOString()}. Log original preservado.`,
          })
          .where(eq(emailIngestionLogs.id, logId));

        // Build targeted Gmail query to fetch only the specific email
        // Use rfc822msgid if available, otherwise search by subject+from
        const targetQuery =
          log.fromAddress && log.subject
            ? `from:${log.fromAddress} subject:"${log.subject.replace(/"/g, '')}"`
            : undefined;

        try {
          await this.processNewEmails(true, targetQuery);
        } catch (reprocessErr: any) {
          logger.error({ err: reprocessErr, logId }, 'processNewEmails failed during reprocess');
        }

        return { message: 'Email reprocessado via Gmail API' };
      }

      // Fallback: re-process from locally saved attachments if a process was created
      if (log.processId) {
        const rawAttachments = log.processedAttachments as Record<string, any> | null;
        // Support both old format (array) and new enriched format (object with .attachments)
        const processedAttachments = Array.isArray(rawAttachments)
          ? rawAttachments
          : (rawAttachments?.attachments as
              | Array<{ filename: string; type: string; documentId?: number }>
              | undefined);

        if (processedAttachments && processedAttachments.length > 0) {
          for (const att of processedAttachments) {
            if (att.documentId) {
              await documentService.reprocess(att.documentId);
            }
          }

          await db
            .update(emailIngestionLogs)
            .set({ status: 'completed', errorMessage: null })
            .where(eq(emailIngestionLogs.id, logId));

          return { message: 'Documentos reprocessados a partir dos arquivos locais' };
        }
      }

      await db
        .update(emailIngestionLogs)
        .set({ status: 'failed', errorMessage: 'Nenhum método de reprocessamento disponível' })
        .where(eq(emailIngestionLogs.id, logId));

      return { message: 'Nenhum método de reprocessamento disponível' };
    } catch (error: any) {
      await db
        .update(emailIngestionLogs)
        .set({ status: 'failed', errorMessage: error.message })
        .where(eq(emailIngestionLogs.id, logId));
      throw error;
    }
  },
};
