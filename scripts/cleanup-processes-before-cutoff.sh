#!/usr/bin/env bash
# Safely removes import processes whose ETD is older than an explicit cutoff.
#
# Default mode is read-only. Execution requires verified DB/uploads backups and
# an exact expected target count:
#
#   scripts/cleanup-processes-before-cutoff.sh
#   scripts/cleanup-processes-before-cutoff.sh --execute \
#     --expected-delete-count 170 \
#     --backup-file /path/importacao_TIMESTAMP.pgdump \
#     --uploads-backup /path/importacao_TIMESTAMP_uploads.tar.gz
set -euo pipefail

MODE="dry-run"
CUTOFF_DATE="2025-05-01"
DEMO_PROCESS_ID="264"
EXPECTED_DELETE_COUNT=""
BACKUP_FILE=""
UPLOADS_BACKUP=""
DB_CONTAINER="${DB_CONTAINER:-importacao-postgres}"
DB_NAME="${POSTGRES_DB:-importacao}"
DB_USER="${POSTGRES_USER:-importacao}"
BATCH_ID="cleanup-processes-$(date -u +%Y%m%dT%H%M%SZ)"

usage() {
  sed -n '2,13p' "$0"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --execute)
      MODE="execute"
      shift
      ;;
    --cutoff)
      CUTOFF_DATE="${2:?--cutoff requires YYYY-MM-DD}"
      shift 2
      ;;
    --demo-process-id)
      DEMO_PROCESS_ID="${2:?--demo-process-id requires an integer}"
      shift 2
      ;;
    --expected-delete-count)
      EXPECTED_DELETE_COUNT="${2:?--expected-delete-count requires an integer}"
      shift 2
      ;;
    --backup-file)
      BACKUP_FILE="${2:?--backup-file requires a path}"
      shift 2
      ;;
    --uploads-backup)
      UPLOADS_BACKUP="${2:?--uploads-backup requires a path}"
      shift 2
      ;;
    --batch-id)
      BATCH_ID="${2:?--batch-id requires a value}"
      shift 2
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if [[ ! "${CUTOFF_DATE}" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]]; then
  echo "Invalid cutoff date: ${CUTOFF_DATE}" >&2
  exit 2
fi
if [[ ! "${DEMO_PROCESS_ID}" =~ ^[0-9]+$ ]]; then
  echo "Invalid DEMO process id: ${DEMO_PROCESS_ID}" >&2
  exit 2
fi
if ! docker ps --format '{{.Names}}' | grep -Fxq "${DB_CONTAINER}"; then
  echo "Database container is not running: ${DB_CONTAINER}" >&2
  exit 2
fi

PSQL=(docker exec -i "${DB_CONTAINER}" psql -X -v ON_ERROR_STOP=1 -P pager=off
  -U "${DB_USER}" -d "${DB_NAME}"
  -v "cutoff=${CUTOFF_DATE}" -v "demo_id=${DEMO_PROCESS_ID}" -v "batch_id=${BATCH_ID}")

if [[ "${MODE}" == "dry-run" ]]; then
  "${PSQL[@]}" <<'SQL'
BEGIN TRANSACTION READ ONLY;

SELECT current_timestamp AS checked_at,
       current_setting('transaction_read_only') AS read_only,
       :'cutoff' AS cutoff,
       :demo_id::integer AS preserved_demo_id;

SELECT count(*) AS process_count_before,
       count(*) FILTER (WHERE etd < DATE :'cutoff' AND id <> :demo_id::integer) AS delete_target_count,
       count(*) FILTER (WHERE etd IS NULL OR etd >= DATE :'cutoff' OR id = :demo_id::integer) AS expected_remaining,
       count(*) FILTER (WHERE etd IS NULL AND id <> :demo_id::integer) AS preserved_null_etd_non_demo,
       count(*) FILTER (WHERE id = :demo_id::integer) AS demo_count
FROM import_processes;

SELECT status, count(*) AS processes, min(etd) AS min_etd, max(etd) AS max_etd
FROM import_processes
WHERE etd < DATE :'cutoff' AND id <> :demo_id::integer
GROUP BY status
ORDER BY status;

