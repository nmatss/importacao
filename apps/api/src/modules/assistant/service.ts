import { and, desc, eq, sql } from 'drizzle-orm';
import { db } from '../../shared/database/connection.js';
import {
  alerts,
  communications,
  documents,
  emailIngestionLogs,
  followUpTracking,
  importProcesses,
  processEvents,
  validationResults,
  auditLogs,
  users,
} from '../../shared/database/schema.js';
import { logger } from '../../shared/utils/logger.js';
import { aiService } from '../ai/service.js';
import { normalize, retrieveContext, tokenize } from '../ai/rag/retriever.js';
import type { AssistantQueryInput } from './schema.js';

type AssistantSourceType =
  | 'process'
  | 'alert'
  | 'communication'
  | 'email_ingestion'
  | 'validation'
  | 'document'
  | 'follow_up'
  | 'event'
  | 'audit'
  | 'knowledge';

export interface AssistantSource {
  id: string;
  type: AssistantSourceType;
  title: string;
  subtitle?: string;
  excerpt: string;
  url?: string;
  createdAt?: string | null;
  score: number;
}

export interface AssistantAnswer {
  question: string;
  answer: string;
  sources: AssistantSource[];
  confidence: number;
  mode: 'ai' | 'deterministic';
  generatedAt: string;
}

interface AssistantUser {
  id: number;
  role: string;
}

interface SourceCandidate extends Omit<AssistantSource, 'score'> {
  searchable: string;
  acknowledged?: boolean | null;
  status?: string | null;
}

const MAX_RECENT_ROWS = 80;
const STOP_WORDS = new Set([
  'a',
  'as',
  'ao',
  'aos',
  'de',
  'da',
  'das',
  'do',
  'dos',
  'e',
  'em',
  'na',
  'nas',
  'no',
  'nos',
  'o',
  'os',
  'um',
  'uma',
  'para',
  'por',
  'com',
  'que',
  'qual',
  'quais',
  'sobre',
  'tem',
  'tenho',
  'hoje',
  'esta',
  'estao',
  'está',
  'estão',
]);

function compact(value: unknown, fallback = ''): string {
  if (value === null || value === undefined) return fallback;
  if (value instanceof Date) return value.toISOString();
  const raw = String(value).replace(/\s+/g, ' ').trim();
  return raw || fallback;
}

function truncate(value: unknown, max = 420): string {
  const raw = compact(value);
  if (raw.length <= max) return raw;
  return `${raw.slice(0, max - 3)}...`;
}

