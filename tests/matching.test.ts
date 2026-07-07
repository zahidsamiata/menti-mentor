/**
 * Matching Entegrasyon Testleri
 *
 * Kapsam: ranked-mentis endpoint, visibility opt-in akışı, cross-tenant kısıtları,
 *         self-match koruması, MENTI rol doğrulaması.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { agent, loginAs, tenantHeaders, type TestAgent } from './helpers/request.js';
import { cleanDb, testPrisma } from './helpers/db.js';
import { createTenant, createMentor, createMenti, createUser } from './helpers/factories.js';
import type { Tenant } from '@prisma/client';

describe('Matching: Ranked Mentis', () => {
  let http: TestAgent;
  let tenant: Tenant;
  let mentorToken: string;
  let mentorId: string;

  beforeEach(async () => {
    await cleanDb();
    http = agent();
    tenant = await createTenant({ isSharedPoolActive: false });

    const mentor = await createMentor(tenant.id, { discType: 'C', sectorTags: ['teknoloji', 'finans'] });
    const tokens = await loginAs(http, mentor.email, mentor.rawPassword);
    mentorToken = tokens.accessToken;
    mentorId = mentor.id;

    // Eşleşme için menti'ler oluştur
    await createMenti(tenant.id, { discType: 'D', sectorTags: ['teknoloji'] });
    await createMenti(tenant.id, { discType: 'I', sectorTags: ['finans'] });
    await createMenti(tenant.id, { discType: 'S', sectorTags: ['sağlık'] }); // Sektör eşleşmesi yok
  });

  it('mentor kendi tenant\'ının APPROVED menti listesini alır', async () => {
    const res = await http
      .get(`/api/mentors/${mentorId}/candidates`)
      .set(tenantHeaders(tenant.id, mentorToken))
      .expect(200);

    const body = res.body as { items: { totalScore: number }[]; fallbackLevel: number };
    expect(body.items.length).toBeGreaterThan(0);
    // Skorlara göre azalan sıralama
    const scores = body.items.map((i) => i.totalScore);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
  });

  it('limit parametresi sonuçları kısıtlar', async () => {
    const res = await http
      .get(`/api/mentors/${mentorId}/candidates?limit=1`)
      .set(tenantHeaders(tenant.id, mentorToken))
      .expect(200);

    expect((res.body as { items: unknown[] }).items).toHaveLength(1);
  });

  it('JWT olmadan 401 döner', async () => {
    await http
      .get(`/api/mentors/${mentorId}/candidates`)
      .set({ 'X-Tenant-Id': tenant.id })
      .expect(401);
  });

  it('PENDING kullanıcılar eşleşme listesine dahil edilmez', async () => {
    const pendingMenti = await createMenti(tenant.id, {
      discType: 'D',
      sectorTags: ['teknoloji'],
      approvalStatus: 'PENDING',
    });

    const res = await http
      .get(`/api/mentors/${mentorId}/candidates`)
      .set(tenantHeaders(tenant.id, mentorToken))
      .expect(200);

    const body = res.body as { items: { mentiId: string }[] };
    const mentiIds = body.items.map((i) => i.mentiId);
    expect(mentiIds).not.toContain(pendingMenti.id);
  });
});

describe('Matching: Visibility Opt-In', () => {
  let http: TestAgent;
  let tenant: Tenant;
  let mentorToken: string;
  let mentorId: string;
  let mentiId: string;

  beforeEach(async () => {
    await cleanDb();
    http = agent();
    tenant = await createTenant();

    const mentor = await createMentor(tenant.id);
    const menti = await createMenti(tenant.id);
    const tokens = await loginAs(http, mentor.email, mentor.rawPassword);
    mentorToken = tokens.accessToken;
    mentorId = mentor.id;
    mentiId = menti.id;
  });

  it('mentor menti\'ye APPROVED opt-in gönderebilir', async () => {
    const res = await http
      .post(`/api/mentors/${mentorId}/visibility-optin`)
      .set(tenantHeaders(tenant.id, mentorToken))
      .send({ mentiId, status: 'APPROVED' })
      .expect(200);

    expect((res.body as { status: string }).status).toBe('APPROVED');
  });

  it('self-match engellenir (400)', async () => {
    await http
      .post(`/api/mentors/${mentorId}/visibility-optin`)
      .set(tenantHeaders(tenant.id, mentorToken))
      .send({ mentiId: mentorId, status: 'APPROVED' })
      .expect(400);
  });

  it('MENTOR rolündeki kullanıcıya opt-in 400 döner', async () => {
    const anotherMentor = await createMentor(tenant.id);
    await http
      .post(`/api/mentors/${mentorId}/visibility-optin`)
      .set(tenantHeaders(tenant.id, mentorToken))
      .send({ mentiId: anotherMentor.id, status: 'APPROVED' })
      .expect(400);
  });

  it('cross-tenant opt-in izole tenant\'larda 403 döner', async () => {
    const otherTenant = await createTenant({ isSharedPoolActive: false });
    const crossMenti = await createMenti(otherTenant.id);

    await http
      .post(`/api/mentors/${mentorId}/visibility-optin`)
      .set(tenantHeaders(tenant.id, mentorToken))
      .send({ mentiId: crossMenti.id, status: 'APPROVED' })
      .expect(403);
  });

  it('her iki tenant shared pool aktifse cross-tenant opt-in başarılı olur', async () => {
    const sharedTenantA = await createTenant({ isSharedPoolActive: true });
    const sharedTenantB = await createTenant({ isSharedPoolActive: true });
    const sharedMentor = await createMentor(sharedTenantA.id);
    const sharedMenti = await createMenti(sharedTenantB.id);
    const sharedTokens = await loginAs(http, sharedMentor.email, sharedMentor.rawPassword);

    await http
      .post(`/api/mentors/${sharedMentor.id}/visibility-optin`)
      .set(tenantHeaders(sharedTenantA.id, sharedTokens.accessToken))
      .send({ mentiId: sharedMenti.id, status: 'APPROVED' })
      .expect(200);
  });
});

describe('Matching: Candidate Filter', () => {
  let http: TestAgent;
  let tenant: Tenant;
  let mentorToken: string;
  let mentorId: string;

  beforeEach(async () => {
    await cleanDb();
    http = agent();
    tenant = await createTenant();
    const mentor = await createMentor(tenant.id, { discType: 'C', sectorTags: ['teknoloji'] });
    const tokens = await loginAs(http, mentor.email, mentor.rawPassword);
    mentorToken = tokens.accessToken;
    mentorId = mentor.id;

    await createMenti(tenant.id, { discType: 'D', sectorTags: ['teknoloji'] });
    await createMenti(tenant.id, { discType: 'S', sectorTags: ['teknoloji'] });
  });

  it('minMatchScore filtresi düşük skorlu adayları eliyor', async () => {
    const res = await http
      .get(`/api/mentors/${mentorId}/candidates?minMatchScore=95`)
      .set(tenantHeaders(tenant.id, mentorToken))
      .expect(200);

    const body = res.body as { items: { totalScore: number }[] };
    body.items.forEach((item) => expect(item.totalScore).toBeGreaterThanOrEqual(90));
  });
});
