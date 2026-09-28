/**
 * AJ-89 — mentilerin S1 ihtiyaç cevaplarının yönetici için TOPLU dağılımı (DB'siz).
 *
 * §10.3 (PO kararı): kurum yöneticisi yalnız toplu görür, kişiye inmez. Ölçülenler:
 * 1. k-anonimlik: eşik (3) altındaki seçenek hücresi gizli — sayı 0, yüzde yok.
 * 2. Payda (cevaplayan sayısı) eşik altındaysa dağılımın TAMAMI gizli — hiçbir seçenek dönmez.
 * 3. Boş S1 (EK2, meşru) paydaya girmez; aynı kişinin tekrarlı seçimi bir kez sayılır.
 * 4. Kurum sınırı sorguda: yalnız çağıran kurumun aktif MENTI üyelikleri okunur.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { MentiNeed } from '@prisma/client';

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: { tenantMembership: { findMany: vi.fn() } },
}));
vi.mock('../src/db.js', () => ({ prisma: prismaMock }));

import {
  buildMentiNeedsDistribution,
  computeMentiNeedsDistribution,
} from '../src/services/mentiNeedsDistribution.service.js';
import { K_ANONYMITY_THRESHOLD } from '../src/services/mask.js';

const repeat = (n: number, list: MentiNeed[]): MentiNeed[][] => Array.from({ length: n }, () => [...list]);

describe('buildMentiNeedsDistribution — k-anonim toplu dağılım', () => {
  it('eşik altındaki seçenek gizli (sayı 0, yüzde null); eşik ve üstü sayı + yüzde', () => {
    const answers: MentiNeed[][] = [
      ...repeat(3, ['KARAR_VEREMIYORUM']),
      ['KARAR_VEREMIYORUM', 'GUVENMIYORUM'], // GUVENMIYORUM tek kişi → gizli
    ];
    const d = buildMentiNeedsDistribution(answers);

    expect(d.suppressed).toBe(false);
    expect(d.respondentCount).toBe(4);
    expect(d.minGroupSize).toBe(K_ANONYMITY_THRESHOLD);
    const byNeed = Object.fromEntries(d.options.map((o) => [o.need, o]));
    expect(byNeed.KARAR_VEREMIYORUM).toEqual({ need: 'KARAR_VEREMIYORUM', count: 4, percent: 100, suppressed: false });
    expect(byNeed.GUVENMIYORUM).toEqual({ need: 'GUVENMIYORUM', count: 0, percent: null, suppressed: true });
    // Hiç seçilmeyen seçenek de 1-2 kişilik seçenekten ayırt edilemez (ikisi de gizli).
    expect(byNeed.KONUSACAK_BIRI).toEqual({ need: 'KONUSACAK_BIRI', count: 0, percent: null, suppressed: true });
  });

  it('negatif: cevaplayan sayısı eşik altındaysa dağılımın tamamı gizli — hiçbir seçenek dönmez', () => {
    const d = buildMentiNeedsDistribution(repeat(2, ['GUVENMIYORUM']));
    expect(d).toEqual({ respondentCount: 0, suppressed: true, minGroupSize: K_ANONYMITY_THRESHOLD, options: [] });
    expect(JSON.stringify(d)).not.toContain('GUVENMIYORUM');
  });

  it('boş S1 paydaya girmez; aynı kişinin tekrarlı seçimi bir kez sayılır', () => {
    const answers: MentiNeed[][] = [
      ...repeat(3, ['BECERIDE_TAKILDIM', 'BECERIDE_TAKILDIM']),
      [], [], [],
    ];
    const d = buildMentiNeedsDistribution(answers);
    expect(d.respondentCount).toBe(3);
    expect(d.options.find((o) => o.need === 'BECERIDE_TAKILDIM')).toMatchObject({ count: 3, percent: 100 });
  });

  it('yüzde cevaplayana göre yuvarlanır; seçenek sırası şema sırası', () => {
    const answers: MentiNeed[][] = [
      ...repeat(3, ['INSANLARI_TANIMIYORUM']),
      ...repeat(3, ['KARAR_VEREMIYORUM', 'INSANLARI_TANIMIYORUM']),
      ['KONUSACAK_BIRI'],
    ];
    const d = buildMentiNeedsDistribution(answers);
    expect(d.options.map((o) => o.need)).toEqual([
      'KARAR_VEREMIYORUM', 'BECERIDE_TAKILDIM', 'GUVENMIYORUM', 'INSANLARI_TANIMIYORUM', 'KONUSACAK_BIRI',
    ]);
    expect(d.options[0]).toMatchObject({ count: 3, percent: 43 }); // 3/7
    expect(d.options[3]).toMatchObject({ count: 6, percent: 86 }); // 6/7
  });
});

describe('computeMentiNeedsDistribution — kurum sınırı üyelikten', () => {
  beforeEach(() => prismaMock.tenantMembership.findMany.mockReset());

  it('yalnız çağıran kurumun aktif MENTI üyelikleri sorgulanır, kişi alanı yalnız mentiNeeds', async () => {
    prismaMock.tenantMembership.findMany.mockResolvedValue(
      repeat(3, ['GUVENMIYORUM']).map((mentiNeeds) => ({ user: { mentiNeeds } })),
    );
    const d = await computeMentiNeedsDistribution('tenant-a');

    const args = prismaMock.tenantMembership.findMany.mock.calls[0]![0];
    expect(args.where).toEqual({ tenantId: 'tenant-a', role: 'MENTI', isActive: true, user: { isActive: true } });
    expect(args.select).toEqual({ user: { select: { mentiNeeds: true } } });
    expect(d.options.find((o) => o.need === 'GUVENMIYORUM')).toMatchObject({ count: 3, percent: 100 });
  });
});
