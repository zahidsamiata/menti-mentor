// KR-19b: "eylem anı" idari blok kontrolü — birden çok tenant'ın blockedPairs'ı TEK sorguda.
//
// Neden ayrı dosya: blockList.ts saf (DB'siz) yardımcıdır ve birim testleri onu DB bağlantısı
// olmadan import eder; prisma importu oraya taşınmaz. Burada yalnız "hangi tenant'lar okunacak"
// + tek findMany + mevcut isPairBlocked yer alır — yeni bir blok mantığı değil.
//
// Cross-tenant (shared pool) senaryosunda blok hangi tarafın admin'i koyduysa o tenant'ta
// durabilir; bu yüzden çağıran, iki tarafın ilgili tenant'larını birlikte verir
// (bkz. conversationController.startConversation KR-19 notu).
import { prisma } from '../db.js';
import { isPairBlocked } from './blockList.js';

export async function isPairBlockedInTenants(
  tenantIds: ReadonlyArray<string | null | undefined>,
  userIdA: string,
  userIdB: string,
): Promise<boolean> {
  const ids = Array.from(new Set(tenantIds.filter((id): id is string => typeof id === 'string' && id.length > 0)));
  if (ids.length === 0) return false;
  const tenants = await prisma.tenant.findMany({
    where: { id: { in: ids } },
    select: { blockedPairs: true },
  });
  return tenants.some((t) => isPairBlocked(t.blockedPairs, userIdA, userIdB));
}
