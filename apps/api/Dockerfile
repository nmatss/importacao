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

# poppler-data + fonte CJK: os BLs da reuniao 11/09/2026 usam fonte composta
# Type0/CIDFontType0 com ordering Adobe-GB1. Sem os CMaps do poppler-data o
# pdftotext/pdftoppm nao resolve o mapeamento ("Missing language pack for
# Adobe-GB1 mapping") e a pagina sai em branco — o OCR entao le so o gabarito
# do formulario. font-noto-cjk da os glifos para a rasterizacao.
RUN apk upgrade --no-cache && apk add --no-cache \
  su-exec \
  poppler-utils \
  poppler-data \
  font-noto-cjk \
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
COPY scripts/audit-process-completeness.mjs ./scripts/audit-process-completeness.mjs
COPY scripts/reprocess-documents.mjs ./scripts/reprocess-documents.mjs
COPY scripts/smoke-integrations.mjs ./scripts/smoke-integrations.mjs

RUN mkdir -p uploads && chown node:node uploads

COPY apps/api/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

USER node

EXPOSE 3001
ENTRYPOINT ["entrypoint.sh"]
