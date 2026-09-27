/**
 * K5-Y3 — yetki ve kurum izolasyonu gerektiren 10 uç için NEGATİF testler.
 *
 * Her uç için (uygulanabildiği kadar):
 *   (a) oturumsuz istek → 401
 *   (b) yanlış rol → 403
 *   (c) BAŞKA KURUMUN kaynağı (saldırgan kendi kurum başlığı + kendi token'ı ile, hedef ID başka
 *       kurumda) → 403/404 VE kaynak değişmez (yazma uçlarında DB'den doğrulanır)
 *   (d) aynı kurumda başkasının kaynağı (IDOR) → 403/404 VE kaynak değişmez
 *
 * Beklenen kodlar mevcut kod davranışından alınmıştır (tahmin değil):
 *   - requireAuth / requireRole / requireSelfOrAdmin → 401 / 403 (`middleware/authorize.ts`)
 *   - kontrolcüdeki `findFirst({ id, tenantId })` bulamazsa → 404
 *   - gdprService kullanıcıyı bulamazsa `GdprUserNotFoundError` fırlatır → kontrolcü 404
 *     (K5-Y3b: önceden globalErrorHandler 500 dönüyordu).
 *
 * Genel "başka kurumun X-Tenant-Id başlığı → 403" ara katman davranışı uçtan bağımsızdır ve
 * `hardening.test.ts` / `tenant-suspension.test.ts`'te test edilir; burada UCA ÖZGÜ kaynak
 * izolasyonu doğrulanır.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import supertest from 'supertest';
import express from 'express';
import { agent, tenantHeaders, type TestAgent } from './helpers/request.js';
import { cleanDb, testPrisma } from './helpers/db.js';
import { createTenant, createAdminUser, createMentor, createMenti } from './helpers/factories.js';
import { signToken } from '../src/middleware/jwtAuth.js';
import feedbackLogRoutes from '../src/routes/feedbackLogRoutes.js';
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

// Ortak createTestApp feedback-logs rotasını bağlamıyor → feedbacklog-identity.test.ts'teki gibi minimal uygulama.
function createFeedbackLogTestApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/feedback-logs', feedbackLogRoutes);
  app.use(notFoundHandler);
  app.use(globalErrorHandler);
  return app;
}

// ─── Ortak kurgu: iki kurum ──────────────────────────────────────────────────
// Kurum A: kaynak sahibi (mentorA, mentorA2, mentiA, mentiA2)
// Kurum B: saldırgan kurum (adminB)
let http: TestAgent;
let tenantA: string;
let mentorA: SeededUser;
let mentorA2: SeededUser;
let mentiA: SeededUser;
let mentiA2: SeededUser;
let adminB: SeededUser;

beforeEach(async () => {
  await cleanDb();
  http = agent();
  tenantA = (await createTenant()).id;
  const tenantB = (await createTenant()).id;
  mentorA  = await createMentor(tenantA);
  mentorA2 = await createMentor(tenantA);
  mentiA   = await createMenti(tenantA);
  mentiA2  = await createMenti(tenantA);
  adminB   = await createAdminUser(tenantB);
});

/** Kullanıcının izolasyon testinde değişmemesi gereken alanları. */
async function userSnapshot(id: string) {
  return testPrisma.user.findUnique({
    where: { id },
    select: { fullName: true, email: true, isActive: true, role: true, bioSummary: true, discType: true },
  });
}

// ─── 1. GET /users/:id/export ────────────────────────────────────────────────
describe('Y3-1: GET /api/users/:id/export', () => {
  const url = (id: string) => `/api/users/${id}/export`;

  it('(a) oturumsuz → 401', async () => {
    await http.get(url(mentiA.id)).set(tenantHeaders(tenantA)).expect(401);
  });

  it('(c) başka kurumun yöneticisi veriyi alamaz; profil/e-posta dönmez', async () => {
    // K5-Y3b: kurum dışı hedef → jenerik 404 (önceden 500).
    const res = await http.get(url(mentiA.id)).set(authAs(adminB)).expect(404);
    expect(res.body.error).toBe('NOT_FOUND');
    expect(res.body).not.toHaveProperty('profile');
    expect(JSON.stringify(res.body)).not.toContain(mentiA.email);
  });

  it('(d) aynı kurumdaki başka menti → 403, veri dönmez', async () => {
    const res = await http.get(url(mentiA.id)).set(authAs(mentiA2)).expect(403);
    expect(res.body).not.toHaveProperty('profile');
  });

  it('(d) aynı kurumdaki mentör başkasının verisini alamaz → 403', async () => {
    const res = await http.get(url(mentiA.id)).set(authAs(mentorA)).expect(403);
    expect(res.body).not.toHaveProperty('profile');
  });
});

