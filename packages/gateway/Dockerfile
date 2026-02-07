FROM node:20-alpine AS builder

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

FROM node:20-alpine

RUN apk add --no-cache postgresql-client wget
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY package.json ./
COPY src/persistence/postgres/migrations/ ./migrations/

EXPOSE 3000
CMD ["node", "dist/app.js"]
