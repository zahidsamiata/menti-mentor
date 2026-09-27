/**
 * AJ-04 — K5-Y3'ün devamı: kurum izolasyonu / IDOR negatif testleri.
 *
 * Kaynak: docs/raporlar/kesif/negatif-test-boslugu-2026-09-26.md — öncelik listesindeki ilk 10 uç
 * `y3-yetki-kurum-izolasyonu.test.ts`'te (K5-Y3, PR #169) kapatıldı. Bu dosya raporun "Ek not"
 * kısmındaki 5 uç + "yüksek risk kümesi"nden sonraki 15 uç için AYNI negatif test desenini uygular:
 *   (a) oturumsuz → 401
 *   (b) yanlış rol → 403
 *   (c) BAŞKA KURUMUN kaynağı → 403/404 VE kaynak değişmez
 *   (d) aynı kurumda başkasının kaynağı (IDOR) → 403/404 VE kaynak değişmez
 * Yalnız uygulanabilen alt-testler yazılır (bazı uçlarda a/b/c/d zaten başka dosyada test edilmiş —
 * orada tekrar edilmez, yalnız eksik olan eklenir). Beklenen kodlar mevcut kod davranışından
 * alınmıştır (tahmin değil) — her blokta ilgili controller dosyası/satırı yorumda belirtilir.
 * Kaynak koda dokunulmadı; yalnız test eklendi.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import supertest from 'supertest';
import express from 'express';
import { agent, tenantHeaders, type TestAgent } from './helpers/request.js';
import { cleanDb, testPrisma } from './helpers/db.js';
import { createTenant, createAdminUser, createMentor, createMenti } from './helpers/factories.js';
import { signToken } from '../src/middleware/jwtAuth.js';
import clubRoutes from '../src/routes/clubRoutes.js';
import jobListingRoutes from '../src/routes/jobListingRoutes.js';
import { notFoundHandler, globalErrorHandler } from '../src/middleware/errorHandler.js';
import type { User } from '@prisma/client';

type SeededUser = Awaited<ReturnType<typeof createMenti>>;

function tokenFor(u: Pick<User, 'id' | 'tenantId' | 'role' | 'fullName'>): string {
  return signToken({ sub: u.id, tenantId: u.tenantId, role: u.role, fullName: u.fullName });
}

/** İstek sahibinin kendi kurumu başlığı + kendi token'ı. */
function authAs(u: SeededUser): Record<string, string> {
  return tenantHeaders(u.tenantId, tokenFor(u));
}

/** Yalnız Authorization header — `authenticateTenantAdmin` tabanlı ctrl-inline uçlar için
 * (bu uçlar X-Tenant-Id header'ı KULLANMAZ, kurum kimliği JWT'nin tenantId'sinden gelir). */
function bearerOnly(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

// clubRoutes/jobListingRoutes ana test app'e (tests/helpers/request.ts) MOUNT EDİLMEMİŞ
// (rapor notu) — feedbacklog-identity.test.ts'teki gibi minimal özel app.
function createClubTestApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/clubs', clubRoutes);
  app.use(notFoundHandler);
  app.use(globalErrorHandler);
  return app;
}

function createJobListingTestApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/job-listings', jobListingRoutes);
  app.use(notFoundHandler);
  app.use(globalErrorHandler);
  return app;
}

// ─── Ortak kurgu: iki kurum ──────────────────────────────────────────────────
let http: TestAgent;
let tenantA: string;
let tenantB: string;
let mentorA: SeededUser;
let mentorA2: SeededUser;
let mentiA: SeededUser;
let adminA: SeededUser;
let adminB: SeededUser;

beforeEach(async () => {
  await cleanDb();
  http = agent();
  tenantA = (await createTenant()).id;
  tenantB = (await createTenant()).id;
  mentorA  = await createMentor(tenantA);
  mentorA2 = await createMentor(tenantA);
  mentiA   = await createMenti(tenantA);
  adminA   = await createAdminUser(tenantA);
  adminB   = await createAdminUser(tenantB);
});

