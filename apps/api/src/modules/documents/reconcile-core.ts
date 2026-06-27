/**
 * Pure cross-document confidence reconciliation (Levers 1 + 2). No DB, no I/O —
 * everything here is a pure transform over plain objects, so it is trivially
 * unit-testable. The DB-bound orchestration lives in `reconcile.ts`.
 *
 * See `reconcile.ts` for the full rationale. In short: re-derive confidence
 * from EVIDENCE (arithmetic self-consistency + corroboration against the
 * operator-uploaded Espelho), conservatively — never overwrite real data, only
 * boost on agreement, log disagreements as conflicts, idempotent.
 */
import { flattenAiData } from '../ai/utils/flatten.js';
import { normalizeItemCode } from '../validation/utils/item-code-normalize.js';
import { normalizeCompanyName } from '../validation/utils/name-normalize.js';
import { normalizeGtin, normalizeNcm, isValidNcm } from '../ai/harness/format.js';

// ── Calibration constants ───────────────────────────────────────────────
/** Field value agrees with an independent trusted source (Espelho 0.99). */
export const CONF_CROSS = 0.99;
/** Field is internally arithmetic-consistent (qty×price, FOB partition). */
export const CONF_ARITH = 0.97;
/** Value copied from the trusted source into a previously-null field. */
export const CONF_FILL = 0.95;

type FieldType = 'code' | 'gtin' | 'ncm' | 'num' | 'str' | 'name';
type FieldSource = 'espelho' | 'arithmetic';

interface FieldRule {
  /** key on the espelho item / summary that holds the trusted value */
  from: string;
  type: FieldType;
}

/** invoice/proforma item key → espelho item key + comparison type */
const INVOICE_ITEM_RULES: Record<string, FieldRule> = {
  itemCode: { from: 'codigo', type: 'code' },
  ean: { from: 'ean13', type: 'gtin' },
  ncmCode: { from: 'ncm', type: 'ncm' },
  quantity: { from: 'qty', type: 'num' },
  unitPrice: { from: 'unitPrice', type: 'num' },
  totalPrice: { from: 'amountUsd', type: 'num' },
  manufacturer: { from: 'codFabricante', type: 'str' },
  color: { from: 'cor', type: 'str' },
  size: { from: 'tamanho', type: 'str' },
  netWeight: { from: 'pesoLiquidoTotal', type: 'num' },
  grossWeight: { from: 'pesoBrutoTotal', type: 'num' },
};

const PACKING_LIST_ITEM_RULES: Record<string, FieldRule> = {
  itemCode: { from: 'codigo', type: 'code' },
  ean: { from: 'ean13', type: 'gtin' },
  quantity: { from: 'qty', type: 'num' },
  color: { from: 'cor', type: 'str' },
  size: { from: 'tamanho', type: 'str' },
  netWeight: { from: 'pesoLiquidoTotal', type: 'num' },
  grossWeight: { from: 'pesoBrutoTotal', type: 'num' },
  boxQuantity: { from: 'caixasPorRef', type: 'num' },
};

/** invoice scalar key → espelho summary key + comparison type */
const INVOICE_SCALAR_RULES: Record<string, FieldRule> = {
  totalFobValue: { from: 'totalAmountUsd', type: 'num' },
  importerName: { from: 'importerName', type: 'name' },
  importerCnpj: { from: 'importerCnpj', type: 'str' },
  importerAddress: { from: 'importerAddress', type: 'str' },
  totalBoxes: { from: 'totalBoxes', type: 'num' },
  totalNetWeight: { from: 'totalNetWeight', type: 'num' },
  totalGrossWeight: { from: 'totalGrossWeight', type: 'num' },
  totalCbm: { from: 'totalCbm', type: 'num' },
};

const PACKING_LIST_SCALAR_RULES: Record<string, FieldRule> = {
  totalBoxes: { from: 'totalBoxes', type: 'num' },
  totalNetWeight: { from: 'totalNetWeight', type: 'num' },
  totalGrossWeight: { from: 'totalGrossWeight', type: 'num' },
};

export const RECONCILABLE_TYPES = new Set(['invoice', 'proforma_invoice', 'packing_list']);

// ── Small value helpers ─────────────────────────────────────────────────
function isNum(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n);
}

/** Same tolerance the comparison view uses for a numeric "match". */
function numClose(a: unknown, b: unknown): boolean {
  if (!isNum(a) || !isNum(b)) return false;
  const diff = Math.abs(a - b);
  return diff < 0.5 || diff / Math.max(Math.abs(a), Math.abs(b), 1) < 0.005;
}

function cfValue(field: unknown): unknown {
  if (field && typeof field === 'object' && 'value' in field) {
    return (field as { value: unknown }).value ?? null;
  }
  return field ?? null;
}