SELECT id, process_code, status, etd
FROM import_processes
WHERE etd < DATE :'cutoff' AND id <> :demo_id::integer
ORDER BY etd, id;

ROLLBACK;
SQL
  exit 0
fi

if [[ ! "${EXPECTED_DELETE_COUNT}" =~ ^[0-9]+$ ]]; then
  echo "--execute requires --expected-delete-count" >&2
  exit 2
fi
if [[ ! -s "${BACKUP_FILE}" ]]; then
  echo "Database backup is missing or empty: ${BACKUP_FILE}" >&2
  exit 2
fi
if [[ ! -s "${UPLOADS_BACKUP}" ]]; then
  echo "Uploads backup is missing or empty: ${UPLOADS_BACKUP}" >&2
  exit 2
fi

docker exec -i "${DB_CONTAINER}" pg_restore --list < "${BACKUP_FILE}" > /dev/null
tar -tzf "${UPLOADS_BACKUP}" > /dev/null

"${PSQL[@]}" -v "expected_delete_count=${EXPECTED_DELETE_COUNT}" <<'SQL'
BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE;
LOCK TABLE import_processes IN SHARE ROW EXCLUSIVE MODE;

CREATE TEMP TABLE cleanup_process_targets ON COMMIT DROP AS
SELECT id, process_code, etd
FROM import_processes
WHERE etd < DATE :'cutoff' AND id <> :demo_id::integer;

SELECT count(*) AS actual_delete_count,
       count(*) = :expected_delete_count::integer AS delete_count_matches
FROM cleanup_process_targets
\gset

\if :delete_count_matches
\else
  \echo 'ABORT: delete target count differs from the approved count.'
  ROLLBACK;
  \quit 3
\endif

SELECT count(*) = 1 AS demo_exists
FROM import_processes
WHERE id = :demo_id::integer
  AND process_code = 'DEMO-IM0712602NB-E227210'
\gset

\if :demo_exists
\else
  \echo 'ABORT: preserved DEMO identity does not match.'
  ROLLBACK;
  \quit 4
\endif

-- These nullable legacy FKs have NO ACTION constraints in production. Keep
-- their audit/source rows while detaching the process that will be removed.
UPDATE email_ingestion_logs
SET process_id = NULL, updated_at = NOW()
WHERE process_id IN (SELECT id FROM cleanup_process_targets);

UPDATE li_tracking
SET process_id = NULL, updated_at = NOW()
WHERE process_id IN (SELECT id FROM cleanup_process_targets);

INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details)
SELECT NULL,
       'cleanup_processes_before_cutoff',
       'process_batch',
       NULL,
       jsonb_build_object(
         'batchId', :'batch_id',
         'cutoff', :'cutoff',
         'preservedDemoId', :demo_id::integer,
         'deletedProcessCount', count(*),
         'deletedProcessIds', jsonb_agg(id ORDER BY id),
         'deletedProcessCodes', jsonb_agg(process_code ORDER BY id)
       )
FROM cleanup_process_targets;

DELETE FROM import_processes p
USING cleanup_process_targets target
WHERE p.id = target.id;

SELECT count(*) AS process_count_after,
       count(*) FILTER (WHERE etd < DATE :'cutoff' AND id <> :demo_id::integer) AS old_process_count_after,
       count(*) FILTER (WHERE etd IS NULL AND id <> :demo_id::integer) AS null_etd_non_demo_after,
       count(*) FILTER (WHERE id = :demo_id::integer) AS demo_count_after
FROM import_processes;

SELECT count(*) = 0 AS cleanup_reconciled
FROM import_processes
WHERE etd < DATE :'cutoff' AND id <> :demo_id::integer
\gset

\if :cleanup_reconciled
  COMMIT;
\else
  \echo 'ABORT: old processes remain after delete.'
  ROLLBACK;
  \quit 5
\endif
SQL

echo "Cleanup batch completed: ${BATCH_ID}"