// ─── AJ4-1: GET /api/clubs/:id + GET /api/clubs/:id/members ─────────────────
// clubController.ts:getClub / listClubMembers — her ikisi de tenantId ile filtrelenmiş
// findFirst kullanır (üye görünürlüğü tenant-geneli tasarım — d/IDOR yok, herkes kendi
// kurumunun kulübünü/üyelerini görebilir; kurum-dışı 404).
describe('AJ4-1: GET /api/clubs/:id ve /:id/members', () => {
  let clubHttp: TestAgent;
  let clubId: string;

  beforeEach(async () => {
    clubHttp = supertest.agent(createClubTestApp());
    const club = await testPrisma.club.create({
      data: { tenantId: tenantA, name: 'AJ4 Kulüp', slug: 'aj4-kulup', type: 'AKADEMIK' },
    });
    clubId = club.id;
    await testPrisma.clubMembership.create({
      data: { tenantId: tenantA, clubId, userId: mentorA.id, role: 'UYE' },
    });
  });

  it('(a) oturumsuz → 401 (detay + üyeler)', async () => {
    await clubHttp.get(`/api/clubs/${clubId}`).set(tenantHeaders(tenantA)).expect(401);
    await clubHttp.get(`/api/clubs/${clubId}/members`).set(tenantHeaders(tenantA)).expect(401);
  });

  it('(c) başka kurumun yöneticisi → 404, kulüp/üye verisi dönmez', async () => {
    const res1 = await clubHttp.get(`/api/clubs/${clubId}`).set(authAs(adminB)).expect(404);
    expect(res1.body).not.toHaveProperty('name');
    const res2 = await clubHttp.get(`/api/clubs/${clubId}/members`).set(authAs(adminB)).expect(404);
    expect(JSON.stringify(res2.body)).not.toContain(mentorA.fullName);
  });
});

// ─── AJ4-2: GET + PATCH /api/job-listings/:id ────────────────────────────────
// jobListingController.ts:getJobListing / updateJobListing — tenantId filtreli findFirst.
describe('AJ4-2: GET + PATCH /api/job-listings/:id', () => {
  let jobHttp: TestAgent;
  let listingId: string;

  beforeEach(async () => {
    jobHttp = supertest.agent(createJobListingTestApp());
    const listing = await testPrisma.jobListing.create({
      data: { tenantId: tenantA, title: 'AJ4 İlan', description: 'AJ4 açıklama gizli-metin' },
    });
    listingId = listing.id;
  });

  it('(a) oturumsuz → 401 (GET + PATCH)', async () => {
    await jobHttp.get(`/api/job-listings/${listingId}`).set(tenantHeaders(tenantA)).expect(401);
    await jobHttp
      .patch(`/api/job-listings/${listingId}`)
      .set(tenantHeaders(tenantA))
      .send({ title: 'x' })
      .expect(401);
  });

  it('(c) başka kurumun yöneticisi GET yapamaz → 404, içerik dönmez', async () => {
    const res = await jobHttp.get(`/api/job-listings/${listingId}`).set(authAs(adminB)).expect(404);
    expect(JSON.stringify(res.body)).not.toContain('gizli-metin');
  });

  it('(c) başka kurumun yöneticisi PATCH yapamaz → 404; ilan değişmez', async () => {
    const before = await testPrisma.jobListing.findUnique({ where: { id: listingId } });
    await jobHttp
      .patch(`/api/job-listings/${listingId}`)
      .set(authAs(adminB))
      .send({ title: 'Ele Gecirildi' })
      .expect(404);
    const after = await testPrisma.jobListing.findUnique({ where: { id: listingId } });
    expect(after?.title).toBe(before?.title);
  });
});

// ─── AJ4-3: POST /api/users/:id/report ──────────────────────────────────────
// reportController.ts:createReport — hedef `findFirst({ id, tenantId })`.
describe('AJ4-3: POST /api/users/:id/report', () => {
  const payload = { reason: 'HARASSMENT', description: 'aj4-sikayet-metni' };

  it('(a) oturumsuz → 401; kayıt oluşmaz', async () => {
    await http.post(`/api/users/${mentiA.id}/report`).set(tenantHeaders(tenantA)).send(payload).expect(401);
    expect(await testPrisma.userReport.count()).toBe(0);
  });

  it('(c) başka kurumun kullanıcısını şikayet edemez → 404; kayıt oluşmaz', async () => {
    await http.post(`/api/users/${mentiA.id}/report`).set(authAs(adminB)).send(payload).expect(404);
    expect(await testPrisma.userReport.count()).toBe(0);
  });
});