// ─── 2. POST /users/:id/anonymize + DELETE /users/:id/hard-delete ────────────
describe('Y3-2: KVKK anonimleştirme / hard-delete', () => {
  const cases = [
    { name: 'POST anonymize', call: (id: string) => http.post(`/api/users/${id}/anonymize`) },
    { name: 'DELETE hard-delete', call: (id: string) => http.delete(`/api/users/${id}/hard-delete`) },
  ];

  for (const c of cases) {
    it(`${c.name} (a) oturumsuz → 401; kullanıcı değişmez`, async () => {
      const before = await userSnapshot(mentiA.id);
      await c.call(mentiA.id).set(tenantHeaders(tenantA)).expect(401);
      expect(await userSnapshot(mentiA.id)).toEqual(before);
    });

    it(`${c.name} (b) aynı kurumdaki mentör/menti → 403; kullanıcı değişmez`, async () => {
      const before = await userSnapshot(mentiA.id);
      await c.call(mentiA.id).set(authAs(mentorA)).expect(403);
      await c.call(mentiA.id).set(authAs(mentiA2)).expect(403);
      expect(await userSnapshot(mentiA.id)).toEqual(before);
    });

    it(`${c.name} (c) başka kurumun yöneticisi → reddedilir; kullanıcı ANONİMLEŞMEZ`, async () => {
      const before = await userSnapshot(mentiA.id);
      // K5-Y3b: kurum dışı hedef → jenerik 404 (önceden 500).
      const res = await c.call(mentiA.id).set(authAs(adminB)).expect(404);
      expect(res.body.error).toBe('NOT_FOUND');
      const after = await userSnapshot(mentiA.id);
      expect(after).toEqual(before);
      expect(after?.isActive).toBe(true);
      expect(after?.email).toBe(mentiA.email);
    });
  }
});

// ─── 3. POST /admin/users/:id/promote-admin + demote-admin ───────────────────
describe('Y3-3: yönetici atama / düşürme', () => {
  it('promote (a) oturumsuz → 401; rol değişmez', async () => {
    await http.post(`/api/admin/users/${mentorA.id}/promote-admin`).set(tenantHeaders(tenantA)).expect(401);
    expect((await userSnapshot(mentorA.id))?.role).toBe('MENTOR');
  });

  it('promote (b)/(d) aynı kurumdaki mentör kendini veya başkasını yönetici yapamaz → 403', async () => {
    await http.post(`/api/admin/users/${mentorA.id}/promote-admin`).set(authAs(mentorA)).expect(403);
    await http.post(`/api/admin/users/${mentiA.id}/promote-admin`).set(authAs(mentorA)).expect(403);
    expect((await userSnapshot(mentorA.id))?.role).toBe('MENTOR');
    expect((await userSnapshot(mentiA.id))?.role).toBe('MENTI');
  });

  it('promote (c) başka kurumun yöneticisi → 404; rol ve üyelik rolü değişmez', async () => {
    await http.post(`/api/admin/users/${mentorA.id}/promote-admin`).set(authAs(adminB)).expect(404);
    expect((await userSnapshot(mentorA.id))?.role).toBe('MENTOR');
    const membership = await testPrisma.tenantMembership.findUnique({
      where: { userId_tenantId: { userId: mentorA.id, tenantId: tenantA } },
      select: { role: true },
    });
    expect(membership?.role).toBe('MENTOR');
    // Saldırgan kurumda da üyelik oluşmamalı
    expect(await testPrisma.tenantMembership.count({ where: { userId: mentorA.id } })).toBe(1);
  });

  it('demote (b)/(d) aynı kurumdaki mentör yöneticiyi düşüremez → 403; rol değişmez', async () => {
    const adminA2 = await createAdminUser(tenantA);
    await http.post(`/api/admin/users/${adminA2.id}/demote-admin`).set(authAs(mentorA)).expect(403);
    expect((await userSnapshot(adminA2.id))?.role).toBe('ADMIN');
  });

  it('demote (c) başka kurumun yöneticisi → 404; hedef hâlâ ADMIN, oturumu silinmez', async () => {
    const adminA2 = await createAdminUser(tenantA);
    await testPrisma.refreshToken.create({
      data: { userId: adminA2.id, token: `y3-rt-${adminA2.id}`, expiresAt: new Date(Date.now() + 86_400_000) },
    });
    await http.post(`/api/admin/users/${adminA2.id}/demote-admin`).set(authAs(adminB)).expect(404);
    expect((await userSnapshot(adminA2.id))?.role).toBe('ADMIN');
    expect(await testPrisma.refreshToken.count({ where: { userId: adminA2.id } })).toBe(1);
  });
});

