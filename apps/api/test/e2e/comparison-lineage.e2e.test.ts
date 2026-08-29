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

/**
 * Prova contra Postgres real (a) que a materializacao de `process_items` grava
 * a linhagem da ADR 0006 e nao duplica em clique duplo, e (b) que o aceite do
 * comparativo vive na tabela relacional: some quando invalidado e uma
 * reafirmacao entra como linha NOVA, sem violar o indice unico de evidencia.
 */

let ctx: E2EContext;
let skipReason: string | null = null;
let adminToken: string;
let sql: postgres.Sql;

beforeAll(async () => {
  try {
    ctx = await setupE2EDatabase();
    adminToken = signTestToken(E2E_ADMIN);
    sql = postgres(ctx.connectionString, { max: 4 });
  } catch (err) {
    skipReason = handleE2ESetupFailure(err);
  }
}, 120_000);

afterAll(async () => {
  await sql?.end();
  await ctx?.cleanup();
});

async function seedProcess(code: string): Promise<number> {
  const [proc] = await sql<{ id: number }[]>`
    INSERT INTO import_processes (process_code, brand, status, created_by, created_at, updated_at)
    VALUES (${code}, 'puket', 'documents_received', ${E2E_ADMIN.id}, now(), now())
    RETURNING id
  `;
  return proc.id;
}

async function seedDocument(
  processId: number,
  type: string,
  aiParsedData: Record<string, unknown>,
): Promise<number> {
  const [doc] = await sql<{ id: number }[]>`
    INSERT INTO documents (
      process_id, type, original_filename, storage_path, mime_type,
      ai_parsed_data, confidence_score, is_processed, created_at, updated_at
    )
    VALUES (
      ${processId}, ${type}, ${`${type}.pdf`}, ${`uploads/${type}.pdf`}, 'application/pdf',
      ${sql.json(aiParsedData)}, 0.9000, true, now(), now()
    )
    RETURNING id
  `;
  return doc.id;
}