// ─── AJ4-4: POST /api/meetings/:meetingId/check-in ──────────────────────────
// meetingCheckInController.ts:submitCheckIn — meeting `findFirst({ id, tenantId })`,
// ardından tarafı olmayan kullanıcı (d) 403; kurum-dışı (c) 404.
describe('AJ4-4: POST /api/meetings/:meetingId/check-in', () => {
  let meetingId: string;
  const payload = { overallRating: 5, progressRating: 5, continueIntent: 'EVET' };

  beforeEach(async () => {
    const hour = 3_600_000;
    const meeting = await testPrisma.meeting.create({
      data: {
        tenantId: tenantA, mentorUserId: mentorA.id, mentiUserId: mentiA.id, status: 'COMPLETED',
        startsAt: new Date(Date.now() - 2 * hour), endsAt: new Date(Date.now() - hour),
      },
    });
    meetingId = meeting.id;
  });

  const checkInCount = () => testPrisma.meetingCheckIn.count({ where: { meetingId } });

  it('(a) oturumsuz → 401; check-in oluşmaz', async () => {
    await http.post(`/api/meetings/${meetingId}/check-in`).set(tenantHeaders(tenantA)).send(payload).expect(401);
    expect(await checkInCount()).toBe(0);
  });

  it('(c) başka kurumun yöneticisi → 404; check-in oluşmaz', async () => {
    await http.post(`/api/meetings/${meetingId}/check-in`).set(authAs(adminB)).send(payload).expect(404);
    expect(await checkInCount()).toBe(0);
  });

  it('(d) aynı kurumda taraf olmayan mentör → 403; check-in oluşmaz', async () => {
    await http.post(`/api/meetings/${meetingId}/check-in`).set(authAs(mentorA2)).send(payload).expect(403);
    expect(await checkInCount()).toBe(0);
  });
});

// ─── AJ4-5: GET /api/meetings/:meetingId/feedback (c) ───────────────────────
// (d) meeting-feedback-ownership.test.ts:118'de zaten test edilmiş — burada yalnız (a)/(c) eklenir.
describe('AJ4-5: GET /api/meetings/:meetingId/feedback (a + c)', () => {
  let meetingId: string;

  beforeEach(async () => {
    const hour = 3_600_000;
    const meeting = await testPrisma.meeting.create({
      data: {
        tenantId: tenantA, mentorUserId: mentorA.id, mentiUserId: mentiA.id, status: 'COMPLETED',
        startsAt: new Date(Date.now() - 2 * hour), endsAt: new Date(Date.now() - hour), hasFeedback: true,
      },
    });
    meetingId = meeting.id;
    await testPrisma.feedback.create({
      data: {
        tenantId: tenantA, meetingId, mentorId: mentorA.id, mentiId: mentiA.id,
        preparednessScore: 4, proactivityScore: 4, engagementScore: 4, goalClarityScore: 4,
        guidanceScore: 4, resourceSharingScore: 4, trustScore: 4,
        keyLearnings: 'aj4-gizli-degerlendirme',
      },
    });
  });

  it('(a) oturumsuz → 401', async () => {
    await http.get(`/api/meetings/${meetingId}/feedback`).set(tenantHeaders(tenantA)).expect(401);
  });

  it('(c) başka kurumun yöneticisi → 404, değerlendirme dönmez', async () => {
    const res = await http.get(`/api/meetings/${meetingId}/feedback`).set(authAs(adminB)).expect(404);
    expect(JSON.stringify(res.body)).not.toContain('aj4-gizli-degerlendirme');
  });
});

