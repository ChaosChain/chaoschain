# Stage 1: Build
FROM node:20-alpine AS builder
RUN apk add --no-cache python3 make g++
WORKDIR /app
COPY packages/gateway/package*.json ./
RUN npm ci --include=dev
COPY packages/gateway/ .
RUN npm run build

# Stage 2: Production runtime
FROM node:20-alpine AS runner
RUN apk add --no-cache wget
WORKDIR /app
RUN addgroup -g 1001 -S chaoschain && adduser -S gateway -u 1001 -G chaoschain
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/src/persistence/postgres/migrations/ ./migrations/
EXPOSE 3000
EXPOSE 9090
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s \
  CMD wget -qO- http://localhost:3000/health || exit 1
CMD ["node", "dist/app.js"]