export interface ReconcileReport {
  changed: boolean;
  /** field paths whose confidence was raised (e.g. "items[0].quantity") */
  boosted: Array<{ path: string; confidence: number; source: FieldSource }>;
  /** field paths filled from the trusted source */
  filled: Array<{ path: string; confidence: number; source: FieldSource }>;
  /** values present in both but disagreeing — left untouched for review */
  conflicts: Array<{ path: string; target: unknown; source: unknown }>;
}

function emptyReport(): ReconcileReport {
  return { changed: false, boosted: [], filled: [], conflicts: [] };
}

/** Raise a wrapper's confidence (never lower) and tag its provenance. */
function boost(
  container: Record<string, any>,
  key: string,
  conf: number,
  source: FieldSource,
  path: string,
  report: ReconcileReport,
): void {
  const field = container[key];
  if (!field || typeof field !== 'object' || !('confidence' in field)) return;
  if (cfValue(field) == null) return;
  if (field.confidence >= conf) {
    if (!field.source) field.source = source; // record provenance once
    return;
  }
  field.confidence = conf;
  field.source = source;
  report.boosted.push({ path, confidence: conf, source });
  report.changed = true;
}

/** Fill a null field from the trusted source. Never overwrites real data. */
function fill(
  container: Record<string, any>,
  key: string,
  value: unknown,
  conf: number,
  source: FieldSource,
  path: string,
  report: ReconcileReport,
): void {
  if (value == null || value === '') return;
  if (cfValue(container[key]) != null) return;
  container[key] = { value, confidence: conf, source };
  report.filled.push({ path, confidence: conf, source });
  report.changed = true;
}

/** Normalize a value per its comparison type. Returns null when unusable. */
function normForType(value: unknown, type: FieldType): string | number | null {
  if (value == null || value === '') return null;
  switch (type) {
    case 'code':
      return normalizeItemCode(value) || null;
    case 'gtin':
      return normalizeGtin(value);
    case 'ncm':
      return isValidNcm(String(value)) ? normalizeNcm(String(value)) : null;
    case 'name':
      return normalizeCompanyName(value) || null;
    case 'num': {
      const n = typeof value === 'number' ? value : Number(String(value).replace(',', '.'));
      return Number.isFinite(n) ? n : null;
    }
    case 'str':
      return String(value).trim() || null;
  }
}

/**
 * Reconcile a single target field against a trusted source value:
 *   - both present + equal    → boost to CONF_CROSS
 *   - target null + source    → fill with CONF_FILL
 *   - both present + differ    → conflict (no change)
 */
function reconcileField(
  container: Record<string, any>,
  key: string,
  sourceRaw: unknown,
  type: FieldType,
  path: string,
  report: ReconcileReport,
): void {
  // Already sourced from the espelho (filled or cross-confirmed): re-checking it
  // is circular (the value came FROM this source) and would break idempotency.
  // Arithmetic-sourced fields are still eligible for independent cross-confirm.
  const existing = container[key];
  if (existing && typeof existing === 'object' && (existing as any).source === 'espelho') return;

  const targetVal = cfValue(container[key]);
  const sourceNorm = normForType(sourceRaw, type);
  if (sourceNorm == null) return;

  if (targetVal == null) {
    const fillValue =
      type === 'ncm' || type === 'gtin' || type === 'code'
        ? String(sourceNorm)
        : type === 'num'
          ? (sourceNorm as number)
          : sourceRaw;
    fill(container, key, fillValue, CONF_FILL, 'espelho', path, report);
    return;
  }

  const targetNorm = normForType(targetVal, type);
  if (targetNorm == null) return;

  const equal = type === 'num' ? numClose(targetNorm, sourceNorm) : targetNorm === sourceNorm;
  if (equal) {
    boost(container, key, CONF_CROSS, 'espelho', path, report);
  } else {
    report.conflicts.push({ path, target: targetVal, source: sourceRaw });
  }
}

export interface EspelhoSource {
  items: Array<Record<string, any>>;
  summary: Record<string, any> | null;
}

/** Build code/GTIN indexes over the espelho items; drop ambiguous codes. */
function indexEspelho(espelho: EspelhoSource) {
  const byGtin = new Map<string, Record<string, any>>();
  const byCode = new Map<string, Record<string, any>>();
  const dupCodes = new Set<string>();
  for (const e of espelho.items) {
    const g = normalizeGtin(e.ean13 ?? e.ean);
    if (g && !byGtin.has(g)) byGtin.set(g, e);
    const c = normalizeItemCode(e.codigo ?? e.itemCode);
    if (c) {
      if (byCode.has(c)) dupCodes.add(c);
      else byCode.set(c, e);
    }
  }
  for (const c of dupCodes) byCode.delete(c); // never match an ambiguous code
  return { byGtin, byCode };
}