// ─── AJ4-6: POST /api/meetings/:meetingId/approve + /reject ─────────────────
// meetingController.ts — approve/reject `findFirst({ id, tenantId, mentorUserId: userId, status })`
// hem kurum-dışı (c) hem aynı kurumda başka mentör (d) AYNI generic 404'e düşer (sorgu eşleşmez).
// NOT: reject ucunun (b)/(d) alt-testleri `meeting-reject-notify.test.ts`'te ZATEN var (rapor
// heuristiğinin kaçırdığı bir örnek — Y3 dosyasındaki uyarıyla tutarlı); burada TEKRARLANMAZ,
// yalnız o dosyada eksik olan (a)/(c) eklenir. approve ucunda HİÇ negatif test yoktu → tam set.
describe('AJ4-6: POST /api/meetings/:meetingId/approve + /reject', () => {
  let meetingId: string;
  let mentorB: SeededUser;

  beforeEach(async () => {
    mentorB = await createMentor(tenantB);
    const hour = 3_600_000;
    const meeting = await testPrisma.meeting.create({
      data: {
        tenantId: tenantA, mentorUserId: mentorA.id, mentiUserId: mentiA.id, status: 'PENDING',
        startsAt: new Date(Date.now() + hour), endsAt: new Date(Date.now() + 2 * hour),
        format: 'IN_PERSON',
      },
    });
    meetingId = meeting.id;
  });

  const meetingStatus = () =>
    testPrisma.meeting.findUnique({ where: { id: meetingId }, select: { status: true } });

  for (const action of ['approve', 'reject'] as const) {
    it(`${action} (a) oturumsuz → 401; durum değişmez`, async () => {
      await http.post(`/api/meetings/${meetingId}/${action}`).set(tenantHeaders(tenantA)).expect(401);
      expect((await meetingStatus())?.status).toBe('PENDING');
    });

    it(`${action} (c) başka kurumun mentörü → 404; durum değişmez`, async () => {
      // reject controller req.body'yi doğrudan destructure eder (`const { reason } = req.body`);
      // gövde/Content-Type hiç gönderilmezse bu tenant kontrolünden ÖNCE 500 ile patlar — gerçek
      // istemci (frontend `meetings.ts:127`) her zaman `{ reason }` gövdesi gönderdiği için bu yol
      // pratikte tetiklenmez. Gerçekçi istemci gövdesiyle test edilir (approve için etkisizdir,
      // zaten `req.body ?? {}` kullanır).
      await http.post(`/api/meetings/${meetingId}/${action}`).set(authAs(mentorB)).send({}).expect(404);
      expect((await meetingStatus())?.status).toBe('PENDING');
    });
  }

  it('approve (b) ADMIN/MENTI rolü → 403; durum değişmez', async () => {
    await http.post(`/api/meetings/${meetingId}/approve`).set(authAs(adminA)).expect(403);
    await http.post(`/api/meetings/${meetingId}/approve`).set(authAs(mentiA)).expect(403);
    expect((await meetingStatus())?.status).toBe('PENDING');
  });

  it('approve (d) aynı kurumda başka mentör → 404; durum değişmez', async () => {
    await http.post(`/api/meetings/${meetingId}/approve`).set(authAs(mentorA2)).expect(404);
    expect((await meetingStatus())?.status).toBe('PENDING');
  });
});

// ─── AJ4-7: DELETE /api/meetings/orientation-lock/:userId ───────────────────
// feedbackController.ts:clearOrientationLock — hedef `findFirst({ id, tenantId, role: 'MENTI' })`.
describe('AJ4-7: DELETE /api/meetings/orientation-lock/:userId', () => {
  beforeEach(async () => {
    await testPrisma.user.update({ where: { id: mentiA.id }, data: { needsOrientation: true } });
  });

  const lockState = async () =>
    (await testPrisma.user.findUnique({ where: { id: mentiA.id }, select: { needsOrientation: true } }))
      ?.needsOrientation;

  it('(a) oturumsuz → 401; kilit değişmez', async () => {
    await http.delete(`/api/meetings/orientation-lock/${mentiA.id}`).set(tenantHeaders(tenantA)).expect(401);
    expect(await lockState()).toBe(true);
  });

  it('(c) başka kurumun yöneticisi → 404; kilit değişmez', async () => {
    await http.delete(`/api/meetings/orientation-lock/${mentiA.id}`).set(authAs(adminB)).expect(404);
    expect(await lockState()).toBe(true);
  });
});

