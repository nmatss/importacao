# Build stage
FROM node:22-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install

COPY . .
RUN npm run build

# Production stage
FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/drizzle ./drizzle

RUN mkdir -p uploads && chown node:node uploads

USER node

EXPOSE 3001
CMD ["sh", "-c", "node dist/shared/database/migrate.js && node dist/server.js"]
