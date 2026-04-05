#!/bin/sh
set -e

# Container runs as USER node (Dockerfile). Ensure uploads dir exists.
mkdir -p /app/uploads 2>/dev/null || true

# Run migrations then start server
node dist/shared/database/migrate.js
exec node dist/server.js
