import { PrismaClient } from '@prisma/client';
import { AsyncLocalStorage } from 'node:async_hooks';

// ─── Request-Scoped Tenant Context ───────────────────────────────────────────
// Her HTTP isteği boyunca aktif tenantId'yi taşır.
// requireTenant middleware'i tarafından doldurulur; Prisma extension okur.
export const tenantStorage = new AsyncLocalStorage<string>();

/**
 * Verilen tenantId'yi tüm async zincirine yayarak fn'i çalıştırır.
 * Express middleware'inde `next()` bu wrapper içinde çağrılmalıdır.
 */
export function runWithTenant<T>(tenantId: string, fn: () => T): T {
  return tenantStorage.run(tenantId, fn);
}

// ─── Tenant-Scoped Model Listesi ─────────────────────────────────────────────
// Bu modeller tenantId sütunu taşır; okuma sorgularına otomatik filtre enjekte edilir.
const TENANT_SCOPED = new Set([
  'User',
  'VisibilityOptIn',
  'MatchRequest',
  'FeedbackLog',
  'MatchCombinationScore',
  'Meeting',
  'Feedback',
  'JobListing',
  'Club',
  'ClubMembership',
  'PendingTag',
  'TenantMembership',
  'Match',
  'AvailabilityBlock',
  // NOT: Conversation/Message KASITLI olarak burada YOK. Chat, güvenlik sınırını
  // tenant'a değil KATILIMCIYA dayar: shared-pool'da menti ile mentör farklı
  // tenant'ta olabilir; tenantId RLS filtresi karşı tarafı eler (konuşmayı göremez).
  // Yetki controller'da participant (mentorUserId/mentiUserId) + admin(aynı tenant)
  // ile açıkça zorlanır. tenantId yalnızca kayıt/analitik amaçlı tutulur.
]);

// findUnique kasıtlı olarak dışarıda bırakıldı:
// findUnique yalnızca PK/unique alanlar üzerinden çalışır; tenantId enjeksiyonu
// imza uyumsuzluğuna yol açar. Güvenlik katmanı findMany/findFirst üzerinde sağlanır.
const READ_OPS = new Set(['findMany', 'findFirst', 'count', 'aggregate', 'groupBy']);

// ─── Prisma Client + RLS Extension ───────────────────────────────────────────
// Global omit (kalıcı savunma / madde 38): `password` hiçbir sorguda DEFAULT olarak
// dönmez. `select`siz `create`/`update`/`findX` yapan bir uç yanlışlıkla parola
// hash'ini response'a taşıyamaz. İhtiyaç duyan tek akış (login/reset doğrulaması)
// explicit `select: { password: true }` yazar — Prisma'da `select`, `omit`'i override
// eder, dolayısıyla o akışlar etkilenmez (bkz. authController.ts login/reset).
const base = new PrismaClient({ omit: { user: { password: true } } });

export const prisma = base.$extends({
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        const tenantId = tenantStorage.getStore();

        if (tenantId && model && TENANT_SCOPED.has(model) && READ_OPS.has(operation)) {
          // Mevcut where koşuluna tenantId'yi başa ekle
          // Geliştirici zaten eklemişse Prisma son değeri kullanır (güvenli tekrar)
          const a = args as { where?: Record<string, unknown> };
          a.where = { tenantId, ...a.where };
        }

        return query(args);
      },
    },
  },
});

export type PrismaExtended = typeof prisma;
