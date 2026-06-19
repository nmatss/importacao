import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import postgres from 'postgres';
import {
  handleE2ESetupFailure,
  setupE2EDatabase,
  signTestToken,
  E2E_ADMIN,
  type E2EContext,
} from './setup.js';
import {
  INVOICE_EXTRACTION,
  PACKING_LIST_EXTRACTION,
  BL_EXTRACTION,
} from '../fixtures/import-flow.fixture.js';

// End-to-end HAPPY PATH for the core import flow Eduarda/Nicolas validate every
// day: a process with an Invoice + Packing List + BL whose AI extractions agree.
//
// HERMETIC BY CONSTRUCTION: we never run the AI provider. We insert the
// documents pre-extracted (isProcessed=true, aiParsedData set, confidence above
// the operational floor) — exactly the state a document reaches AFTER a
// successful extraction. The comparison and validation endpoints read that
// stored extraction, so the test exercises the real cross-document matching and
// the real 26-check validation pipeline without any network call. setup.ts also
// leaves AI_ALLOW_EXTERNAL=false, so no external provider could be reached even
// if a code path tried.

let ctx: E2EContext;
let skipReason: string | null = null;
let authToken: string;
let processId: number;

// A unique process code per run so repeated local runs against a reused
// container never collide on the UNIQUE(process_code) constraint.
const PROCESS_CODE = `E2E-FLOW-${Date.now()}`;

async function seedHappyPathProcess(connectionString: string): Promise<number> {
  const sql = postgres(connectionString, { max: 1 });
  try {
    // 1. The process the operator opens. Status 'draft' so the final validation
    //    run is allowed to transition draft -> validating -> validated.
    const [proc] = await sql<{ id: number }[]>`
      INSERT INTO import_processes (process_code, brand, status, created_by)
      VALUES (${PROCESS_CODE}, 'puket', 'draft', ${E2E_ADMIN.id})
      RETURNING id
    `;
    const pid = proc.id;

    // 2. The three core documents, already extracted. confidence_score is above
    //    MIN_OPERATIONAL_CONFIDENCE (0.4) so getComparison()/validation select
    //    them; is_processed=true and aiParsedData carry meaningful data.
    const insertDoc = (
      type: string,
      filename: string,
      data: unknown,
      confidence: number,
    ) => sql`
      INSERT INTO documents
        (process_id, type, original_filename, storage_path, mime_type,
         ai_parsed_data, confidence_score, is_processed)
      VALUES
        (${pid}, ${type}, ${filename}, ${`/tmp/e2e/${filename}`}, 'application/pdf',
         ${sql.json(data as object)}, ${confidence}, true)
    `;

    await insertDoc('invoice', 'invoice.pdf', INVOICE_EXTRACTION, 0.95);
    await insertDoc('packing_list', 'packing-list.pdf', PACKING_LIST_EXTRACTION, 0.95);
    await insertDoc('ohbl', 'bl.pdf', BL_EXTRACTION, 0.9);

    return pid;
  } finally {
    await sql.end();
  }
}

beforeAll(async () => {
  try {
    ctx = await setupE2EDatabase();
    authToken = signTestToken(E2E_ADMIN);
    processId = await seedHappyPathProcess(ctx.connectionString);
  } catch (err) {
    skipReason = handleE2ESetupFailure(err);
  }
}, 120_000);

afterAll(async () => {
  await ctx?.cleanup();
});

