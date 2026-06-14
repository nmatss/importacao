/**
 * In-memory RAG retriever over the domain knowledge base (../knowledge/*.json).
 *
 * Why in-memory (not pgvector): the KB is tiny (ncms ~360, ports ~50, parties
 * ~560, carriers ~70, premissas params). For catalog lookups — "does the doc
 * mention this NCM / supplier / port?" — deterministic lexical matching is both
 * faster and MORE accurate than embeddings (exact codes/names beat semantic
 * similarity), with zero network dependency. A semantic path (bge-m3) is a
 * future upgrade for the free-text `premissas`; see embeddings.ts. (Direction
 * review 2026-06-14 demoted pgvector to a conditional optimization.)
 *
 * Retrieved snippets are injected by skills/assemble.ts as a domain-context
 * block marked "reference only, never a license to invent". Snippets are
 * SANITIZED here (whitespace collapsed, length capped, fence markers stripped)
 * so a poisoned KB entry can't become an injection vector.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { RetrievalConfig } from '../skills/types.js';

const cache = new Map<string, KbEntry[]>();

export interface KbEntry {
  /** Human-readable snippet injected into the prompt. */
  text: string;
  /** Lowercased, accent-stripped tokens used for lexical scoring. */
  tokens: Set<string>;
  /** A distinctive key (code/name) used for substring boosting. */
  key: string;
}

