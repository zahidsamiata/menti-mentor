/**
 * AJ-13 — negatif test kovası, 2. parti.
 *
 * Kaynak: docs/raporlar/kesif/negatif-test-boslugu-2026-09-26.md — öncelik listesindeki
 * (c)/(d) eksik uçlardan K5-Y3 (#169) ve AJ-04 (#176) tarafından KAPSANMAMIŞ 25 uç.
 * Öncelik: yazma/silme uçları ve kişisel veri döndüren uçlar önce.
 *
 * Aynı desen (AJ-04 ile birebir):
 *   (a) oturumsuz → 401
 *   (b) yanlış rol → 403
 *   (c) BAŞKA KURUMUN kaynağı → 403/404 VE kaynak DEĞİŞMEZ
 *   (d) aynı kurumda başkasının kaynağı (IDOR) → 403/404 VE kaynak DEĞİŞMEZ
 * Yalnız uygulanabilen alt-testler yazılır — admin router'ında requireRole('ADMIN') PAYLAŞILAN
 * middleware olduğundan (a)/(b) admin.test.ts / session-revocation.test.ts'te zaten kanıtlı;
 * burada TEKRARLANMAZ, yalnız o dosyalarda kanıtlanmayan (c)/(d) kontrolcü-özel mantık eklenir.
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

// clubRoutes ve feedbackLogRoutes ana test app'e (tests/helpers/request.ts) MOUNT EDİLMEMİŞ
// (rapor notu) — AJ-04/GV-05'teki gibi minimal özel app.
function createClubTestApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/clubs', clubRoutes);
  app.use(notFoundHandler);
  app.use(globalErrorHandler);
  return app;
}

function createFeedbackLogTestApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/feedback-logs', feedbackLogRoutes);
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

// ─── AJ13-1: GET /api/users/:id/export ──────────────────────────────────────
// gdprController.ts:exportUserDataHandler — isSelf/isAdmin inline kontrol, ardından
// exportUserData servisi tenantId ile filtrelenmiş findFirst kullanır.
describe('AJ13-1: GET /api/users/:id/export', () => {
  it('(a) oturumsuz → 401', async () => {
    await http.get(`/api/users/${mentiA.id}/export`).set(tenantHeaders(tenantA)).expect(401);
  });

  it('(c) başka kurumun yöneticisi → 404, veri dönmez', async () => {
    const res = await http.get(`/api/users/${mentiA.id}/export`).set(authAs(adminB)).expect(404);
    expect(JSON.stringify(res.body)).not.toContain(mentiA.email);
  });

  it('(d) aynı kurumda başka mentör (sahibi/admin değil) → 403', async () => {
    const res = await http.get(`/api/users/${mentiA.id}/export`).set(authAs(mentorA)).expect(403);
    expect(res.body).not.toHaveProperty('profile');
  });
});

// ─── AJ13-2: POST /api/users/:id/anonymize ──────────────────────────────────
// gdprController.ts:anonymizeUserHandler — inline ADMIN kontrolü + servis tenantId filtreli.
describe('AJ13-2: POST /api/users/:id/anonymize', () => {
  it('(a) oturumsuz → 401; kullanıcı değişmez', async () => {
    await http.post(`/api/users/${mentiA.id}/anonymize`).set(tenantHeaders(tenantA)).expect(401);
    const after = await testPrisma.user.findUnique({ where: { id: mentiA.id }, select: { email: true } });
    expect(after?.email).toBe(mentiA.email);
  });

  it('(b) ADMIN olmayan (mentör) → 403; kullanıcı değişmez', async () => {
    await http.post(`/api/users/${mentiA.id}/anonymize`).set(authAs(mentorA)).expect(403);
    const after = await testPrisma.user.findUnique({ where: { id: mentiA.id }, select: { email: true } });
    expect(after?.email).toBe(mentiA.email);
  });

  it('(c) başka kurumun yöneticisi → 404; kullanıcı değişmez', async () => {
    await http.post(`/api/users/${mentiA.id}/anonymize`).set(authAs(adminB)).expect(404);
    const after = await testPrisma.user.findUnique({ where: { id: mentiA.id }, select: { email: true, fullName: true } });
    expect(after?.email).toBe(mentiA.email);
    expect(after?.fullName).toBe(mentiA.fullName);
  });
});

// ─── AJ13-3: DELETE /api/users/:id/hard-delete ──────────────────────────────
// gdprController.ts:hardDeleteUserHandler — "silme" anonimleştirmeye yönlendirilir (madde 39);
// aynı ADMIN + tenant-scoped desen.
describe('AJ13-3: DELETE /api/users/:id/hard-delete', () => {
  it('(a) oturumsuz → 401; kullanıcı silinmez/değişmez', async () => {
    await http.delete(`/api/users/${mentiA.id}/hard-delete`).set(tenantHeaders(tenantA)).expect(401);
    expect(await testPrisma.user.findUnique({ where: { id: mentiA.id } })).not.toBeNull();
  });

  it('(c) başka kurumun yöneticisi → 404; kullanıcı silinmez/değişmez', async () => {
    await http.delete(`/api/users/${mentiA.id}/hard-delete`).set(authAs(adminB)).expect(404);
    const after = await testPrisma.user.findUnique({ where: { id: mentiA.id }, select: { email: true } });
    expect(after?.email).toBe(mentiA.email);
  });
});

// ─── AJ13-4: POST /api/admin/users/:id/promote-admin ────────────────────────
// adminController.ts:promoteToAdmin — hedef `findFirst({ id, tenantId })`.
describe('AJ13-4: POST /api/admin/users/:id/promote-admin (c)', () => {
  it('başka kurumun yöneticisi hedefi ADMIN yapamaz → 404; rol değişmez', async () => {
    await http.post(`/api/admin/users/${mentiA.id}/promote-admin`).set(authAs(adminB)).expect(404);
    const after = await testPrisma.user.findUnique({ where: { id: mentiA.id }, select: { role: true } });
    expect(after?.role).toBe('MENTI');
  });
});

// ─── AJ13-5: POST /api/admin/users/:id/demote-admin ─────────────────────────
describe('AJ13-5: POST /api/admin/users/:id/demote-admin (c)', () => {
  it('başka kurumun yöneticisi hedefi düşüremez → 404; rol değişmez', async () => {
    await http.post(`/api/admin/users/${adminA.id}/demote-admin`).set(authAs(adminB)).expect(404);
    const after = await testPrisma.user.findUnique({ where: { id: adminA.id }, select: { role: true } });
    expect(after?.role).toBe('ADMIN');
  });
});

// ─── AJ13-6: GET /api/feedback-logs/:id ──────────────────────────────────────
// feedbackLogController.ts:getFeedbackLog — tenantId filtreli findFirst; MENTOR yalnız
// kendi yazdığı kayda erişebilir (log.mentorId !== userId → 403).
describe('AJ13-6: GET /api/feedback-logs/:id', () => {
  let fbHttp: TestAgent;
  let logId: string;

  beforeEach(async () => {
    fbHttp = supertest.agent(createFeedbackLogTestApp());
    const log = await testPrisma.feedbackLog.create({
      data: {
        tenantId: tenantA, mentorId: mentorA.id, mentiId: mentiA.id,
        phase: 1, starRating: 4, goalAchieved: 'aj13-gizli-not',
      },
    });
    logId = log.id;
  });

  it('(a) oturumsuz → 401', async () => {
    await fbHttp.get(`/api/feedback-logs/${logId}`).set(tenantHeaders(tenantA)).expect(401);
  });

  it('(c) başka kurumun yöneticisi → 404, kayıt dönmez', async () => {
    const res = await fbHttp.get(`/api/feedback-logs/${logId}`).set(authAs(adminB)).expect(404);
    expect(JSON.stringify(res.body)).not.toContain('aj13-gizli-not');
  });

  it('(d) aynı kurumda kaydın sahibi olmayan mentör → 403', async () => {
    await fbHttp.get(`/api/feedback-logs/${logId}`).set(authAs(mentorA2)).expect(403);
  });
});

// ─── AJ13-7: GET /api/requests/:id ───────────────────────────────────────────
// requestController.ts:getRequest — tenantId filtreli findFirst + taraf (requester/target/admin) kontrolü.
describe('AJ13-7: GET /api/requests/:id', () => {
  let requestId: string;

  beforeEach(async () => {
    const req = await testPrisma.matchRequest.create({
      data: {
        tenantId: tenantA, requesterUserId: mentiA.id, targetType: 'USER', targetId: mentorA.id,
        requestMessage: 'aj13-gizli-talep-mesaji',
      },
    });
    requestId = req.id;
  });

  it('(a) oturumsuz → 401', async () => {
    await http.get(`/api/requests/${requestId}`).set(tenantHeaders(tenantA)).expect(401);
  });

  it('(c) başka kurumun yöneticisi → 404, talep dönmez', async () => {
    const res = await http.get(`/api/requests/${requestId}`).set(authAs(adminB)).expect(404);
    expect(JSON.stringify(res.body)).not.toContain('aj13-gizli-talep-mesaji');
  });

  it('(d) aynı kurumda taraf olmayan mentör → 404, talep dönmez', async () => {
    const res = await http.get(`/api/requests/${requestId}`).set(authAs(mentorA2)).expect(404);
    expect(JSON.stringify(res.body)).not.toContain('aj13-gizli-talep-mesaji');
  });
});

// ─── AJ13-8: GET /api/requests (liste) (c) ──────────────────────────────────
// requestController.ts:listRequests — tenantId filtreli; başka kurumun listesine sızıntı olmamalı.
describe('AJ13-8: GET /api/requests (liste, c)', () => {
  it('başka kurumun yöneticisi kendi listesinde bu kurumun talebini GÖRMEZ', async () => {
    const req = await testPrisma.matchRequest.create({
      data: { tenantId: tenantA, requesterUserId: mentiA.id, targetType: 'USER', targetId: mentorA.id },
    });
    const res = await http.get('/api/requests').set(authAs(adminB)).expect(200);
    const ids = (res.body.items as Array<{ id: string }>).map((r) => r.id);
    expect(ids).not.toContain(req.id);
  });
});

// ─── AJ13-9: GET /api/admin/users/:id/coaching-suggestions (c) ──────────────
describe('AJ13-9: GET /api/admin/users/:id/coaching-suggestions (c)', () => {
  it('başka kurumun yöneticisi öneri göremez → 404', async () => {
    await http.get(`/api/admin/users/${mentiA.id}/coaching-suggestions`).set(authAs(adminB)).expect(404);
  });
});

// ─── AJ13-10: GET /api/admin/reports (liste) (c) ────────────────────────────
describe('AJ13-10: GET /api/admin/reports (liste, c)', () => {
  it('başka kurumun yöneticisi kendi listesinde bu kurumun şikayetini GÖRMEZ', async () => {
    const report = await testPrisma.userReport.create({
      data: {
        tenantId: tenantA, reporterUserId: mentiA.id, targetUserId: mentorA.id,
        reason: 'SPAM', description: 'aj13-gizli-sikayet',
      },
    });
    const res = await http.get('/api/admin/reports').set(authAs(adminB)).expect(200);
    const ids = (res.body.items as Array<{ id: string }>).map((r) => r.id);
    expect(ids).not.toContain(report.id);
  });
});

// ─── AJ13-11: PATCH /api/admin/reports/:id (c) ──────────────────────────────
describe('AJ13-11: PATCH /api/admin/reports/:id (c)', () => {
  it('başka kurumun yöneticisi şikayeti inceleyemez → 404; durum değişmez', async () => {
    const report = await testPrisma.userReport.create({
      data: { tenantId: tenantA, reporterUserId: mentiA.id, targetUserId: mentorA.id, reason: 'SPAM' },
    });
    await http
      .patch(`/api/admin/reports/${report.id}`)
      .set(authAs(adminB))
      .send({ status: 'DISMISSED' })
      .expect(404);
    const after = await testPrisma.userReport.findUnique({ where: { id: report.id }, select: { status: true } });
    expect(after?.status).toBe('OPEN');
  });
});

// ─── AJ13-12: PATCH /api/users/:id (c) ──────────────────────────────────────
// userController.ts:updateUser — a/b zaten test edilmiş (session-revocation.test.ts, profile.test.ts).
describe('AJ13-12: PATCH /api/users/:id (c)', () => {
  it('başka kurumun yöneticisi hedefi düzenleyemez → 404; veri değişmez', async () => {
    await http
      .patch(`/api/users/${mentiA.id}`)
      .set(authAs(adminB))
      .send({ fullName: 'Ele Gecirildi' })
      .expect(404);
    const after = await testPrisma.user.findUnique({ where: { id: mentiA.id }, select: { fullName: true } });
    expect(after?.fullName).toBe(mentiA.fullName);
  });
});

// ─── AJ13-13 + AJ13-14: adaptif test next/answer ────────────────────────────
// adaptiveTestController.ts — isSelf/isAdmin inline kontrol ÖNCE, tenant lookup SONRA
// (admin başka kurumun kullanıcısı için 404, aynı kurumda sahibi olmayan kullanıcı 403 alır).
describe('AJ13-13: GET /api/users/:id/adaptive-test/next', () => {
  it('(c) başka kurumun yöneticisi → 404', async () => {
    await http.get(`/api/users/${mentiA.id}/adaptive-test/next`).set(authAs(adminB)).expect(404);
  });

  it('(d) aynı kurumda sahibi/admin olmayan kullanıcı → 403', async () => {
    await http.get(`/api/users/${mentiA.id}/adaptive-test/next`).set(authAs(mentorA)).expect(403);
  });
});

describe('AJ13-14: POST /api/users/:id/adaptive-test/answer', () => {
  const body = { questionId: 'aj13-yer-tutucu', value: 3 };

  it('(c) başka kurumun yöneticisi → 404; yanıt kaydedilmez', async () => {
    await http.post(`/api/users/${mentiA.id}/adaptive-test/answer`).set(authAs(adminB)).send(body).expect(404);
    expect(await testPrisma.userResponse.count({ where: { userId: mentiA.id } })).toBe(0);
  });

  it('(d) aynı kurumda sahibi/admin olmayan kullanıcı → 403; yanıt kaydedilmez', async () => {
    await http.post(`/api/users/${mentiA.id}/adaptive-test/answer`).set(authAs(mentorA)).send(body).expect(403);
    expect(await testPrisma.userResponse.count({ where: { userId: mentiA.id } })).toBe(0);
  });
});

// ─── AJ13-15: GET /api/mentors/:mentorId/dashboard-metrics ──────────────────
describe('AJ13-15: GET /api/mentors/:mentorId/dashboard-metrics', () => {
  it('(c) başka kurumun yöneticisi → 404', async () => {
    await http.get(`/api/mentors/${mentorA.id}/dashboard-metrics`).set(authAs(adminB)).expect(404);
  });

  it('(d) aynı kurumda başka mentör → 403', async () => {
    const res = await http.get(`/api/mentors/${mentorA.id}/dashboard-metrics`).set(authAs(mentorA2)).expect(403);
    expect(res.body).not.toHaveProperty('activeMentees');
  });
});

// ─── AJ13-16: POST /api/admin/users/:id/request-correction (c) ─────────────
describe('AJ13-16: POST /api/admin/users/:id/request-correction (c)', () => {
  it('başka kurumun yöneticisi düzeltme isteyemez → 404; not eklenmez', async () => {
    await http
      .post(`/api/admin/users/${mentiA.id}/request-correction`)
      .set(authAs(adminB))
      .send({ feedbackNote: 'aj13 en az on karakter geri bildirim notu' })
      .expect(404);
    const after = await testPrisma.user.findUnique({ where: { id: mentiA.id }, select: { rejectionReason: true } });
    expect(after?.rejectionReason).toBeNull();
  });
});

// ─── AJ13-17: POST /api/admin/users/:id/rematch (c) ─────────────────────────
describe('AJ13-17: POST /api/admin/users/:id/rematch (c)', () => {
  it('başka kurumun yöneticisi rematch tetikleyemez → 404; sayaç değişmez', async () => {
    await http.post(`/api/admin/users/${mentiA.id}/rematch`).set(authAs(adminB)).send({}).expect(404);
    const after = await testPrisma.user.findUnique({ where: { id: mentiA.id }, select: { rematchCount: true } });
    expect(after?.rematchCount).toBe(0);
  });
});

// ─── AJ13-18: POST /api/admin/users/:id/nudge (c) ───────────────────────────
describe('AJ13-18: POST /api/admin/users/:id/nudge (c)', () => {
  it('başka kurumun yöneticisi dürtemez → 404', async () => {
    await http.post(`/api/admin/users/${mentiA.id}/nudge`).set(authAs(adminB)).send({}).expect(404);
  });
});

// ─── AJ13-19/20/21: taxonomy tag approve/merge/reject (c) ───────────────────
// tagController.ts — her aksiyon tenantId filtreli findFirst; kurum-dışı 404, etiket durumu değişmez.
describe('AJ13-19: POST /api/admin/tags/:id/approve (c)', () => {
  it('başka kurumun yöneticisi onaylayamaz → 404; durum değişmez', async () => {
    const tag = await testPrisma.pendingTag.create({
      data: { tenantId: tenantA, value: 'aj13-etiket-onay', submittedBy: mentiA.id },
    });
    await http.post(`/api/admin/tags/${tag.id}/approve`).set(authAs(adminB)).expect(404);
    const after = await testPrisma.pendingTag.findUnique({ where: { id: tag.id }, select: { status: true } });
    expect(after?.status).toBe('PENDING');
  });
});

describe('AJ13-20: POST /api/admin/tags/:id/merge (c)', () => {
  it('başka kurumun yöneticisi birleştiremez → 404; durum değişmez', async () => {
    const tag = await testPrisma.pendingTag.create({
      data: { tenantId: tenantA, value: 'aj13-etiket-birlestir', submittedBy: mentiA.id },
    });
    await http
      .post(`/api/admin/tags/${tag.id}/merge`)
      .set(authAs(adminB))
      .send({ targetTag: 'aj13-hedef-etiket' })
      .expect(404);
    const after = await testPrisma.pendingTag.findUnique({ where: { id: tag.id }, select: { status: true } });
    expect(after?.status).toBe('PENDING');
  });
});

describe('AJ13-21: POST /api/admin/tags/:id/reject (c)', () => {
  it('başka kurumun yöneticisi reddedemez → 404; durum değişmez', async () => {
    const tag = await testPrisma.pendingTag.create({
      data: { tenantId: tenantA, value: 'aj13-etiket-red', submittedBy: mentiA.id },
    });
    await http.post(`/api/admin/tags/${tag.id}/reject`).set(authAs(adminB)).expect(404);
    const after = await testPrisma.pendingTag.findUnique({ where: { id: tag.id }, select: { status: true } });
    expect(after?.status).toBe('PENDING');
  });
});

// ─── AJ13-22: POST /api/admin/visibility-optin/:optInId/confirm (c) ─────────
describe('AJ13-22: POST /api/admin/visibility-optin/:optInId/confirm (c)', () => {
  it('başka kurumun yöneticisi onaylayamaz → 404; durum değişmez', async () => {
    const optIn = await testPrisma.visibilityOptIn.create({
      data: { tenantId: tenantA, mentorId: mentorA.id, mentiId: mentiA.id, status: 'PENDING' },
    });
    await http.post(`/api/admin/visibility-optin/${optIn.id}/confirm`).set(authAs(adminB)).expect(404);
    const after = await testPrisma.visibilityOptIn.findUnique({ where: { id: optIn.id }, select: { status: true } });
    expect(after?.status).toBe('PENDING');
  });
});

// ─── AJ13-23: POST /api/users/:id/temperament-test ──────────────────────────
// temperamentController.ts:submitTemperamentTest — (d) zaten security-audit-2.test.ts:262'de
// (aynı ailedeki self-profile testinde) dolaylı kanıtlı DEĞİL; burada (a)/(b)/(c) eklenir.
describe('AJ13-23: POST /api/users/:id/temperament-test', () => {
  const answers = Array.from({ length: 7 }, (_, i) => ({
    questionId: i + 1,
    selectedDisc: (['D', 'I', 'S', 'C'] as const)[i % 4],
  }));

  it('(a) oturumsuz → 401; test verisi değişmez', async () => {
    await http.post(`/api/users/${mentiA.id}/temperament-test`).set(tenantHeaders(tenantA)).send({ answers }).expect(401);
    const after = await testPrisma.user.findUnique({ where: { id: mentiA.id }, select: { temperamentJson: true } });
    expect(after?.temperamentJson).toBeNull();
  });

  it('(b) MENTOR rolü (ADMIN/MENTI değil) → 403', async () => {
    await http.post(`/api/users/${mentiA.id}/temperament-test`).set(authAs(mentorA)).send({ answers }).expect(403);
  });

  it('(c) başka kurumun yöneticisi → 404; test verisi değişmez', async () => {
    await http.post(`/api/users/${mentiA.id}/temperament-test`).set(authAs(adminB)).send({ answers }).expect(404);
    const after = await testPrisma.user.findUnique({ where: { id: mentiA.id }, select: { temperamentJson: true } });
    expect(after?.temperamentJson).toBeNull();
  });
});

// ─── AJ13-24: PATCH /api/clubs/:id ───────────────────────────────────────────
// clubController.ts:updateClub — tenantId filtreli findFirst.
describe('AJ13-24: PATCH /api/clubs/:id', () => {
  let clubHttp: TestAgent;
  let clubId: string;

  beforeEach(async () => {
    clubHttp = supertest.agent(createClubTestApp());
    const club = await testPrisma.club.create({
      data: { tenantId: tenantA, name: 'AJ13 Kulüp', slug: 'aj13-kulup', type: 'AKADEMIK' },
    });
    clubId = club.id;
  });

  it('(a) oturumsuz → 401', async () => {
    await clubHttp.patch(`/api/clubs/${clubId}`).set(tenantHeaders(tenantA)).send({ name: 'x' }).expect(401);
  });

  it('(c) başka kurumun yöneticisi → 404; kulüp değişmez', async () => {
    await clubHttp.patch(`/api/clubs/${clubId}`).set(authAs(adminB)).send({ name: 'Ele Gecirildi' }).expect(404);
    const after = await testPrisma.club.findUnique({ where: { id: clubId }, select: { name: true } });
    expect(after?.name).toBe('AJ13 Kulüp');
  });
});

// ─── AJ13-25: POST /api/clubs/:id/members ────────────────────────────────────
// clubController.ts:addClubMember — kulüp VE eklenecek kullanıcı aynı tenant'a ait olmalı.
describe('AJ13-25: POST /api/clubs/:id/members', () => {
  let clubHttp: TestAgent;
  let clubId: string;

  beforeEach(async () => {
    clubHttp = supertest.agent(createClubTestApp());
    const club = await testPrisma.club.create({
      data: { tenantId: tenantA, name: 'AJ13 Kulüp 2', slug: 'aj13-kulup-2', type: 'AKADEMIK' },
    });
    clubId = club.id;
  });

  const memberCount = () => testPrisma.clubMembership.count({ where: { clubId } });

  it('(a) oturumsuz → 401; üyelik oluşmaz', async () => {
    await clubHttp
      .post(`/api/clubs/${clubId}/members`)
      .set(tenantHeaders(tenantA))
      .send({ userId: mentorA.id })
      .expect(401);
    expect(await memberCount()).toBe(0);
  });

  it('(c) başka kurumun yöneticisi üye ekleyemez → 404; üyelik oluşmaz', async () => {
    await clubHttp
      .post(`/api/clubs/${clubId}/members`)
      .set(authAs(adminB))
      .send({ userId: mentorA.id })
      .expect(404);
    expect(await memberCount()).toBe(0);
  });
});
