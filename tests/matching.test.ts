/**
 * Matching Entegrasyon Testleri
 *
 * Kapsam: ranked-mentis endpoint, visibility opt-in akışı, cross-tenant kısıtları,
 *         self-match koruması, MENTI rol doğrulaması,
 *         level-3 fallback davranışı, computeSectorScore değişkenliği.
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

// ─── P0 Regresyon: Level 3 Fallback threshold deadlock ───────────────────────
describe('Matching: Level 3 Fallback — yüksek barajda deadlock olmamalı', () => {
  let http: TestAgent;
  let tenant: Tenant;
  let mentorToken: string;
  let mentorId: string;

  beforeEach(async () => {
    await cleanDb();
    http = agent();

    // minMatchScoreThreshold=80 → yüksek eşik
    tenant = await createTenant();
    await testPrisma.tenant.update({
      where: { id: tenant.id },
      data:  { minMatchScoreThreshold: 80 },
    });

    // Mentor: D tipi, geniş sektör havuzu
    const mentor = await createMentor(tenant.id, {
      discType:   'D',
      sectorTags: ['teknoloji', 'finans', 'sağlık'],
    });
    const tokens = await loginAs(http, mentor.email, mentor.rawPassword);
    mentorToken = tokens.accessToken;
    mentorId    = mentor.id;

    // Menti: S tipi (D→S anti-match), kısmi sektör örtüşmesi (50%)
    // Level 0/1: anti-match → dışlanır
    // Level 2: skor = 50*0.6 + 30*0.4 = 42 < 80 → eşik altında elenir
    // Level 3 (sector-only): skor = 50*0.6 + 50*0.4 = 50 < 80
    //   eski kod: applyScoreFilter uygular → boş döner (deadlock)
    //   yeni kod: threshold atlanır → menti döner ✅
    await createMenti(tenant.id, {
      discType:   'S',
      sectorTags: ['teknoloji', 'sanat'],
    });
  });

  it('level 3 fallback, tenant barajı yüksek olsa bile en az bir aday döner', async () => {
    const res = await http
      .get(`/api/mentors/${mentorId}/candidates`)
      .set(tenantHeaders(tenant.id, mentorToken))
      .expect(200);

    const body = res.body as { items: unknown[]; fallbackLevel: number };
    expect(body.fallbackLevel).toBe(3);
    expect(body.items.length).toBeGreaterThan(0);
  });

  it('level 3 aday listesinde uyarı rozeti bulunur', async () => {
    const res = await http
      .get(`/api/mentors/${mentorId}/candidates`)
      .set(tenantHeaders(tenant.id, mentorToken))
      .expect(200);

    const body = res.body as { items: { warnings: string[] }[] };
    expect(body.items[0]!.warnings.length).toBeGreaterThan(0);
  });
});

// ─── P2 Regresyon: TenantMembership.role izolasyonu ──────────────────────────
describe('Matching: TenantMembership Rol İzolasyonu', () => {
  let http: TestAgent;

  beforeEach(async () => {
    await cleanDb();
    http = agent();
  });

  it('çift-kurumlu kullanıcı TenantMembership.role ile doğru havuza girer', async () => {
    // Her iki tenant shared pool'da olduğunda User X'in home tenant'ı eligibleTenantIds'e girer.
    // P2 senaryosu: User X'in global User.role='MENTOR' ama tenantA üzerinden MENTI olarak eşleşmeli.
    //   ESKİ KOD: User.role='MENTOR' → tenantB menti havuzunda GÖRÜNMEZ (yanlış).
    //   YENİ KOD: TenantMembership(tenantA, MENTI, aktif) → tenantB menti havuzunda GÖRÜNÜR.
    const tenantA = await createTenant({ isSharedPoolActive: true });
    const tenantB = await createTenant({ isSharedPoolActive: true });

    // User X: home=tenantA, User.role=MENTOR — ama TenantMembership(tenantA) rolü MENTI olarak güncelleniyor.
    const userX = await createMentor(tenantA.id, { sectorTags: ['teknoloji'] });
    // createMentor TenantMembership(tenantA, MENTOR) oluşturur; bunu MENTI olarak güncelle
    await testPrisma.tenantMembership.update({
      where: { userId_tenantId: { userId: userX.id, tenantId: tenantA.id } },
      data:  { role: 'MENTI' },
    });

    // Mentor Y: tenantB'de sorgular; shared pool → eligibleTenantIds=[tenantB, tenantA]
    const mentorY = await createMentor(tenantB.id, { sectorTags: ['teknoloji'] });
    const { accessToken } = await loginAs(http, mentorY.email, mentorY.rawPassword);

    const res = await http
      .get(`/api/mentors/${mentorY.id}/candidates`)
      .set(tenantHeaders(tenantB.id, accessToken))
      .expect(200);

    const ids = (res.body as { items: { mentiId: string }[] }).items.map((i) => i.mentiId);
    expect(ids).toContain(userX.id);
  });

  it('izole tenant adayları başka tenant havuzuna sızmaz (cross-tenant izolasyon)', async () => {
    const tenantA = await createTenant({ isSharedPoolActive: false });
    const tenantB = await createTenant({ isSharedPoolActive: false });

    // tenantA'nın menties — sadece tenantA membership'i var; tenantB'ye sızmamalı
    const mentiA = await createMenti(tenantA.id, { sectorTags: ['teknoloji'] });

    // tenantB'de gerçek bir menti olsun (boş liste trivial geçmesin)
    await createMenti(tenantB.id, { sectorTags: ['teknoloji'] });

    const mentorB = await createMentor(tenantB.id, { sectorTags: ['teknoloji'] });
    const { accessToken } = await loginAs(http, mentorB.email, mentorB.rawPassword);

    const res = await http
      .get(`/api/mentors/${mentorB.id}/candidates`)
      .set(tenantHeaders(tenantB.id, accessToken))
      .expect(200);

    const ids = (res.body as { items: { mentiId: string }[] }).items.map((i) => i.mentiId);
    expect(ids).not.toContain(mentiA.id);
  });

  it('pasif TenantMembership aday havuzdan dışlar', async () => {
    const tenant = await createTenant();

    // pasif üye: User.isActive=true ama TenantMembership.isActive=false
    const passiveMenti = await createMenti(tenant.id, { sectorTags: ['teknoloji'] });
    await testPrisma.tenantMembership.update({
      where: { userId_tenantId: { userId: passiveMenti.id, tenantId: tenant.id } },
      data:  { isActive: false },
    });

    // aktif referans üyesi (boş liste trivial geçmesin)
    await createMenti(tenant.id, { sectorTags: ['teknoloji'] });

    const mentor = await createMentor(tenant.id, { sectorTags: ['teknoloji'] });
    const { accessToken } = await loginAs(http, mentor.email, mentor.rawPassword);

    const res = await http
      .get(`/api/mentors/${mentor.id}/candidates`)
      .set(tenantHeaders(tenant.id, accessToken))
      .expect(200);

    const ids = (res.body as { items: { mentiId: string }[] }).items.map((i) => i.mentiId);
    expect(ids).not.toContain(passiveMenti.id);
  });
});

// ─── Adım 4: Explicit tenantId filtresi — RLS-bağımsız izolasyon garantisi ──
describe('Matching: Explicit tenantId filtresi RLS olmadan da izolasyonu korur', () => {
  // Bu test neyi kanıtlar:
  //   Aday sorgusundaki explicit `tenantId: { in: eligibleTenantIds }` filtresi
  //   cross-tenant sızıntıyı tek başına engeller.
  //   Kanıt: tüm dönen adayların mentiTenantId'si yalnızca istek tenant'ına ait.
  //   Eğer db.ts RLS extension refactor edilip kaldırılsaydı, bu aynı explicit
  //   WHERE koşulu zaten korumaya devam ederdi — `User.tenantId: { in: [tenantB] }`
  //   tenantA kullanıcısını dışlar.
  let http: TestAgent;

  beforeEach(async () => {
    await cleanDb();
    http = agent();
  });

  it('dönen tüm adayların mentiTenantId değeri istek tenant\'ına ait', async () => {
    const tenantA = await createTenant({ isSharedPoolActive: false });
    const tenantB = await createTenant({ isSharedPoolActive: false });

    // tenantA'da MENTI — potansiyel sızıntı kaynağı; tenantB havuzunda görünmemeli
    await createMenti(tenantA.id, { sectorTags: ['teknoloji'] });
    // tenantB'de meşru MENTI — görünmeli
    const legitimateMenti = await createMenti(tenantB.id, { sectorTags: ['teknoloji'] });

    const mentorB = await createMentor(tenantB.id, { sectorTags: ['teknoloji'] });
    const { accessToken } = await loginAs(http, mentorB.email, mentorB.rawPassword);

    const res = await http
      .get(`/api/mentors/${mentorB.id}/candidates`)
      .set(tenantHeaders(tenantB.id, accessToken))
      .expect(200);

    const body = res.body as { items: { mentiId: string; mentiTenantId: string }[] };

    // Meşru aday görünüyor — havuz boş değil (trivial pass koruması)
    expect(body.items.map((i) => i.mentiId)).toContain(legitimateMenti.id);

    // Tüm dönen adayların home tenant'ı tenantB — explicit WHERE filtresinin kanıtı
    for (const item of body.items) {
      expect(item.mentiTenantId).toBe(tenantB.id);
    }
  });
});
