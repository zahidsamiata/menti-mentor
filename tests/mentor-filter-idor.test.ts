/**
 * 3b-2 / Y3+Y4 — Mentör filtresi IDOR regresyonu.
 *
 * Açık (yetki haritası 2026-08-29): `/mentors/:mentorId/filter` GET+PUT yalnız tenant
 * kontrolü yapıyordu, SAHİPLİK değil → mentör A, mentör B'nin eşleşme filtresini
 * okuyabiliyor/DEĞİŞTİREBİLİYORdu (aynı tenant içi). Fix: route'a requireSelfOrAdmin('mentorId').
 *
 * İddia: peer mentör başkasının filtresine erişemez (403); kendi + ADMIN erişebilir.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { cleanDb } from './helpers/db.js';
import { createTenant, createUser } from './helpers/factories.js';
import { agent, loginAs, tenantHeaders, type TestAgent } from './helpers/request.js';

describe('Y4 — PUT /mentors/:mentorId/filter IDOR', () => {
  let http: TestAgent;
  let tenantId: string;
  let mentorA: string;
  let mentorB: string;
  let tokenA: string;

  beforeEach(async () => {
    await cleanDb();
    http = agent();
    const tenant = await createTenant();
    tenantId = tenant.id;
    const a = await createUser({ tenantId, role: 'MENTOR' });
    const b = await createUser({ tenantId, role: 'MENTOR' });
    mentorA = a.id;
    mentorB = b.id;
    ({ accessToken: tokenA } = await loginAs(http, a.email, a.rawPassword));
  });

  it('mentör A, mentör B\'nin filtresini YAZAMAZ → 403', async () => {
    const res = await http
      .put(`/api/mentors/${mentorB}/filter`)
      .set(tenantHeaders(tenantId, tokenA))
      .send({ minCompatibilityScore: 90, blockedDiscTypes: ['D'], filterEnabled: true });
    expect(res.status).toBe(403);
  });

  it('mentör A KENDİ filtresini yazabilir → 200', async () => {
    const res = await http
      .put(`/api/mentors/${mentorA}/filter`)
      .set(tenantHeaders(tenantId, tokenA))
      .send({ minCompatibilityScore: 40, blockedDiscTypes: [], filterEnabled: true });
    expect(res.status).toBe(200);
    expect(res.body.minCompatibilityScore).toBe(40);
  });

  it('ADMIN herhangi bir mentörün filtresini yazabilir → 200', async () => {
    const admin = await createUser({ tenantId, role: 'ADMIN' });
    const { accessToken: adminToken } = await loginAs(http, admin.email, admin.rawPassword);
    const res = await http
      .put(`/api/mentors/${mentorB}/filter`)
      .set(tenantHeaders(tenantId, adminToken))
      .send({ minCompatibilityScore: 50, blockedDiscTypes: [], filterEnabled: true });
    expect(res.status).toBe(200);
  });
});

describe('Y3 — GET /mentors/:mentorId/filter IDOR', () => {
  let http: TestAgent;
  let tenantId: string;
  let mentorA: string;
  let mentorB: string;
  let tokenA: string;

  beforeEach(async () => {
    await cleanDb();
    http = agent();
    const tenant = await createTenant();
    tenantId = tenant.id;
    const a = await createUser({ tenantId, role: 'MENTOR' });
    const b = await createUser({ tenantId, role: 'MENTOR' });
    mentorA = a.id;
    mentorB = b.id;
    ({ accessToken: tokenA } = await loginAs(http, a.email, a.rawPassword));
  });

  it('mentör A, mentör B\'nin filtresini OKUYAMAZ → 403', async () => {
    const res = await http
      .get(`/api/mentors/${mentorB}/filter`)
      .set(tenantHeaders(tenantId, tokenA));
    expect(res.status).toBe(403);
  });

  it('mentör A KENDİ filtresini okuyabilir → 200', async () => {
    const res = await http
      .get(`/api/mentors/${mentorA}/filter`)
      .set(tenantHeaders(tenantId, tokenA));
    expect(res.status).toBe(200);
    expect(res.body.mentorId).toBe(mentorA);
  });
});
