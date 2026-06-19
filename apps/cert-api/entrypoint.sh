#!/bin/sh
set -e

# =============================================================================
# cert-api entrypoint — durable volume ownership fix (issue #85)
# =============================================================================
# /app/reports (cert-reports) and /app/certs (cert-certs) are docker named
# volumes. A FRESH named volume is created owned by root:root, which breaks
# writes for the app process running as uid 1001 (PermissionError on
# /app/reports). Previously this was patched with a one-time manual chown,
# but a new/recreated volume re-breaks it.
#
# This script runs a tiny root-only chown over the mount points on every start,
# then drops to the unprivileged appuser (uid 1001) via gosu before exec'ing
# the app, so the application process itself NEVER runs as root.

APP_UID=1001
APP_GID=1001
APP_USER=appuser

# Only the root path needs/can chown. If the container is (unexpectedly) not
# root, skip the chown and just run the command as the current user — the app
# still works when the volume is already correctly owned.
if [ "$(id -u)" = "0" ]; then
    # Best-effort: never let a chown hiccup take the container down; the app's
    # own startup will surface a real permission problem if one remains.
    chown -R "${APP_UID}:${APP_GID}" /app/reports /app/certs 2>/dev/null || true
    exec gosu "${APP_USER}" "$@"
fi

exec "$@"
