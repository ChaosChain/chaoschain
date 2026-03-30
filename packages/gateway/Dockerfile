# Stage 1: Build
FROM node:20-alpine AS builder
RUN apk add --no-cache python3 make g++
WORKDIR /app
COPY packages/gateway/package*.json ./
RUN npm ci --include=dev
COPY packages/gateway/ .
# Copy skill files from repo root (build context is repo root)
COPY chaoschain-skills ./chaoschain-skills
RUN npm run build

# Stage 2: Production runtime
FROM node:20-alpine AS runner
WORKDIR /app
RUN apk add --no-cache wget
RUN addgroup -g 1001 -S chaoschain && adduser -S gateway -u 1001 -G chaoschain
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/chaoschain-skills ./chaoschain-skills
COPY --from=builder /app/demo-data ./demo-data
ENV SKILLS_DIR=/app/chaoschain-skills
# --ignore-scripts avoids building optional native deps (e.g. bufferutil) that need Python in runner
RUN npm ci --omit=dev --ignore-scripts
USER gateway
EXPOSE 3000
EXPOSE 9090
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s \
  CMD wget -qO- http://localhost:3000/health || exit 1
CMD ["node", "dist/app.js"]
