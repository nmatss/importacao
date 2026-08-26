\set ON_ERROR_STOP on

BEGIN ISOLATION LEVEL SERIALIZABLE;

DO $$
DECLARE
  unexpected_count integer;
BEGIN
  SELECT count(*)
    INTO unexpected_count
    FROM import_processes
   WHERE correction_status IS NOT NULL
     AND correction_status NOT IN ('pending_correction', 'SIM', 'NÃO', 'NAO');

  IF unexpected_count <> 0 THEN
    RAISE EXCEPTION
      'Unexpected correction_status values found; refusing normalization (% rows)',
      unexpected_count;
  END IF;
END
$$;

WITH normalized AS (
  UPDATE import_processes
     SET ai_extracted_data = COALESCE(ai_extracted_data, '{}'::jsonb)
       || jsonb_build_object('sheetDocumentCorrection', correction_status),
         correction_status = NULL,
         updated_at = now()
   WHERE correction_status IN ('SIM', 'NÃO', 'NAO')
  RETURNING id
)
INSERT INTO audit_logs (action, entity_type, details, created_at)
SELECT
  'normalize_validation_workflow_state',
  'import_process',
  jsonb_build_object(
    'normalizedRows', count(*),
    'source', 'follow-up reconciliation 2026-08-25'
  ),
  now()
FROM normalized;

DO $$
DECLARE
  invalid_count integer;
BEGIN
  SELECT count(*)
    INTO invalid_count
    FROM import_processes
   WHERE correction_status IS NOT NULL
     AND correction_status <> 'pending_correction';

  IF invalid_count <> 0 THEN
    RAISE EXCEPTION
      'Workflow normalization postcondition failed (% invalid rows)',
      invalid_count;
  END IF;
END
$$;

COMMIT;
