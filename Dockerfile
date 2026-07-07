# ─── Stage 1: Bağımlılıklar ──────────────────────────────────────────────────
# Tüm bağımlılıklar (dev dahil) kurulur; build için gerekli.
FROM node:22-alpine AS deps
WORKDIR /app

COPY package*.json ./
# ci: package-lock.json'a sadık kal, güvenlik açıklarını atla
RUN npm ci --ignore-scripts

# ─── Stage 2: Build ───────────────────────────────────────────────────────────
FROM node:22-alpine AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Prisma client'ı üret; TS'i derle
RUN npx prisma generate && npm run build

# ─── Stage 3: Production runtime ─────────────────────────────────────────────
# Yalnızca production bağımlılıkları + derlenen çıktı
FROM node:22-alpine AS runner
WORKDIR /app

# Güvenlik: root olmayan kullanıcı
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 backend

COPY --from=builder /app/package*.json ./
RUN npm ci --omit=dev --ignore-scripts

# Derlenen JS + Prisma client
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=builder /app/prisma ./prisma

USER backend
ENV NODE_ENV=production
EXPOSE 3000

# Migration sonrası server başlat
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/server.js"]
