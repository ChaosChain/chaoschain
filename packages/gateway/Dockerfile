# Stage 1: Build
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --include=dev
COPY . .
RUN npm run build

# Stage 2: Production runtime
FROM node:20-alpine AS runner
WORKDIR /app
RUN addgroup -g 1001 -S chaoschain && adduser -S gateway -u 1001 -G chaoschain
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package*.json ./
RUN npm ci --omit=dev
USER gateway
EXPOSE 3000
EXPOSE 9090
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s \
  CMD wget -qO- http://localhost:3000/health || exit 1
CMD ["node", "dist/app.js"]
