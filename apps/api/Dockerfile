# Build stage
FROM node:25-alpine AS builder

# Refresh OS packages to pick up the latest patched libcrypto3 / libssl3 /
# zlib — otherwise Trivy (aquasecurity/trivy-action) finds fixable HIGH
# CVEs in the base layer and blocks the Build Docker Images CI job.
RUN apk upgrade --no-cache

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install

COPY . .
RUN npm run build

# Production stage
FROM node:25-alpine

RUN apk upgrade --no-cache && apk add --no-cache su-exec

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/drizzle ./drizzle

RUN mkdir -p uploads && chown node:node uploads

COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

USER node

EXPOSE 3001
ENTRYPOINT ["entrypoint.sh"]