describe('Import flow E2E — happy path (invoice + packing list + BL)', () => {
  it('GET /process/:id/comparison — matches the two shared items and reports aggregates', async () => {
    if (skipReason) {
      console.warn(`SKIP: ${skipReason}`);
      return;
    }
    const { app } = await import('../../src/app.js');
    const res = await request(app)
      .get(`/api/documents/process/${processId}/comparison`)
      .set('Authorization', `Bearer ${authToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const data = res.body.data;
    // All three core documents were picked up by the selector.
    expect(data.hasInvoice).toBe(true);
    expect(data.hasPackingList).toBe(true);
    expect(data.hasBl).toBe(true);
    // No espelho was seeded, so the espelho dimension stays absent.
    expect(data.hasEspelho).toBe(false);

    // Item-level cross-document matching: both invoice lines exist in the PL.
    expect(Array.isArray(data.itemComparison)).toBe(true);
    expect(data.itemComparison).toHaveLength(2);
    for (const row of data.itemComparison) {
      expect(row.matched).toBe(true);
      // Quantities agree between invoice and packing list -> clean match.
      expect(row.qtyMatch).toBe(true);
      expect(row.status).toBe('match');
    }

    const byCode = Object.fromEntries(
      data.itemComparison.map((r: { itemCode: string }) => [r.itemCode, r]),
    );
    expect(byCode['PI7752Y'].invoiceQty).toBe(100);
    expect(byCode['PI7752Y'].plQty).toBe(100);
    expect(byCode['AC2285Y'].invoiceQty).toBe(50);
    expect(byCode['AC2285Y'].plQty).toBe(50);

    // Nothing dangling on either side once every line is paired.
    expect(data.unmatchedInvoiceItems).toHaveLength(0);
    expect(data.unmatchedPlItems).toHaveLength(0);

    // Aggregate field comparison is produced and the exporter row (shared by
    // INV/PL/BL) is conforming ('match').
    expect(Array.isArray(data.aggregateComparison)).toBe(true);
    const exporterRow = data.aggregateComparison.find(
      (r: { label: string }) => r.label === 'Exportador / Shipper',
    );
    expect(exporterRow).toBeDefined();
    expect(exporterRow.status).toBe('match');

    // Confidence carried through from the stored extractions.
    expect(Number(data.invoiceConfidence)).toBeGreaterThanOrEqual(0.4);
    expect(Number(data.plConfidence)).toBeGreaterThanOrEqual(0.4);
  });

  it('POST /:id/run then GET /:id/report — produces a validation report with a check summary', async () => {
    if (skipReason) {
      console.warn(`SKIP: ${skipReason}`);
      return;
    }
    const { app } = await import('../../src/app.js');

    const runRes = await request(app)
      .post(`/api/validation/${processId}/run`)
      .set('Authorization', `Bearer ${authToken}`);

    expect(runRes.status).toBe(200);
    expect(runRes.body.success).toBe(true);
    // The full check battery ran and returned a non-empty result set.
    expect(Array.isArray(runRes.body.data)).toBe(true);
    expect(runRes.body.data.length).toBeGreaterThan(0);
    for (const result of runRes.body.data) {
      expect(['passed', 'failed', 'warning', 'skipped']).toContain(result.status);
    }

    const reportRes = await request(app)
      .get(`/api/validation/${processId}/report`)
      .set('Authorization', `Bearer ${authToken}`);

    expect(reportRes.status).toBe(200);
    expect(reportRes.body.success).toBe(true);

    const report = reportRes.body.data;
    expect(report.processCode).toBe(PROCESS_CODE);
    expect(report.brand).toBe('puket');
    // A final run moved the process out of 'draft'; with no failing checks it
    // lands on 'validated' (worst case it stays diagnostic, but never 'draft').
    expect(report.status).not.toBe('draft');

    // The summary aggregates the persisted results and the counts are coherent.
    expect(report.summary).toBeDefined();
    expect(report.summary.total).toBeGreaterThan(0);
    const { total, passed, failed, warnings, skipped } = report.summary;
    expect(passed + failed + warnings + skipped).toBe(total);

    // The report buckets the persisted checks; cross-document checks exist.
    expect(Array.isArray(report.crossDocumentChecks)).toBe(true);
    expect(Array.isArray(report.systemChecks)).toBe(true);
    expect(report.crossDocumentChecks.length + report.systemChecks.length).toBe(total);
  });
});
