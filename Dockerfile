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
# KR-16: `prisma --version` motorları (schema engine + query engine) bu aşamada,
# imajın kendi platformu (alpine/musl) için node_modules/@prisma/engines'e indirir.
# deps aşaması --ignore-scripts ile kurduğu için @prisma/engines postinstall'ı çalışmaz;
# CLI eksik motoru ilk çağrıda indirir. Burada indirilmezse build DÜŞER (açılışta değil).
RUN ./node_modules/.bin/prisma generate && \
    ./node_modules/.bin/prisma --version && \
    npm run build

# ─── Stage 3: Production runtime ─────────────────────────────────────────────
# Yalnızca production bağımlılıkları + derlenen çıktı
FROM node:22-alpine AS runner
WORKDIR /app

# Güvenlik: root olmayan kullanıcı
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 backend

COPY --from=builder /app/package*.json ./
RUN npm ci --omit=dev --ignore-scripts

# Derlenen JS + Prisma client + Prisma motorları (@prisma/engines builder'da indirildi)
# KR-16: `prisma` CLI artık dependencies'te → yukarıdaki npm ci onu lockfile'daki kesin
# sürümle kurar; açılışta `npx` ile internetten (sürümsüz) indirme YOK.
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=builder /app/prisma ./prisma

# V-16: /health'in commit alanı için — build sırasında geçilmezse 'unknown' kalır
# (sabit ama yanlış bir sürüm göstermekten iyidir). Dokploy tarafı: 03-PO-ELLE-ISLER.md.
ARG GIT_SHA=unknown
ENV GIT_SHA=${GIT_SHA}

USER backend
ENV NODE_ENV=production
# KR-16: Prisma CLI'nin güncelleme/telemetri kontrolü (ağ çağrısı) kapalı — açılış ağa bağlı olmasın.
ENV CHECKPOINT_DISABLE=1
EXPOSE 3000

# Migration sonrası server başlat (KR-16: npx değil, imajdaki yerel ikili)
CMD ["sh", "-c", "./node_modules/.bin/prisma migrate deploy && node dist/server.js"]
