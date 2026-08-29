/**
 * 3b-2 / Y2 — GET /api/meetings katılımcı regresyonu.
 *
 * Açık (yetki haritası 2026-08-29): listMeetings tüm tenant'ın görüşmelerini (isim, sectorTags,
 * beklenti, eşleşme skoru) her üyeye döndürüyordu. Fix: non-admin YALNIZ taraf olduğu görüşmeleri
 * görür; ADMIN tenant genelini görür.
 *
 * İddia: menti A, menti B'nin görüşmesini GÖRMEZ; kendi görüşmesini görür; admin ikisini de görür.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { cleanDb, testPrisma } from './helpers/db.js';
import { createTenant, createUser } from './helpers/factories.js';
import { agent, loginAs, tenantHeaders, type TestAgent } from './helpers/request.js';

describe('Y2 — GET /api/meetings IDOR', () => {
  let http: TestAgent;
  let tenantId: string;
  let mentiA: string;
  let mentiB: string;
  let tokenA: string;

  beforeEach(async () => {
    await cleanDb();
    http = agent();
    const tenant = await createTenant();
    tenantId = tenant.id;
    const mentor = await createUser({ tenantId, role: 'MENTOR' });
    const a = await createUser({ tenantId, role: 'MENTI' });
    const b = await createUser({ tenantId, role: 'MENTI' });
    mentiA = a.id;
    mentiB = b.id;

    const now = Date.now();
    await testPrisma.meeting.create({
      data: { tenantId, mentorUserId: mentor.id, mentiUserId: mentiA, startsAt: new Date(now), endsAt: new Date(now + 3600_000) },
    });
    await testPrisma.meeting.create({
      data: { tenantId, mentorUserId: mentor.id, mentiUserId: mentiB, startsAt: new Date(now), endsAt: new Date(now + 3600_000) },
    });

    ({ accessToken: tokenA } = await loginAs(http, a.email, a.rawPassword));
  });

  it('menti A yalnız KENDİ görüşmesini görür; B\'ninki sızmaz', async () => {
    const res = await http.get('/api/meetings').set(tenantHeaders(tenantId, tokenA)).expect(200);
    const items = res.body.items as Array<{ mentiUserId: string }>;
    expect(items.length).toBe(1);
    expect(items[0]!.mentiUserId).toBe(mentiA);
    expect(items.every((m) => m.mentiUserId !== mentiB)).toBe(true);
  });

  it('ADMIN tenant genelini görür → 2', async () => {
    const admin = await createUser({ tenantId, role: 'ADMIN' });
    const { accessToken: adminToken } = await loginAs(http, admin.email, admin.rawPassword);
    const res = await http.get('/api/meetings').set(tenantHeaders(tenantId, adminToken)).expect(200);
    expect((res.body.items as unknown[]).length).toBe(2);
  });
});
