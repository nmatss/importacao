/**
 * Knowledge-base lookups for the harness. The KB JSON lives in ../knowledge/
 * (built from the Follow Up spreadsheet — the domain source of truth).
 *
 * Design: when a KB file is missing or empty, every lookup returns `true`
 * ("cannot refute"). This makes the harness degrade gracefully to
 * format + grounding + numeric checks when the KB has not been populated yet,
 * and NEVER produces false alarms from an absent catalog.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { normalizeForGrounding } from './grounding.js';

const cache = new Map<string, any>();

function load(file: string): any {
  if (cache.has(file)) return cache.get(file);
  let data: any = null;
  try {
    const p = fileURLToPath(new URL(`../knowledge/${file}`, import.meta.url));
    data = JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    data = null;
  }
  cache.set(file, data);
  return data;
}

/** Test seam — reset the memoized KB (used by unit tests). */
export function _clearKbCache(): void {
  cache.clear();
}

export function isKnownNcm(code: string): boolean {
  const kb = load('ncms.json');
  const codes: string[] = kb?.codes;
  if (!Array.isArray(codes) || codes.length === 0) return true;
  const norm = (s: string) => s.replace(/\D/g, '');
  const target = norm(code);
  return codes.some((c) => norm(c) === target);
}

export function isKnownPort(name: string, kind: 'loading' | 'discharge'): boolean {
  const kb = load('ports.json');
  const list: string[] = kb?.[kind];
  if (!Array.isArray(list) || list.length === 0) return true;
  const v = normalizeForGrounding(name);
  // Match if either contains the other (extracted "NINGBO" vs KB "NINGBO, CHINA").
  return list.some((p) => {
    const k = normalizeForGrounding(p);
    return k.includes(v) || v.includes(k);
  });
}

export function isKnownSupplier(name: string): boolean {
  const kb = load('parties.json');
  const list: string[] = kb?.suppliers;
  if (!Array.isArray(list) || list.length === 0) return true;
  const v = normalizeForGrounding(name);
  if (v.length < 3) return true;
  return list.some((s) => {
    const k = normalizeForGrounding(s);
    return k.includes(v) || v.includes(k);
  });
}
