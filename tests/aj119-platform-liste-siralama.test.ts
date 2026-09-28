/**
 * AJ-119 — platform kurum detayındaki sayfalı üye ve toplantı listeleri eşit zaman damgasında
 * kararlı sıralanır.
 *
 *   GET /api/platform/tenants/:id/members   → orderBy [createdAt asc, id asc]
 *   GET /api/platform/tenants/:id/meetings  → orderBy [startsAt desc, id desc]
 *
 * Neden: sıralama yalnız zaman damgası üzerindeydi; aynı createdAt/startsAt'e sahip kayıtlarda
 * satır sırası belirsizdi → offset sayfalamasında (skip/take) sayfa sınırında bir kayıt iki kez
 * gelir, bir diğeri hiç gelmez. İkincil anahtar `id` (birincil yönle aynı) sırayı tekil kılar.
 * Desen: AJ-107 (konuşma listesi, tests/aj107-conversation-list-order.test.ts).
 *
 * Test: bir sayfadan fazla (PAGE_SIZE + 1) eşit damgalı kayıt; kimlikler beklenen sıranın TERSİ
 * yönde eklenir (fiziksel sıra beklenenle örtüşmesin). İki sayfa art arda gezilir: birleşik liste
 * beklenen tam sıraya eşit olmalı — tekrar yok, kayıp yok.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { agent, type TestAgent } from './helpers/request.js';
import { cleanDb, testPrisma } from './helpers/db.js';
import { createTenant, createMentor, createMenti } from './helpers/factories.js';
import { signToken, PLATFORM_AUDIENCE } from '../src/middleware/jwtAuth.js';
import { PAGE_SIZE as PLATFORM_PAGE_SIZE } from '../src/controllers/platformTenantController.js';

// Platform oturumu: aj102-gizlilik-negatif.test.ts / security.test.ts ile aynı desen.
function platformCookie(): string {
  const token = signToken(
    { sub: 'platform-admin', tenantId: '__platform__', role: 'ADMIN', fullName: 'Platform Yöneticisi', isPlatformAdmin: true },
    { audience: PLATFORM_AUDIENCE },
  );
  return `platform_token=${encodeURIComponent(token)}`;
}

const RECORD_COUNT = PLATFORM_PAGE_SIZE + 1; // bir sayfadan fazlası → sayfa sınırı oluşur
const SAME_INSTANT = new Date('2026-09-01T10:00:00.000Z');
const pad = (i: number): string => String(i).padStart(3, '0');

async function fetchTwoPages<T>(
  http: TestAgent,
  url: string,
  listKey: string,
  pick: (row: T) => string,
): Promise<{ ids: string[]; total: number }> {
  const ids: string[] = [];
  let total = 0;
  for (const page of [1, 2]) {
    const res = await http.get(`${url}?page=${page}`).set('Cookie', platformCookie()).expect(200);
    total = res.body.total as number;
    ids.push(...(res.body[listKey] as T[]).map(pick));
  }
  return { ids, total };
}

describe('AJ-119 · platform üye listesi — eşit createdAt kararlı sayfalama', () => {
  let http: TestAgent;
  let tenantId: string;
  let expectedUserIds: string[];

  beforeEach(async () => {
    await cleanDb();
    http = agent();
    const tenant = await createTenant();
    tenantId = tenant.id;

    const indices = Array.from({ length: RECORD_COUNT }, (_, i) => i);
    await testPrisma.user.createMany({
      data: indices.map((i) => ({
        id: `aj119-user-${pad(i)}`,
        tenantId,
        email: `aj119-user-${pad(i)}@test.local`,
        fullName: `AJ119 Üye ${pad(i)}`,
        role: 'MENTI' as const,
        approvalStatus: 'APPROVED' as const,
        authProvider: 'LOCAL' as const,
        isActive: true,
      })),
    });
    // Üyelik kimlikleri ekleme sırasıyla AZALAN; beklenen sıra (id asc) ekleme sırasının tersi.
    for (const i of [...indices].reverse()) {
      await testPrisma.tenantMembership.create({
        data: {
          id: `aj119-mem-${pad(i)}`,
          userId: `aj119-user-${pad(i)}`,
          tenantId,
          role: 'MENTI',
          isActive: true,
          createdAt: SAME_INSTANT,
        },
      });
    }
    expectedUserIds = indices.map((i) => `aj119-user-${pad(i)}`);
  });

  it('iki sayfa art arda: tekrar yok, kayıp yok, sıra üyelik id artan', async () => {
    const { ids, total } = await fetchTwoPages<{ id: string }>(
      http,
      `/api/platform/tenants/${tenantId}/members`,
      'members',
      (m) => m.id,
    );
    expect(total).toBe(RECORD_COUNT);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(expectedUserIds);
  });
});

describe('AJ-119 · platform toplantı listesi — eşit startsAt kararlı sayfalama', () => {
  let http: TestAgent;
  let tenantId: string;
  let expectedMeetingIds: string[];

  beforeEach(async () => {
    await cleanDb();
    http = agent();
    const tenant = await createTenant();
    tenantId = tenant.id;
    const mentor = await createMentor(tenantId);
    const menti = await createMenti(tenantId);

    const indices = Array.from({ length: RECORD_COUNT }, (_, i) => i);
    // Kimlikler ekleme sırasıyla ARTAN; beklenen sıra (id desc) ekleme sırasının tersi.
    for (const i of indices) {
      await testPrisma.meeting.create({
        data: {
          id: `aj119-meet-${pad(i)}`,
          tenantId,
          mentorUserId: mentor.id,
          mentiUserId: menti.id,
          startsAt: SAME_INSTANT,
          endsAt: new Date(SAME_INSTANT.getTime() + 60 * 60 * 1000),
        },
      });
    }
    expectedMeetingIds = indices.map((i) => `aj119-meet-${pad(i)}`).reverse();
  });

  it('iki sayfa art arda: tekrar yok, kayıp yok, sıra toplantı id azalan', async () => {
    const { ids, total } = await fetchTwoPages<{ id: string }>(
      http,
      `/api/platform/tenants/${tenantId}/meetings`,
      'meetings',
      (m) => m.id,
    );
    expect(total).toBe(RECORD_COUNT);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(expectedMeetingIds);
  });
});
