# Menti-Mentor Multi-Tenant SaaS Backend

Bu klasör; tek tenant yapıdan **Multi-Tenant SaaS** mimarisine geçiş, **mentor kontrollü görünürlük (visibility opt-in)**, **LLM token optimizasyonu** ve ileride eklenecek **Recruitment/Job Board** altyapısı için hazırlanmış backend iskeletidir.

## Kurulum

1. `.env.example` dosyasını `.env` olarak kopyalayın ve `DATABASE_URL` ayarlayın.
2. Bağımlılıkları kurun:

```bash
npm install
```

3. Prisma generate + migrate:

```bash
npm run prisma:generate
npm run prisma:migrate
```

4. Geliştirme sunucusu:

```bash
npm run dev
```

## Tenant izolasyonu

- Tüm tenant bazlı endpoint'ler `X-Tenant-Id` header'ı bekler.
- Varsayılan olarak **tenant dışına veri sızması yoktur**.
- Çapraz tenant eşleşme yalnızca:
  - Menti’nin tenant’ı **ve**
  - Mentor’un tenant’ı
  - `isSharedPoolActive = true` ise mümkündür.

## Token optimizasyonu (kritik)

- Skorlama (60% etiket + 40% DISC) tamamen backend matematiği ile yapılır.
- LLM çağrısı sadece **mentor visibility opt-in** sonrası, **2 cümlelik ice-breaker** üretmek için yapılır.

