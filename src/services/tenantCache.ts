/**
 * Tenant L1 In-Memory Cache
 *
 * Tenant kaydı her istekte DB'den çekilir. Yüksek trafikte bu N×DB sorgusu oluşturur.
 * Bu cache, tenant.ts middleware'inin DB sorgusunu TTL 5 dakika ile önbelleğe alır.
 *
 * Yapılandırma:
 *   TENANT_CACHE_TTL_MS = önbellekleme süresi (varsayılan 300_000 ms = 5 dk)
 *
 * Kullanım: tenant.ts middleware'inde `getCachedTenant` çağrısı.
 * Tenant güncelleme işlemlerinde `invalidateTenant` çağrılmalıdır.
 */

import { prisma } from '../db.js';

const TTL_MS = Number(process.env.TENANT_CACHE_TTL_MS ?? 300_000);

type CachedTenant = {
  id: string;
  name: string;
  slug: string;
  isSharedPoolActive: boolean;
  tenantVocabulary: unknown;
  displayName: string | null;
  logoUrl: string | null;
  primaryColor: string | null;
};

type CacheEntry = {
  tenant: CachedTenant;
  cachedAt: number;
};

const cache = new Map<string, CacheEntry>();

export async function getCachedTenant(tenantId: string): Promise<CachedTenant | null> {
  const entry = cache.get(tenantId);

  if (entry && Date.now() - entry.cachedAt < TTL_MS) {
    return entry.tenant;
  }

  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: {
      id: true, name: true, slug: true,
      isSharedPoolActive: true, tenantVocabulary: true,
      displayName: true, logoUrl: true, primaryColor: true,
    },
  });

  if (!tenant) return null;

  cache.set(tenantId, { tenant, cachedAt: Date.now() });
  return tenant;
}

export function invalidateTenant(tenantId: string): void {
  cache.delete(tenantId);
}

export function invalidateAll(): void {
  cache.clear();
}

// TTL geçmiş kayıtları temizle
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of cache) {
    if (now - entry.cachedAt > TTL_MS * 2) {
      cache.delete(key);
    }
  }
}, TTL_MS);
