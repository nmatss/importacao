#!/bin/sh
set -e

# Fix uploads directory permissions (Docker named volume may be root-owned)
mkdir -p /app/uploads
chown node:node /app/uploads

# Run migrations and start server as non-root user
exec su-exec node sh -c "node dist/shared/database/migrate.js && node dist/server.js"
