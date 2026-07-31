/**
 * Security Hardening Entegrasyon Testleri
 *
 * Bu test seti production deployment öncesi üç kritik tehdit senaryosunu doğrular:
 *
 *  1. Cross-Tenant Penetrasyon Engeli
 *     Kullanıcının JWT tenantId'si ile X-Tenant-Id header'ı çeliştiğinde
 *     middleware 403 döndürmeli, kaynak asla sızmamalıdır.
 *
 *  2. Algoritmik Kilitlenme / Boş Havuz Güvenliği
 *     Tüm adaylar blockedPairs veya yüksek threshold ile elenmişse
 *     motor TypeError fırlatmadan { items: [], fallbackLevel: 3 } döndürmeli.
 *
 *  3. Sabotajcı Menti — DISC Submit Zod Zırhı
 *     Eksik, mükerrer veya geçersiz cevaplar gönderildiğinde Zod 400 döndürmeli,
 *     calculateDiscResult hiçbir zaman çağrılmamalıdır.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { agent, loginAs, tenantHeaders, type TestAgent } from './helpers/request.js';
import { cleanDb, testPrisma }                from './helpers/db.js';
import {
  createTenant,
  createMentor,
  createMenti,
  createAdminUser,
} from './helpers/factories.js';
import type { Tenant, User } from '@prisma/client';

// ─── Test 1: Cross-Tenant Penetrasyon Engeli ─────────────────────────────────

describe('Hardening: Cross-Tenant Penetrasyon Engeli', () => {
  let http: TestAgent;
  let tenantA: Tenant;
  let tenantB: Tenant;
  let userA:   User & { rawPassword: string };
  let tokenA:  string;

  beforeEach(async () => {
    await cleanDb();
    http = agent();

    tenantA = await createTenant({ name: 'Tenant Alpha' });
    tenantB = await createTenant({ name: 'Tenant Beta'  });
    userA   = await createMentor(tenantA.id, { discType: 'C', sectorTags: ['teknoloji'] });

    const tokens = await loginAs(http, userA.email, userA.rawPassword);
    tokenA = tokens.accessToken;
  });

  it('Kullanıcı A, B tenant header ile istek atarsa 403 alır', async () => {
    // JWT tenantId = tenantA.id, ama X-Tenant-Id header = tenantB.id
    // Middleware step-3: cross-tenant mismatch → 403 CROSS_TENANT_ERISIM_ENGELLENDI
    const res = await http
      .get(`/api/users/${userA.id}`)
      .set({
        'X-Tenant-Id':    tenantB.id,   // ← yabancı tenant
        'Authorization': `Bearer ${tokenA}`,
      });

    expect(res.status).toBe(403);
    expect((res.body as { error: string }).error).toBe('CROSS_TENANT_ERISIM_ENGELLENDI');
  });

  it('ADMIN, başka tenant\'taki kullanıcı ID\'sini kendi header\'ıyla sorgularsa 404 alır (RLS)', async () => {
    // Ownership kapısını (requireSelfOrAdmin) yalnızca kaydın sahibi veya ADMIN geçer.
    // ADMIN geçtikten SONRA RLS + tenantId filtresi devreye girer:
    // findFirst(id=B_user, tenantId=tenantA) → bulunamaz → 404.
    // (Mentör/menti aynı sorguyu yaparsa ownership nedeniyle 403 alır — bkz. idor-ownership.test.ts.)
    const adminA = await createAdminUser(tenantA.id);
    const { accessToken: adminToken } = await loginAs(http, adminA.email, adminA.rawPassword);
    const userB = await createMenti(tenantB.id);

    const res = await http
      .get(`/api/users/${userB.id}`)
      .set(tenantHeaders(tenantA.id, adminToken));

    expect(res.status).toBe(404);
  });

  it('Header yoksa 400 döner (tenant zorunlu)', async () => {
    const res = await http
      .get(`/api/users/${userA.id}`)
      .set({ 'Authorization': `Bearer ${tokenA}` });
    // X-Tenant-Id yoksa config.defaultTenantId de yoksa 400
    // (TEST ortamında DEFAULT_TENANT_ID tanımlı değil)
    expect([400, 401]).toContain(res.status);
  });
});

// ─── Test 2: Algoritmik Kilitlenme / Boş Havuz ───────────────────────────────

describe('Hardening: Boş Havuz / Algoritmik Kilitlenme', () => {
  let http: TestAgent;
  let tenant:      Tenant;
  let mentor:      User & { rawPassword: string };
  let menti1:      User & { rawPassword: string };
  let menti2:      User & { rawPassword: string };
  let mentorToken: string;

  beforeEach(async () => {
    await cleanDb();
    http   = agent();
    tenant = await createTenant();
    mentor = await createMentor(tenant.id, { discType: 'C', sectorTags: ['teknoloji'] });
    menti1 = await createMenti(tenant.id, { discType: 'D', sectorTags: ['teknoloji'] });
    menti2 = await createMenti(tenant.id, { discType: 'I', sectorTags: ['teknoloji'] });

    const tokens = await loginAs(http, mentor.email, mentor.rawPassword);
    mentorToken  = tokens.accessToken;
  });

  it('Tüm adaylar blockedPairs ile elendiğinde motor boş state döndürür', async () => {
    // Her iki menti'yi admin kara listesine al
    await testPrisma.tenant.update({
      where: { id: tenant.id },
      data:  {
        blockedPairs: [
          { fromUserId: mentor.id, toUserId: menti1.id, blockedAt: new Date().toISOString(), blockedBy: 'test-admin' },
          { fromUserId: mentor.id, toUserId: menti2.id, blockedAt: new Date().toISOString(), blockedBy: 'test-admin' },
        ],
      },
    });

    const res = await http
      .get(`/api/mentors/${mentor.id}/candidates`)
      .set(tenantHeaders(tenant.id, mentorToken))
      .expect(200);

    const body = res.body as { items: unknown[]; fallbackLevel: number };
    expect(body.items).toHaveLength(0);
    expect(body.fallbackLevel).toBe(3); // tüm fallbackler geçildi, motor çökmedi
  });

  it('minMatchScoreThreshold %90\'a ayarlandığında havuz kilitlenir; motor TypeError fırlatmaz', async () => {
    await testPrisma.tenant.update({
      where: { id: tenant.id },
      data:  { minMatchScoreThreshold: 90 }, // gerçekçi hiçbir eşleşme bu eşiği aşamaz
    });

    const res = await http
      .get(`/api/mentors/${mentor.id}/candidates`)
      .set(tenantHeaders(tenant.id, mentorToken))
      .expect(200); // 500 değil!

    const body = res.body as { items: unknown[] };
    // Boş veya az eleman; önemli olan 500 alınmaması
    expect(Array.isArray(body.items)).toBe(true);
  });

  it('Bozuk blockedPairs JSON blobu (geçersiz kayıt) TypeError fırlatmaz', async () => {
    // DB'ye bozuk kayıtlar + geçerli kayıt karışık yaz
    await testPrisma.tenant.update({
      where: { id: tenant.id },
      data:  {
        blockedPairs: [
          null,                         // null kayıt
          { fromUserId: 'x' },          // eksik toUserId
          { fromUserId: '', toUserId: '' }, // boş string
          { fromUserId: menti1.id, toUserId: menti1.id, blockedAt: 'now', blockedBy: 'admin' }, // self-block
          { fromUserId: mentor.id, toUserId: menti2.id, blockedAt: new Date().toISOString(), blockedBy: 'admin' }, // geçerli
        ] as object[],
      },
    });

    const res = await http
      .get(`/api/mentors/${mentor.id}/candidates`)
      .set(tenantHeaders(tenant.id, mentorToken))
      .expect(200); // sanitizeBlockedPairs bozuk kayıtları filtrelemeli

    const body = res.body as { items: { mentiId: string }[] };
    // menti2 bloklandı ama menti1 görünür olmalı (bozuk kayıtlar atlandı)
    const ids = body.items.map((i) => i.mentiId);
    expect(ids).not.toContain(menti2.id); // geçerli blok çalışıyor
    expect(ids).toContain(menti1.id);     // bozuk self-block etkisiz
  });
});

// ─── Test 3: Sabotajcı Menti — DISC Submit Zod Zırhı ─────────────────────────

describe('Hardening: Sabotajcı Menti /disc/submit', () => {
  let http:       TestAgent;
  let tenant:     Tenant;
  let menti:      User & { rawPassword: string };
  let mentiToken: string;

  beforeEach(async () => {
    await cleanDb();
    http   = agent();
    tenant = await createTenant();
    menti  = await createMenti(tenant.id, { discType: 'D', sectorTags: ['teknoloji'] });

    const tokens = await loginAs(http, menti.email, menti.rawPassword);
    mentiToken   = tokens.accessToken;
  });

  const VALID_ANSWERS = [
    { questionId: 1, selectedOption: 'A' },
    { questionId: 2, selectedOption: 'B' },
    { questionId: 3, selectedOption: 'C' },
    { questionId: 4, selectedOption: 'D' },
    { questionId: 5, selectedOption: 'A' },
    { questionId: 6, selectedOption: 'B' },
  ]; // 6 soru — minimum geçerli set

  it('Geçerli 6 cevap ile 200 döner ve discType set edilir', async () => {
    const res = await http
      .post('/api/users/disc/submit')
      .set(tenantHeaders(tenant.id, mentiToken))
      .send({ answers: VALID_ANSWERS })
      .expect(200);

    const body = res.body as { resultCard: { dominant: string } };
    expect(['D', 'I', 'S', 'C']).toContain(body.resultCard.dominant);
  });

  it('Boş answers array → 400 (Zod min(6))', async () => {
    const res = await http
      .post('/api/users/disc/submit')
      .set(tenantHeaders(tenant.id, mentiToken))
      .send({ answers: [] })
      .expect(400);

    expect((res.body as { error: string }).error).toBe('VALIDATION');
  });

  it('5 soru (min 6\'dan az) → 400', async () => {
    await http
      .post('/api/users/disc/submit')
      .set(tenantHeaders(tenant.id, mentiToken))
      .send({ answers: VALID_ANSWERS.slice(0, 5) })
      .expect(400);
  });

  it('Geçersiz enum seçeneği (E) → 400', async () => {
    const tampered = [
      ...VALID_ANSWERS.slice(0, 5),
      { questionId: 6, selectedOption: 'E' }, // ← geçersiz
    ];
    const res = await http
      .post('/api/users/disc/submit')
      .set(tenantHeaders(tenant.id, mentiToken))
      .send({ answers: tampered })
      .expect(400);

    expect((res.body as { error: string }).error).toBe('VALIDATION');
  });

  it('Mükerrer soru ID\'si → 400 (Zod refine)', async () => {
    const duplicate = [
      ...VALID_ANSWERS.slice(0, 5),
      { questionId: 1, selectedOption: 'C' }, // ← id:1 tekrar
    ];
    const res = await http
      .post('/api/users/disc/submit')
      .set(tenantHeaders(tenant.id, mentiToken))
      .send({ answers: duplicate })
      .expect(400);

    expect((res.body as { error: string }).error).toBe('VALIDATION');
  });

  it('Geçersiz questionId (99) → 400 (Zod refine)', async () => {
    const tampered = [
      ...VALID_ANSWERS.slice(0, 5),
      { questionId: 99, selectedOption: 'A' }, // ← ID yok
    ];
    await http
      .post('/api/users/disc/submit')
      .set(tenantHeaders(tenant.id, mentiToken))
      .send({ answers: tampered })
      .expect(400);
  });

  it('JWT olmadan 401 döner', async () => {
    await http
      .post('/api/users/disc/submit')
      .set({ 'X-Tenant-Id': tenant.id })
      .send({ answers: VALID_ANSWERS })
      .expect(401);
  });

  it('Admin ayar clamping: threshold 100 gönderilirse 400 alınır (max 90)', async () => {
    const admin = await createAdminUser(tenant.id);
    const adminTokens = await loginAs(http, admin.email, admin.rawPassword);

    const res = await http
      .patch(`/api/tenants/${tenant.id}/settings`)
      .set({ 'Authorization': `Bearer ${adminTokens.accessToken}` })
      .send({ minMatchScoreThreshold: 100 }) // ← 90 üstü reddedilmeli
      .expect(400);

    expect((res.body as { error: string }).error).toBe('VALIDATION');
  });

  it('Admin ayar clamping: maxMeetingsPerWeek 7 gönderilirse 400 alınır (max 5)', async () => {
    const admin = await createAdminUser(tenant.id);
    const adminTokens = await loginAs(http, admin.email, admin.rawPassword);

    const res = await http
      .patch(`/api/tenants/${tenant.id}/settings`)
      .set({ 'Authorization': `Bearer ${adminTokens.accessToken}` })
      .send({ maxMeetingsPerWeek: 7 }) // ← 5 üstü reddedilmeli
      .expect(400);

    expect((res.body as { error: string }).error).toBe('VALIDATION');
  });
});

// ─── Test 4: DISC Matematik Edge-Case Koruması ───────────────────────────────
// calculateDiscResult: sıfıra bölme koruması (|| 1), NaN guard (Number.isFinite)
// ve dominant tiebreak (D>I>S>C) HTTP entegrasyon testleriyle doğrulanır.

describe('Hardening: DISC Matematik Edge-Case Koruması', () => {
  let http:       TestAgent;
  let tenant:     Tenant;
  let menti:      User & { rawPassword: string };
  let mentiToken: string;

  beforeEach(async () => {
    await cleanDb();
    http   = agent();
    tenant = await createTenant();
    menti  = await createMenti(tenant.id, { discType: 'D', sectorTags: ['teknoloji'] });

    const tokens = await loginAs(http, menti.email, menti.rawPassword);
    mentiToken   = tokens.accessToken;
  });

  // Tüm sorular aynı boyuta (D → seçenek 'A') cevaplansa bile
  // NaN/Infinity üretilmemeli; normalize vektör [0,1] aralığında olmalıdır.
  it('Tüm cevaplar D boyutundan (seçenek A) → dominant="D", vektör değerleri finite ve [0,1]', async () => {
    const allD = [1, 2, 3, 4, 5, 6].map((id) => ({ questionId: id, selectedOption: 'A' }));

    const res = await http
      .post('/api/users/disc/submit')
      .set(tenantHeaders(tenant.id, mentiToken))
      .send({ answers: allD })
      .expect(200);

    // yanıt: resultCard.discVector (result.vector → discResultCard.discVector)
    const body = res.body as { resultCard: { dominant: string; discVector: Record<string, number> } };
    expect(body.resultCard.dominant).toBe('D');

    for (const dim of ['D', 'I', 'S', 'C']) {
      const val = body.resultCard.discVector[dim] ?? NaN;
      expect(Number.isFinite(val)).toBe(true);
      expect(val).toBeGreaterThanOrEqual(0);
      expect(val).toBeLessThanOrEqual(1);
    }
  });

  // Karma 6 cevapla normalize edilmiş vektörün toplamı 1.0'a yakın olmalıdır
  // (normalize işleminin doğru çalıştığını, sıfıra bölmediğini kanıtlar).
  it('Karma 6 geçerli cevap → normalize vektör D+I+S+C toplamı ~1.0', async () => {
    const mixed = [
      { questionId: 1, selectedOption: 'A' }, // D
      { questionId: 2, selectedOption: 'B' }, // I
      { questionId: 3, selectedOption: 'C' }, // S
      { questionId: 4, selectedOption: 'D' }, // C
      { questionId: 5, selectedOption: 'A' }, // D
      { questionId: 6, selectedOption: 'B' }, // I
    ];

    const res = await http
      .post('/api/users/disc/submit')
      .set(tenantHeaders(tenant.id, mentiToken))
      .send({ answers: mixed })
      .expect(200);

    const body = res.body as { resultCard: { discVector: Record<string, number> } };
    const vec = body.resultCard.discVector;
    const sum = (vec['D'] ?? 0) + (vec['I'] ?? 0) + (vec['S'] ?? 0) + (vec['C'] ?? 0);
    expect(sum).toBeCloseTo(1.0, 1);
  });
});