describe('Linhagem e aceites do comparativo (E2E)', () => {
  it('materializa process_items com linhagem e nao duplica em generate concorrente', async () => {
    if (skipReason) {
      console.warn(`SKIP: ${skipReason}`);
      return;
    }
    const { espelhoService } = await import('../../src/modules/espelhos/service.js');

    const processId = await seedProcess('E2E-LIN-001');
    const documentId = await seedDocument(processId, 'invoice', {
      items: [
        { itemCode: 'PK-1', description: 'CAMISETA', unitPrice: 10, quantity: 2, ncmCode: '6109' },
        { itemCode: 'PK-2', description: 'MEIA', unitPrice: 5, quantity: 4, ncmCode: '6115' },
      ],
    });
    const [run] = await sql<{ id: number }[]>`
      INSERT INTO document_extraction_runs (document_id, process_id, document_type, created_at)
      VALUES (${documentId}, ${processId}, 'invoice', now())
      RETURNING id
    `;

    // Clique duplo: duas materializacoes concorrentes do MESMO processo.
    await Promise.all([
      espelhoService.autoPopulateItems(processId),
      espelhoService.autoPopulateItems(processId),
    ]);

    const rows = await sql<
      {
        id: number;
        source_document_id: number | null;
        extraction_run_id: number | null;
        materialized_at: Date | null;
      }[]
    >`
      SELECT id, source_document_id, extraction_run_id, materialized_at
      FROM process_items WHERE process_id = ${processId}
    `;

    // Duas invocacoes, UM lote: o recheque sob o advisory lock impede o dobro.
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.source_document_id).toBe(documentId);
      expect(row.extraction_run_id).toBe(run.id);
      expect(row.materialized_at).not.toBeNull();
    }
  }, 60_000);

  it('aceite vive na tabela: some ao ser invalidado e a reafirmacao vira linha nova', async () => {
    if (skipReason) {
      console.warn(`SKIP: ${skipReason}`);
      return;
    }
    const { app } = await import('../../src/app.js');

    const processId = await seedProcess('E2E-ACC-001');
    await seedDocument(processId, 'invoice', { exporterName: 'ACME TRADING LTD' });
    await seedDocument(processId, 'packing_list', { exporterName: 'OUTRA EXPORTADORA SA' });

    const first = await request(app)
      .get(`/api/documents/process/${processId}/comparison`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(first.status).toBe(200);

    const exporterRow = first.body.data.aggregateComparison.find(
      (row: any) => row.label === 'Exportador / Shipper',
    );
    expect(exporterRow).toBeDefined();
    expect(exporterRow.accepted).toBeNull();

    const accept = await request(app)
      .post(`/api/documents/process/${processId}/comparison/accept`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        scope: 'aggregate',
        rowKey: exporterRow.rowKey,
        fieldLabel: exporterRow.label,
        previousStatus: exporterRow.status,
        resolution_note: 'Nome comercial diferente da razao social.',
      });
    expect(accept.status).toBe(200);

    const accepted = await request(app)
      .get(`/api/documents/process/${processId}/comparison`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(accepted.body.data.acceptances).toHaveLength(1);
    const acceptedRow = accepted.body.data.aggregateComparison.find(
      (row: any) => row.rowKey === exporterRow.rowKey,
    );
    expect(acceptedRow.accepted).not.toBeNull();
    expect(acceptedRow.accepted.acceptedByName).toBeDefined();

    // A trilha central registra o aceite, como registra a edicao da celula.
    const [auditRow] = await sql<{ total: number }[]>`
      SELECT count(*)::int AS total FROM audit_logs
      WHERE action = 'accept_comparison' AND entity_id = ${processId}
    `;
    expect(auditRow.total).toBe(1);

    // Reprocessamento invalida o aceite (invalidateComparisonAcceptances).
    await sql`
      UPDATE comparison_acceptances
      SET invalidated_at = now(), invalidation_reason = 'document_reprocessed'
      WHERE process_id = ${processId} AND invalidated_at IS NULL
    `;

    const afterInvalidation = await request(app)
      .get(`/api/documents/process/${processId}/comparison`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(afterInvalidation.body.data.acceptances).toHaveLength(0);
    const clearedRow = afterInvalidation.body.data.aggregateComparison.find(
      (row: any) => row.rowKey === exporterRow.rowKey,
    );
    expect(clearedRow.accepted).toBeNull();

    // Reafirmar o MESMO payload nao pode ressuscitar a linha invalidada — e
    // tambem nao pode estourar o indice unico de evidencia.
    const reaffirm = await request(app)
      .post(`/api/documents/process/${processId}/comparison/accept`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        scope: 'aggregate',
        rowKey: exporterRow.rowKey,
        fieldLabel: exporterRow.label,
        previousStatus: exporterRow.status,
        resolution_note: 'Nome comercial diferente da razao social.',
      });
    expect(reaffirm.status).toBe(200);

    const stored = await sql<{ id: number; invalidated_at: Date | null }[]>`
      SELECT id, invalidated_at FROM comparison_acceptances
      WHERE process_id = ${processId} ORDER BY id
    `;
    expect(stored).toHaveLength(2);
    expect(stored[0].invalidated_at).not.toBeNull();
    expect(stored[1].invalidated_at).toBeNull();
  }, 60_000);

  it('edicao da celula exige justificativa e pode ser revertida ao valor extraido', async () => {
    if (skipReason) {
      console.warn(`SKIP: ${skipReason}`);
      return;
    }
    const { app } = await import('../../src/app.js');

    const processId = await seedProcess('E2E-OVR-001');
    await seedDocument(processId, 'invoice', { exporterName: 'ACME TRADING LTD' });
    await seedDocument(processId, 'packing_list', { exporterName: 'OUTRA EXPORTADORA SA' });

    const comparison = await request(app)
      .get(`/api/documents/process/${processId}/comparison`)
      .set('Authorization', `Bearer ${adminToken}`);
    const exporterRow = comparison.body.data.aggregateComparison.find(
      (row: any) => row.label === 'Exportador / Shipper',
    );

    const semNota = await request(app)
      .patch(`/api/documents/process/${processId}/comparison/field`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        rowKey: exporterRow.rowKey,
        fieldLabel: exporterRow.label,
        sourceColumn: 'packingList',
        value: 'ACME TRADING LTD',
      });
    expect(semNota.status).toBe(400);

    const comNota = await request(app)
      .patch(`/api/documents/process/${processId}/comparison/field`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        rowKey: exporterRow.rowKey,
        fieldLabel: exporterRow.label,
        sourceColumn: 'packingList',
        value: 'ACME TRADING LTD',
        note: 'packing list traz o nome fantasia',
      });
    expect(comNota.status).toBe(200);

    const edited = await request(app)
      .get(`/api/documents/process/${processId}/comparison`)
      .set('Authorization', `Bearer ${adminToken}`);
    const editedRow = edited.body.data.aggregateComparison.find(
      (row: any) => row.rowKey === exporterRow.rowKey,
    );
    expect(editedRow.packingList).toBe('ACME TRADING LTD');

    const removed = await request(app)
      .delete(`/api/documents/process/${processId}/comparison/field`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        rowKey: exporterRow.rowKey,
        sourceColumn: 'packingList',
        note: 'restaurar valor extraido',
      });
    expect(removed.status).toBe(200);

    const restored = await request(app)
      .get(`/api/documents/process/${processId}/comparison`)
      .set('Authorization', `Bearer ${adminToken}`);
    const restoredRow = restored.body.data.aggregateComparison.find(
      (row: any) => row.rowKey === exporterRow.rowKey,
    );
    // Sem override, a celula volta ao valor EXTRAIDO do packing list.
    expect(restoredRow.packingList).toBe('OUTRA EXPORTADORA SA');

    const [auditRow] = await sql<{ total: number }[]>`
      SELECT count(*)::int AS total FROM audit_logs
      WHERE action = 'remove_comparison_field_override' AND entity_id = ${processId}
    `;
    expect(auditRow.total).toBe(1);
  }, 60_000);
});
