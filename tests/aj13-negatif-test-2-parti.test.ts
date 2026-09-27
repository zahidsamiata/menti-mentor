/**
 * AJ-13 — negatif test kovası, 2. parti.
 *
 * Kaynak: docs/raporlar/kesif/negatif-test-boslugu-2026-09-26.md — öncelik listesindeki
 * (c)/(d) eksik uçlardan K5-Y3 (#169) ve AJ-04 (#176) tarafından KAPSANMAMIŞ uçlar.
 *
 * ⚠️ Bağımsız inceleme (PR #184, ilk sürüm) 14 uçun `tests/y3-yetki-kurum-izolasyonu.test.ts`
 * (K5-Y3, #169) ile BİREBİR TEKRAR olduğunu tespit etti (export, anonymize/hard-delete,
 * promote/demote, feedback-logs/:id, requests/:id, coaching-suggestions, admin/reports
 * GET+PATCH, users/:id PATCH, adaptive-test next+answer, dashboard-metrics — Y3-1..Y3-10).
 * Bu tekrarlar ÇIKARILDI; yalnız Y3'te KARŞILIĞI OLMAYAN 11 uç kaldı. Ayrıca aynı incelemede
 * `POST /clubs/:id/members` (c) testinin gövdesinde A-kurumu kullanıcısı kullanıldığı için
 * kulüp sorgusunun kurum filtresini GERÇEKTEN sınamadığı (kullanıcı sorgusu zaten reddediyordu)
 * bulundu — gövde saldırganın KENDİ kurumundan (B) bir kullanıcıya çevrildi; artık yalnız kulüp
 * sorgusunun tenant filtresi test edilmiş oluyor.
 *
 * Aynı desen (AJ-04/Y3 ile birebir):
 *   (a) oturumsuz → 401
 *   (b) yanlış rol → 403
 *   (c) BAŞKA KURUMUN kaynağı → 403/404 VE kaynak DEĞİŞMEZ
 *   (d) aynı kurumda başkasının kaynağı (IDOR) → 403/404 VE kaynak DEĞİŞMEZ
 * Yalnız uygulanabilen alt-testler yazılır. Kaynak koda dokunulmadı; yalnız test eklendi.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import supertest from 'supertest';
import express from 'express';
import { agent, tenantHeaders, type TestAgent } from './helpers/request.js';
import { cleanDb, testPrisma } from './helpers/db.js';
import { createTenant, createAdminUser, createMentor, createMenti } from './helpers/factories.js';
import { signToken } from '../src/middleware/jwtAuth.js';
import clubRoutes from '../src/routes/clubRoutes.js';
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

// clubRoutes ana test app'e (tests/helpers/request.ts) MOUNT EDİLMEMİŞ (rapor notu) —
// AJ-04/GV-05'teki gibi minimal özel app.
function createClubTestApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/clubs', clubRoutes);
  app.use(notFoundHandler);
  app.use(globalErrorHandler);
  return app;
}

// ─── Ortak kurgu: iki kurum ──────────────────────────────────────────────────
let http: TestAgent;
let tenantA: string;
let tenantB: string;
let mentorA: SeededUser;
let mentiA: SeededUser;
let adminB: SeededUser;

beforeEach(async () => {
  await cleanDb();
  http = agent();
  tenantA = (await createTenant()).id;
  tenantB = (await createTenant()).id;
  mentorA = await createMentor(tenantA);
  mentiA  = await createMenti(tenantA);
  adminB  = await createAdminUser(tenantB);
});

// ─── AJ13-1: GET /api/requests (liste) (c) ──────────────────────────────────
// requestController.ts:listRequests — tenantId filtreli; başka kurumun listesine sızıntı olmamalı.
// Y3'te KARŞILIĞI YOK (Y3-5 yalnız /requests/:id tekil ucunu kapsıyor).
describe('AJ13-1: GET /api/requests (liste, c)', () => {
  it('başka kurumun yöneticisi kendi listesinde bu kurumun talebini GÖRMEZ', async () => {
    const req = await testPrisma.matchRequest.create({
      data: { tenantId: tenantA, requesterUserId: mentiA.id, targetType: 'USER', targetId: mentorA.id },
    });
    const res = await http.get('/api/requests').set(authAs(adminB)).expect(200);
    const ids = (res.body.items as Array<{ id: string }>).map((r) => r.id);
    expect(ids).not.toContain(req.id);
  });
});

// ─── AJ13-2: POST /api/admin/users/:id/request-correction (c) ──────────────
describe('AJ13-2: POST /api/admin/users/:id/request-correction (c)', () => {
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

// ─── AJ13-3: POST /api/admin/users/:id/rematch (c) ──────────────────────────
describe('AJ13-3: POST /api/admin/users/:id/rematch (c)', () => {
  it('başka kurumun yöneticisi rematch tetikleyemez → 404; sayaç değişmez', async () => {
    await http.post(`/api/admin/users/${mentiA.id}/rematch`).set(authAs(adminB)).send({}).expect(404);
    const after = await testPrisma.user.findUnique({ where: { id: mentiA.id }, select: { rematchCount: true } });
    expect(after?.rematchCount).toBe(0);
  });
});

// ─── AJ13-4: POST /api/admin/users/:id/nudge (c) ────────────────────────────
describe('AJ13-4: POST /api/admin/users/:id/nudge (c)', () => {
  it('başka kurumun yöneticisi dürtemez → 404', async () => {
    await http.post(`/api/admin/users/${mentiA.id}/nudge`).set(authAs(adminB)).send({}).expect(404);
  });
});

// ─── AJ13-5/6/7: taxonomy tag approve/merge/reject (c) ──────────────────────
// tagController.ts — her aksiyon tenantId filtreli findFirst; kurum-dışı 404, etiket durumu değişmez.
describe('AJ13-5: POST /api/admin/tags/:id/approve (c)', () => {
  it('başka kurumun yöneticisi onaylayamaz → 404; durum değişmez', async () => {
    const tag = await testPrisma.pendingTag.create({
      data: { tenantId: tenantA, value: 'aj13-etiket-onay', submittedBy: mentiA.id },
    });
    await http.post(`/api/admin/tags/${tag.id}/approve`).set(authAs(adminB)).expect(404);
    const after = await testPrisma.pendingTag.findUnique({ where: { id: tag.id }, select: { status: true } });
    expect(after?.status).toBe('PENDING');
  });
});

describe('AJ13-6: POST /api/admin/tags/:id/merge (c)', () => {
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

describe('AJ13-7: POST /api/admin/tags/:id/reject (c)', () => {
  it('başka kurumun yöneticisi reddedemez → 404; durum değişmez', async () => {
    const tag = await testPrisma.pendingTag.create({
      data: { tenantId: tenantA, value: 'aj13-etiket-red', submittedBy: mentiA.id },
    });
    await http.post(`/api/admin/tags/${tag.id}/reject`).set(authAs(adminB)).expect(404);
    const after = await testPrisma.pendingTag.findUnique({ where: { id: tag.id }, select: { status: true } });
    expect(after?.status).toBe('PENDING');
  });
});

// ─── AJ13-8: POST /api/admin/visibility-optin/:optInId/confirm (c) ─────────
describe('AJ13-8: POST /api/admin/visibility-optin/:optInId/confirm (c)', () => {
  it('başka kurumun yöneticisi onaylayamaz → 404; durum değişmez', async () => {
    const optIn = await testPrisma.visibilityOptIn.create({
      data: { tenantId: tenantA, mentorId: mentorA.id, mentiId: mentiA.id, status: 'PENDING' },
    });
    await http.post(`/api/admin/visibility-optin/${optIn.id}/confirm`).set(authAs(adminB)).expect(404);
    const after = await testPrisma.visibilityOptIn.findUnique({ where: { id: optIn.id }, select: { status: true } });
    expect(after?.status).toBe('PENDING');
  });
});

// ─── AJ13-9: POST /api/users/:id/temperament-test ───────────────────────────
describe('AJ13-9: POST /api/users/:id/temperament-test', () => {
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

// ─── AJ13-10: PATCH /api/clubs/:id ───────────────────────────────────────────
// clubController.ts:updateClub — tenantId filtreli findFirst.
describe('AJ13-10: PATCH /api/clubs/:id', () => {
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

// ─── AJ13-11: POST /api/clubs/:id/members ────────────────────────────────────
// clubController.ts:addClubMember — kulüp VE eklenecek kullanıcı aynı tenant'a ait olmalı.
// Bağımsız inceleme (PR #184) bulgusu: gövdedeki userId A-kurumundan olursa, kulüp sorgusunun
// tenant filtresi (hipotetik olarak) bozulsa BİLE ikinci sorgu (kullanıcı, attacker'ın tenant'ıyla
// filtrelenir) yine reddederdi — test kulüp izolasyonunu GERÇEKTEN sınamazdı. Düzeltme: gövdeye
// saldırganın KENDİ kurumundan (B) bir kullanıcı konur; böylece TEK ret sebebi kulüp sorgusunun
// tenant filtresi olur ve mesaj ('Kulüp bulunamadı.') bunu doğrular.
describe('AJ13-11: POST /api/clubs/:id/members', () => {
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

  it('(c) başka kurumun yöneticisi, KENDİ kurumundaki kullanıcıyı bile ekleyemez → 404 "Kulüp bulunamadı."; üyelik oluşmaz', async () => {
    // userId = adminB.id (saldırganın KENDİ kurumu, B) — kullanıcı sorgusu bu ID'yi kendi
    // tenant'ında BULURDU; tek ret sebebi kulüp sorgusunun `tenantId: req.tenant.tenantId` (B)
    // filtresidir (kulüp A'da kayıtlı). Böylece test gerçekten kulüp-tenant izolasyonunu sınar.
    const res = await clubHttp
      .post(`/api/clubs/${clubId}/members`)
      .set(authAs(adminB))
      .send({ userId: adminB.id })
      .expect(404);
    expect(res.body.message).toBe('Kulüp bulunamadı.');
    expect(await memberCount()).toBe(0);
  });
});
