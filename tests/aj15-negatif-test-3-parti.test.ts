/**
 * AJ-15 — negatif test kovası, 3. parti.
 *
 * Kaynak: docs/raporlar/kesif/negatif-test-boslugu-2026-09-26.md — öncelik listesindeki
 * (c)/(d) eksik uçlardan K5-Y3 (#169), AJ-04 (#176) ve AJ-13 (#184) tarafından KAPSANMAMIŞ
 * sonraki 20 uç. Sıralama: önce yazma/silme uçları, sonra kişisel veri döndüren okumalar.
 *
 * Aynı desen (Y3/AJ-04/AJ-13 ile birebir):
 *   (a) oturumsuz → 401
 *   (b) yanlış rol → 403
 *   (c) BAŞKA KURUMUN kaynağı (saldırgan KENDİ kurum başlığı + KENDİ token'ı ile) → 403/404
 *       VE kaynak DEĞİŞMEZ (yazma uçlarında DB'den tekrar okunarak doğrulanır)
 *   (d) aynı kurumda başkasının kaynağı (IDOR) → 403/404 VE kaynak DEĞİŞMEZ
 * Yalnız uygulanabilen alt-testler yazılır. AJ-13'ün 7b dersi izlendi: gövdedeki yardımcı
 * kimlikler (varsa) saldırganın KENDİ kurumundan seçildi ki ret TEK sebepten (hedef kaynağın
 * kurum filtresi) gelsin. Kaynak koda dokunulmadı; yalnız test eklendi.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import supertest from 'supertest';
import express from 'express';
import { agent, tenantHeaders, type TestAgent } from './helpers/request.js';
import { cleanDb, testPrisma } from './helpers/db.js';
import {
  createTenant,
  createAdminUser,
  createMentor,
  createMenti,
  createUserProfile,
} from './helpers/factories.js';
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

// clubRoutes/feedbackLogRoutes ana test app'e (tests/helpers/request.ts) MOUNT EDİLMEMİŞ
// (AJ-04/AJ-13'teki gibi not) — feedbacklog-identity.test.ts'teki gibi minimal özel app.
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
let mentiA2: SeededUser;
let mentorB: SeededUser;
let mentiB: SeededUser;
let adminB: SeededUser;

beforeEach(async () => {
  await cleanDb();
  http = agent();
  tenantA = (await createTenant()).id;
  tenantB = (await createTenant()).id;
  mentorA  = await createMentor(tenantA);
  mentorA2 = await createMentor(tenantA);
  mentiA   = await createMenti(tenantA);
  mentiA2  = await createMenti(tenantA);
  mentorB  = await createMentor(tenantB);
  mentiB   = await createMenti(tenantB);
  adminB   = await createAdminUser(tenantB);
});

const hour = 3_600_000;

// ─── AJ15-1/2/3: mentörlük anlaşması — confirm/renew/end ────────────────────
// agreementController.ts — her üçü de `findFirst({ id, tenantId })`; kurum-dışı → 404,
// aynı kurumda taraf olmayan → 403 YETKI_YETERSIZ.
describe('AJ15-1/2/3: mentörlük anlaşması confirm/renew/end', () => {
  async function makeAgreement(status: 'DRAFT' | 'ACTIVE' | 'RENEWAL_PENDING') {
    return testPrisma.mentorshipAgreement.create({
      data: {
        tenantId: tenantA,
        mentorId: mentorA.id,
        mentiId: mentiA.id,
        meetingFrequency: 'WEEKLY',
        communicationChannel: 'ONLINE',
        durationWeeks: 12,
        targetMeetings: 10,
        mentiGoal: 'aj15 anlasma hedefi en az on karakter',
        status,
      },
    });
  }

  it('confirm (c) başka kurumun yöneticisi → 404; anlaşma DRAFT kalır', async () => {
    const ag = await makeAgreement('DRAFT');
    const res = await http.post(`/api/agreements/${ag.id}/confirm`).set(authAs(adminB)).expect(404);
    expect(res.body.error).toBe('NOT_FOUND');
    const after = await testPrisma.mentorshipAgreement.findUnique({ where: { id: ag.id } });
    expect(after?.status).toBe('DRAFT');
    expect(after?.mentorConfirmedAt).toBeNull();
    expect(after?.mentiConfirmedAt).toBeNull();
  });

  it('confirm (d) aynı kurumda taraf olmayan kullanıcı → 403; anlaşma DRAFT kalır', async () => {
    const ag = await makeAgreement('DRAFT');
    await http.post(`/api/agreements/${ag.id}/confirm`).set(authAs(mentorA2)).expect(403);
    const after = await testPrisma.mentorshipAgreement.findUnique({ where: { id: ag.id } });
    expect(after?.status).toBe('DRAFT');
  });

  it('renew (c) başka kurumun yöneticisi → 404; durum RENEWAL_PENDING kalır', async () => {
    const ag = await makeAgreement('RENEWAL_PENDING');
    const res = await http.post(`/api/agreements/${ag.id}/renew`).set(authAs(adminB)).expect(404);
    expect(res.body.error).toBe('NOT_FOUND');
    const after = await testPrisma.mentorshipAgreement.findUnique({ where: { id: ag.id } });
    expect(after?.status).toBe('RENEWAL_PENDING');
  });

  it('renew (d) aynı kurumda taraf olmayan kullanıcı → 403; durum değişmez', async () => {
    const ag = await makeAgreement('RENEWAL_PENDING');
    await http.post(`/api/agreements/${ag.id}/renew`).set(authAs(mentiA2)).expect(403);
    const after = await testPrisma.mentorshipAgreement.findUnique({ where: { id: ag.id } });
    expect(after?.status).toBe('RENEWAL_PENDING');
  });

  it('end (c) başka kurumun yöneticisi → 404; anlaşma ACTIVE kalır (bitirilmez)', async () => {
    const ag = await makeAgreement('ACTIVE');
    const res = await http.post(`/api/agreements/${ag.id}/end`).set(authAs(adminB)).expect(404);
    expect(res.body.error).toBe('NOT_FOUND');
    const after = await testPrisma.mentorshipAgreement.findUnique({ where: { id: ag.id } });
    expect(after?.status).toBe('ACTIVE');
  });

  it('end (d) aynı kurumda taraf olmayan kullanıcı → 403; anlaşma ACTIVE kalır', async () => {
    const ag = await makeAgreement('ACTIVE');
    await http.post(`/api/agreements/${ag.id}/end`).set(authAs(mentorA2)).expect(403);
    const after = await testPrisma.mentorshipAgreement.findUnique({ where: { id: ag.id } });
    expect(after?.status).toBe('ACTIVE');
  });
});

// ─── AJ15-4: POST /api/conversations (c) ─────────────────────────────────────
// conversationController.ts:startConversation — hedef mentör başka tenant'taysa
// canCrossTenantMatch kontrolü; iki tenant da isSharedPoolActive:false (factory varsayılanı)
// olduğu için paylaşım kapalı → 403 SHARED_POOL_KAPALI, konuşma oluşmaz.
describe('AJ15-4: POST /api/conversations (c) — paylaşımlı havuz kapalıyken cross-tenant', () => {
  it('tenant B menti, tenant A mentörüne konuşma açamaz → 403; konuşma oluşmaz', async () => {
    const res = await http
      .post('/api/conversations')
      .set(authAs(mentiB))
      .send({ mentorUserId: mentorA.id, message: 'aj15 gizli ilk mesaj' })
      .expect(403);
    expect(res.body.error).toBe('SHARED_POOL_KAPALI');
    expect(
      await testPrisma.conversation.count({ where: { mentorUserId: mentorA.id, mentiUserId: mentiB.id } }),
    ).toBe(0);
  });
});

// ─── AJ15-5: DELETE /api/clubs/:id/members/:userId ──────────────────────────
// clubController.ts:removeClubMember — üyelik `findFirst({ clubId, userId, tenantId })`.
describe('AJ15-5: DELETE /api/clubs/:id/members/:userId', () => {
  let clubHttp: TestAgent;
  let clubId: string;

  beforeEach(async () => {
    clubHttp = supertest.agent(createClubTestApp());
    const club = await testPrisma.club.create({
      data: { tenantId: tenantA, name: 'AJ15 Kulüp', slug: 'aj15-kulup', type: 'AKADEMIK' },
    });
    clubId = club.id;
    await testPrisma.clubMembership.create({
      data: { tenantId: tenantA, clubId, userId: mentorA.id, role: 'UYE' },
    });
  });

  const memberExists = () =>
    testPrisma.clubMembership.findFirst({ where: { clubId, userId: mentorA.id } });

  it('(a) oturumsuz → 401; üyelik değişmez', async () => {
    await clubHttp.delete(`/api/clubs/${clubId}/members/${mentorA.id}`).set(tenantHeaders(tenantA)).expect(401);
    expect(await memberExists()).not.toBeNull();
  });

  it('(b) aynı kurumdaki MENTOR/MENTI rolü → 403; üyelik değişmez', async () => {
    await clubHttp.delete(`/api/clubs/${clubId}/members/${mentorA.id}`).set(authAs(mentorA2)).expect(403);
    await clubHttp.delete(`/api/clubs/${clubId}/members/${mentiA.id}`).set(authAs(mentiA)).expect(403);
    expect(await memberExists()).not.toBeNull();
  });

  it('(c) başka kurumun yöneticisi → 404; üyelik SİLİNMEZ', async () => {
    const res = await clubHttp.delete(`/api/clubs/${clubId}/members/${mentorA.id}`).set(authAs(adminB)).expect(404);
    expect(res.body.message).toBe('Üyelik kaydı bulunamadı.');
    expect(await memberExists()).not.toBeNull();
  });
});

// ─── AJ15-6: GET /api/users/:userId/clubs (c) ────────────────────────────────
// clubController.ts:getUserClubs — requireSelfOrAdmin ADMIN'i bypass eder (rol kontrolü),
// ama controller içi `findFirst({ id: userId, tenantId })` kurum-dışı hedefi bulamaz.
describe('AJ15-6: GET /api/users/:userId/clubs (c)', () => {
  it('başka kurumun yöneticisi mentiA\'nın kulüp listesini göremez → 404', async () => {
    const club = await testPrisma.club.create({
      data: { tenantId: tenantA, name: 'AJ15 Kulüp 2', slug: 'aj15-kulup-2', type: 'SOSYAL' },
    });
    await testPrisma.clubMembership.create({
      data: { tenantId: tenantA, clubId: club.id, userId: mentiA.id, role: 'UYE' },
    });
    const res = await http.get(`/api/users/${mentiA.id}/clubs`).set(authAs(adminB)).expect(404);
    expect(res.body).not.toHaveProperty('items');
  });
});

// ─── AJ15-7: POST /api/meetings (c) ──────────────────────────────────────────
// meetingController.ts:createMeeting — mentor/menti `findFirst({ id, tenantId, role, isActive })`.
describe('AJ15-7: POST /api/meetings (c)', () => {
  it('başka kurumun yöneticisi tenant A çifti için görüşme açamaz → 404; görüşme oluşmaz', async () => {
    const res = await http
      .post('/api/meetings')
      .set(authAs(adminB))
      .send({
        mentorId: mentorA.id,
        mentiId: mentiA.id,
        scheduledAt: new Date(Date.now() + 24 * hour).toISOString(),
      })
      .expect(404);
    expect(res.body.message).toBe('Mentor bulunamadı.');
    expect(await testPrisma.meeting.count({ where: { mentorUserId: mentorA.id, mentiUserId: mentiA.id } })).toBe(0);
  });
});

// ─── AJ15-8: PATCH /api/meetings/:id (c) ────────────────────────────────────
// meetingController.ts:updateMeetingStatus — `findFirst({ id, tenantId })`.
describe('AJ15-8: PATCH /api/meetings/:id (c)', () => {
  it('başka kurumun yöneticisi durumu değiştiremez → 404; durum PENDING kalır', async () => {
    const meeting = await testPrisma.meeting.create({
      data: {
        tenantId: tenantA, mentorUserId: mentorA.id, mentiUserId: mentiA.id, status: 'PENDING',
        startsAt: new Date(Date.now() + hour), endsAt: new Date(Date.now() + 2 * hour),
      },
    });
    const res = await http
      .patch(`/api/meetings/${meeting.id}`)
      .set(authAs(adminB))
      .send({ status: 'CANCELLED' })
      .expect(404);
    expect(res.body.error).toBe('NOT_FOUND');
    const after = await testPrisma.meeting.findUnique({ where: { id: meeting.id }, select: { status: true } });
    expect(after?.status).toBe('PENDING');
  });
});

// ─── AJ15-9: POST /api/meetings/:meetingId/feedback (c) ─────────────────────
// feedbackController.ts:submitFeedback — meeting `findFirst({ id, tenantId })`.
describe('AJ15-9: POST /api/meetings/:meetingId/feedback (c)', () => {
  it('başka kurumun mentörü değerlendirme yazamaz → 404; değerlendirme oluşmaz', async () => {
    const meeting = await testPrisma.meeting.create({
      data: {
        tenantId: tenantA, mentorUserId: mentorA.id, mentiUserId: mentiA.id, status: 'COMPLETED',
        startsAt: new Date(Date.now() - 2 * hour), endsAt: new Date(Date.now() - hour),
      },
    });
    const res = await http
      .post(`/api/meetings/${meeting.id}/feedback`)
      .set(authAs(mentorB))
      .send({ guidanceScore: 5 })
      .expect(404);
    expect(res.body.error).toBe('NOT_FOUND');
    expect(await testPrisma.feedback.count({ where: { meetingId: meeting.id } })).toBe(0);
    const after = await testPrisma.meeting.findUnique({ where: { id: meeting.id }, select: { hasFeedback: true } });
    expect(after?.hasFeedback).toBe(false);
  });
});

// ─── AJ15-10: POST /api/meetings/:meetingId/mark-not-happened (c) ───────────
// meetingController.ts:markMeetingNotHappened — `findFirst({ id, tenantId, mentorUserId, status })`.
describe('AJ15-10: POST /api/meetings/:meetingId/mark-not-happened (c)', () => {
  it('başka kurumun mentörü işaretleyemez → 404; durum COMPLETED kalır', async () => {
    const meeting = await testPrisma.meeting.create({
      data: {
        tenantId: tenantA, mentorUserId: mentorA.id, mentiUserId: mentiA.id, status: 'COMPLETED',
        startsAt: new Date(Date.now() - 2 * hour), endsAt: new Date(Date.now() - hour),
      },
    });
    const res = await http
      .post(`/api/meetings/${meeting.id}/mark-not-happened`)
      .set(authAs(mentorB))
      .send({})
      .expect(404);
    expect(res.body.error).toBe('NOT_FOUND');
    const after = await testPrisma.meeting.findUnique({ where: { id: meeting.id }, select: { status: true } });
    expect(after?.status).toBe('COMPLETED');
  });
});

// ─── AJ15-11: POST /api/meetings/:meetingId/feedback-prompted (c + d) ───────
// meetingController.ts:markFeedbackPrompted — `findFirst({ id, tenantId, OR: [mentor, menti] })`.
describe('AJ15-11: POST /api/meetings/:meetingId/feedback-prompted', () => {
  let meetingId: string;

  beforeEach(async () => {
    const meeting = await testPrisma.meeting.create({
      data: {
        tenantId: tenantA, mentorUserId: mentorA.id, mentiUserId: mentiA.id, status: 'COMPLETED',
        startsAt: new Date(Date.now() - 2 * hour), endsAt: new Date(Date.now() - hour),
      },
    });
    meetingId = meeting.id;
  });

  const promptedFlag = async () =>
    (await testPrisma.meeting.findUnique({ where: { id: meetingId }, select: { feedbackPrompted: true } }))
      ?.feedbackPrompted;

  it('(c) başka kurumun yöneticisi → 404; bayrak değişmez', async () => {
    await http.post(`/api/meetings/${meetingId}/feedback-prompted`).set(authAs(adminB)).expect(404);
    expect(await promptedFlag()).toBe(false);
  });

  it('(d) aynı kurumda taraf olmayan mentör → 404; bayrak değişmez', async () => {
    await http.post(`/api/meetings/${meetingId}/feedback-prompted`).set(authAs(mentorA2)).expect(404);
    expect(await promptedFlag()).toBe(false);
  });
});

// ─── AJ15-12: PUT /api/mentors/:mentorId/filter (c) ─────────────────────────
// mentorFilterController.ts:upsertMentorFilter — `findFirst({ id, tenantId, role: MENTOR })`.
describe('AJ15-12: PUT /api/mentors/:mentorId/filter (c)', () => {
  it('başka kurumun yöneticisi filtreyi değiştiremez → 404; filtre oluşmaz', async () => {
    const res = await http
      .put(`/api/mentors/${mentorA.id}/filter`)
      .set(authAs(adminB))
      .send({ minCompatibilityScore: 90, blockedDiscTypes: ['D'], filterEnabled: true })
      .expect(404);
    expect(res.body.error).toBe('NOT_FOUND');
    expect(await testPrisma.mentorFilter.findUnique({ where: { mentorId: mentorA.id } })).toBeNull();
  });
});

// ─── AJ15-13: POST /api/admin/users/:id/reject (b + c) ──────────────────────
// adminController.ts:rejectUser — `findFirst({ id, tenantId })`; a zaten
// session-revocation.test.ts:68'de test edilmiş.
describe('AJ15-13: POST /api/admin/users/:id/reject', () => {
  async function snapshot(id: string) {
    return testPrisma.user.findUnique({
      where: { id },
      select: { approvalStatus: true, isActive: true, rejectedBy: true, rejectionReason: true },
    });
  }

  it('(b) aynı kurumdaki mentör/menti reddedemez → 403; durum değişmez', async () => {
    const before = await snapshot(mentiA.id);
    await http.post(`/api/admin/users/${mentiA.id}/reject`).set(authAs(mentorA)).send({}).expect(403);
    await http.post(`/api/admin/users/${mentiA.id}/reject`).set(authAs(mentiA2)).send({}).expect(403);
    expect(await snapshot(mentiA.id)).toEqual(before);
  });

  it('(c) başka kurumun yöneticisi → 404; kullanıcı reddedilmez', async () => {
    const before = await snapshot(mentiA.id);
    const res = await http.post(`/api/admin/users/${mentiA.id}/reject`).set(authAs(adminB)).send({}).expect(404);
    expect(res.body.error).toBe('NOT_FOUND');
    expect(await snapshot(mentiA.id)).toEqual(before);
  });
});

// ─── AJ15-14: POST /api/feedback-logs (c) ───────────────────────────────────
// feedbackLogController.ts:createFeedbackLog — mentor/menti `findFirst({ id, tenantId, role })`.
describe('AJ15-14: POST /api/feedback-logs (c)', () => {
  let flHttp: TestAgent;

  beforeEach(() => {
    flHttp = supertest.agent(createFeedbackLogTestApp());
  });

  it('başka kurumun yöneticisi tenant A çifti için log yazamaz → 404; kayıt oluşmaz', async () => {
    const res = await flHttp
      .post('/api/feedback-logs')
      .set(authAs(adminB))
      .send({ mentorId: mentorA.id, mentiId: mentiA.id, phase: 1, starRating: 4 })
      .expect(404);
    expect(res.body.message).toBe('Mentor bulunamadı.');
    expect(await testPrisma.feedbackLog.count({ where: { mentorId: mentorA.id, mentiId: mentiA.id } })).toBe(0);
  });
});

// ─── AJ15-15: GET /api/feedback-logs (liste, c) ─────────────────────────────
describe('AJ15-15: GET /api/feedback-logs (liste, c)', () => {
  it('başka kurumun yöneticisi kendi listesinde bu kurumun logunu GÖRMEZ', async () => {
    const flHttp = supertest.agent(createFeedbackLogTestApp());
    await testPrisma.feedbackLog.create({
      data: { tenantId: tenantA, mentorId: mentorA.id, mentiId: mentiA.id, phase: 1, starRating: 4, npsScore: 9 },
    });
    const res = await flHttp.get('/api/feedback-logs').set(authAs(adminB)).expect(200);
    expect(res.body.total).toBe(0);
    expect(res.body.items).toEqual([]);
    expect(JSON.stringify(res.body)).not.toContain(mentorA.fullName);
  });
});

// ─── AJ15-16: GET /api/admin/matches (c) ────────────────────────────────────
// adminController.ts:adminListMatches — Match.tenantId filtreli; Match.mentorId/mentiId
// aslında UserProfile.id'ye referans verir (schema.prisma:1042-1043).
describe('AJ15-16: GET /api/admin/matches (c)', () => {
  it('başka kurumun yöneticisi kendi listesinde bu kurumun eşleşmesini GÖRMEZ', async () => {
    const mentorProfile = await createUserProfile(mentorA.id, { archetype: 'ARCHITECT', archetypeRole: 'MENTOR' });
    const mentiProfile  = await createUserProfile(mentiA.id,  { archetype: 'EXPLORER',  archetypeRole: 'MENTI' });
    await testPrisma.match.create({
      data: {
        tenantId: tenantA, mentorId: mentorProfile.id, mentiId: mentiProfile.id,
        predictedScore: 80, sectorScore: 80, characterScore: 80,
        mentorArchetype: 'ARCHITECT', mentiArchetype: 'EXPLORER', status: 'ACTIVE',
      },
    });
    const res = await http.get('/api/admin/matches').set(authAs(adminB)).expect(200);
    expect(res.body.total).toBe(0);
    expect(res.body.items).toEqual([]);
  });
});

// ─── AJ15-17: GET /api/admin/mentors/certification-results (c) ─────────────
// adminController.ts:adminListCertResults — TenantMembership.tenantId filtreli.
describe('AJ15-17: GET /api/admin/mentors/certification-results (c)', () => {
  it('başka kurumun yöneticisi tenant A mentörünü listede GÖRMEZ', async () => {
    const res = await http.get('/api/admin/mentors/certification-results').set(authAs(adminB)).expect(200);
    // Ortak kurguda tenant B'nin TEK mentörü mentorB'dir — total===1 hem tenant A'nın
    // (mentorA, mentorA2) sızmadığını hem de sorgunun gerçekten çalıştığını kanıtlar.
    expect(res.body.total).toBe(1);
    const ids = (res.body.items as Array<{ userId: string }>).map((r) => r.userId);
    expect(ids).toEqual([mentorB.id]);
    expect(ids).not.toContain(mentorA.id);
    expect(JSON.stringify(res.body)).not.toContain(mentorA.fullName);
  });
});

// ─── AJ15-18: GET /api/admin/tags/pending (c) ───────────────────────────────
// tagController.ts:listPendingTags — PendingTag.tenantId filtreli.
describe('AJ15-18: GET /api/admin/tags/pending (c)', () => {
  it('başka kurumun yöneticisi kendi listesinde bu kurumun bekleyen etiketini GÖRMEZ', async () => {
    await testPrisma.pendingTag.create({
      data: { tenantId: tenantA, value: 'aj15-bekleyen-etiket', submittedBy: mentiA.id },
    });
    const res = await http.get('/api/admin/tags/pending').set(authAs(adminB)).expect(200);
    expect(res.body.total).toBe(0);
    expect(JSON.stringify(res.body)).not.toContain('aj15-bekleyen-etiket');
  });
});

// ─── AJ15-19: GET /api/admin/health-metrics (c) ─────────────────────────────
// adminController.ts:getHealthMetrics → retentionMetrics.service.ts:computeHealthMetrics —
// TenantMembership.tenantId filtreli rol sayımı (arz-talep dengesi).
describe('AJ15-19: GET /api/admin/health-metrics (c)', () => {
  it('başka kurumun yöneticisi tenant A\'nın mentor/menti sayılarını GÖRMEZ', async () => {
    const res = await http.get('/api/admin/health-metrics').set(authAs(adminB)).expect(200);
    expect(res.body.tenantId).toBe(tenantB);
    // Ortak kurguda tenant B'nin TEK mentörü/mentisi mentorB/mentiB'dir (1'er) — tenant A'nın
    // 2 mentörü + 2 mentisi bu sayıma KARIŞMADIĞINI (yani hâlâ 1/1 olduğunu) kanıtlar.
    expect(res.body.supplyDemand.mentors).toBe(1);
    expect(res.body.supplyDemand.mentis).toBe(1);
  });
});

// ─── AJ15-20: GET /api/users (liste, c) ─────────────────────────────────────
// userController.ts:listUsers — peer havuzu, User.tenantId + approvalStatus:APPROVED filtreli.
describe('AJ15-20: GET /api/users (liste, c)', () => {
  it('başka kurumun yöneticisi kendi listesinde bu kurumun mentörünü GÖRMEZ', async () => {
    const res = await http.get('/api/users').set(authAs(adminB)).query({ role: 'MENTOR' }).expect(200);
    const ids = (res.body.items as Array<{ id: string }>).map((u) => u.id);
    expect(ids).not.toContain(mentorA.id);
    expect(JSON.stringify(res.body)).not.toContain(mentorA.fullName);
  });
});
