import { prisma } from '../db.js';
import { isTenantSuspended } from '../middleware/tenantSuspension.js';

const CROSS_TENANT_SELECT = { isSharedPoolActive: true, isActive: true, verificationStatus: true } as const;

// Kural (Rule 1):
// Cross-tenant erişim sadece iki tenant da shared pool açıksa mümkün.
// Y1-B9c: askıdaki kurum (isTenantSuspended — kural tek yerde) paylaşımlı havuzdan düşer; kimliği
// bilinen askıdaki kurum kullanıcısına başka kurumdan konuşma/talep/görünürlük isteği açılamaz.
// Çağıranlar mevcut jenerik SHARED_POOL_KAPALI yanıtını döner → askı bilgisi sızmaz.
// Aynı kurum içi davranış değişmez (askıdaki kurumun kendi üyesi zaten requireTenant'ta durur).
export async function canCrossTenantMatch(args: { requesterTenantId: string; targetTenantId: string }) {
  if (args.requesterTenantId === args.targetTenantId) return true;

  const [a, b] = await Promise.all([
    prisma.tenant.findUnique({ where: { id: args.requesterTenantId }, select: CROSS_TENANT_SELECT }),
    prisma.tenant.findUnique({ where: { id: args.targetTenantId }, select: CROSS_TENANT_SELECT }),
  ]);

  if (!a || !b) return false;
  if (isTenantSuspended(a) || isTenantSuspended(b)) return false;
  return Boolean(a.isSharedPoolActive && b.isSharedPoolActive);
}
