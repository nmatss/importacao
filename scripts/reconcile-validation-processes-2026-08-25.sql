\set ON_ERROR_STOP on

BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';
LOCK TABLE import_processes IN SHARE ROW EXCLUSIVE MODE;

CREATE TEMP TABLE reconcile_extra_processes ON COMMIT DROP AS
SELECT id, process_code
FROM import_processes
WHERE process_code IN (
  'PUK015', 'PK189', 'PUK003', 'PUK012', 'PUK006', 'PUK005',
  'PKT-0035-IN', 'teste123', 'PKT-0032-BD',
  'DEMO-IM0712602NB-E227210', 'IM235', 'IM074', 'IM0732605NB',
  'IM237', 'PK208', 'PI7823Y', 'PK210', 'IM239'
);

DO $$
BEGIN
  IF (SELECT count(*) FROM reconcile_extra_processes) <> 18 THEN
    RAISE EXCEPTION 'extra process count diverged: %',
      (SELECT count(*) FROM reconcile_extra_processes);
  END IF;
END $$;

CREATE TEMP TABLE reconcile_process_moves ON COMMIT DROP AS
SELECT source.id AS source_process_id,
       target.id AS target_process_id,
       target.process_code AS target_process_code
FROM import_processes source
JOIN import_processes target ON target.process_code = CASE source.process_code
  WHEN 'PUK015' THEN 'PK2042602NB'
  WHEN 'PUK012' THEN 'PK1182601NB'
  WHEN 'PUK006' THEN 'PK1192512XI'
END
WHERE source.process_code IN ('PUK015', 'PUK012', 'PUK006');

DO $$
BEGIN
  IF (SELECT count(*) FROM reconcile_process_moves) <> 3 THEN
    RAISE EXCEPTION 'process move count diverged: %',
      (SELECT count(*) FROM reconcile_process_moves);
  END IF;
END $$;

-- Move only document projections. Follow Up/process metadata from the legacy
-- aggregate must not overwrite the authoritative target row.
UPDATE import_processes target
SET ai_extracted_data = COALESCE(target.ai_extracted_data, '{}'::jsonb) || projection.data,
    updated_at = now()
FROM reconcile_process_moves move
JOIN import_processes source ON source.id = move.source_process_id
CROSS JOIN LATERAL (
  SELECT COALESCE(jsonb_object_agg(entry.key, entry.value), '{}'::jsonb) AS data
  FROM jsonb_each(COALESCE(source.ai_extracted_data, '{}'::jsonb)) entry
  WHERE entry.key IN (
    'invoice', 'proforma_invoice', 'packing_list', 'ohbl', 'draft_bl', 'espelho'
  )
) projection
WHERE target.id = move.target_process_id;

UPDATE import_processes target
SET ai_extracted_data = COALESCE(target.ai_extracted_data, '{}'::jsonb) ||
      jsonb_build_object('ohbl', source.ai_extracted_data -> 'ohbl'),
    updated_at = now()
FROM import_processes source
WHERE target.process_code = 'PK2092606SZ'
  AND source.process_code = 'PK2112606NB'
  AND source.ai_extracted_data ? 'ohbl';

UPDATE import_processes
SET ai_extracted_data = ai_extracted_data - 'ohbl',
    updated_at = now()
WHERE process_code = 'PK2112606NB'
  AND ai_extracted_data ? 'ohbl';

CREATE TEMP TABLE reconcile_document_moves ON COMMIT DROP AS
SELECT d.id AS document_id,
       move.target_process_id,
       move.target_process_code
FROM documents d
JOIN reconcile_process_moves move ON move.source_process_id = d.process_id
UNION ALL
SELECT d.id, target.id, target.process_code
FROM documents d
JOIN import_processes target ON target.process_code = 'PK2092606SZ'
WHERE d.id IN (153, 154)
  AND d.process_id = 277;

DO $$
BEGIN
  IF (SELECT count(*) FROM reconcile_document_moves) <> 18 THEN
    RAISE EXCEPTION 'document move count diverged: %',
      (SELECT count(*) FROM reconcile_document_moves);
  END IF;
