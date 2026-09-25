/**
 * PS-01 · Eşit skorlu adayların sırası kararlı (entegrasyon).
 *
 * Aday sorguları ORDER BY'sızdı ve karşılaştırıcı eşitlikte ayırıcısızdı → eşit skorlu
 * adayların sırası Postgres'in döndürdüğü fiziksel sıraya bağlıydı (sayfa yenilenince
 * değişebilirdi). Artık: skor azalan, eşitlikte id artan — her çağrıda aynı.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { cleanDb, testPrisma } from './helpers/db.js';
import { createTenant, createMentor, createMenti } from './helpers/factories.js';
import { rankMentisForMentor, rankMentorsForMenti } from '../src/services/matching.js';
import type { Tenant } from '@prisma/client';

const ascending = (ids: string[]) => [...ids].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

describe('PS-01 · kararlı sıralama', () => {
  let tenant: Tenant;

  beforeEach(async () => {
    await cleanDb();
    tenant = await createTenant();
    // Kurum barajı eşit skorlu adayları düşürmesin
    await testPrisma.tenant.update({ where: { id: tenant.id }, data: { minMatchScoreThreshold: 0 } });
  });

  it('mentor → menti: eşit skorlu adaylar id artan sırada ve her çağrıda aynı sırada', async () => {
    const mentor = await createMentor(tenant.id, { discType: 'C', sectorTags: ['teknoloji'] });
    for (let i = 0; i < 6; i++) {
      await createMenti(tenant.id, { discType: 'D', sectorTags: ['teknoloji'] });
    }

    const first = await rankMentisForMentor({ mentorId: mentor.id, mentorTenantId: tenant.id });
    const scores = new Set(first.items.map((m) => m.totalScore));
    expect(first.items).toHaveLength(6);
    expect(scores.size, 'kurgu: tüm adaylar eşit skorlu olmalı').toBe(1);

    const ids = first.items.map((m) => m.mentiId);
    expect(ids).toEqual(ascending(ids));

    for (let run = 0; run < 3; run++) {
      const again = await rankMentisForMentor({ mentorId: mentor.id, mentorTenantId: tenant.id });
      expect(again.items.map((m) => m.mentiId)).toEqual(ids);
    }
  });

  it('menti → mentör: eşit skorlu mentörler id artan sırada ve her çağrıda aynı sırada', async () => {
    const menti = await createMenti(tenant.id, { discType: 'D', sectorTags: ['teknoloji'] });
    for (let i = 0; i < 6; i++) {
      await createMentor(tenant.id, { discType: 'C', sectorTags: ['teknoloji'] });
    }

    const first = await rankMentorsForMenti({ mentiId: menti.id, mentiTenantId: tenant.id });
    const scores = new Set(first.items.map((m) => m.totalScore));
    expect(first.items).toHaveLength(6);
    expect(scores.size, 'kurgu: tüm mentörler eşit skorlu olmalı').toBe(1);

    const ids = first.items.map((m) => m.mentorId);
    expect(ids).toEqual(ascending(ids));

    for (let run = 0; run < 3; run++) {
      const again = await rankMentorsForMenti({ mentiId: menti.id, mentiTenantId: tenant.id });
      expect(again.items.map((m) => m.mentorId)).toEqual(ids);
    }
  });

  it('eşitlik ayırıcısı skoru ezmez: yüksek skorlu aday id\'si büyük olsa da önde', async () => {
    const mentor = await createMentor(tenant.id, { discType: 'C', sectorTags: ['teknoloji'] });
    const tied = [];
    for (let i = 0; i < 3; i++) {
      tied.push(await createMenti(tenant.id, { discType: 'D', sectorTags: ['saglik'] }));
    }
    const best = await createMenti(tenant.id, { discType: 'D', sectorTags: ['teknoloji'] });

    const { items } = await rankMentisForMentor({ mentorId: mentor.id, mentorTenantId: tenant.id });
    expect(items[0]!.mentiId).toBe(best.id);
    const rest = items.slice(1).map((m) => m.mentiId);
    expect(rest).toEqual(ascending(tied.map((t) => t.id)));
  });
});