// ─── AJ4-8: PATCH /api/tenants/:id/onboarding ───────────────────────────────
// selfServeController.ts:updateOnboarding — `authenticateTenantAdmin` + `payload.tenantId !== :id` → 403.
// Bu uçlar X-Tenant-Id header'ı KULLANMAZ (yalnız Authorization bearer).
describe('AJ4-8: PATCH /api/tenants/:id/onboarding', () => {
  it('(a) oturumsuz → 401; onboardingStep değişmez', async () => {
    const before = await testPrisma.tenant.findUnique({ where: { id: tenantA } });
    await http.patch(`/api/tenants/${tenantA}/onboarding`).send({ onboardingStep: 'TEMPLATE' }).expect(401);
    const after = await testPrisma.tenant.findUnique({ where: { id: tenantA } });
    expect(after?.onboardingStep).toBe(before?.onboardingStep);
  });

  it('(c) başka kurumun yöneticisi → 403; onboardingStep değişmez', async () => {
    const before = await testPrisma.tenant.findUnique({ where: { id: tenantA } });
    await http
      .patch(`/api/tenants/${tenantA}/onboarding`)
      .set(bearerOnly(tokenFor(adminB)))
      .send({ onboardingStep: 'TEMPLATE' })
      .expect(403);
    const after = await testPrisma.tenant.findUnique({ where: { id: tenantA } });
    expect(after?.onboardingStep).toBe(before?.onboardingStep);
  });
});

// ─── AJ4-9: POST /api/tenants/:id/invitations (c) ───────────────────────────
// selfServeController.ts:createInvitation — `payload.tenantId !== :id` → 403 (b zaten test edilmiş).
describe('AJ4-9: POST /api/tenants/:id/invitations (c)', () => {
  it('başka kurumun yöneticisi davet linki oluşturamaz → 403', async () => {
    await http
      .post(`/api/tenants/${tenantA}/invitations`)
      .set(bearerOnly(tokenFor(adminB)))
      .send({ role: 'MENTOR' })
      .expect(403);
  });
});

// ─── AJ4-10: GET + PUT /api/tenants/:id/invitation-templates (c) ────────────
// selfServeController.ts:getInvitationTemplates / saveInvitationTemplate — aynı `payload.tenantId
// !== :id` deseni. (b) zaten tenant-admin-inactive-membership.test.ts'te test edilmiş.
describe('AJ4-10: GET + PUT /api/tenants/:id/invitation-templates (c)', () => {
  it('GET: başka kurumun yöneticisi şablonları göremez → 403', async () => {
    await http
      .get(`/api/tenants/${tenantA}/invitation-templates`)
      .set(bearerOnly(tokenFor(adminB)))
      .expect(403);
  });

  it('PUT: başka kurumun yöneticisi şablon yazamaz → 403; şablon oluşmaz', async () => {
    await http
      .put(`/api/tenants/${tenantA}/invitation-templates`)
      .set(bearerOnly(tokenFor(adminB)))
      .send({ role: 'MENTOR', format: 'EMAIL', content: 'AJ4 saldirgan sablon icerigi' })
      .expect(403);
    expect(await testPrisma.invitationTemplate.count({ where: { tenantId: tenantA } })).toBe(0);
  });
});

// ─── AJ4-11: POST /api/tenants/:id/block-pair (c) ───────────────────────────
// adminSettingsController.ts:blockPair — aynı desen. (b) tenant-admin-inactive-membership'te var.
describe('AJ4-11: POST /api/tenants/:id/block-pair (c)', () => {
  it('başka kurumun yöneticisi bu kurumda çift engelleyemez → 403; liste değişmez', async () => {
    await http
      .post(`/api/tenants/${tenantA}/block-pair`)
      .set(bearerOnly(tokenFor(adminB)))
      .send({ fromUserId: mentorA.id, toUserId: mentiA.id })
      .expect(403);
    const after = await testPrisma.tenant.findUnique({ where: { id: tenantA } });
    expect(Array.isArray(after?.blockedPairs) ? after?.blockedPairs : []).toHaveLength(0);
  });
});