function toIsoDate(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function unwrapAiValue(value: unknown): unknown {
  if (value && typeof value === 'object' && 'value' in value) {
    return (value as { value?: unknown }).value;
  }
  return value;
}

function summarizeAiParsedData(data: unknown): string {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return '';
  const raw = data as Record<string, unknown>;
  const keys = [
    'invoiceNumber',
    'exporterName',
    'importerName',
    'portOfLoading',
    'portOfDischarge',
    'incoterm',
    'totalFobValue',
    'totalBoxes',
    'totalNetWeight',
    'totalGrossWeight',
    'containerNumber',
    'shipmentDate',
  ];

  const parts = keys
    .map((key) => {
      const value = unwrapAiValue(raw[key]);
      return value === null || value === undefined || value === '' ? null : `${key}: ${value}`;
    })
    .filter((part): part is string => Boolean(part));

  return parts.slice(0, 8).join('; ');
}

function questionTokens(question: string): string[] {
  return [
    ...new Set(tokenize(question).filter((token) => token.length >= 2 && !STOP_WORDS.has(token))),
  ].slice(0, 20);
}

function sourceBoost(type: AssistantSourceType, questionNorm: string): number {
  if (type === 'alert' && /\b(alerta|risco|pendente|prazo|critico|crítico)\b/.test(questionNorm)) {
    return 3;
  }
  if (
    (type === 'communication' || type === 'email_ingestion') &&
    /\b(email|e-mail|atendimento|comunicacao|comunicação|retorno|mensagem)\b/.test(questionNorm)
  ) {
    return 3;
  }
  if (
    type === 'validation' &&
    /\b(validacao|validação|divergencia|divergência|falha)\b/.test(questionNorm)
  ) {
    return 3;
  }
  if (
    type === 'document' &&
    /\b(documento|invoice|fatura|packing|bl|espelho|li|lpc?o)\b/.test(questionNorm)
  ) {
    return 3;
  }
  if (
    (type === 'process' || type === 'follow_up' || type === 'event') &&
    /\b(processo|embarque|etd|eta|status|etapa|follow)\b/.test(questionNorm)
  ) {
    return 2;
  }
  return 0;
}

function scoreCandidate(candidate: SourceCandidate, question: string, tokens: string[]): number {
  const questionNorm = normalize(question);
  const sourceNorm = normalize(
    `${candidate.title} ${candidate.subtitle ?? ''} ${candidate.searchable}`,
  );
  let score = sourceBoost(candidate.type, questionNorm);

  if (
    candidate.acknowledged === false &&
    /\b(pendente|aberto|tratar|acao|ação)\b/.test(questionNorm)
  ) {
    score += 2;
  }
  if (candidate.status && questionNorm.includes(normalize(candidate.status))) {
    score += 0.5;
  }

  for (const token of tokens) {
    if (sourceNorm.includes(token)) score += token.length >= 5 ? 1.4 : 1;
  }

  const compactQuestion = questionNorm.replace(/\s+/g, '');
  const processCodeHit = sourceNorm.match(/\b[a-z]{0,4}\d{3,}[a-z0-9-]*\b/i)?.[0];
  if (processCodeHit && compactQuestion.includes(processCodeHit.replace(/\s+/g, ''))) {
    score += 6;
  }

  return score;
}

function fallbackAnswer(question: string, sources: AssistantSource[]): string {
  if (sources.length === 0) {
    return [
      'Não encontrei evidências internas suficientes para responder com segurança.',
      'Tente informar o código do processo, o destinatário do atendimento, o tipo de documento ou o período desejado.',
    ].join('\n');
  }

  const highlights = sources
    .slice(0, 6)
    .map((source, index) => `${index + 1}. ${source.title}: ${source.excerpt}`)
    .join('\n');

  return [
    `Com base nas fontes internas encontradas para "${question}":`,
    highlights,
    'Use as fontes abaixo para abrir o processo, conferir o alerta ou validar o atendimento antes de executar uma ação.',
  ].join('\n\n');
}

async function findProcessCandidates(tokens: string[]) {
  const codes = tokens.filter((token) => /\d/.test(token) && token.length >= 3).slice(0, 5);
  if (codes.length === 0) return [];

  const results = await Promise.all(
    codes.map((code) =>
      db
        .select()
        .from(importProcesses)
        .where(
          sql`(${importProcesses.processCode} ILIKE ${`%${code}%`} OR ${importProcesses.previousCodes}::text ILIKE ${`%${code}%`})`,
        )
        .orderBy(desc(importProcesses.updatedAt))
        .limit(10),
    ),
  );

  return results.flat();
}

export const assistantService = {
  async query(input: AssistantQueryInput, user: AssistantUser): Promise<AssistantAnswer> {
    const question = input.question.trim();
    const tokens = questionTokens(question);
    const candidates: SourceCandidate[] = [];
    const processWhere = input.processId ? eq(importProcesses.id, input.processId) : undefined;
    const relatedProcessWhere = input.processId
      ? eq(importProcesses.id, input.processId)
      : undefined;

    const [
      recentProcesses,
      processMatches,
      alertRows,
      communicationRows,
      emailRows,
      validationRows,
      documentRows,
      followUpRows,
      eventRows,
      auditRows,
    ] = await Promise.all([
      db
        .select()
        .from(importProcesses)
        .where(processWhere)
        .orderBy(desc(importProcesses.updatedAt))
        .limit(input.processId ? 1 : MAX_RECENT_ROWS),
      findProcessCandidates(tokens),
      db
        .select({
          id: alerts.id,
          processId: alerts.processId,
          processCode: importProcesses.processCode,
          severity: alerts.severity,
          title: alerts.title,
          message: alerts.message,
          acknowledged: alerts.acknowledged,
          createdAt: alerts.createdAt,
        })
        .from(alerts)
        .leftJoin(importProcesses, eq(alerts.processId, importProcesses.id))
        .where(input.processId ? eq(alerts.processId, input.processId) : undefined)
        .orderBy(desc(alerts.createdAt))
        .limit(MAX_RECENT_ROWS),
      db
        .select({
          id: communications.id,
          processId: communications.processId,
          processCode: importProcesses.processCode,
          recipient: communications.recipient,
          recipientEmail: communications.recipientEmail,
          subject: communications.subject,
          body: communications.body,
          status: communications.status,
          sentAt: communications.sentAt,
          createdAt: communications.createdAt,
        })
        .from(communications)
        .leftJoin(importProcesses, eq(communications.processId, importProcesses.id))
        .where(input.processId ? eq(communications.processId, input.processId) : undefined)
        .orderBy(desc(communications.createdAt))
        .limit(MAX_RECENT_ROWS),
      db
        .select({
          id: emailIngestionLogs.id,
          processId: emailIngestionLogs.processId,
          processCode: emailIngestionLogs.processCode,
          subject: emailIngestionLogs.subject,
          fromAddress: emailIngestionLogs.fromAddress,
          status: emailIngestionLogs.status,
          attachmentsCount: emailIngestionLogs.attachmentsCount,
          errorMessage: emailIngestionLogs.errorMessage,
          receivedAt: emailIngestionLogs.receivedAt,
        })
        .from(emailIngestionLogs)
        .where(input.processId ? eq(emailIngestionLogs.processId, input.processId) : undefined)
        .orderBy(desc(emailIngestionLogs.receivedAt))
        .limit(MAX_RECENT_ROWS),
      db
        .select({
          id: validationResults.id,
          processId: validationResults.processId,
          processCode: importProcesses.processCode,
          checkName: validationResults.checkName,
          status: validationResults.status,
          expectedValue: validationResults.expectedValue,
          actualValue: validationResults.actualValue,
          message: validationResults.message,
          resolvedManually: validationResults.resolvedManually,
          resolutionNote: validationResults.resolutionNote,
          createdAt: validationResults.createdAt,
        })
        .from(validationResults)
        .leftJoin(importProcesses, eq(validationResults.processId, importProcesses.id))
        .where(input.processId ? eq(validationResults.processId, input.processId) : undefined)
        .orderBy(desc(validationResults.createdAt))
        .limit(MAX_RECENT_ROWS),
      db
        .select({
          id: documents.id,
          processId: documents.processId,
          processCode: importProcesses.processCode,
          type: documents.type,
          originalFilename: documents.originalFilename,
          isProcessed: documents.isProcessed,
          confidenceScore: documents.confidenceScore,
          aiParsedData: documents.aiParsedData,
          createdAt: documents.createdAt,
        })
        .from(documents)
        .leftJoin(importProcesses, eq(documents.processId, importProcesses.id))
        .where(input.processId ? eq(documents.processId, input.processId) : undefined)
        .orderBy(desc(documents.createdAt))
        .limit(MAX_RECENT_ROWS),
      db
        .select({
          id: followUpTracking.id,
          processId: followUpTracking.processId,
          processCode: importProcesses.processCode,
          overallProgress: followUpTracking.overallProgress,
          documentsReceivedAt: followUpTracking.documentsReceivedAt,
          espelhoGeneratedAt: followUpTracking.espelhoGeneratedAt,
          sentToFeniciaAt: followUpTracking.sentToFeniciaAt,
          liSubmittedAt: followUpTracking.liSubmittedAt,
          liApprovedAt: followUpTracking.liApprovedAt,
          liDeadline: followUpTracking.liDeadline,
          notes: followUpTracking.notes,
          updatedAt: followUpTracking.updatedAt,
        })
        .from(followUpTracking)
        .innerJoin(importProcesses, eq(followUpTracking.processId, importProcesses.id))
        .where(relatedProcessWhere)
        .orderBy(desc(followUpTracking.updatedAt))
        .limit(MAX_RECENT_ROWS),
      db
        .select({
          id: processEvents.id,
          processId: processEvents.processId,
          processCode: importProcesses.processCode,
          eventType: processEvents.eventType,
          title: processEvents.title,
          description: processEvents.description,
          createdAt: processEvents.createdAt,
        })
        .from(processEvents)
        .innerJoin(importProcesses, eq(processEvents.processId, importProcesses.id))
        .where(input.processId ? eq(processEvents.processId, input.processId) : undefined)
        .orderBy(desc(processEvents.createdAt))
        .limit(MAX_RECENT_ROWS),
      user.role === 'admin'
        ? db
            .select({
              id: auditLogs.id,
              userName: users.name,
              action: auditLogs.action,
              entityType: auditLogs.entityType,
              entityId: auditLogs.entityId,
              details: auditLogs.details,
              createdAt: auditLogs.createdAt,
            })
            .from(auditLogs)
            .leftJoin(users, eq(auditLogs.userId, users.id))
            .where(
              input.processId
                ? and(eq(auditLogs.entityType, 'process'), eq(auditLogs.entityId, input.processId))
                : undefined,
            )
            .orderBy(desc(auditLogs.createdAt))
            .limit(input.processId ? MAX_RECENT_ROWS : 30)
        : Promise.resolve([]),
    ]);

    const uniqueProcesses = new Map<number, (typeof recentProcesses)[number]>();
    for (const process of [...recentProcesses, ...processMatches])
      uniqueProcesses.set(process.id, process);

    for (const process of uniqueProcesses.values()) {
      const excerpt = truncate(
        [
          `Status ${process.status}`,
          process.logisticStatus ? `etapa ${process.logisticStatus}` : null,
          process.brand ? `marca ${process.brand}` : null,
          process.exporterName ? `exportador ${process.exporterName}` : null,
          process.importerName ? `importador ${process.importerName}` : null,
          process.portOfLoading ? `embarque ${process.portOfLoading}` : null,
          process.portOfDischarge ? `destino ${process.portOfDischarge}` : null,
          process.etd ? `ETD ${process.etd}` : null,
          process.eta ? `ETA ${process.eta}` : null,
          process.totalFobValue ? `FOB ${process.totalFobValue}` : null,
          process.notes ? `observações ${process.notes}` : null,
        ]
          .filter(Boolean)
          .join('; '),
      );
      candidates.push({
        id: `process:${process.id}`,
        type: 'process',
        title: `Processo ${process.processCode}`,
        subtitle: `${process.brand} · ${process.status}`,
        excerpt,
        searchable: `${process.processCode} ${excerpt}`,
        url: `/importacao/processos/${process.id}`,
        createdAt: toIsoDate(process.updatedAt),
        status: process.status,
      });
    }

    for (const alert of alertRows) {
      const excerpt = truncate(
        `${alert.severity.toUpperCase()} · ${alert.acknowledged ? 'tratado' : 'pendente'} · ${alert.message}`,
      );
      candidates.push({
        id: `alert:${alert.id}`,
        type: 'alert',
        title: alert.processCode
          ? `Alerta em ${alert.processCode}: ${alert.title}`
          : `Alerta: ${alert.title}`,
        subtitle: alert.acknowledged ? 'Tratado' : 'Pendente',
        excerpt,
        searchable: `${alert.title} ${alert.message} ${alert.processCode ?? ''} ${alert.severity}`,
        url: alert.processId ? `/importacao/processos/${alert.processId}` : '/importacao/alertas',
        createdAt: toIsoDate(alert.createdAt),
        acknowledged: alert.acknowledged,
        status: alert.severity,
      });
    }

    for (const communication of communicationRows) {
      const excerpt = truncate(
        `${communication.status} · Para ${communication.recipient} <${communication.recipientEmail}> · ${communication.subject} · ${communication.body}`,
      );
      candidates.push({
        id: `communication:${communication.id}`,
        type: 'communication',
        title: communication.processCode
          ? `Atendimento ${communication.processCode}: ${communication.subject}`
          : `Atendimento: ${communication.subject}`,
        subtitle: `${communication.recipient} · ${communication.status}`,
        excerpt,
        searchable: `${communication.processCode ?? ''} ${communication.recipient} ${communication.recipientEmail} ${communication.subject} ${communication.body}`,
        url: communication.processId
          ? `/importacao/processos/${communication.processId}`
          : '/importacao/comunicacoes',
        createdAt: toIsoDate(communication.sentAt ?? communication.createdAt),
        status: communication.status,
      });
    }

    for (const email of emailRows) {
      const excerpt = truncate(
        `${email.status} · De ${email.fromAddress} · ${email.subject} · anexos ${email.attachmentsCount ?? 0}${email.errorMessage ? ` · erro ${email.errorMessage}` : ''}`,
      );
      candidates.push({
        id: `email_ingestion:${email.id}`,
        type: 'email_ingestion',
        title: email.processCode
          ? `E-mail recebido ${email.processCode}: ${email.subject}`
          : `E-mail recebido: ${email.subject}`,
        subtitle: `${email.fromAddress} · ${email.status}`,
        excerpt,
        searchable: `${email.processCode ?? ''} ${email.fromAddress} ${email.subject} ${email.status} ${email.errorMessage ?? ''}`,
        url: email.processId
          ? `/importacao/processos/${email.processId}`
          : '/importacao/email-ingestion',
        createdAt: toIsoDate(email.receivedAt),
        status: email.status,
      });
    }

    for (const validation of validationRows) {
      const excerpt = truncate(
        [
          `Status ${validation.status}`,
          validation.message,
          validation.expectedValue ? `Esperado: ${validation.expectedValue}` : null,
          validation.actualValue ? `Encontrado: ${validation.actualValue}` : null,
          validation.resolutionNote ? `Tratativa: ${validation.resolutionNote}` : null,
        ]
          .filter(Boolean)
          .join('; '),
      );
      candidates.push({
        id: `validation:${validation.id}`,
        type: 'validation',
        title: validation.processCode
          ? `Validação ${validation.processCode}: ${validation.checkName}`
          : `Validação: ${validation.checkName}`,
        subtitle: validation.resolvedManually ? 'Aceita manualmente' : validation.status,
        excerpt,
        searchable: `${validation.processCode ?? ''} ${validation.checkName} ${excerpt}`,
        url: `/importacao/processos/${validation.processId}`,
        createdAt: toIsoDate(validation.createdAt),
        status: validation.status,
      });
    }

    for (const document of documentRows) {
      const parsedSummary = summarizeAiParsedData(document.aiParsedData);
      const excerpt = truncate(
        [
          `${document.type} · ${document.originalFilename}`,
          document.isProcessed ? 'processado' : 'pendente de processamento',
          document.confidenceScore ? `confiança ${document.confidenceScore}` : null,
          parsedSummary || null,
        ]
          .filter(Boolean)
          .join('; '),
      );
      candidates.push({
        id: `document:${document.id}`,
        type: 'document',
        title: document.processCode
          ? `Documento ${document.processCode}: ${document.originalFilename}`
          : `Documento: ${document.originalFilename}`,
        subtitle: document.type,
        excerpt,
        searchable: `${document.processCode ?? ''} ${document.type} ${document.originalFilename} ${parsedSummary}`,
        url: `/importacao/processos/${document.processId}`,
        createdAt: toIsoDate(document.createdAt),
        status: document.isProcessed ? 'processed' : 'pending',
      });
    }

    for (const followUp of followUpRows) {
      const excerpt = truncate(
        [
          `Progresso ${followUp.overallProgress ?? 0}%`,
          followUp.documentsReceivedAt
            ? `documentos recebidos ${followUp.documentsReceivedAt}`
            : null,
          followUp.espelhoGeneratedAt ? `espelho gerado ${followUp.espelhoGeneratedAt}` : null,
          followUp.sentToFeniciaAt ? `enviado à Fenícia ${followUp.sentToFeniciaAt}` : null,
          followUp.liSubmittedAt ? `LI protocolada ${followUp.liSubmittedAt}` : null,
          followUp.liApprovedAt ? `LI deferida ${followUp.liApprovedAt}` : null,
          followUp.liDeadline ? `prazo LI ${followUp.liDeadline}` : null,
          followUp.notes ? `notas ${followUp.notes}` : null,
        ]
          .filter(Boolean)
          .join('; '),
      );
      candidates.push({
        id: `follow_up:${followUp.id}`,
        type: 'follow_up',
        title: `Follow-up ${followUp.processCode}`,
        subtitle: `${followUp.overallProgress ?? 0}% concluído`,
        excerpt,
        searchable: `${followUp.processCode} ${excerpt}`,
        url: `/importacao/processos/${followUp.processId}`,
        createdAt: toIsoDate(followUp.updatedAt),
      });
    }

    for (const event of eventRows) {
      const excerpt = truncate(`${event.eventType} · ${event.title} · ${event.description ?? ''}`);
      candidates.push({
        id: `event:${event.id}`,
        type: 'event',
        title: `Histórico ${event.processCode}: ${event.title}`,
        subtitle: event.eventType,
        excerpt,
        searchable: `${event.processCode} ${event.eventType} ${event.title} ${event.description ?? ''}`,
        url: `/importacao/processos/${event.processId}`,
        createdAt: toIsoDate(event.createdAt),
        status: event.eventType,
      });
    }

    for (const audit of auditRows) {
      const excerpt = truncate(
        `${audit.action} · ${audit.entityType ?? 'sistema'} #${audit.entityId ?? '-'} · ${JSON.stringify(audit.details ?? {})}`,
      );
      candidates.push({
        id: `audit:${audit.id}`,
        type: 'audit',
        title: `Auditoria: ${audit.action}`,
        subtitle: audit.userName ?? 'Sistema',
        excerpt,
        searchable: excerpt,
        url: '/importacao/auditoria',
        createdAt: toIsoDate(audit.createdAt),
        status: audit.action,
      });
    }

    const knowledgeSnippets = retrieveContext(question, {
      namespaces: ['ncms', 'ports', 'parties', 'carriers', 'premissas'],
      k: 2,
    });
    knowledgeSnippets.forEach((snippet, index) => {
      candidates.push({
        id: `knowledge:${index}`,
        type: 'knowledge',
        title: 'Base de conhecimento operacional',
        excerpt: snippet,
        searchable: snippet,
        createdAt: null,
      });
    });

    const ranked = candidates
      .map((candidate) => ({
        ...candidate,
        score: scoreCandidate(candidate, question, tokens),
      }))
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        return bTime - aTime;
      });

    const positive = ranked.filter((source) => source.score > 0);
    const sources = positive.slice(0, input.limit ?? 10);
    const confidence =
      sources.length === 0 ? 0.15 : Math.min(0.92, 0.35 + Math.min(sources[0].score, 12) / 20);

    let answer = fallbackAnswer(question, sources);
    let mode: AssistantAnswer['mode'] = 'deterministic';

    if (sources.length > 0) {
      try {
        answer = await aiService.generateOperationalAssistantAnswer(question, sources);
        mode = 'ai';
      } catch (error) {
        logger.warn(
          { error },
          'Operational assistant AI answer failed; using deterministic fallback',
        );
      }
    }

    return {
      question,
      answer,
      sources,
      confidence,
      mode,
      generatedAt: new Date().toISOString(),
    };
  },
};
