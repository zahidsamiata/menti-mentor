# Menti-Mentor Multi-Tenant SaaS Backend

**Versiyon:** 0.1.0 — Ajansal Pipeline v1 ile güçlendirilmiştir  
**Yığın:** TypeScript · Node.js · Express 5 · Prisma · PostgreSQL  
**Mimari:** Multi-Tenant SaaS · DISC Tabanlı Eşleştirme · KVKK/GDPR Uyumlu

---

## İçindekiler

1. [Kurulum](#kurulum)
2. [Mimari](#mimari)
3. [Tenant İzolasyonu](#tenant-izolasyonu)
4. [Skorlama Algoritması](#skorlama-algoritması)
5. [API Referansı](#api-referansı)
6. [Ortam Değişkenleri](#ortam-değişkenleri)
7. [Geliştirme Komutları](#geliştirme-komutları)
8. [KVKK / GDPR Uyumu](#kvkkgdpr-uyumu)
9. [Ölçeklenebilirlik Rehberi](#ölçeklenebilirlik-rehberi)

---

## Kurulum

```bash
# 1. Bağımlılıklar
npm install

# 2. Ortam değişkenleri
cp .env.example .env
# .env içinde DATABASE_URL, JWT_SECRET, OPENAI_API_KEY doldurun

# 3. Veritabanı
npm run prisma:migrate
npm run prisma:generate

# 4. Mock veri (geliştirme / yük testi)
npm run seed

# 5. Geliştirme sunucusu
npm run dev
```

---

## Mimari

```
HTTP İstek
  ↓
Tenant Middleware (X-Tenant-Id doğrulaması + JWT)
  ↓
Rate Limiter (Tenant bazında)
  ↓
HTTP Access Logger
  ↓
Controller (Zod doğrulaması)
  ↓
Service (İş mantığı — DB çağrısı yok ise senkron)
  ↓
Prisma (PostgreSQL)
```

### Temel Modüller

| Yol | Sorumluluk |
|-----|-----------|
| `src/server.ts` | Express uygulaması + route kaydı + graceful shutdown |
| `src/config.ts` | Ortam değişkeni doğrulaması (production güvenlik kontrolleri dahil) |
| `src/db.ts` | Prisma client singleton |
| `src/middleware/tenant.ts` | X-Tenant-Id çıkarma + JWT doğrulama + cross-tenant token kontrolü |
| `src/middleware/rateLimiter.ts` | Tenant bazında istek sınırlaması |
| `src/middleware/requestLogger.ts` | HTTP erişim logu (JSON yapısal) |
| `src/services/scoring.ts` | Sektör (%60) + DISC (%40) skor hesaplama |
| `src/services/matching.ts` | `rankMentisForMentor` — fallback kademeli eşleştirme |
| `src/services/algorithmTuner.ts` | NPS tabanlı 60/40 ağırlık ayarlama |
| `src/services/iceBreaker.ts` | OpenAI 2-cümlelik mesaj + offline fallback |
| `src/services/gdprService.ts` | KVKK/GDPR: anonimleştirme, silme, dışa aktarma |
| `src/services/matchingInterface.ts` | Job Board için polimorfik eşleştirme arayüzü |
| `src/services/analyticsEngine.ts` | DISC vektör analizi (senkron, DB çağrısı yok) |
| `src/services/tenantSharing.ts` | Cross-tenant havuz kontrolü |

---

## Tenant İzolasyonu

### Temel Kurallar

1. **Tüm istekler** `X-Tenant-Id` header'ı taşımalıdır (JWT içindeki `tenantId` ile eşleşmeli).
2. **Cross-tenant veri erişimi** yalnızca her iki tenant da `isSharedPoolActive = true` ise mümkündür.
3. **Cross-tenant token girişimi** anında `401` döndürür ve `SystemLog`'a yazılır.
4. **Production** ortamında `DEFAULT_TENANT_ID` ve zayıf `JWT_SECRET` başlatmayı engeller.

### Kimlik Doğrulama Önceliği

```
1. Authorization: Bearer <JWT>  ← tercih edilen, imzalı
2. X-User-Id header             ← geriye dönük uyumluluk (JWT yoksa)
```

---

## Skorlama Algoritması

```
totalScore = sectorScore × 0.60 + discScore × 0.40

sectorScore = (etiket kesişimi / menti etiket sayısı) × 100   [0-100]
discScore   = DISC_COMPATIBILITY[mentorDisc][mentiDisc]        [0-100]

# Vektör tabanlı (progressive profiling mevcut ise):
discScore = confidence × vectorScore + (1-confidence) × matrixScore
```

### DISC Uyum Matrisi (mentor → menti)

| Mentor↓ Menti→ | D | I | S | C |
|---|---|---|---|---|
| **D** | 60 | 75 | 30 | 85 |
| **I** | 70 | 60 | 70 | 80 |
| **S** | 35 | 70 | 75 | 65 |
| **C** | 85 | 75 | 65 | 60 |

### Fallback Kademeleri

| Kademe | Açıklama |
|--------|---------|
| 0 | Tüm filtreler aktif (zaman + anti-match + sektör + DISC) |
| 1 | Zaman filtresi gevşetildi |
| 2 | Anti-match filtresi kaldırıldı |
| 3 | Yalnızca sektör uyumu (uyarı rozeti gösterilir) |

### Ağırlık Ayarlama (NPS Feedback Loop)

Sistem her ayın sonunda `algorithmTuner.ts` üzerinden tenant bazında NPS verilerini analiz eder:
- 3. ay NPS ≥ 70 → ağırlıklar korunur
- 3. ay NPS < 50 → DISC ağırlığı +5% (maksimum %60)
- 1. ay yüksek → 3. ay düşük → DISC ağırlığı +5%

---

## API Referansı

**Base URL:** `http://localhost:3000`  
**Zorunlu Header:** `X-Tenant-Id: <tenant-id>`  
**Opsiyonel Header:** `Authorization: Bearer <jwt-token>`

---

### Sağlık Kontrolü

```
GET /health
```
**Yanıt:** `{ ok: true, env: "development" }`

---

### Kimlik Doğrulama (`/api/auth`)

#### Giriş Yap
```
POST /api/auth/login
Content-Type: application/json

{ "slug": "tech-hub", "userId": "clxxx..." }
```
**Yanıt:**
```json
{
  "accessToken": "eyJ...",
  "expiresIn": "24h",
  "user": { "id": "...", "role": "MENTOR", "fullName": "..." },
  "tenant": { "name": "TechHub", "slug": "tech-hub", "primaryColor": "#6366f1" }
}
```

#### Oturumu Görüntüle
```
GET /api/auth/me
Authorization: Bearer <token>
X-Tenant-Id: <tenant-id>
```

---

### Kullanıcılar (`/api/users`)

#### Kullanıcıları Listele
```
GET /api/users?role=MENTOR&isActive=true
X-Tenant-Id: <tenant-id>
```

#### Kullanıcı Oluştur
```
POST /api/users
X-Tenant-Id: <tenant-id>

{
  "role": "MENTI",
  "email": "ali@example.com",
  "fullName": "Ali Veli",
  "sectorTags": ["teknoloji", "finans"],
  "discType": "C",
  "timeCommitment": "HAFTADA_1",
  "interactionStyle": "GOREV_BAZLI",
  "expectationCategories": ["KARIYER_YONLENDIRME"]
}
```

#### Kullanıcı Güncelle
```
PATCH /api/users/:id
X-Tenant-Id: <tenant-id>

{ "sectorTags": ["teknoloji"], "discType": "D" }
```

#### Self Profile Güncelle (serbest form)
```
PATCH /api/users/:id/self-profile
X-Tenant-Id: <tenant-id>

{ "certifications": ["AWS Solutions Architect"], "languages": ["Türkçe", "İngilizce"] }
```

---

### Eşleştirme (`/api/mentors`)

#### Mentor için Sıralı Menti Listesi
```
GET /api/mentors/:mentorId/ranked-mentis?limit=20
X-Tenant-Id: <tenant-id>
Authorization: Bearer <token>
```
**Yanıt:**
```json
{
  "items": [
    {
      "mentiId": "...",
      "mentiName": "...",
      "totalScore": 87.5,
      "sectorScore": 100,
      "discScore": 70,
      "confidence": 0.85,
      "fallbackLevel": 0,
      "warnings": []
    }
  ],
  "fallbackLevel": 0
}
```

#### Visibility Opt-In / Ice-Breaker Üret
```
POST /api/mentors/:mentorId/opt-in
X-Tenant-Id: <tenant-id>
Authorization: Bearer <token>

{ "mentiId": "clxxx...", "status": "APPROVED" }
```
**Yanıt:** `VisibilityOptIn` kaydı + `iceBreaker` mesajı (LLM veya fallback)

**Kurallar:**
- Mentor kendi kendini opt-in edemez (400)
- Hedef kullanıcı MENTI rolünde olmalı (400)
- Cross-tenant: her iki tenant `isSharedPoolActive=true` olmalı (403)

---

### Tenant Yönetimi (`/api/tenants`)

#### Tenant Oluştur
```
POST /api/tenants
Content-Type: application/json

{
  "name": "Tech Community",
  "slug": "tech-community",
  "isSharedPoolActive": false,
  "displayName": "Tech Topluluk Platformu",
  "primaryColor": "#6366f1"
}
```

#### Tenant Güncelle
```
PATCH /api/tenants/:id
{ "isSharedPoolActive": true }
```

---

### Toplantılar (`/api/meetings`)

```
POST /api/meetings          — Toplantı oluştur
GET  /api/meetings          — Toplantıları listele
PATCH /api/meetings/:id/status  — Durum güncelle (APPROVED/COMPLETED/CANCELLED)
```

---

### Geri Bildirim Logları (`/api/feedback-logs`)

```
POST /api/feedback-logs     — NPS/yıldız puanı gönder
GET  /api/feedback-logs     — Tenant bazında listele
```

**Body:**
```json
{
  "mentorId": "...",
  "mentiId": "...",
  "phase": 1,
  "starRating": 5,
  "npsScore": 85,
  "goalAchieved": "Evet"
}
```

---

### Analitik (`/api/analytics`)

```
GET /api/analytics/disc-distribution   — Tenant DISC dağılımı
GET /api/analytics/nps-trend           — NPS zaman serisi
GET /api/analytics/matching-stats      — Eşleşme istatistikleri
```

---

### KVKK / GDPR Endpointleri (`/api/users`)

```
POST   /api/users/:id/anonymize    — PII anonimleştirme (Admin)
DELETE /api/users/:id/hard-delete  — Kalıcı silme (Admin, GDPR Md.17)
GET    /api/users/:id/export       — Veri dışa aktarma (Kullanıcı veya Admin)
```

---

### İş İlanları (`/api/job-listings`)

```
GET  /api/job-listings           — Aktif ilanlar (tenant bazında)
POST /api/job-listings           — İlan oluştur
PATCH /api/job-listings/:id      — İlan güncelle
```

---

### Kulüpler (`/api/clubs`)

```
GET  /api/clubs                  — Tenant kulüplerini listele
POST /api/clubs                  — Kulüp oluştur
POST /api/clubs/:id/members      — Üye ekle
```

---

### Sorular ve Yanıtlar (`/api/questions`)

```
GET  /api/questions              — Aktif soruları listele (CORE/DEEPENING)
POST /api/questions/:id/respond  — Kullanıcı yanıtı kaydet → discVector güncellenir
```

---

### Platform Yönetimi (`/api/platform`) — Tenant Dışı

```
GET  /api/platform/tenants       — Tüm tenantları gör (Platform Admin Key gerekli)
POST /api/platform/tenants       — Yeni tenant oluştur
```

**Header:** `X-Platform-Admin-Key: <platform-admin-key>`

---

## Ortam Değişkenleri

| Değişken | Zorunlu | Açıklama |
|----------|---------|---------|
| `DATABASE_URL` | ✅ | PostgreSQL bağlantı URL'i |
| `JWT_SECRET` | ✅ (prod) | Min 32 karakter, production'da zorunlu |
| `OPENAI_API_KEY` | ⬜ | Ice-breaker için; yoksa fallback çalışır |
| `OPENAI_MODEL` | ⬜ | Varsayılan: `gpt-4.1-mini` |
| `PORT` | ⬜ | Varsayılan: `3000` |
| `NODE_ENV` | ⬜ | `development` / `production` |
| `DEFAULT_TENANT_ID` | ⬜ (sadece dev) | Production'da yasak |
| `PLATFORM_ADMIN_KEY` | ✅ (prod) | Platform yönetici API anahtarı |
| `JWT_EXPIRES_IN` | ⬜ | Varsayılan: `24h` |
| `ALLOWED_ORIGINS` | ⬜ | CORS kaynak listesi (virgülle ayrılmış) |
| `RATE_LIMIT_RPM` | ⬜ | Dakikada maksimum istek (varsayılan: 100) |

---

## Geliştirme Komutları

```bash
npm run dev              # Geliştirme sunucusu (tsx watch)
npm run build            # TypeScript derle → dist/
npm start                # Production build çalıştır
npm run lint             # ESLint
npm run format           # Prettier
npm run prisma:generate  # Prisma client yenile
npm run prisma:migrate   # Migration uygula
npm run prisma:studio    # Prisma Studio GUI
npm run seed             # Mock veri oluştur (3 tenant, 220 kullanıcı)
npm run test:scoring     # Scoring algoritması matematiksel doğrulama
```

---

## KVKK / GDPR Uyumu

### PII Kategorileri

| Alan | Tür | İşlem |
|------|-----|-------|
| `fullName`, `email` | Zorunlu PII | Anonimleştirme veya silme |
| `discType`, `discVector` | Hassas kategori (kişilik) | Anonimleştirme veya silme |
| `bioSummary`, `selfProfile` | Serbest PII | Anonimleştirme veya silme |
| `sectorTags`, `skills` | Analitik | **Korunur** (kişi tanımlamaz) |
| `FeedbackLog.npsScore` | Analitik | **Korunur** (anonim) |

### Haklar

| Hak | Endpoint | Süre |
|-----|---------|------|
| Silinme Hakkı (GDPR Md.17) | `DELETE /api/users/:id/hard-delete` | Anında |
| Anonimleştirme (KVKK) | `POST /api/users/:id/anonymize` | Anında |
| Veri Taşınabilirliği (GDPR Md.20) | `GET /api/users/:id/export` | JSON çıktı |
| Otomatik Temizlik | `purgeExpiredData()` cron | SystemLog: 90 gün |

---

## Ölçeklenebilirlik Rehberi

### Veritabanı

- Kritik index'ler schema'da tanımlıdır: `[tenantId, role, isActive]`, `[tenantId, discType]`, vb.
- Büyük tenant'larda `User` tablosu için PostgreSQL tablo bölümleme (partitioning) önerilir.
- `discVector` (JSON) için PostgreSQL GIN index'i: `CREATE INDEX ON "User" USING GIN ("discVector");`

### Önbellekleme

- Tenant kaydı: L1 in-memory (TTL 5 dk) → `tenantCache.ts`
- Eşleşme sonuçları: Redis ile TTL 10 dk (yüksek hacimde önerilir)

### Rate Limiting

- Tenant bazında: `RATE_LIMIT_RPM` env değişkeni (varsayılan 100 istek/dakika)
- Ice-breaker endpointi: 5 istek/dakika (LLM maliyet koruması)

### Job Board Genişletmesi

`MatchTargetType=JOB_LISTING` altyapısı hazır:
1. `src/services/jobMatchingStrategy.ts` oluştur
2. `MatchStrategy` arayüzünü implement et
3. Mevcut `MatchRequest` tablosu değişmez
Detay: `src/services/matchingInterface.ts`