END $$;

-- Preserve email lineage. Entries without an authoritative destination remain
-- recoverable orphans instead of being destroyed with their validation record.
UPDATE email_ingestion_logs log
SET process_id = move.target_process_id,
    process_code = move.target_process_code,
    updated_at = now()
FROM reconcile_process_moves move
WHERE log.process_id = move.source_process_id;

UPDATE email_attachment_documents attachment
SET process_id = move.target_process_id,
    process_code = move.target_process_code,
    updated_at = now()
FROM reconcile_process_moves move
WHERE attachment.process_id = move.source_process_id;

UPDATE email_ingestion_logs log
SET process_id = NULL,
    updated_at = now()
WHERE log.process_id IN (SELECT id FROM reconcile_extra_processes);

UPDATE email_attachment_documents attachment
SET process_id = NULL,
    orphaned = true,
    recoverable = true,
    updated_at = now()
WHERE attachment.process_id IN (SELECT id FROM reconcile_extra_processes);

UPDATE email_attachment_documents attachment
SET process_id = move.target_process_id,
    process_code = move.target_process_code,
    updated_at = now()
FROM reconcile_document_moves move
WHERE attachment.document_id = move.document_id;

UPDATE document_extraction_history history
SET process_id = move.target_process_id
FROM reconcile_document_moves move
WHERE history.document_id = move.document_id;

UPDATE document_extraction_runs run
SET process_id = move.target_process_id
FROM reconcile_document_moves move
WHERE run.document_id = move.document_id;

UPDATE document_extracted_fields field
SET process_id = move.target_process_id
FROM reconcile_document_moves move
WHERE field.document_id = move.document_id;

UPDATE documents document
SET process_id = move.target_process_id,
    updated_at = now()
FROM reconcile_document_moves move
WHERE document.id = move.document_id;

-- Payment terms are not ISO-4217 currencies. Keep PREPAID/COLLECT as the term
-- and remove the conflicting numeric amount that crashed Intl.NumberFormat.
UPDATE documents
SET ai_parsed_data = jsonb_set(
      ai_parsed_data,
      '{freightValue,value}',
      'null'::jsonb,
      true
    ),
    updated_at = now()
WHERE id = 153
  AND upper(ai_parsed_data -> 'freightCurrency' ->> 'value') IN ('PREPAID', 'COLLECT');

UPDATE import_processes
SET ai_extracted_data = jsonb_set(
      ai_extracted_data,
      '{ohbl,freightValue,value}',
      'null'::jsonb,
      true
    ),
    updated_at = now()
WHERE process_code = 'PK2092606SZ'
  AND upper(ai_extracted_data -> 'ohbl' -> 'freightCurrency' ->> 'value') IN (
    'PREPAID',
    'COLLECT'
  );

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM documents
    WHERE id = 153
      AND upper(ai_parsed_data -> 'freightCurrency' ->> 'value') IN ('PREPAID', 'COLLECT')
      AND ai_parsed_data -> 'freightValue' -> 'value' <> 'null'::jsonb
  ) THEN
    RAISE EXCEPTION 'freight normalization failed for document 153';
  END IF;
END $$;

CREATE TEMP TABLE reconcile_document_deletes (
  document_id integer PRIMARY KEY
) ON COMMIT DROP;

INSERT INTO reconcile_document_deletes (document_id) VALUES
  (20), (21), (26), (27), (28), (44),
  (67), (68), (69), (70), (71), (72),
  (83), (84), (85), (86), (87), (88),
  (101), (102), (103), (104),
  (118), (119), (124), (125), (126), (127), (128),
  (146), (149);

DO $$
BEGIN
  IF (
    SELECT count(*)
    FROM documents document
    JOIN reconcile_document_deletes target ON target.document_id = document.id
  ) <> 31 THEN
    RAISE EXCEPTION 'document delete count diverged: %', (
      SELECT count(*)
      FROM documents document
      JOIN reconcile_document_deletes target ON target.document_id = document.id
    );
  END IF;
END $$;

