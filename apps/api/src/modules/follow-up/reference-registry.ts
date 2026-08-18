import { googleSheetsService } from '../integrations/google-sheets.service.js';
import { logger } from '../../shared/utils/logger.js';

/**
 * Allow-list of process references taken from the Follow Up spreadsheet.
 *
 * Pedido da Eduarda (17/08/2026): "pegar as referencias de processo somente
 * as que estao na planilha Follow Up, porque tem pego outras informacoes
 * (codigo de itens, referencias incompletas)". A extracao por regex + IA no
 * e-mail continua existindo, mas deixa de ser a autoridade: um candidato so
 * vira processo se a propria planilha o declarar.
 *
 * Ela mesma pediu que isso seja temporario ("depois que tivermos mais
 * avancados, ajustamos a automacao de novo pra pegar do email"), por isso o
 * comportamento antigo continua disponivel em PROCESS_REFERENCE_SOURCE=legacy.
 */

export type ReferenceSource = 'follow_up' | 'legacy';

const DEFAULT_TTL_MS = 10 * 60 * 1000;

export interface ReferenceSnapshot {
  /** normalized reference -> canonical reference exactly as written in the sheet */
  byNormalized: Map<string, string>;
  fetchedAt: number;
  /** true when served from a stale cache because the sheet was unreachable */
  stale: boolean;
}

let cache: { byNormalized: Map<string, string>; fetchedAt: number } | null = null;
let inflight: Promise<ReferenceSnapshot | null> | null = null;

let warnedUnconfigured = false;

export function getReferenceSource(): ReferenceSource {
  if (process.env.PROCESS_REFERENCE_SOURCE === 'legacy') return 'legacy';

  // "Not configured" and "configured but unreachable" are different failures
  // and must not share a behaviour. Without GOOGLE_SHEETS_FOLLOW_UP_ID the
  // operator simply has not set the feature up, and blocking every process
  // would be a self-inflicted outage on deploy; we degrade to legacy and say
  // so. Once the sheet IS configured, an outage fails closed instead — see
  // fetchSnapshot.
  if (!googleSheetsService.isConfigured()) {
    if (!warnedUnconfigured) {
      warnedUnconfigured = true;
      logger.warn(
        'PROCESS_REFERENCE_SOURCE=follow_up mas a planilha Follow Up nao esta configurada (GOOGLE_SHEETS_FOLLOW_UP_ID / credenciais da SA). Mantendo o comportamento legado ate configurar.',
      );
    }
    return 'legacy';
  }

  return 'follow_up';
}

function ttlMs(): number {
  const raw = Number(process.env.FOLLOW_UP_REFERENCE_TTL_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_TTL_MS;
}

/**
 * Canonical form used for comparison. Removes the separators people type by
 * hand and uppercases. It deliberately does NOT strip suffix letters: the
 * suffix is what distinguishes PK2052602TJ from PK2052602NB, and treating an
 * incomplete reference as equal to a complete one is exactly the bug the
 * allow-list is meant to kill.
 */
export function normalizeReference(code: string): string {
  return code.replace(/[\s\-_./]/g, '').toUpperCase();
}

async function fetchSnapshot(): Promise<ReferenceSnapshot | null> {
  try {
    const rows = await googleSheetsService.readProcessReferences();
    const byNormalized = new Map<string, string>();

    for (const raw of rows) {
      const normalized = normalizeReference(raw);
      if (!normalized) continue;
      // First occurrence wins: the sheet is ordered by the team's own
      // convention and a duplicated row must not flip the canonical spelling.
      if (!byNormalized.has(normalized)) byNormalized.set(normalized, raw.trim());
    }

    cache = { byNormalized, fetchedAt: Date.now() };
    logger.info(
      { references: byNormalized.size, rows: rows.length },
      'Follow Up reference allow-list refreshed',
    );
    return { ...cache, stale: false };
  } catch (err) {
    if (cache) {
      logger.warn(
        { err, references: cache.byNormalized.size, cachedAtMs: Date.now() - cache.fetchedAt },
        'Follow Up sheet unreachable — serving stale reference allow-list',
      );
      return { ...cache, stale: true };
    }
    logger.error(
      { err },
      'Follow Up sheet unreachable and no cached allow-list — process references cannot be validated',
    );
    return null;
  }
}

/**
 * Current allow-list, or null when it cannot be established at all (sheet
 * unreachable/unconfigured AND nothing cached). Null means "unknown", never
 * "empty" — callers must fail closed on null instead of treating every code
 * as unknown-and-therefore-new.
 */
export async function getFollowUpReferences(): Promise<ReferenceSnapshot | null> {
  if (cache && Date.now() - cache.fetchedAt < ttlMs()) {
    return { ...cache, stale: false };
  }
  // Collapse concurrent refreshes: the email batch resolves many codes in a
  // row and must not fan out one Sheets call per message.
  if (!inflight) {
    inflight = fetchSnapshot().finally(() => {
      inflight = null;
    });
  }
  return inflight;
}

export interface ReferenceDecision {
  /** 'allowed' carries the canonical spelling from the sheet. */
  status: 'allowed' | 'not_listed' | 'unavailable';
  canonical?: string;
  stale?: boolean;
}

/**
 * Decide whether a candidate code may be treated as a real process reference.
 * Matching is exact on the normalized form — no substring/prefix matching,
 * which is what let truncated references ("referencias incompletas") attach
 * documents to the wrong process.
 */
export async function resolveFollowUpReference(code: string): Promise<ReferenceDecision> {
  const normalized = normalizeReference(code);
  if (!normalized) return { status: 'not_listed' };

  const snapshot = await getFollowUpReferences();
  if (!snapshot) return { status: 'unavailable' };

  const canonical = snapshot.byNormalized.get(normalized);
  if (!canonical) return { status: 'not_listed', stale: snapshot.stale };
  return { status: 'allowed', canonical, stale: snapshot.stale };
}

export interface CandidateFilterResult {
  /** 'unavailable' means the allow-list could not be established at all. */
  status: 'applied' | 'unavailable';
  /** Canonical spellings, in the order the candidates were proposed. */
  canonical: string[];
  /** Candidates the sheet does not know. */
  rejected: string[];
}

/**
 * Filter proposed process-code candidates through the allow-list.
 *
 * Pure with respect to the caller: it decides nothing about creating or
 * linking, it only says which candidates the sheet recognises. Keeping this
 * separate from the e-mail loop is what makes the rule testable — the loop
 * itself needs Gmail, IMAP and the database to run.
 */
export async function filterCandidatesByFollowUp(codes: string[]): Promise<CandidateFilterResult> {
  const canonical: string[] = [];
  const rejected: string[] = [];

  for (const candidate of codes) {
    const decision = await resolveFollowUpReference(candidate);
    if (decision.status === 'unavailable') {
      return { status: 'unavailable', canonical: [], rejected: [] };
    }
    if (decision.status === 'allowed' && decision.canonical) {
      if (!canonical.includes(decision.canonical)) canonical.push(decision.canonical);
    } else {
      rejected.push(candidate);
    }
  }

  return { status: 'applied', canonical, rejected };
}

/** Test seam — resets the module-level cache between cases. */
export function __resetFollowUpReferenceCache(): void {
  cache = null;
  inflight = null;
  warnedUnconfigured = false;
}
