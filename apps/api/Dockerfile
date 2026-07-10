# Build stage
FROM node:22-alpine AS builder

# Refresh OS packages to pick up the latest patched libcrypto3 / libssl3 /
# zlib — otherwise Trivy (aquasecurity/trivy-action) finds fixable HIGH
# CVEs in the base layer and blocks the Build Docker Images CI job.
RUN apk upgrade --no-cache

WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/package.json
COPY apps/web/package.json ./apps/web/package.json
ENV HUSKY=0
RUN npm ci --workspace apps/api --ignore-scripts

COPY apps/api ./apps/api
WORKDIR /app/apps/api
RUN npm run build

# Production stage
FROM node:22-alpine

RUN apk upgrade --no-cache && apk add --no-cache \
  su-exec \
  poppler-utils \
  tesseract-ocr \
  tesseract-ocr-data-eng \
  tesseract-ocr-data-por

WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/package.json
COPY apps/web/package.json ./apps/web/package.json
ENV HUSKY=0
RUN npm ci --omit=dev --workspace apps/api --ignore-scripts
RUN if [ -d apps/api/node_modules ]; then cp -a apps/api/node_modules/. node_modules/; fi
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx

COPY --from=builder /app/apps/api/dist ./dist
COPY --from=builder /app/apps/api/drizzle ./drizzle

RUN mkdir -p uploads && chown node:node uploads

COPY apps/api/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

USER node

EXPOSE 3001
ENTRYPOINT ["entrypoint.sh"]