// ─── AJ4-12: PATCH + DELETE /api/questions/:questionId ──────────────────────
// questionController.ts:updateQuestion / deleteQuestion — tenant'a özgü soru; kurum-dışı → 403
// (global soru kilidiyle AYNI kod yolu, 404 DEĞİL — question.tenantId !== req.tenant.tenantId).
describe('AJ4-12: PATCH + DELETE /api/questions/:questionId', () => {
  let questionId: string;

  beforeEach(async () => {
    const q = await testPrisma.question.create({
      data: { tenantId: tenantA, text: 'AJ4 tenant sorusu', discDimension: 'D', order: 1 },
    });
    questionId = q.id;
  });

  it('PATCH (a) oturumsuz → 401; DELETE (a) oturumsuz → 401', async () => {
    await http.patch(`/api/questions/${questionId}`).set(tenantHeaders(tenantA)).send({ text: 'x' }).expect(401);
    await http.delete(`/api/questions/${questionId}`).set(tenantHeaders(tenantA)).expect(401);
  });

  it('PATCH (c) başka kurumun yöneticisi → 403; soru değişmez', async () => {
    const before = await testPrisma.question.findUnique({ where: { id: questionId } });
    await http
      .patch(`/api/questions/${questionId}`)
      .set(authAs(adminB))
      .send({ text: 'Ele Gecirildi' })
      .expect(403);
    const after = await testPrisma.question.findUnique({ where: { id: questionId } });
    expect(after?.text).toBe(before?.text);
  });

  it('DELETE (c) başka kurumun yöneticisi → 403; soru silinmez', async () => {
    await http.delete(`/api/questions/${questionId}`).set(authAs(adminB)).expect(403);
    expect(await testPrisma.question.findUnique({ where: { id: questionId } })).not.toBeNull();
  });
});

// ─── AJ4-13: DELETE /api/questions/:questionId/hide (c) ─────────────────────
// questionController.ts:unhideGlobalQuestion — `deleteMany({ questionId, tenantId: req.tenant.tenantId })`.
// Saldırganın KENDİ tenantId'siyle silme denemesi eşleşmez (0 satır) → 204 döner AMA kurbanın
// gizleme kaydı DEĞİŞMEZ. Bu, yanlış-negatif riskini gösterir: durum kodu "başarı" görünür ama
// veri sızmaz/bozulmaz — test bunu doğrular.
describe('AJ4-13: DELETE /api/questions/:questionId/hide (c) — kurbanın kaydı değişmez', () => {
  let questionId: string;

  beforeEach(async () => {
    const q = await testPrisma.question.create({
      data: { tenantId: null, text: 'AJ4 global soru', discDimension: 'I', order: 1, category: 'STK_CUSTOM' },
    });
    questionId = q.id;
    await testPrisma.questionHide.create({ data: { questionId, tenantId: tenantA } });
  });

  it('başka kurumun yöneticisi 204 alır ama kurbanın gizleme kaydı silinmez', async () => {
    await http.delete(`/api/questions/${questionId}/hide`).set(authAs(adminB)).expect(204);
    const stillHidden = await testPrisma.questionHide.findUnique({
      where: { questionId_tenantId: { questionId, tenantId: tenantA } },
    });
    expect(stillHidden).not.toBeNull();
  });
});

// ─── AJ4-14: PATCH /api/users/:id/self-profile (c) ──────────────────────────
// userController.ts:patchSelfProfile — ADMIN bypass'ı ownership kontrolünü geçer ama ikinci
// sorgu (`findFirst({ id, tenantId: req.tenant.tenantId })`) kurum-dışı hedefi bulamaz → 404.
describe('AJ4-14: PATCH /api/users/:id/self-profile (c)', () => {
  it('başka kurumun yöneticisi hedefin selfProfile\'ını değiştiremez → 404; veri değişmez', async () => {
    const before = await testPrisma.user.findUnique({ where: { id: mentiA.id }, select: { selfProfile: true } });
    await http
      .patch(`/api/users/${mentiA.id}/self-profile`)
      .set(authAs(adminB))
      .send({ hobi: 'ele-gecirildi' })
      .expect(404);
    const after = await testPrisma.user.findUnique({ where: { id: mentiA.id }, select: { selfProfile: true } });
    expect(after?.selfProfile).toEqual(before?.selfProfile);
  });
});

// ─── AJ4-15: GET /api/mentors/:mentorId/candidates (d) ──────────────────────
// matchingController.ts:getRankedMentisForMentor — inline `isOwner` kontrolü (route'ta
// requireSelfOrAdmin YOK, kontrol controller içinde). (c) matching-ranking.test.ts'te zaten var.
describe('AJ4-15: GET /api/mentors/:mentorId/candidates (d)', () => {
  it('aynı kurumda başka mentör, mentörA\'nın aday listesini göremez → 403', async () => {
    const res = await http.get(`/api/mentors/${mentorA.id}/candidates`).set(authAs(mentorA2)).expect(403);
    expect(res.body).not.toHaveProperty('items');
  });
});
