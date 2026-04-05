import fs from 'fs/promises';
import path from 'path';
import { eq, desc, count, sql, ilike, and, gte } from 'drizzle-orm';
import { db } from '../../shared/database/connection.js';
import {
  emailIngestionLogs,
  importProcesses,
  followUpTracking,
} from '../../shared/database/schema.js';
import { documentService } from '../documents/service.js';
import { gmailService } from './gmail.service.js';
import { imapService } from './imap.service.js';
import { logger } from '../../shared/utils/logger.js';
import { auditService } from '../audit/service.js';
import { aiService, type EmailAnalysisResult } from '../ai/service.js';

import { UPLOAD_DIR } from '../../shared/config/paths.js';

// ── Regex-based process code extraction (fast, first pass) ──────────────

function extractProcessCode(text: string): string | null {
  const patterns = [
    /\b(IMP[-_]?\d{4}[-_]?\d{3,})\b/i,
    /\b(PU?K(?:ET)?[-_]?\d{3,})\b/i,
    /\b(IMAG(?:INARIUM)?[-_]?\d{3,})\b/i,
    /\b([A-Z]{2,10}[-_]\d{4}[-_]\d{2,})\b/i,
    /\b(\d{4}[-/]\d{5,})\b/,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return match[1].toUpperCase();
  }
  return null;
}

// ── Document classification (filename-based, fast) ──────────────────────

