/**
 * Y-04 — sayfalamasız liste uçları artık limit/offset alır; `total` sahiplik/tenant
 * filtresiyle aynı koşuldan sayılır (başkasının kaydı sayıya da girmez).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { cleanDb, testPrisma } from './helpers/db.js';
import { createTenant, createUser } from './helpers/factories.js';
import { agent, loginAs, tenantHeaders, type TestAgent } from './helpers/request.js';

describe('Y-04: GET /api/requests sayfalama', () => {
  let http: TestAgent;
  let tenantId: string;
  let token: string;

  beforeEach(async () => {
    await cleanDb();
    http = agent();
    tenantId = (await createTenant()).id;
    const me = await createUser({ tenantId, role: 'MENTI' });
    const other = await createUser({ tenantId, role: 'MENTI' });
    const mentor = await createUser({ tenantId, role: 'MENTOR' });
    for (let i = 0; i < 5; i++) {
      await testPrisma.matchRequest.create({
        data: { tenantId, requesterUserId: me.id, targetType: 'USER', targetId: mentor.id },
      });
    }
    await testPrisma.matchRequest.create({
      data: { tenantId, requesterUserId: other.id, targetType: 'USER', targetId: mentor.id },
    });
    ({ accessToken: token } = await loginAs(http, me.email, me.rawPassword));
  });

  it('sayfalar çakışmaz; total yalnız kendi talepleri', async () => {
    const p1 = await http.get('/api/requests?limit=2').set(tenantHeaders(tenantId, token)).expect(200);
    const p2 = await http.get('/api/requests?limit=2&offset=2').set(tenantHeaders(tenantId, token)).expect(200);
    const p3 = await http.get('/api/requests?limit=2&offset=4').set(tenantHeaders(tenantId, token)).expect(200);
    expect(p1.body.total).toBe(5);
    expect([p1.body.items.length, p2.body.items.length, p3.body.items.length]).toEqual([2, 2, 1]);
    const ids = [...p1.body.items, ...p2.body.items, ...p3.body.items].map((r: { id: string }) => r.id);
    expect(new Set(ids).size).toBe(5);
  });

  it('negatif: üst sınır kırpılır; sınırsız liste istenemez', async () => {
    const res = await http.get('/api/requests?limit=100000').set(tenantHeaders(tenantId, token)).expect(200);
    expect(res.body.limit).toBe(100);
    expect(res.body.items).toHaveLength(5);
  });
});

describe('Y-04: GET /api/users/:userId/clubs sayfalama', () => {
  it('kullanıcının kulüpleri sayfalı döner; total doğru', async () => {
    await cleanDb();
    const http = agent();
    const tenantId = (await createTenant()).id;
    const me = await createUser({ tenantId, role: 'MENTI' });
    for (let i = 0; i < 3; i++) {
      const club = await testPrisma.club.create({
        data: { tenantId, name: `Kulüp ${i}`, slug: `kulup-${i}`, type: 'SOSYAL' },
      });
      await testPrisma.clubMembership.create({ data: { tenantId, clubId: club.id, userId: me.id } });
    }
    const { accessToken } = await loginAs(http, me.email, me.rawPassword);
    const res = await http.get(`/api/users/${me.id}/clubs?limit=2`).set(tenantHeaders(tenantId, accessToken)).expect(200);
    expect(res.body.total).toBe(3);
    expect(res.body.items).toHaveLength(2);
    expect(res.body.limit).toBe(2);
  });
});
