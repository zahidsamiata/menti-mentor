/**
 * AJ-103 · resolveCrossTenantTarget — DB'siz birim.
 * Konuşma / eşleşme isteği / görünürlük opt-in uçlarının hedef kapısı: hedef yoksa YA DA paylaşımı
 * kapalı başka kurumdaysa null (çağıran "hedef yok" yanıtını verir). Hedefin rolü/aktifliği bu kapıda
 * KARAR VERMEZ — paylaşımı kapalı kurumdaki hedef hangi durumda olursa olsun aynı sonuç (null).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

type TenantRow = { isSharedPoolActive: boolean; isActive: boolean; verificationStatus: string };
const tenants = new Map<string, TenantRow>();
type FindArgs = { where: { id: string } };
const tenantFindUnique = vi.fn(async (args: FindArgs) => tenants.get(args.where.id) ?? null);

vi.mock('../src/db.js', () => ({
  prisma: { tenant: { findUnique: (a: FindArgs) => tenantFindUnique(a) } },
}));

const { resolveCrossTenantTarget } = await import('../src/services/tenantSharing.js');

const tenant = (isSharedPoolActive: boolean): TenantRow => ({
  isSharedPoolActive,
  isActive: true,
  verificationStatus: 'APPROVED',
});

type Target = { id: string; tenantId: string; role: string; isActive: boolean };
const target = (tenantId: string, over: Partial<Target> = {}): Target => ({
  id: `u-${tenantId}`,
  tenantId,
  role: 'MENTOR',
  isActive: true,
  ...over,
});

describe('AJ-103: resolveCrossTenantTarget', () => {
  beforeEach(() => {
    tenants.clear();
    tenantFindUnique.mockClear();
    tenants.set('OWN', tenant(true));
    tenants.set('CLOSED', tenant(false));
    tenants.set('OPEN', tenant(true));
  });

  it('hedef yok → null (kurum sorgusu yapılmaz)', async () => {
    await expect(resolveCrossTenantTarget(null, 'OWN')).resolves.toBeNull();
    expect(tenantFindUnique).not.toHaveBeenCalled();
  });

  it('paylaşımı kapalı kurumdaki hedef: aktif/pasif/farklı rol fark etmez → hepsi null', async () => {
    const variants = [
      target('CLOSED'),
      target('CLOSED', { isActive: false }),
      target('CLOSED', { role: 'MENTI' }),
      target('CLOSED', { role: 'ADMIN', isActive: false }),
    ];
    for (const v of variants) {
      await expect(resolveCrossTenantTarget(v, 'OWN')).resolves.toBeNull();
    }
  });

  it('açık havuzdaki hedef aynen döner (rol/aktiflik çağıranda denetlenir)', async () => {
    const inactive = target('OPEN', { isActive: false });
    await expect(resolveCrossTenantTarget(inactive, 'OWN')).resolves.toBe(inactive);
  });

  it('aynı kurum: paylaşım kapalı olsa bile hedef aynen döner (mevcut davranış)', async () => {
    const same = target('CLOSED', { role: 'MENTI' });
    await expect(resolveCrossTenantTarget(same, 'CLOSED')).resolves.toBe(same);
    expect(tenantFindUnique).not.toHaveBeenCalled();
  });
});
