/**
 * 3b-2 / Y1 — GET /api/requests sahiplik regresyonu.
 *
 * Açık (yetki haritası 2026-08-29): listRequests tüm tenant'ın match taleplerini (+ serbest-metin
 * requestMessage / PII) her üyeye döndürüyordu. Fix: non-admin YALNIZ taraf olduğu talepleri görür
 * (gönderen VEYA hedef mentör); ADMIN tenant genelini görür.
 *
 * İddia: menti A, menti B'nin talebini GÖRMEZ; kendi talebini görür; admin ikisini de görür.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { cleanDb, testPrisma } from './helpers/db.js';
import { createTenant, createUser } from './helpers/factories.js';
import { agent, loginAs, tenantHeaders, type TestAgent } from './helpers/request.js';

describe('Y1 — GET /api/requests IDOR', () => {
  let http: TestAgent;
  let tenantId: string;
  let mentiA: string;
  let mentiB: string;
  let mentor: string;
  let mentorEmail: string;
  let mentorPw: string;
  let tokenA: string;

  beforeEach(async () => {
    await cleanDb();
    http = agent();
    const tenant = await createTenant();
    tenantId = tenant.id;
    const a = await createUser({ tenantId, role: 'MENTI' });
    const b = await createUser({ tenantId, role: 'MENTI' });
    const m = await createUser({ tenantId, role: 'MENTOR' });
    mentiA = a.id;
    mentiB = b.id;
    mentor = m.id;
    mentorEmail = m.email;
    mentorPw = m.rawPassword;

    await testPrisma.matchRequest.create({
      data: { tenantId, requesterUserId: mentiA, targetType: 'USER', targetId: mentor, requestMessage: 'A gizli mesaj' },
    });
    await testPrisma.matchRequest.create({
      data: { tenantId, requesterUserId: mentiB, targetType: 'USER', targetId: mentor, requestMessage: 'B gizli mesaj' },
    });

    ({ accessToken: tokenA } = await loginAs(http, a.email, a.rawPassword));
  });

  it('menti A yalnız KENDİ talebini görür; B\'nin talebi/mesajı sızmaz', async () => {
    const res = await http.get('/api/requests').set(tenantHeaders(tenantId, tokenA)).expect(200);
    const items = res.body.items as Array<{ requesterUserId: string }>;
    expect(items.length).toBe(1);
    expect(items[0]!.requesterUserId).toBe(mentiA);
    expect(JSON.stringify(res.body)).not.toContain('B gizli mesaj');
  });

  it('hedef mentör kendisine gelen talepleri görür (2 talep de ona)', async () => {
    const { accessToken: mentorToken } = await loginAs(http, mentorEmail, mentorPw);
    const res = await http.get('/api/requests').set(tenantHeaders(tenantId, mentorToken)).expect(200);
    expect((res.body.items as unknown[]).length).toBe(2); // ikisi de targetId=mentor
  });

  it('ADMIN tenant genelini görür → 2', async () => {
    const admin = await createUser({ tenantId, role: 'ADMIN' });
    const { accessToken: adminToken } = await loginAs(http, admin.email, admin.rawPassword);
    const res = await http.get('/api/requests').set(tenantHeaders(tenantId, adminToken)).expect(200);
    expect((res.body.items as unknown[]).length).toBe(2);
  });
});