function loadJson(file: string): any {
  try {
    const p = fileURLToPath(new URL(`../knowledge/${file}`, import.meta.url));
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

export function normalize(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip combining accents
    .toLowerCase()
    .replace(/[^a-z0-9\s./-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Tokens worth matching on: words >= 2 chars and numeric/code runs. */
export function tokenize(s: string): string[] {
  return normalize(s)
    .split(/[\s./-]+/)
    .filter((t) => t.length >= 2);
}

/** Neutralize a snippet before it enters the prompt as untrusted KB text. */
function sanitizeSnippet(s: string): string {
  // Collapse ANY run of '=' (2+) so a KB entry can never reconstruct a fence
  // marker ('=== ... ===') if it ever reaches a prompt.
  const flat = s
    .replace(/[\r\n]+/g, ' ')
    .replace(/={2,}/g, '=')
    .replace(/\s+/g, ' ')
    .trim();
  return flat.length > 200 ? `${flat.slice(0, 197)}...` : flat;
}

export function makeEntry(text: string, key: string): KbEntry {
  return { text: sanitizeSnippet(text), tokens: new Set(tokenize(text)), key: normalize(key) };
}

// ── Corpus builders per namespace ────────────────────────────────────
function buildCorpus(ns: string): KbEntry[] {
  if (cache.has(ns)) return cache.get(ns)!;
  const out: KbEntry[] = [];
  switch (ns) {
    case 'ncms': {
      const codes: string[] = loadJson('ncms.json')?.codes ?? [];
      for (const c of codes) out.push(makeEntry(`NCM ${c}`, c.replace(/\D/g, '')));
      break;
    }
    case 'parties': {
      const kb = loadJson('parties.json') ?? {};
      for (const s of kb.suppliers ?? [])
        out.push(makeEntry(`Fornecedor/exportador conhecido: ${s}`, s));
      for (const im of kb.importers ?? []) {
        const name = typeof im === 'string' ? im : im?.name;
        if (name) out.push(makeEntry(`Importador conhecido: ${name}`, name));
      }
      break;
    }
    case 'ports': {
      const kb = loadJson('ports.json') ?? {};
      for (const p of kb.loading ?? []) out.push(makeEntry(`Porto de embarque: ${p}`, p));
      for (const p of kb.discharge ?? []) out.push(makeEntry(`Porto de descarga: ${p}`, p));
      for (const p of kb.transshipment ?? []) out.push(makeEntry(`Porto de transbordo: ${p}`, p));
      break;
    }
    case 'carriers': {
      const kb = loadJson('carriers.json') ?? {};
      for (const c of kb.shippingLines ?? []) out.push(makeEntry(`Armador/cia marítima: ${c}`, c));
      for (const a of kb.freightAgents ?? []) out.push(makeEntry(`Agente de carga: ${a}`, a));
      for (const t of kb.terminals ?? []) out.push(makeEntry(`Terminal/recinto: ${t}`, t));
      break;
    }
    case 'ean': {
      const rows: any[] = loadJson('ean.json')?.puket ?? [];
      for (const r of rows) {
        if (!r?.ean) continue;
        out.push(
          makeEntry(
            `EAN ${r.ean} = produto ${r.product ?? '?'} (${r.line ?? ''} cor ${r.color ?? ''} grade ${r.grade ?? ''})`,
            String(r.ean),
          ),
        );
      }
      break;
    }
    case 'premissas': {
      const kb = loadJson('premissas.json') ?? {};
      if (kb.usdRateNote) out.push(makeEntry(`Câmbio: ${kb.usdRateNote}`, 'usd cambio dolar'));
      for (const [name, v] of Object.entries<any>(kb.tariffs ?? {})) {
        out.push(makeEntry(`Tarifa ${name}: ${v?.value} ${v?.unit ?? ''} ${v?.note ?? ''}`, name));
      }
      for (const [port, days] of Object.entries<any>(kb.transitTimeDays ?? {})) {
        out.push(makeEntry(`Transit time ${port}: ${days} dias`, port));
      }
      for (const [type, v] of Object.entries<any>(kb.cbmByContainer ?? {})) {
        out.push(makeEntry(`CBM ${type}: nominal ${v?.nominal} / real ${v?.real}`, type));
      }
      break;
    }
    default:
      break;
  }
  cache.set(ns, out);
  return out;
}

/** Test seam — drop the memoized corpus. */
export function _clearCorpusCache(): void {
  cache.clear();
}

/**
 * Score one KB entry against the query. Substring hit on the distinctive key
 * (an NCM code, a supplier name) dominates; otherwise token overlap, length-
 * normalized so long entries don't win by sheer size. Pure + deterministic.
 */
export function scoreEntry(queryNorm: string, queryTokens: Set<string>, e: KbEntry): number {
  let score = 0;
  if (e.key.length >= 3 && queryNorm.includes(e.key)) score += 10 + Math.min(e.key.length, 20);
  // Threshold matches tokenize() (>= 2) so 2-char tokens that count toward the
  // length divisor can also score, instead of only inflating it.
  let overlap = 0;
  for (const t of e.tokens) if (t.length >= 2 && queryTokens.has(t)) overlap++;
  if (e.tokens.size > 0) score += overlap / Math.sqrt(e.tokens.size);
  return score;
}

/** Rank a synthetic/loaded corpus against a query. Pure — used by tests too. */
export function rankEntries(query: string, entries: KbEntry[], k: number): string[] {
  const queryNorm = normalize(query);
  const queryTokens = new Set(tokenize(query));
  return entries
    .map((e) => ({ e, s: scoreEntry(queryNorm, queryTokens, e) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, Math.max(0, k))
    .map((x) => x.e.text);
}

/**
 * Retrieve domain-context snippets for an extraction, honoring the skill's
 * RetrievalConfig (which namespaces, k per namespace). Returns ready-to-inject
 * sanitized strings; empty array when nothing is relevant (RAG degrades to no
 * context, never to noise).
 */
export function retrieveContext(query: string, config: RetrievalConfig | undefined): string[] {
  if (!config || !query?.trim()) return [];
  const out: string[] = [];
  for (const ns of config.namespaces) {
    out.push(...rankEntries(query, buildCorpus(ns), config.k));
  }
  return out;
}

/** Expose corpus building for tests/diagnostics. */
export function _corpusFor(ns: string): KbEntry[] {
  return buildCorpus(ns);
}
