import { prisma } from '../db.js';
import { isTenantSuspended } from '../middleware/tenantSuspension.js';

const CROSS_TENANT_SELECT = { isSharedPoolActive: true, isActive: true, verificationStatus: true } as const;

// Kural (Rule 1):
// Cross-tenant erişim sadece iki tenant da shared pool açıksa mümkün.
// Y1-B9c: askıdaki kurum (isTenantSuspended — kural tek yerde) paylaşımlı havuzdan düşer; kimliği
// bilinen askıdaki kurum kullanıcısına başka kurumdan konuşma/talep/görünürlük isteği açılamaz.
// Çağıranlar resolveCrossTenantTarget üzerinden "hedef bulunamadı" ile AYNI yanıtı döner → askı
// bilgisi sızmaz (AJ-103).
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

// AJ-103: kurumlar arası HEDEF kapısı — hedef kişi (RLS-muaf findUnique ile) okunduktan HEMEN
// sonra, rol/aktiflik kontrollerinden ÖNCE çağrılır. Hedef yoksa YA DA paylaşım kapalı başka
// kurumdaysa null döner; çağıran ikisinde de ucun mevcut "hedef bulunamadı" yanıtını verir.
// Neden: önceden rol/aktiflik paylaşım kapısından önce bakılıyordu → paylaşımı kapalı kurumdaki
// bir kimlik için yanıt kodu farkı (yok/pasif/yanlış rol ↔ var-aktif-doğru rol) o kişinin
// durumunu ele veriyordu. Aynı kurum ve açık havuz davranışı değişmez.
export async function resolveCrossTenantTarget<T extends { tenantId: string }>(
  target: T | null,
  requesterTenantId: string,
): Promise<T | null> {
  if (!target) return null;
  const allowed = await canCrossTenantMatch({ requesterTenantId, targetTenantId: target.tenantId });
  return allowed ? target : null;
}
