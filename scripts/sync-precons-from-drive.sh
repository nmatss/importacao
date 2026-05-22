#!/usr/bin/env bash
# Pull-and-sync Pre-Cons from Google Drive.
#
# Wire to cron (e.g. every 30 min):
#   */30 * * * * API_URL=https://importacao.grupounico.com IMPORT_TOKEN=<bearer> \
#       /opt/importacao/scripts/sync-precons-from-drive.sh >> /var/log/importacao/precons.log 2>&1
#
# Requires:
#   - API_URL pointing at the running API
#   - IMPORT_TOKEN with admin permissions
#   - GOOGLE_DRIVE_PRE_CONS_FOLDER_ID configured on the API side
set -euo pipefail

: "${API_URL:?API_URL not set}"
: "${IMPORT_TOKEN:?IMPORT_TOKEN not set}"

ts="$(date '+%Y-%m-%d %H:%M:%S')"
echo "[$ts] triggering Pre-Cons sync-from-drive against $API_URL"

resp=$(curl -sS -w '\nHTTP_STATUS:%{http_code}' \
  -X POST "$API_URL/api/pre-cons/sync-from-drive" \
  -H "Authorization: Bearer $IMPORT_TOKEN" \
  -H 'Content-Type: application/json')

http_status="${resp##*HTTP_STATUS:}"
body="${resp%HTTP_STATUS:*}"

echo "[$ts] HTTP $http_status"
echo "$body" | head -c 4096
echo

if [[ "$http_status" != "200" ]]; then
  echo "[$ts] sync failed" >&2
  exit 1
fi