/**
 * Reconcile an itemized document (invoice / proforma / packing_list) in place.
 * `espelho` may be null — arithmetic self-consistency still applies.
 */
export function reconcileItemizedDoc(
  data: Record<string, any>,
  documentType: string,
  espelho: EspelhoSource | null,
): ReconcileReport {
  const report = emptyReport();
  if (!data || typeof data !== 'object') return report;

  const hasPrices = documentType === 'invoice' || documentType === 'proforma_invoice';
  const itemRules = documentType === 'packing_list' ? PACKING_LIST_ITEM_RULES : INVOICE_ITEM_RULES;
  const scalarRules =
    documentType === 'packing_list' ? PACKING_LIST_SCALAR_RULES : INVOICE_SCALAR_RULES;

  const items: Array<Record<string, any>> = Array.isArray(data.items) ? data.items : [];
  const index = espelho ? indexEspelho(espelho) : null;

  // ── Arithmetic: FOB partition (which items are Free Of Charge) ──────────
  let focPartitionConfirmed = false;
  if (hasPrices) {
    const fob = cfValue(data.totalFobValue);
    if (isNum(fob)) {
      let sumByFlag = 0;
      for (const it of items) {
        const t = cfValue(it.totalPrice);
        if (isNum(t) && cfValue(it.isFreeOfCharge) !== true) sumByFlag += t;
      }
      focPartitionConfirmed = numClose(sumByFlag, fob);
    }
  }

  // ── Items ───────────────────────────────────────────────────────────────
  items.forEach((it, i) => {
    if (!it || typeof it !== 'object') return;

    // Arithmetic self-consistency: quantity × unitPrice == totalPrice
    if (hasPrices) {
      const q = cfValue(it.quantity);
      const u = cfValue(it.unitPrice);
      const t = cfValue(it.totalPrice);
      if (isNum(q) && isNum(u) && isNum(t) && numClose(q * u, t)) {
        boost(it, 'quantity', CONF_ARITH, 'arithmetic', `items[${i}].quantity`, report);
        boost(it, 'unitPrice', CONF_ARITH, 'arithmetic', `items[${i}].unitPrice`, report);
        boost(it, 'totalPrice', CONF_ARITH, 'arithmetic', `items[${i}].totalPrice`, report);
      }
      if (focPartitionConfirmed) {
        boost(it, 'isFreeOfCharge', CONF_FILL, 'arithmetic', `items[${i}].isFreeOfCharge`, report);
      }
    }

    // Cross-document corroboration against the trusted espelho
    if (index) {
      const g = normalizeGtin(cfValue(it.ean));
      const c = normalizeItemCode(cfValue(it.itemCode));
      const match = (g && index.byGtin.get(g)) || (c && index.byCode.get(c)) || null;
      if (match) {
        for (const [key, rule] of Object.entries(itemRules)) {
          reconcileField(it, key, match[rule.from], rule.type, `items[${i}].${key}`, report);
        }
      }
    }
  });

  // ── Scalars ───────────────────────────────────────────────────────────
  if (hasPrices && focPartitionConfirmed) {
    boost(data, 'totalFobValue', CONF_ARITH, 'arithmetic', 'totalFobValue', report);
  }
  if (index && espelho?.summary) {
    for (const [key, rule] of Object.entries(scalarRules)) {
      reconcileField(data, key, espelho.summary[rule.from], rule.type, key, report);
    }
    // exporterName ↔ espelho supplier (per-item `fornecedor`)
    const fornecedor = espelho.items.find((e) => e.fornecedor)?.fornecedor;
    if (fornecedor) {
      reconcileField(data, 'exporterName', fornecedor, 'name', 'exporterName', report);
    }
  }

  return report;
}

interface TrustEspelhoRow {
  type: string;
  isProcessed: boolean | null;
  aiParsedData: unknown;
  confidenceScore: string | number | null;
}

/**
 * An espelho is a trustworthy INDEPENDENT source only when it came from the
 * operator-uploaded xlsx (confidence ≈ 0.99) and was NOT auto-built from the
 * invoice (which would make corroboration circular).
 */
export function selectTrustedEspelho(docs: TrustEspelhoRow[]): EspelhoSource | null {
  const candidates = docs
    .filter((d) => d.type === 'espelho' && d.isProcessed && d.aiParsedData)
    .filter((d) => Number(d.confidenceScore) >= 0.95);
  for (const d of candidates) {
    const flat = flattenAiData(d.aiParsedData as Record<string, any>);
    if (flat?.summary?.generatedBy === 'auto_deterministic') continue;
    const items = Array.isArray(flat?.items) ? flat.items : [];
    if (items.length > 0) {
      return { items, summary: (flat.summary as Record<string, any>) ?? null };
    }
  }
  return null;
}