// ─── 4. GET /feedback-logs/:id ───────────────────────────────────────────────
describe('Y3-4: GET /api/feedback-logs/:id', () => {
  let fl: TestAgent;
  let logId: string;

  beforeEach(async () => {
    fl = supertest.agent(createFeedbackLogTestApp());
    const log = await testPrisma.feedbackLog.create({
      data: { tenantId: tenantA, mentorId: mentorA.id, mentiId: mentiA.id, phase: 1, starRating: 4, npsScore: 9 },
    });
    logId = log.id;
  });

  it('(a) oturumsuz → 401', async () => {
    await fl.get(`/api/feedback-logs/${logId}`).set(tenantHeaders(tenantA)).expect(401);
  });

  it('(c) başka kurumun yöneticisi → 404, kayıt dönmez', async () => {
    const res = await fl.get(`/api/feedback-logs/${logId}`).set(authAs(adminB)).expect(404);
    expect(res.body).not.toHaveProperty('starRating');
  });

  it('(d) aynı kurumdaki başka mentör → 403', async () => {
    const res = await fl.get(`/api/feedback-logs/${logId}`).set(authAs(mentorA2)).expect(403);
    expect(res.body).not.toHaveProperty('starRating');
  });

  it('(d) menti (taraf olsa bile) ve başka menti → 403', async () => {
    await fl.get(`/api/feedback-logs/${logId}`).set(authAs(mentiA)).expect(403);
    await fl.get(`/api/feedback-logs/${logId}`).set(authAs(mentiA2)).expect(403);
  });
});

// ─── 5. GET /requests/:id ────────────────────────────────────────────────────
describe('Y3-5: GET /api/requests/:id', () => {
  let requestId: string;

  beforeEach(async () => {
    const r = await testPrisma.matchRequest.create({
      data: {
        tenantId: tenantA,
        requesterUserId: mentiA.id,
        targetType: 'USER',
        targetId: mentorA.id,
        requestMessage: 'y3-gizli-talep-mesaji',
      },
    });
    requestId = r.id;
  });

  it('(a) oturumsuz → 401', async () => {
    await http.get(`/api/requests/${requestId}`).set(tenantHeaders(tenantA)).expect(401);
  });

  it('(c) başka kurumun yöneticisi → 404, mesaj sızmaz', async () => {
    const res = await http.get(`/api/requests/${requestId}`).set(authAs(adminB)).expect(404);
    expect(JSON.stringify(res.body)).not.toContain('y3-gizli-talep-mesaji');
  });

  it('(d) aynı kurumda taraf olmayan menti ve mentör → 404, mesaj sızmaz', async () => {
    for (const u of [mentiA2, mentorA2]) {
      const res = await http.get(`/api/requests/${requestId}`).set(authAs(u)).expect(404);
      expect(JSON.stringify(res.body)).not.toContain('y3-gizli-talep-mesaji');
    }
  });
});

// ─── 6. GET /admin/users/:id/coaching-suggestions ────────────────────────────
describe('Y3-6: GET /api/admin/users/:id/coaching-suggestions', () => {
  const url = (id: string) => `/api/admin/users/${id}/coaching-suggestions`;

  it('(a) oturumsuz → 401', async () => {
    await http.get(url(mentiA.id)).set(tenantHeaders(tenantA)).expect(401);
  });

  it('(b)/(d) aynı kurumdaki mentör/menti → 403', async () => {
    await http.get(url(mentiA.id)).set(authAs(mentorA)).expect(403);
    await http.get(url(mentiA.id)).set(authAs(mentiA2)).expect(403);
  });

  it('(c) başka kurumun yöneticisi → 404, öneri dönmez', async () => {
    const res = await http.get(url(mentiA.id)).set(authAs(adminB)).expect(404);
    expect(res.body).not.toHaveProperty('items');
  });
});