DELETE FROM documents document
USING reconcile_document_deletes target
WHERE document.id = target.document_id;

-- Preserve the matched Sydle staging row while following the authoritative
-- Follow Up rename.
UPDATE sydle_purchase_payments staged
SET process_id = target.id,
    process_code = target.process_code,
    match_reason = concat_ws(
      ' | ',
      nullif(staged.match_reason, ''),
      'reconciled_from_PKT-0035-IN_2026-08-25'
    ),
    updated_at = now()
FROM import_processes target
WHERE staged.process_id = (
    SELECT id FROM import_processes WHERE process_code = 'PKT-0035-IN'
  )
  AND target.process_code = 'PKT-0035-IN-AIR';

DELETE FROM alerts alert
USING reconcile_extra_processes target
WHERE alert.process_id = target.id;

DELETE FROM communications communication
USING reconcile_extra_processes target
WHERE communication.process_id = target.id;

INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details)
SELECT NULL,
       'reconcile_validation_processes_2026_08_25',
       'process_batch',
       NULL,
       jsonb_build_object(
         'authoritativeSource', 'Follow Up Processos de Importação',
         'cutoff', '2025-05-01',
         'removedProcessCount', count(*),
         'removedProcessIds', jsonb_agg(id ORDER BY id),
         'removedProcessCodes', jsonb_agg(process_code ORDER BY id),
         'movedDocumentCount', (SELECT count(*) FROM reconcile_document_moves),
         'deletedDocumentCount', (SELECT count(*) FROM reconcile_document_deletes)
       )
FROM reconcile_extra_processes;

DELETE FROM import_processes process
USING reconcile_extra_processes target
WHERE process.id = target.id;

DO $$
BEGIN
  IF (SELECT count(*) FROM import_processes) <> 117 THEN
    RAISE EXCEPTION 'final process count diverged: %',
      (SELECT count(*) FROM import_processes);
  END IF;
  IF (SELECT count(*) FROM documents) <> 51 THEN
    RAISE EXCEPTION 'final document count diverged: %',
      (SELECT count(*) FROM documents);
  END IF;
  IF EXISTS (
    SELECT 1
    FROM import_processes process
    JOIN reconcile_extra_processes target ON target.id = process.id
  ) THEN
    RAISE EXCEPTION 'extra processes remain';
  END IF;
  IF EXISTS (
    SELECT 1 FROM sydle_purchase_payments WHERE process_code = 'PKT-0035-IN'
  ) THEN
    RAISE EXCEPTION 'stale Sydle process code remains';
  END IF;
  IF (
    SELECT count(*)
    FROM import_processes process
    CROSS JOIN LATERAL jsonb_object_keys(
      COALESCE(process.ai_extracted_data, '{}'::jsonb)
    ) projection_key
    WHERE projection_key IN (
      'invoice', 'proforma_invoice', 'packing_list', 'ohbl', 'draft_bl', 'espelho'
    )
  ) <> 26 THEN
    RAISE EXCEPTION 'final document projection count diverged: %', (
      SELECT count(*)
      FROM import_processes process
      CROSS JOIN LATERAL jsonb_object_keys(
        COALESCE(process.ai_extracted_data, '{}'::jsonb)
      ) projection_key
      WHERE projection_key IN (
        'invoice', 'proforma_invoice', 'packing_list', 'ohbl', 'draft_bl', 'espelho'
      )
    );
  END IF;
END $$;

SELECT json_build_object(
  'processes', (SELECT count(*) FROM import_processes),
  'documents', (SELECT count(*) FROM documents),
  'movedDocuments', (SELECT count(*) FROM reconcile_document_moves),
  'deletedDocuments', (SELECT count(*) FROM reconcile_document_deletes),
  'remainingInvalidCurrencyPairs', (
    SELECT count(*)
    FROM documents
    WHERE upper(ai_parsed_data -> 'freightCurrency' ->> 'value') IN ('PREPAID', 'COLLECT')
      AND ai_parsed_data -> 'freightValue' -> 'value' <> 'null'::jsonb
  )
);

COMMIT;
