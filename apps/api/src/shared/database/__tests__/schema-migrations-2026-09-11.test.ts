import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { getTableConfig, type PgTable } from 'drizzle-orm/pg-core';
import { documentIngestionTombstones, documents, processChecklistHiddenSteps } from '../schema.js';

const MIGRATIONS_FOLDER = path.resolve(process.cwd(), 'drizzle');

function sqlDe(arquivo: string): string {
  return fs.readFileSync(path.join(MIGRATIONS_FOLDER, arquivo), 'utf8');
}

/**
 * As migrations 0011+ ficam fora do journal do Drizzle, entao nada gera o SQL a
 * partir do `schema.ts`: os dois sao escritos a mao e podem divergir. Um campo
 * declarado no schema e ausente da migration compila, passa nos testes com
 * mock e quebra so em producao, na primeira query que o seleciona.
 *
 * Estes casos amarram cada coluna e indice declarado no schema para as
 * estruturas da reuniao de 2026-09-11 ao SQL que as cria.
 */
describe('schema.ts x migrations da fundacao (2026-09-11)', () => {
  const casos: Array<[string, PgTable, string, string[] | null]> = [
    [
      'documents (colunas novas)',
      documents,
      '0029_document_content_dedupe_and_tombstones.sql',
      ['content_sha256', 'drive_md5', 'drive_version', 'drive_modified_time', 'drive_area'],
    ],
    [
      'document_ingestion_tombstones',
      documentIngestionTombstones,
      '0029_document_content_dedupe_and_tombstones.sql',
      null,
    ],
    [
      'process_checklist_hidden_steps',
      processChecklistHiddenSteps,
      '0030_process_checklist_hidden_steps.sql',
      null,
    ],
  ];

  it.each(casos)('%s: toda coluna declarada e criada pela migration', (_n, tabela, arquivo, so) => {
    const sql = sqlDe(arquivo);
    const config = getTableConfig(tabela);
    const colunas = so ?? config.columns.map((c) => c.name);

    expect(colunas.length).toBeGreaterThan(0);
    for (const coluna of colunas) {
      expect(config.columns.map((c) => c.name)).toContain(coluna);
      expect(sql, `${coluna} ausente de ${arquivo}`).toContain(`"${coluna}"`);
    }
  });

  it.each(casos)(
    '%s: todo indice/unico declarado existe na migration',
    (_n, tabela, arquivo, so) => {
      const sql = sqlDe(arquivo);
      const config = getTableConfig(tabela);
      const indices = [
        ...config.indexes.map((i) => i.config.name),
        ...config.uniqueConstraints.map((u) => u.name),
      ]
        .filter((nome): nome is string => typeof nome === 'string')
        // Para `documents`, so os indices que a 0029 introduz.
        .filter((nome) => so === null || nome === 'documents_process_content_sha256_idx');

      expect(indices.length).toBeGreaterThan(0);
      for (const nome of indices) {
        expect(sql, `indice ${nome} ausente de ${arquivo}`).toContain(`"${nome}"`);
      }
    },
  );

  it('tombstone: document_id nao tem FK (o documento ja foi apagado)', () => {
    const config = getTableConfig(documentIngestionTombstones);
    const colunasComFk = config.foreignKeys.flatMap((fk) =>
      fk.reference().columns.map((c) => c.name),
    );

    expect(colunasComFk).toContain('process_id');
    expect(colunasComFk).not.toContain('document_id');
    expect(sqlDe('0029_document_content_dedupe_and_tombstones.sql')).toMatch(
      /"document_id" integer,/,
    );
  });

  it('as FKs para o processo apagam em cascata no schema e no SQL', () => {
    for (const [tabela, arquivo] of [
      [documentIngestionTombstones, '0029_document_content_dedupe_and_tombstones.sql'],
      [processChecklistHiddenSteps, '0030_process_checklist_hidden_steps.sql'],
    ] as const) {
      const fk = getTableConfig(tabela).foreignKeys.find((f) =>
        f.reference().columns.some((c) => c.name === 'process_id'),
      );
      expect(fk?.onDelete).toBe('cascade');
      expect(sqlDe(arquivo)).toMatch(
        /"process_id" integer NOT NULL\s+REFERENCES "import_processes"\("id"\) ON DELETE CASCADE/,
      );
    }
  });

  it('etapa oculta e unica por (processo, etapa)', () => {
    const unico = getTableConfig(processChecklistHiddenSteps).uniqueConstraints.find(
      (u) => u.name === 'process_checklist_hidden_steps_process_step_uniq',
    );
    expect(unico?.columns.map((c) => c.name)).toEqual(['process_id', 'step_key']);
    expect(sqlDe('0030_process_checklist_hidden_steps.sql')).toMatch(
      /UNIQUE \("process_id", "step_key"\)/,
    );
  });

  it('a 0029 nao reescreve dado existente (aditiva)', () => {
    const sql = sqlDe('0029_document_content_dedupe_and_tombstones.sql').replace(/--.*$/gm, '');
    // Comando que reescreve ou remove dado. `ON DELETE CASCADE` de uma FK nao
    // e um comando, entao so conta DELETE/UPDATE no inicio de uma instrucao.
    expect(sql).not.toMatch(/\b(DROP|TRUNCATE)\b|(^|;)\s*(UPDATE|DELETE)\b/im);

    // As colunas novas de `documents` sao anulaveis e sem DEFAULT: nenhuma
    // linha existente e reescrita pelo ALTER.
    const alterDocuments = /ALTER TABLE "documents"([\s\S]*?);/.exec(sql)?.[1] ?? '';
    expect(alterDocuments).toContain('ADD COLUMN IF NOT EXISTS');
    expect(alterDocuments).not.toMatch(/NOT NULL|DEFAULT/i);
  });
});