// ─── 7. GET + PATCH /admin/reports(/:id) ─────────────────────────────────────
describe('Y3-7: kurum şikâyetleri', () => {
  let reportId: string;

  beforeEach(async () => {
    const r = await testPrisma.userReport.create({
      data: { tenantId: tenantA, reporterUserId: mentiA.id, targetUserId: mentorA.id, reason: 'OTHER', description: 'y3-sikayet' },
    });
    reportId = r.id;
  });

  async function reportState() {
    return testPrisma.userReport.findUnique({
      where: { id: reportId },
      select: { status: true, reviewNote: true, reviewedBy: true },
    });
  }

  it('GET (a) oturumsuz → 401; (b) mentör/menti → 403', async () => {
    await http.get('/api/admin/reports').set(tenantHeaders(tenantA)).expect(401);
    await http.get('/api/admin/reports').set(authAs(mentorA)).expect(403);
    await http.get('/api/admin/reports').set(authAs(mentiA)).expect(403);
  });

  it('GET (c) başka kurumun yöneticisi A kurumunun şikâyetini listede görmez', async () => {
    const res = await http.get('/api/admin/reports').set(authAs(adminB)).expect(200);
    expect(res.body.total).toBe(0);
    expect(JSON.stringify(res.body)).not.toContain(reportId);
  });

  it('PATCH (a) oturumsuz → 401; şikâyet değişmez', async () => {
    await http.patch(`/api/admin/reports/${reportId}`).set(tenantHeaders(tenantA)).send({ status: 'DISMISSED' }).expect(401);
    expect(await reportState()).toEqual({ status: 'OPEN', reviewNote: null, reviewedBy: null });
  });

  it('PATCH (b)/(d) aynı kurumdaki mentör/menti → 403; şikâyet değişmez', async () => {
    await http.patch(`/api/admin/reports/${reportId}`).set(authAs(mentorA)).send({ status: 'DISMISSED' }).expect(403);
    await http.patch(`/api/admin/reports/${reportId}`).set(authAs(mentiA2)).send({ status: 'DISMISSED' }).expect(403);
    expect(await reportState()).toEqual({ status: 'OPEN', reviewNote: null, reviewedBy: null });
  });

  it('PATCH (c) başka kurumun yöneticisi → 404; şikâyet KAPANMAZ', async () => {
    await http
      .patch(`/api/admin/reports/${reportId}`)
      .set(authAs(adminB))
      .send({ status: 'DISMISSED', note: 'y3-kapatma-girisimi' })
      .expect(404);
    expect(await reportState()).toEqual({ status: 'OPEN', reviewNote: null, reviewedBy: null });
  });
});

// ─── 8. PATCH /users/:id ─────────────────────────────────────────────────────
describe('Y3-8: PATCH /api/users/:id', () => {
  const payload = { fullName: 'Y3 Degistirildi', bioSummary: 'y3-bio', isActive: false };

  it('(a) oturumsuz → 401; kullanıcı değişmez', async () => {
    const before = await userSnapshot(mentiA.id);
    await http.patch(`/api/users/${mentiA.id}`).set(tenantHeaders(tenantA)).send(payload).expect(401);
    expect(await userSnapshot(mentiA.id)).toEqual(before);
  });

  it('(b)/(d) aynı kurumdaki mentör/menti başkasını (ve kendini) düzenleyemez → 403', async () => {
    const before = await userSnapshot(mentiA.id);
    await http.patch(`/api/users/${mentiA.id}`).set(authAs(mentorA)).send(payload).expect(403);
    await http.patch(`/api/users/${mentiA.id}`).set(authAs(mentiA2)).send(payload).expect(403);
    await http.patch(`/api/users/${mentiA.id}`).set(authAs(mentiA)).send(payload).expect(403);
    expect(await userSnapshot(mentiA.id)).toEqual(before);
  });

  it('(c) başka kurumun yöneticisi → 404; ad/bio/aktiflik değişmez', async () => {
    const before = await userSnapshot(mentiA.id);
    await http.patch(`/api/users/${mentiA.id}`).set(authAs(adminB)).send(payload).expect(404);
    const after = await userSnapshot(mentiA.id);
    expect(after).toEqual(before);
    expect(after?.isActive).toBe(true);
  });
});