function classifyDocument(filename: string): string {
  const lower = filename.toLowerCase();
  // Split filename into tokens by common separators (strip extension first)
  const tokens = lower.replace(/\.[^.]+$/, '').split(/[-_.\s]+/);

  if (
    lower.includes('invoice') ||
    lower.includes('fatura') ||
    lower.includes('commercial') ||
    tokens.includes('inv')
  )
    return 'invoice';
  if (lower.includes('packing') || tokens.includes('pl') || lower.includes('pack'))
    return 'packing_list';
  if (
    tokens.includes('bl') ||
    lower.includes('bill') ||
    lower.includes('lading') ||
    lower.includes('conhecimento') ||
    lower.includes('ohbl')
  )
    return 'ohbl';
  if (lower.includes('espelho')) return 'espelho';
  if (tokens.includes('li') || lower.includes('licen')) return 'li';
  if (
    lower.includes('certificado') ||
    lower.includes('certificate') ||
    tokens.includes('cert') ||
    lower.includes('inmetro')
  )
    return 'certificate';
  return 'other';
}

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

  // Map AI document type mentions to our classification types
  const typeMapping: Record<string, string> = {
    invoice: 'invoice',
    fatura: 'invoice',
    commercial_invoice: 'invoice',
    packing_list: 'packing_list',
    packing: 'packing_list',
    romaneio: 'packing_list',
    ohbl: 'ohbl',
    bl: 'ohbl',
    bill_of_lading: 'ohbl',
    espelho: 'espelho',
    li: 'li',
    licenca: 'li',
    licenca_de_importacao: 'li',
    certificate: 'certificate',
    certificado: 'certificate',
    cert_of_origin: 'certificate',
    certificate_of_origin: 'certificate',
    quality_certificate: 'certificate',
    phytosanitary_certificate: 'certificate',
    fumigation_certificate: 'certificate',
    inmetro: 'certificate',
    correction: 'other',
    draft: 'other',
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

// ── Regex-based document type extraction from text ──────────────────────

function extractDocumentTypesFromText(text: string): string[] {
  const lower = text.toLowerCase();
  const types: string[] = [];

  if (/\b(invoice|fatura|commercial\s+invoice)\b/.test(lower)) types.push('invoice');
  if (/\b(packing\s*list|romaneio|lista\s+de\s+embarque)\b/.test(lower)) types.push('packing_list');
  if (
    /\b(bill\s+of\s+lading|conhecimento\s+de\s+embarque|ohbl)\b|(?:^|[^a-z])bl(?:$|[^a-z])/.test(
      lower,
    )
  )
    types.push('ohbl');
  if (/\b(espelho)\b/.test(lower)) types.push('espelho');
  if (/\b(licen[çc]a\s+de\s+importa[çc][aã]o)\b|(?:^|[^a-z])li(?:$|[^a-z])/.test(lower))
    types.push('li');
  if (/\b(certificado|certificate|cert\s+of\s+origin)\b/.test(lower)) types.push('certificate');

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

function isAllowedSender(from: string): boolean {
  const allowedRaw = process.env.EMAIL_ALLOWED_SENDERS;
  if (!allowedRaw) return true;

  const allowed = allowedRaw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const fromLower = from.toLowerCase();

  return allowed.some((pattern) => fromLower.includes(pattern));
}

// ── Fuzzy process code matching against DB ──────────────────────────────

function escapeLikePattern(str: string): string {
  return str.replace(/[%_\\]/g, '\\$&');
}

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

  // Try case-insensitive match
  const [caseInsensitive] = await db
    .select({ id: importProcesses.id, processCode: importProcesses.processCode })
    .from(importProcesses)
    .where(ilike(importProcesses.processCode, escapeLikePattern(code)))
    .limit(1);
  if (caseInsensitive) return caseInsensitive;

  // Try partial match (code contained in process_code or vice versa)
  const normalizedCode = code.replace(/[-_]/g, '').toUpperCase();
  const escaped = escapeLikePattern(normalizedCode);
  const [partial] = await db
    .select({ id: importProcesses.id, processCode: importProcesses.processCode })
    .from(importProcesses)
    .where(ilike(importProcesses.processCode, `%${escaped}%`))
    .limit(1);
  if (partial) return partial;

  // Try matching with wildcards for separator variations (IMP2025001 matches IMP-2025-001)
  const withWildcards = escaped.replace(/(\d+)/g, '%$1%').replace(/%%/g, '%');
  const [wildcardMatch] = await db
    .select({ id: importProcesses.id, processCode: importProcesses.processCode })
    .from(importProcesses)
    .where(ilike(importProcesses.processCode, withWildcards))
    .limit(1);
  if (wildcardMatch) return wildcardMatch;

  return null;
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
    let emails;
    if (gmailService.isConfigured()) {
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
        continue;
      }

      // Filter by allowed senders (skip if custom query was provided)
      if (!gmailQuery && !isAllowedSender(email.from)) {
        logger.debug({ from: email.from }, 'Email from non-allowed sender, ignoring');
        await db.insert(emailIngestionLogs).values({
          messageId: email.messageId,
          fromAddress: email.from,
          subject: email.subject,
          receivedAt: email.date,
          attachmentsCount: email.attachments.length,
          status: 'ignored',
          errorMessage: 'Remetente não autorizado',
        });
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
          continue;
        }

        // ── Step 1: Try regex on subject (fast) ──────────────────────
        let processCode = extractProcessCode(email.subject);
        let detectionMethod: 'regex_subject' | 'regex_body' | 'ai' | null = processCode
          ? 'regex_subject'
          : null;

        // ── Step 2: Try regex on body if subject failed ──────────────
        if (!processCode && email.body) {
          processCode = extractProcessCode(email.body.substring(0, 3000));
          if (processCode) detectionMethod = 'regex_body';
        }

        // ── Step 3: Regex-based document type & category detection ────
        const regexDocTypes = extractDocumentTypesFromText(
          `${email.subject} ${(email.body || '').substring(0, 3000)}`,
        );
        const regexCategory = detectEmailCategory(email.subject, email.body || '');
        const regexInvoiceNumbers = extractInvoiceNumbers(
          `${email.subject} ${(email.body || '').substring(0, 3000)}`,
        );

        // ── Step 4: AI analysis - SKIP if regex resolved process code
        //    and all attachments can be classified by filename ─────────
        let aiAnalysis: EmailAnalysisResult | null = null;
        const allAttachmentsClassified = email.attachments.every(
          (att) => classifyDocument(att.filename) !== 'other',
        );

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
        if (!processCode && aiAnalysis?.processCode) {
          processCode = aiAnalysis.processCode.toUpperCase();
          detectionMethod = 'ai';
          logger.info({ processCode, method: 'ai' }, 'Process code detected via AI');
        }

        // ── Step 6: Resolve process in DB (with fuzzy matching) ──────
        let processId: number | null = null;

        if (processCode) {
          const matched = await fuzzyMatchProcessCode(processCode);

          if (matched) {
            processId = matched.id;
            // Update processCode to the canonical form from DB
            processCode = matched.processCode;
          } else {
            // Create new process
            const brand = detectBrand(email.subject, email.from);
            const [newProcess] = await db
              .insert(importProcesses)
              .values({
                processCode,
                brand,
                status: 'draft',
                notes: `Processo criado automaticamente a partir do email: ${email.subject}`,
              })
              .returning();
            processId = newProcess.id;

            await db.insert(followUpTracking).values({ processId: newProcess.id });
            logger.info(
              { processCode, processId: newProcess.id },
              'New process created from email',
            );
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
          continue;
        }

        // ── Step 6.8: Detect Pre-Cons spreadsheet ─────────────────────
        const isPreCons =
          /pre.?cons/i.test(email.subject) ||
          email.attachments.some((att) => /pre.?cons/i.test(att.filename));

        if (isPreCons) {
          const preConsAttachment =
            email.attachments.find(
              (att) =>
                (att.filename.endsWith('.xlsx') || att.filename.endsWith('.xls')) &&
                /pre.?cons/i.test(att.filename),
            ) ||
            email.attachments.find(
              (att) => att.filename.endsWith('.xlsx') || att.filename.endsWith('.xls'),
            );

          if (preConsAttachment) {
            try {
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

              continue; // Skip normal attachment processing
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
        }> = [];

        const supportedMimes = [
          'application/pdf',
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'application/vnd.ms-excel',
        ];

        for (const att of email.attachments) {
          // Skip unsupported file types (images, docs, etc.)
          const isSupported =
            supportedMimes.some((m) => att.contentType?.includes(m)) ||
            att.filename.endsWith('.pdf') ||
            att.filename.endsWith('.xlsx') ||
            att.filename.endsWith('.xls');

          if (!isSupported) {
            logger.info(
              { filename: att.filename, contentType: att.contentType },
              'Attachment skipped: unsupported file type',
            );
            processedAttachments.push({
              filename: att.filename,
              type: 'unsupported',
              status: 'skipped',
              skipReason: `Tipo de arquivo não suportado: ${att.contentType}`,
            });
            continue;
          }

          await fs.mkdir(UPLOAD_DIR, { recursive: true });
          const safeName = `${Date.now()}-${att.filename.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
          const filePath = path.join(UPLOAD_DIR, safeName);
          await fs.writeFile(filePath, att.content);

          // Use AI-enhanced classification (falls back to filename-only)
          const docType = classifyDocumentWithContext(att.filename, aiAnalysis);

          // Upload to Sistema Automatico INBOX
          let sistemaFileId: string | undefined;
          try {
            const { googleDriveService } = await import('../integrations/google-drive.service.js');
            const configured = await googleDriveService.isConfigured();
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
                const { googleDriveService } = await import('../integrations/google-drive.service.js');
                await googleDriveService.moveFromInboxToProcessados(sistemaFileId, processCode, docType);
              } catch (err) {
                logger.warn({ err }, 'Failed to move file from INBOX to PROCESSADOS');
              }
            }

            processedAttachments.push({
              filename: att.filename,
              type: docType,
              status: 'processed',
              documentId: doc.id,
            });
          } else {
            processedAttachments.push({
              filename: att.filename,
              type: docType,
              status: 'processed',
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
      } catch (error: any) {
        await db
          .update(emailIngestionLogs)
          .set({ status: 'failed', errorMessage: error.message })
          .where(eq(emailIngestionLogs.id, logEntry.id));
        logger.error({ err: error, messageId: email.messageId }, 'Failed to process email');
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
      sharedMailbox: process.env.GMAIL_SHARED_MAILBOX || null,
      allowedSenders: process.env.EMAIL_ALLOWED_SENDERS || '(todos)',
      lastRun: lastLog?.createdAt || null,
      todayStats: stats,
    };
  },

  async getLogs(page = 1, limit = 20, startDate?: string, endDate?: string) {
    const offset = (page - 1) * limit;
    const conditions = [];

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
