/**
 * Y1-B9c · Askıdaki kurum kullanıcısına başka kurumdan istek açılamaz — DB'siz birim.
 * canCrossTenantMatch; conversationController.startConversation, requestController (USER hedef)
 * ve matchingController görünürlük uçlarının ortak kapısıdır → hepsi SHARED_POOL_KAPALI (jenerik) döner.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

type TenantRow = { isSharedPoolActive: boolean; isActive: boolean; verificationStatus: string };
const tenants = new Map<string, TenantRow>();
type FindArgs = { where: { id: string }; select?: Record<string, boolean> };
const tenantFindUnique = vi.fn(async (args: FindArgs) => tenants.get(args.where.id) ?? null);

vi.mock('../src/db.js', () => ({
  prisma: { tenant: { findUnique: (a: FindArgs) => tenantFindUnique(a) } },
}));

const { canCrossTenantMatch } = await import('../src/services/tenantSharing.js');

const active = (over: Partial<TenantRow> = {}): TenantRow => ({
  isSharedPoolActive: true,
  isActive: true,
  verificationStatus: 'APPROVED',
  ...over,
});

describe('Y1-B9c: canCrossTenantMatch askı kuralı', () => {
  beforeEach(() => {
    tenants.clear();
    tenantFindUnique.mockClear();
  });

  it('iki aktif, havuzu açık kurum → izin verilir (aktif kurum etkilenmez)', async () => {
    tenants.set('A', active());
    tenants.set('B', active({ verificationStatus: 'AUTO_APPROVED' }));
    await expect(canCrossTenantMatch({ requesterTenantId: 'A', targetTenantId: 'B' })).resolves.toBe(true);
  });

  it('hedef kurum dondurulmuş (isActive=false) → reddedilir', async () => {
    tenants.set('A', active());
    tenants.set('B', active({ isActive: false }));
    await expect(canCrossTenantMatch({ requesterTenantId: 'A', targetTenantId: 'B' })).resolves.toBe(false);
  });

  it('hedef kurum reddedilmiş (REJECTED) → reddedilir', async () => {
    tenants.set('A', active());
    tenants.set('B', active({ verificationStatus: 'REJECTED' }));
    await expect(canCrossTenantMatch({ requesterTenantId: 'A', targetTenantId: 'B' })).resolves.toBe(false);
  });

  it('talep eden kurum askıda → reddedilir (iki yön)', async () => {
    tenants.set('A', active({ isActive: false }));
    tenants.set('B', active());
    await expect(canCrossTenantMatch({ requesterTenantId: 'A', targetTenantId: 'B' })).resolves.toBe(false);
  });

  it('havuz kapalıysa eskisi gibi reddedilir; hedef kurum yoksa reddedilir', async () => {
    tenants.set('A', active());
    tenants.set('B', active({ isSharedPoolActive: false }));
    await expect(canCrossTenantMatch({ requesterTenantId: 'A', targetTenantId: 'B' })).resolves.toBe(false);
    await expect(canCrossTenantMatch({ requesterTenantId: 'A', targetTenantId: 'YOK' })).resolves.toBe(false);
  });

  it('aynı kurum içi davranış değişmez: DB okunmadan true', async () => {
    tenants.set('A', active({ isActive: false }));
    await expect(canCrossTenantMatch({ requesterTenantId: 'A', targetTenantId: 'A' })).resolves.toBe(true);
    expect(tenantFindUnique).not.toHaveBeenCalled();
  });

  it('N+1 yok: çapraz kontrol tek seferde en fazla 2 kurum sorgusu, askı alanları aynı sorguda', async () => {
    tenants.set('A', active());
    tenants.set('B', active());
    await canCrossTenantMatch({ requesterTenantId: 'A', targetTenantId: 'B' });
    expect(tenantFindUnique).toHaveBeenCalledTimes(2);
    for (const [arg] of tenantFindUnique.mock.calls) {
      expect(arg.select).toMatchObject({
        isSharedPoolActive: true,
        isActive: true,
        verificationStatus: true,
      });
    }
  });
});