// ─── 9. adaptive-test next / answer ──────────────────────────────────────────
describe('Y3-9: /api/users/:id/adaptive-test/next + answer', () => {
  let questionId: string;

  beforeEach(async () => {
    const q = await testPrisma.question.create({
      data: { tenantId: tenantA, text: 'Y3 adaptif soru', discDimension: 'D', order: 1 },
    });
    questionId = q.id;
  });

  const responseCount = () => testPrisma.userResponse.count({ where: { userId: mentiA.id } });

  it('(a) oturumsuz → 401 (next + answer); yanıt yazılmaz', async () => {
    await http.get(`/api/users/${mentiA.id}/adaptive-test/next`).set(tenantHeaders(tenantA)).expect(401);
    await http
      .post(`/api/users/${mentiA.id}/adaptive-test/answer`)
      .set(tenantHeaders(tenantA))
      .send({ questionId, value: 5 })
      .expect(401);
    expect(await responseCount()).toBe(0);
  });

  it('(c) başka kurumun yöneticisi → 404 (next + answer); yanıt yazılmaz', async () => {
    await http.get(`/api/users/${mentiA.id}/adaptive-test/next`).set(authAs(adminB)).expect(404);
    await http
      .post(`/api/users/${mentiA.id}/adaptive-test/answer`)
      .set(authAs(adminB))
      .send({ questionId, value: 5 })
      .expect(404);
    expect(await responseCount()).toBe(0);
  });

  it('(d) aynı kurumdaki başka menti/mentör → 403 (next + answer); yanıt yazılmaz', async () => {
    for (const u of [mentiA2, mentorA]) {
      await http.get(`/api/users/${mentiA.id}/adaptive-test/next`).set(authAs(u)).expect(403);
      await http
        .post(`/api/users/${mentiA.id}/adaptive-test/answer`)
        .set(authAs(u))
        .send({ questionId, value: 5 })
        .expect(403);
    }
    expect(await responseCount()).toBe(0);
  });
});

// ─── 10. GET /mentors/:mentorId/dashboard-metrics ────────────────────────────
describe('Y3-10: GET /api/mentors/:mentorId/dashboard-metrics', () => {
  const url = (id: string) => `/api/mentors/${id}/dashboard-metrics`;

  beforeEach(async () => {
    const hour = 3_600_000;
    await testPrisma.meeting.createMany({
      data: [
        { tenantId: tenantA, mentorUserId: mentorA.id, mentiUserId: mentiA.id, status: 'PENDING',
          startsAt: new Date(Date.now() + 24 * hour), endsAt: new Date(Date.now() + 25 * hour) },
        { tenantId: tenantA, mentorUserId: mentorA.id, mentiUserId: mentiA.id, status: 'COMPLETED',
          startsAt: new Date(Date.now() - 25 * hour), endsAt: new Date(Date.now() - 24 * hour) },
      ],
    });
  });

  it('(a) oturumsuz → 401', async () => {
    await http.get(url(mentorA.id)).set(tenantHeaders(tenantA)).expect(401);
  });

  it('(b) menti → 403', async () => {
    await http.get(url(mentorA.id)).set(authAs(mentiA)).expect(403);
  });

  it('(d) aynı kurumdaki başka mentör → 403, sayılar/isimler dönmez', async () => {
    const res = await http.get(url(mentorA.id)).set(authAs(mentorA2)).expect(403);
    expect(res.body).not.toHaveProperty('activeMentees');
  });

  it('(c) başka kurumun yöneticisi → 404, sayılar/isimler dönmez', async () => {
    // K5-Y3b: kurum dışı mentör → jenerik 404 (önceden 200 + sıfır metrik; komşu
    // visibility-optin ucu ile aynı desen).
    const res = await http.get(url(mentorA.id)).set(authAs(adminB)).expect(404);
    expect(res.body.error).toBe('NOT_FOUND');
    expect(res.body).not.toHaveProperty('pendingRequests');
    expect(res.body).not.toHaveProperty('activeMentees');
    expect(JSON.stringify(res.body)).not.toContain(mentiA.fullName);
  });

  it('pozitif kontrol: mentör kendi metriğini görür (kurgu doğru)', async () => {
    const res = await http.get(url(mentorA.id)).set(authAs(mentorA)).expect(200);
    expect(res.body.pendingRequests).toBe(1);
    expect(res.body.completedMeetings).toBe(1);
  });
});
