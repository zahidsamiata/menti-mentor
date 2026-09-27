/**
 * AJ-16 — K5-Y3'ün devamı: kurum izolasyonu / IDOR negatif testleri (4. parti).
 *
 * Kaynak: docs/raporlar/kesif/negatif-test-boslugu-2026-09-26.md — önceki üç parti
 * (`y3-yetki-kurum-izolasyonu.test.ts`, `aj04-negatif-test-devami.test.ts`,
 * `aj13-negatif-test-2-parti.test.ts`, `aj15-negatif-test-3-parti.test.ts`) raporun
 * öncelik listesi + tablosundaki uçları sırayla kapattı. Bu dosya tablodaki KALAN
 * uçlardan devam eder: AlgorithmTuner/Cron paneli, KPI, Öğrenme Yolculuğu (admin +
 * oyuncu), FeedbackLog kombinasyon skorları, Kulüpler ve İş İlanları listeleri.
 *
 * Desen (yalnız uygulanabilen alt-testler yazılır; başka dosyada zaten test edilen
 * senaryo TEKRARLANMAZ):
 *   (a) oturumsuz → 401
 *   (b) yanlış rol → 403
 *   (c) BAŞKA KURUMUN kaynağı/verisi → 403/404 VE kaynak/veri DEĞİŞMEZ (DB'den okunarak)
 *   (d) aynı kurumda başkasının kaydı (IDOR) → 403/404 VE kaynak değişmez
 *
 * Kaynak koda dokunulmadı; yalnız test eklendi. Beklenen kodlar controller/servis
 * OKUNARAK alındı (tahmin değil) — ilgili dosya/satır her blokta yorumda belirtilir.
 *
 * AÇIK BULGU → AJ-17'YE DEVREDİLDİ: `POST /api/admin/cron/run-purge` ve aynı ailedeki
 * `POST /api/admin/cron/run-tuning`, T+ADMIN zinciriyle korunuyor (yalnız KENDİ kurumunun
 * yöneticisi çağırabilir) AMA çağrılan iş (`purgeExpiredData()` / `runWeeklyTuning()`,
 * `src/services/cronScheduler.ts:87-95` ve `:56-72`) tenant PARAMETRESİ ALMADAN TÜM
 * kurumları işler — HERHANGİ bir kurumun yöneticisi TÜM kurumları etkileyen bir
 * KVKK-temizliği/ağırlık-kalibrasyonu tetikleyebilir. İnceleme (#190) bu satırdaki
 * `it.fails` kullanımını SORUN olarak işaretledi; test buradan ÇIKARILDI, açık kuyruğa
 * AJ-17 olarak alındı — doğru negatif test (düzeltmeyle birlikte) orada yazılacak. Bu
 * dosyada yalnız uçların (a) oturumsuz-401 testi kalır; bulgunun kendisi test EDİLMEDEN
 * bırakıldı (kod DEĞİŞTİRİLMEDİ).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import supertest from 'supertest';
import express from 'express';
import { agent, loginAs, tenantHeaders, type TestAgent } from './helpers/request.js';
import { cleanDb, testPrisma } from './helpers/db.js';
import {
  createTenant,
  createAdminUser,
  createMentor,
  createMenti,
} from './helpers/factories.js';
import { signToken } from '../src/middleware/jwtAuth.js';
import clubRoutes from '../src/routes/clubRoutes.js';
import jobListingRoutes from '../src/routes/jobListingRoutes.js';
import feedbackLogRoutes from '../src/routes/feedbackLogRoutes.js';
import { notFoundHandler, globalErrorHandler } from '../src/middleware/errorHandler.js';
import type { User, Tenant } from '@prisma/client';

type SeededUser = Awaited<ReturnType<typeof createMenti>>;

function tokenFor(u: Pick<User, 'id' | 'tenantId' | 'role' | 'fullName'>): string {
  return signToken({ sub: u.id, tenantId: u.tenantId, role: u.role, fullName: u.fullName });
}

// clubRoutes/jobListingRoutes/feedbackLogRoutes ana test app'e (tests/helpers/request.ts)
// MOUNT EDİLMEMİŞ (rapor notu) — feedbacklog-identity.test.ts / aj04'teki gibi minimal özel app.
function mountedApp(path: string, router: express.Router) {
  const app = express();
  app.use(express.json());
  app.use(path, router);
  app.use(notFoundHandler);
  app.use(globalErrorHandler);
  return supertest.agent(app);
}

// ─── AJ16-1: GET /api/admin/algorithm-tuner/pending ─────────────────────────
// adminController.ts:getPendingTuning → algorithmTuner.ts:getPendingAdjustment
// (tenant.tenantVocabulary.pendingAlgorithmAdjustment, tenant-scoped okuma).
describe('AJ16-1: GET /api/admin/algorithm-tuner/pending', () => {
  let http: TestAgent;
  let tenantA: Tenant;
  let tenantB: Tenant;
  let adminB: SeededUser;

  beforeEach(async () => {
    await cleanDb();
    http = agent();
    tenantA = await createTenant();
    tenantB = await createTenant();
    adminB = await createAdminUser(tenantB.id);
    await testPrisma.tenant.update({
      where: { id: tenantA.id },
      data: { tenantVocabulary: { pendingAlgorithmAdjustment: { tenantId: tenantA.id, adjusted: true, reason: 'test' } } },
    });
  });

  it('(a) oturumsuz → 401', async () => {
    await http.get('/api/admin/algorithm-tuner/pending').set(tenantHeaders(tenantB.id)).expect(401);
  });

  it('(c) B kurumunun yöneticisi A kurumunun bekleyen önerisini GÖRMEZ (null döner)', async () => {
    const { accessToken } = await loginAs(http, adminB.email, adminB.rawPassword);
    const res = await http.get('/api/admin/algorithm-tuner/pending').set(tenantHeaders(tenantB.id, accessToken)).expect(200);
    expect(res.body.pending).toBeNull();
  });
});

// ─── AJ16-2/3: POST .../algorithm-tuner/approve + /reject ───────────────────
// adminController.ts:approvePendingTuning/rejectPendingTuning → yalnız req.tenant.tenantId
// üzerinde çalışır; B'nin çağrısı A'nın tenantVocabulary'sine ASLA dokunmaz.
describe('AJ16-2/3: POST /api/admin/algorithm-tuner/approve + /reject', () => {
  let http: TestAgent;
  let tenantA: Tenant;
  let tenantB: Tenant;
  let adminB: SeededUser;
  const pendingA = { tenantId: '', adjusted: true, reason: 'test', proposedAt: new Date().toISOString() };

  beforeEach(async () => {
    await cleanDb();
    http = agent();
    tenantA = await createTenant();
    tenantB = await createTenant();
    adminB = await createAdminUser(tenantB.id);
    pendingA.tenantId = tenantA.id;
    await testPrisma.tenant.update({
      where: { id: tenantA.id },
      data: { tenantVocabulary: { pendingAlgorithmAdjustment: pendingA } },
    });
  });

  it('approve (a) oturumsuz → 401', async () => {
    await http.post('/api/admin/algorithm-tuner/approve').set(tenantHeaders(tenantB.id)).expect(401);
  });

  it('approve (c) B kurumunun yöneticisi kendi (boş) önerisini onaylar → 404; A\'nın önerisi DEĞİŞMEZ', async () => {
    const { accessToken } = await loginAs(http, adminB.email, adminB.rawPassword);
    await http.post('/api/admin/algorithm-tuner/approve').set(tenantHeaders(tenantB.id, accessToken)).expect(404);

    const tenantARow = await testPrisma.tenant.findUnique({ where: { id: tenantA.id }, select: { tenantVocabulary: true } });
    const vocab = tenantARow?.tenantVocabulary as Record<string, unknown>;
    expect(vocab['pendingAlgorithmAdjustment']).toEqual(pendingA);
  });

  it('reject (c) B kurumunun yöneticisi reddeder → 200 (kendi boş durumu); A\'nın bekleyen önerisi DEĞİŞMEZ', async () => {
    const { accessToken } = await loginAs(http, adminB.email, adminB.rawPassword);
    await http.post('/api/admin/algorithm-tuner/reject').set(tenantHeaders(tenantB.id, accessToken)).expect(200);

    const tenantARow = await testPrisma.tenant.findUnique({ where: { id: tenantA.id }, select: { tenantVocabulary: true } });
    const vocab = tenantARow?.tenantVocabulary as Record<string, unknown>;
    expect(vocab['pendingAlgorithmAdjustment']).toEqual(pendingA);
  });
});

// ─── AJ16-4: POST /api/admin/cron/run-tuning ────────────────────────────────
// (a) yalnız yetki kapısı. Kurumlar-arası yan etki bulgusu AJ-17'ye devredildi (üstteki not).
describe('AJ16-4: POST /api/admin/cron/run-tuning', () => {
  it('(a) oturumsuz → 401', async () => {
    const http = agent();
    const tenant = await (async () => { await cleanDb(); return createTenant(); })();
    await http.post('/api/admin/cron/run-tuning').set(tenantHeaders(tenant.id)).expect(401);
  });
});

// ─── AJ16-5: POST /api/admin/cron/run-purge ─────────────────────────────────
// (a) yalnız yetki kapısı. Kurumlar-arası yan etki bulgusu (gdprService.ts:purgeExpiredData()
// tenant parametresi almadan TÜM kurumları etkiliyor) AJ-17'ye devredildi (üstteki not) —
// #190 incelemesi buradaki `it.fails` kullanımını sorunlu bulduğu için ÇIKARILDI.
describe('AJ16-5: POST /api/admin/cron/run-purge', () => {
  it('(a) oturumsuz → 401', async () => {
    const http = agent();
    const tenant = await (async () => { await cleanDb(); return createTenant(); })();
    await http.post('/api/admin/cron/run-purge').set(tenantHeaders(tenant.id)).expect(401);
  });
});

// ─── AJ16-6: GET /api/admin/kpi ─────────────────────────────────────────────
// adminController.ts:getKpiDashboard → kpiReport.service computeKpiStats(tenantId,
// tenant-scoped). B'nin panosu yalnız kendi verisini yansıtmalı.
describe('AJ16-6: GET /api/admin/kpi', () => {
  it('(c) B kurumunun panosu A kurumunun kullanıcılarını SAYMAZ', async () => {
    await cleanDb();
    const http = agent();
    const tenantA = await createTenant();
    const tenantB = await createTenant();
    await createMentor(tenantA.id);
    await createMenti(tenantA.id);
    const adminB = await createAdminUser(tenantB.id);

    const { accessToken } = await loginAs(http, adminB.email, adminB.rawPassword);
    const res = await http.get('/api/admin/kpi').set(tenantHeaders(tenantB.id, accessToken)).expect(200);

    // B kurumunda adminB dışında aktif kullanıcı yok → toplam yalnız 1 (adminB).
    expect(res.body.stats.totalActiveUsers).toBe(1);
    expect(res.body.tenantId).toBe(tenantB.id);
  });
});

// ─── AJ16-7: GET /api/admin/learning-journey/stages ─────────────────────────
// learningJourney.service.ts:listStagesForAdmin — OR:[{tenantId:null},{tenantId}].
// A'nın kendi (tenant-özel) aşaması B'nin yönetici listesinde GÖRÜNMEMELİ.
describe('AJ16-7: GET /api/admin/learning-journey/stages', () => {
  let http: TestAgent;
  let tenantA: Tenant;
  let tenantB: Tenant;
  let adminA: SeededUser;
  let adminB: SeededUser;

  beforeEach(async () => {
    await cleanDb();
    http = agent();
    tenantA = await createTenant();
    tenantB = await createTenant();
    adminA = await createAdminUser(tenantA.id);
    adminB = await createAdminUser(tenantB.id);
  });

  it('(a) oturumsuz → 401', async () => {
    await http.get('/api/admin/learning-journey/stages').set(tenantHeaders(tenantA.id)).expect(401);
  });

  it('(c) A\'nın kendi eklediği aşama B\'nin yönetici listesinde GÖRÜNMEZ', async () => {
    const { accessToken: tokenA } = await loginAs(http, adminA.email, adminA.rawPassword);
    const created = await http
      .post('/api/admin/learning-journey/stages')
      .set(tenantHeaders(tenantA.id, tokenA))
      .send({
        audience: 'MENTI',
        title: 'AJ16 A-özel aşama',
        situationText: 'Bir durumla karşılaşıyorsun, ne yaparsın?',
        learningGoal: 'Bir şey öğren.',
        choices: [
          { key: 'a', label: 'Evet', outcome: 'correct', feedback: 'İyi.' },
          { key: 'b', label: 'Hayır', outcome: 'wrong', feedback: 'Olmadı.' },
        ],
      })
      .expect(201);
    const stageId = created.body.id as string;

    const httpB = agent();
    const { accessToken: tokenB } = await loginAs(httpB, adminB.email, adminB.rawPassword);
    const listB = await httpB
      .get('/api/admin/learning-journey/stages')
      .set(tenantHeaders(tenantB.id, tokenB))
      .expect(200);
    expect(listB.body.items.map((s: { id: string }) => s.id)).not.toContain(stageId);
  });
});

// ─── AJ16-8/9: PATCH + DELETE /api/admin/learning-journey/stages/:stageId ───
// learningJourney.service.ts:assertTenantOwned → başka tenant'ın aşaması FORBIDDEN (403).
describe('AJ16-8/9: PATCH + DELETE /api/admin/learning-journey/stages/:stageId (c)', () => {
  let http: TestAgent;
  let tenantA: Tenant;
  let tenantB: Tenant;
  let adminA: SeededUser;
  let adminB: SeededUser;
  let stageId: string;

  beforeEach(async () => {
    await cleanDb();
    http = agent();
    tenantA = await createTenant();
    tenantB = await createTenant();
    adminA = await createAdminUser(tenantA.id);
    adminB = await createAdminUser(tenantB.id);

    const { accessToken: tokenA } = await loginAs(http, adminA.email, adminA.rawPassword);
    const created = await http
      .post('/api/admin/learning-journey/stages')
      .set(tenantHeaders(tenantA.id, tokenA))
      .send({
        audience: 'MENTOR',
        title: 'AJ16 A-özel aşama (silinecek/güncellenecek)',
        situationText: 'Bir durumla karşılaşıyorsun, ne yaparsın?',
        learningGoal: 'Bir şey öğren.',
        choices: [
          { key: 'a', label: 'Evet', outcome: 'correct', feedback: 'İyi.' },
          { key: 'b', label: 'Hayır', outcome: 'wrong', feedback: 'Olmadı.' },
        ],
      })
      .expect(201);
    stageId = created.body.id as string;
  });

  it('PATCH: B kurumunun yöneticisi A\'nın aşamasını düzenleyemez → 403; başlık DEĞİŞMEZ', async () => {
    const httpB = agent();
    const { accessToken: tokenB } = await loginAs(httpB, adminB.email, adminB.rawPassword);
    await httpB
      .patch(`/api/admin/learning-journey/stages/${stageId}`)
      .set(tenantHeaders(tenantB.id, tokenB))
      .send({ title: 'Ele geçirildi' })
      .expect(403);

    const stage = await testPrisma.learningStage.findUnique({ where: { id: stageId } });
    expect(stage?.title).toBe('AJ16 A-özel aşama (silinecek/güncellenecek)');
  });

  it('DELETE: B kurumunun yöneticisi A\'nın aşamasını silemez → 403; aşama VAR OLMAYA DEVAM EDER', async () => {
    const httpB = agent();
    const { accessToken: tokenB } = await loginAs(httpB, adminB.email, adminB.rawPassword);
    await httpB
      .delete(`/api/admin/learning-journey/stages/${stageId}`)
      .set(tenantHeaders(tenantB.id, tokenB))
      .expect(403);

    const stage = await testPrisma.learningStage.findUnique({ where: { id: stageId } });
    expect(stage).not.toBeNull();
  });
});

// ─── AJ16-10: POST /api/admin/learning-journey/stages/reorder ───────────────
// learningJourney.service.ts:reorderTenantStages — owned.length !== orderedIds.length
// → FORBIDDEN; transaction hiç ÇALIŞMAZ (kısmi de olsa yazılmaz).
describe('AJ16-10: POST /api/admin/learning-journey/stages/reorder', () => {
  it('(a) oturumsuz → 401', async () => {
    await cleanDb();
    const http = agent();
    const tenant = await createTenant();
    await http.post('/api/admin/learning-journey/stages/reorder').set(tenantHeaders(tenant.id)).expect(401);
  });

  it('(c) B kurumunun yöneticisi sıralamaya A\'nın aşama id\'sini eklerse → 403; A\'nın sırası DEĞİŞMEZ', async () => {
    await cleanDb();
    const http = agent();
    const tenantA = await createTenant();
    const tenantB = await createTenant();
    const adminA = await createAdminUser(tenantA.id);
    const adminB = await createAdminUser(tenantB.id);

    const { accessToken: tokenA } = await loginAs(http, adminA.email, adminA.rawPassword);
    const stageBody = (title: string) => ({
      audience: 'MENTOR' as const,
      title,
      situationText: 'Bir durumla karşılaşıyorsun, ne yaparsın?',
      learningGoal: 'Bir şey öğren.',
      choices: [
        { key: 'a', label: 'Evet', outcome: 'correct' as const, feedback: 'İyi.' },
        { key: 'b', label: 'Hayır', outcome: 'wrong' as const, feedback: 'Olmadı.' },
      ],
    });
    const stageA1 = await http.post('/api/admin/learning-journey/stages').set(tenantHeaders(tenantA.id, tokenA)).send(stageBody('A-1')).expect(201);
    const stageA2 = await http.post('/api/admin/learning-journey/stages').set(tenantHeaders(tenantA.id, tokenA)).send(stageBody('A-2')).expect(201);
    const orderBefore = (await testPrisma.learningStage.findUnique({ where: { id: stageA1.body.id } }))?.order;

    const httpB = agent();
    const { accessToken: tokenB } = await loginAs(httpB, adminB.email, adminB.rawPassword);
    // Ters sıra gönderilir: eğer sahiplik kontrolü atlanıp uygulansaydı stageA1'in
    // order'ı DEĞİŞİRDİ (0→1) — testin ayırt ediciliği için kasıtlı.
    await httpB
      .post('/api/admin/learning-journey/stages/reorder')
      .set(tenantHeaders(tenantB.id, tokenB))
      .send({ order: [stageA2.body.id, stageA1.body.id] })
      .expect(403);

    const orderAfter = (await testPrisma.learningStage.findUnique({ where: { id: stageA1.body.id } }))?.order;
    expect(orderAfter).toBe(orderBefore);
  });
});

// ─── AJ16-11/12: GET /api/learning-journey/status + POST /complete ──────────
// learningJourneyController.ts — requireRole('MENTOR','MENTI'); kimlik req.auth.userId'den
// (öz-kaynak, IDOR yüzeyi yok). Yalnız a/b eksik.
describe('AJ16-11/12: GET /api/learning-journey/status + POST /complete', () => {
  let http: TestAgent;
  let tenant: Tenant;
  let admin: SeededUser;

  beforeEach(async () => {
    await cleanDb();
    http = agent();
    tenant = await createTenant();
    admin = await createAdminUser(tenant.id);
  });

  it('status (a) oturumsuz → 401; (b) ADMIN rolü → 403 (yolculuk oyuncu-yalnız)', async () => {
    await http.get('/api/learning-journey/status').set(tenantHeaders(tenant.id)).expect(401);
    const { accessToken } = await loginAs(http, admin.email, admin.rawPassword);
    await http.get('/api/learning-journey/status').set(tenantHeaders(tenant.id, accessToken)).expect(403);
  });

  it('complete (a) oturumsuz → 401; (b) ADMIN rolü → 403', async () => {
    await http.post('/api/learning-journey/complete').set(tenantHeaders(tenant.id)).expect(401);
    const { accessToken } = await loginAs(http, admin.email, admin.rawPassword);
    await http.post('/api/learning-journey/complete').set(tenantHeaders(tenant.id, accessToken)).expect(403);
  });
});

// ─── AJ16-13: POST /api/learning-journey/stages/:stageId/select ────────────
// learningJourney.service.ts:resolveChoice → OR:[{tenantId:null},{tenantId}] filtresi
// dışındaki (başka tenant'ın özel) aşama bulunamaz → jenerik 404 (bilgi sızmaz).
describe('AJ16-13: POST /api/learning-journey/stages/:stageId/select', () => {
  let http: TestAgent;
  let tenantA: Tenant;
  let tenantB: Tenant;
  let stageIdA: string;

  beforeEach(async () => {
    await cleanDb();
    http = agent();
    tenantA = await createTenant();
    tenantB = await createTenant();
    const adminA = await createAdminUser(tenantA.id);
    const { accessToken: tokenA } = await loginAs(http, adminA.email, adminA.rawPassword);
    const created = await http
      .post('/api/admin/learning-journey/stages')
      .set(tenantHeaders(tenantA.id, tokenA))
      .send({
        audience: 'MENTI',
        title: 'AJ16 A-özel seçim aşaması',
        situationText: 'Bir durumla karşılaşıyorsun, ne yaparsın?',
        learningGoal: 'Bir şey öğren.',
        choices: [
          { key: 'a', label: 'Evet', outcome: 'correct', feedback: 'İyi.' },
          { key: 'b', label: 'Hayır', outcome: 'wrong', feedback: 'Olmadı.' },
        ],
      })
      .expect(201);
    stageIdA = created.body.id as string;
  });

  it('(a) oturumsuz → 401', async () => {
    await http.post(`/api/learning-journey/stages/${stageIdA}/select`).set(tenantHeaders(tenantB.id)).send({ choiceKey: 'a' }).expect(401);
  });

  it('(b) ADMIN rolü → 403', async () => {
    const admin = await createAdminUser(tenantB.id);
    const { accessToken } = await loginAs(http, admin.email, admin.rawPassword);
    await http.post(`/api/learning-journey/stages/${stageIdA}/select`).set(tenantHeaders(tenantB.id, accessToken)).send({ choiceKey: 'a' }).expect(403);
  });

  it('(c) B kurumunun mentisi A\'nın özel aşamasını seçemez → 404, bilgi sızmaz', async () => {
    const mentiB = await createMenti(tenantB.id);
    const { accessToken } = await loginAs(http, mentiB.email, mentiB.rawPassword);
    const res = await http
      .post(`/api/learning-journey/stages/${stageIdA}/select`)
      .set(tenantHeaders(tenantB.id, accessToken))
      .send({ choiceKey: 'a' })
      .expect(404);
    expect(res.body.error).toBe('SECIM_BULUNAMADI');
  });
});

// ─── AJ16-14: GET /api/feedback-logs/combination-scores ─────────────────────
// feedbackLogController.ts:getCombinationScores → prisma.matchCombinationScore
// tenantId ile filtrelenir. Router ana test app'e mount edilmemiş → minimal app.
describe('AJ16-14: GET /api/feedback-logs/combination-scores', () => {
  let http: ReturnType<typeof mountedApp>;
  let tenantA: Tenant;
  let tenantB: Tenant;
  let adminB: SeededUser;

  beforeEach(async () => {
    await cleanDb();
    http = mountedApp('/api/feedback-logs', feedbackLogRoutes);
    tenantA = await createTenant();
    tenantB = await createTenant();
    adminB = await createAdminUser(tenantB.id);
    await testPrisma.matchCombinationScore.create({
      data: { tenantId: tenantA.id, discCombination: 'D-I', score: 42 },
    });
  });

  it('(a) oturumsuz → 401', async () => {
    await http.get('/api/feedback-logs/combination-scores').set(tenantHeaders(tenantB.id)).expect(401);
  });

  it('(b) MENTOR rolü → 403 (yalnız ADMIN)', async () => {
    const mentor = await createMentor(tenantB.id);
    await http.get('/api/feedback-logs/combination-scores').set(tenantHeaders(tenantB.id, tokenFor(mentor))).expect(403);
  });

  it('(c) B kurumunun yöneticisi A kurumunun kombinasyon skorunu GÖRMEZ', async () => {
    const res = await http.get('/api/feedback-logs/combination-scores').set(tenantHeaders(tenantB.id, tokenFor(adminB))).expect(200);
    expect(res.body.items).toHaveLength(0);
  });
});

// ─── AJ16-15/16: GET + POST /api/clubs ──────────────────────────────────────
// clubController.ts:listClubs/createClub → tenantId ile filtrelenir/yazılır.
// Router ana test app'e mount edilmemiş → minimal app (aj04'teki gibi).
describe('AJ16-15/16: GET + POST /api/clubs', () => {
  let http: ReturnType<typeof mountedApp>;
  let tenantA: Tenant;
  let tenantB: Tenant;
  let adminB: SeededUser;

  beforeEach(async () => {
    await cleanDb();
    http = mountedApp('/api/clubs', clubRoutes);
    tenantA = await createTenant();
    tenantB = await createTenant();
    adminB = await createAdminUser(tenantB.id);
    await testPrisma.club.create({
      data: { tenantId: tenantA.id, name: 'A Kulübü', slug: 'a-kulubu', type: 'AKADEMIK' },
    });
  });

  it('GET (a) oturumsuz → 401', async () => {
    await http.get('/api/clubs').set(tenantHeaders(tenantB.id)).expect(401);
  });

  it('GET (c) B kurumunun listesinde A kurumunun kulübü GÖRÜNMEZ', async () => {
    const res = await http.get('/api/clubs').set(tenantHeaders(tenantB.id, tokenFor(adminB))).expect(200);
    expect(res.body.total).toBe(0);
    expect(res.body.items).toHaveLength(0);
  });

  it('POST (a) oturumsuz → 401; kulüp oluşmaz', async () => {
    await http.post('/api/clubs').set(tenantHeaders(tenantB.id)).send({ name: 'Yeni', slug: 'yeni', type: 'SOSYAL' }).expect(401);
    expect(await testPrisma.club.count({ where: { tenantId: tenantB.id } })).toBe(0);
  });

  it('POST (b) MENTOR rolü → 403; kulüp oluşmaz', async () => {
    const mentor = await createMentor(tenantB.id);
    await http
      .post('/api/clubs')
      .set(tenantHeaders(tenantB.id, tokenFor(mentor)))
      .send({ name: 'Yeni', slug: 'yeni', type: 'SOSYAL' })
      .expect(403);
    expect(await testPrisma.club.count({ where: { tenantId: tenantB.id } })).toBe(0);
  });
});

// ─── AJ16-17/18: GET + POST /api/job-listings ───────────────────────────────
// jobListingController.ts:listJobListings/createJobListing → tenantId ile
// filtrelenir/yazılır. Router ana test app'e mount edilmemiş → minimal app.
describe('AJ16-17/18: GET + POST /api/job-listings', () => {
  let http: ReturnType<typeof mountedApp>;
  let tenantA: Tenant;
  let tenantB: Tenant;
  let adminB: SeededUser;

  beforeEach(async () => {
    await cleanDb();
    http = mountedApp('/api/job-listings', jobListingRoutes);
    tenantA = await createTenant();
    tenantB = await createTenant();
    adminB = await createAdminUser(tenantB.id);
    await testPrisma.jobListing.create({
      data: { tenantId: tenantA.id, title: 'A İlanı', description: 'A kurumunun ilanı — sızmamalı.' },
    });
  });

  it('GET (a) oturumsuz → 401', async () => {
    await http.get('/api/job-listings').set(tenantHeaders(tenantB.id)).expect(401);
  });

  it('GET (c) B kurumunun listesinde A kurumunun ilanı GÖRÜNMEZ', async () => {
    const res = await http.get('/api/job-listings').set(tenantHeaders(tenantB.id, tokenFor(adminB))).expect(200);
    expect(res.body.total).toBe(0);
    expect(res.body.items).toHaveLength(0);
  });

  it('POST (a) oturumsuz → 401; ilan oluşmaz', async () => {
    await http.post('/api/job-listings').set(tenantHeaders(tenantB.id)).send({ title: 'Yeni', description: 'Yeni ilan açıklaması.' }).expect(401);
    expect(await testPrisma.jobListing.count({ where: { tenantId: tenantB.id } })).toBe(0);
  });

  it('POST (b) MENTOR rolü → 403; ilan oluşmaz', async () => {
    const mentor = await createMentor(tenantB.id);
    await http
      .post('/api/job-listings')
      .set(tenantHeaders(tenantB.id, tokenFor(mentor)))
      .send({ title: 'Yeni', description: 'Yeni ilan açıklaması.' })
      .expect(403);
    expect(await testPrisma.jobListing.count({ where: { tenantId: tenantB.id } })).toBe(0);
  });
});

// ─── AJ16-19/20: GET /api/conversations + /api/conversations/unread-count ───
// conversationController.ts — requireAuth() yalnız; kimlik req.auth.userId'den (katılımcı
// bazlı sorgu — tenant-çapraz IDOR yüzeyi conversation.test.ts'te zaten test edilmiş),
// yalnız oturumsuz (a) hiç test edilmemişti.
describe('AJ16-19/20: GET /api/conversations + /unread-count (a)', () => {
  it('oturumsuz → 401 (liste + sayaç)', async () => {
    await cleanDb();
    const http = agent();
    const tenant = await createTenant();
    await http.get('/api/conversations').set(tenantHeaders(tenant.id)).expect(401);
    await http.get('/api/conversations/unread-count').set(tenantHeaders(tenant.id)).expect(401);
  });
});
