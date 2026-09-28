/**
 * AJ-105 — kurum-içi rol kararları `TenantMembership.role`'den (User.role DEĞİL).
 *
 * Sorun: oturumdaki rol her istekte üyelikten düzeltiliyordu (middleware/tenant.ts), ama HEDEF
 * kişinin rolü ("bu kişi mentör mü / menti mi") veritabanından `User.role` ile okunuyordu.
 * `User.role` kişi-genel tek alandır: A kurumunda MENTOR, B kurumunda MENTI olan kişi B'de de
 * mentör gibi işlem görüyordu. Kurum yöneticisi bildirim alıcıları da `User.role = ADMIN` + ana
 * kurumdan seçiliyordu.
 *
 * Kişiler (hepsinin ana kurumu B — ana kurum RLS filtresinin bulduğu kayıt, yani hata burada görünür):
 *  - P: A'da MENTOR, B'de MENTI (User.role = MENTOR) → B'de mentör işlemi GÖREMEZ.
 *  - Q: A'da MENTI, B'de MENTOR (User.role = MENTI)  → B'de mentör işlemi görür, menti işlemi görmez.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { agent, tenantHeaders, type TestAgent } from './helpers/request.js';
import { cleanDb, testPrisma } from './helpers/db.js';
import { createTenant, createUser, createMentor, createMenti } from './helpers/factories.js';
import { signToken } from '../src/middleware/jwtAuth.js';
import type { Tenant, User, UserRole } from '@prisma/client';

const emailMocks = vi.hoisted(() => ({ sendAdminNewUserNotification: vi.fn(async () => undefined) }));
vi.mock('../src/services/emailService.js', async (orig) => ({
  ...(await orig<typeof import('../src/services/emailService.js')>()),
  sendAdminNewUserNotification: emailMocks.sendAdminNewUserNotification,
  sendMeetingRequestEmail: vi.fn(async () => undefined),
}));

type Seeded = Awaited<ReturnType<typeof createUser>>;

function tokenFor(u: Pick<User, 'id' | 'role' | 'fullName'>, tenantId: string): string {
  return signToken({ sub: u.id, tenantId, role: u.role, fullName: u.fullName });
}

let http: TestAgent;
let tenantA: Tenant;
let tenantB: Tenant;
let adminB: Seeded;
let mentiB: Seeded;
let mentorB: Seeded;
let p: Seeded; // A'da MENTOR, B'de MENTI
let q: Seeded; // A'da MENTI, B'de MENTOR

/** Ana kurumu B olan, User.role = userRole; B üyeliği roleInB, A üyeliği roleInA olan kişi. */
async function createSplitRoleUser(userRole: UserRole, roleInA: UserRole, roleInB: UserRole): Promise<Seeded> {
  const u = await createUser({ tenantId: tenantB.id, role: userRole });
  await testPrisma.tenantMembership.update({
    where: { userId_tenantId: { userId: u.id, tenantId: tenantB.id } },
    data:  { role: roleInB },
  });
  await testPrisma.tenantMembership.create({
    data: { userId: u.id, tenantId: tenantA.id, role: roleInA, isActive: true },
  });
  return u;
}

function asB(u: Seeded) {
  return tenantHeaders(tenantB.id, tokenFor(u, tenantB.id));
}

const FUTURE = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();

beforeEach(async () => {
  await cleanDb();
  http = agent();
  emailMocks.sendAdminNewUserNotification.mockClear();
  tenantA = await createTenant();
  tenantB = await createTenant();
  adminB  = await createUser({ tenantId: tenantB.id, role: 'ADMIN' });
  mentiB  = await createMenti(tenantB.id);
  mentorB = await createMentor(tenantB.id);
  p = await createSplitRoleUser('MENTOR', 'MENTOR', 'MENTI');
  q = await createSplitRoleUser('MENTI', 'MENTI', 'MENTOR');
});

describe('AJ-105: A\'da MENTOR, B\'de MENTI olan kişi B\'de mentör gibi işlem göremez', () => {
  it('görüşme oluşturma (yönetici) — mentör olarak 404; görüşme yazılmaz', async () => {
    const res = await http.post('/api/meetings').set(asB(adminB))
      .send({ mentorId: p.id, mentiId: mentiB.id, scheduledAt: FUTURE });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('NOT_FOUND');
    expect(await testPrisma.meeting.count()).toBe(0);
  });

  it('anlaşma oluşturma — mentör olarak 404 MENTOR_BULUNAMADI; anlaşma yazılmaz', async () => {
    const res = await http.post('/api/agreements').set(asB(adminB)).send({
      mentorId: p.id, mentiId: mentiB.id,
      meetingFrequency: 'WEEKLY', communicationChannel: 'ONLINE',
      durationWeeks: 8, targetMeetings: 6, mentiGoal: 'Kariyer hedeflerimi netleştirmek istiyorum.',
      privacyAgreed: true,
    });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('MENTOR_BULUNAMADI');
    expect(await testPrisma.mentorshipAgreement.count()).toBe(0);
  });

  it('mentör filtresi okuma/yazma (yönetici) — 404; filtre yazılmaz', async () => {
    const get = await http.get(`/api/mentors/${p.id}/filter`).set(asB(adminB));
    expect(get.status).toBe(404);
    const put = await http.put(`/api/mentors/${p.id}/filter`).set(asB(adminB))
      .send({ minCompatibilityScore: 50, blockedDiscTypes: [], filterEnabled: true });
    expect(put.status).toBe(404);
    expect(await testPrisma.mentorFilter.count()).toBe(0);
  });

  it('görünürlük onayı (yönetici, mentör adına) — 404; kayıt yazılmaz', async () => {
    const res = await http.post(`/api/mentors/${p.id}/visibility-optin`).set(asB(adminB))
      .send({ mentiId: mentiB.id });
    expect(res.status).toBe(404);
    expect(await testPrisma.visibilityOptIn.count()).toBe(0);
  });

  it('konuşma başlatma (menti) — hedef mentör değil 400; konuşma yazılmaz', async () => {
    const res = await http.post('/api/conversations').set(asB(mentiB))
      .send({ mentorUserId: p.id, message: 'Merhaba, görüşebilir miyiz?' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('TARGET');
    expect(await testPrisma.conversation.count()).toBe(0);
  });

  it('eşleşme isteği (menti) — hedef mentör değil 400; istek yazılmaz', async () => {
    const res = await http.post('/api/requests').set(asB(mentiB))
      .send({ targetType: 'USER', targetId: p.id, requestMessage: 'Merhaba' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('TARGET');
    expect(await testPrisma.matchRequest.count()).toBe(0);
  });

  it('mentör listesi (?role=MENTOR) — P yok, Q var', async () => {
    const res = await http.get('/api/users?role=MENTOR&pageSize=50').set(asB(mentiB)).expect(200);
    const ids = (res.body.items as Array<{ id: string; role: string }>).map((i) => i.id);
    expect(ids).not.toContain(p.id);
    expect(ids).toContain(q.id);
    expect(ids).toContain(mentorB.id);
    const qItem = (res.body.items as Array<{ id: string; role: string }>).find((i) => i.id === q.id);
    expect(qItem?.role).toBe('MENTOR');
  });

  it('DISC görünürlüğü — mentör, B\'de MENTI olan P\'nin tipini görür; B\'de MENTOR olan Q\'nunkini görmez', async () => {
    await testPrisma.user.updateMany({ where: { id: { in: [p.id, q.id] } }, data: { discType: 'D' } });
    const pRes = await http.get(`/api/users/${p.id}`).set(asB(mentorB)).expect(200);
    expect(pRes.body.discType).toBe('D');
    expect(pRes.body.role).toBe('MENTI');
    const qRes = await http.get(`/api/users/${q.id}`).set(asB(mentorB)).expect(200);
    expect(qRes.body).not.toHaveProperty('discType');
    expect(qRes.body.role).toBe('MENTOR');
  });
});

describe('AJ-105: ters yön — A\'da MENTI, B\'de MENTOR olan kişi B\'de mentördür', () => {
  it('görüşme oluşturma (yönetici) — Q mentör olarak kabul edilir', async () => {
    const res = await http.post('/api/meetings').set(asB(adminB))
      .send({ mentorId: q.id, mentiId: mentiB.id, scheduledAt: FUTURE });
    expect(res.status).toBe(201);
    expect(await testPrisma.meeting.count({ where: { mentorUserId: q.id } })).toBe(1);
  });

  it('oryantasyon kilidi kaldırma (menti işlemi) — Q için 404, kilit kalır; P için 200', async () => {
    await testPrisma.user.updateMany({ where: { id: { in: [p.id, q.id] } }, data: { needsOrientation: true } });

    const qRes = await http.delete(`/api/meetings/orientation-lock/${q.id}`).set(asB(adminB));
    expect(qRes.status).toBe(404);
    expect((await testPrisma.user.findUnique({ where: { id: q.id } }))?.needsOrientation).toBe(true);

    const pRes = await http.delete(`/api/meetings/orientation-lock/${p.id}`).set(asB(adminB));
    expect(pRes.status).toBe(200);
    expect((await testPrisma.user.findUnique({ where: { id: p.id } }))?.needsOrientation).toBe(false);
  });
});

describe('AJ-105: yönetici görünürlüğü ve bildirim alıcıları kurum üyeliğinden', () => {
  it('User.role = ADMIN ama B üyeliği MENTOR → /auth/me kurum düzeltme notunu görmez', async () => {
    await testPrisma.tenant.update({ where: { id: tenantB.id }, data: { correctionNote: 'Belge ekleyin.' } });
    const demoted = await createUser({ tenantId: tenantB.id, role: 'ADMIN' });
    await testPrisma.tenantMembership.update({
      where: { userId_tenantId: { userId: demoted.id, tenantId: tenantB.id } },
      data:  { role: 'MENTOR' },
    });

    const me = await http.get('/api/auth/me').set(asB(demoted)).expect(200);
    expect(me.body.tenant.correctionNote).toBeNull();
    const adminMe = await http.get('/api/auth/me').set(asB(adminB)).expect(200);
    expect(adminMe.body.tenant.correctionNote).toBe('Belge ekleyin.');
  });

  it('yeni kullanıcı bildirimi yalnız B\'nin AKTİF ADMIN üyelerine gider', async () => {
    // Rolü üyelikte düşürülmüş (User.role ADMIN kaldı) → almaz.
    const demoted = await createUser({ tenantId: tenantB.id, role: 'ADMIN' });
    await testPrisma.tenantMembership.update({
      where: { userId_tenantId: { userId: demoted.id, tenantId: tenantB.id } },
      data:  { role: 'MENTOR' },
    });
    // Başka kurumun yöneticisi (B'de üyeliği yok) → almaz.
    const adminA = await createUser({ tenantId: tenantA.id, role: 'ADMIN' });
    // Ana kurumu A, B'de misafir ADMIN üyeliği → alır.
    const guestAdmin = await createUser({ tenantId: tenantA.id, role: 'MENTOR' });
    await testPrisma.tenantMembership.create({
      data: { userId: guestAdmin.id, tenantId: tenantB.id, role: 'ADMIN', isActive: true },
    });
    // B'de ADMIN üyeliği pasif → almaz.
    const inactiveAdmin = await createUser({ tenantId: tenantB.id, role: 'ADMIN' });
    await testPrisma.tenantMembership.update({
      where: { userId_tenantId: { userId: inactiveAdmin.id, tenantId: tenantB.id } },
      data:  { isActive: false },
    });

    await http.post('/api/users').set(asB(adminB))
      .send({ role: 'MENTI', email: 'yeni-menti@test.local', fullName: 'Yeni Menti' })
      .expect(201);

    const recipients = emailMocks.sendAdminNewUserNotification.mock.calls
      .map((c) => (c as unknown as [{ toEmail: string }])[0].toEmail)
      .sort();
    expect(recipients).toEqual([adminB.email, guestAdmin.email].sort());
    expect(recipients).not.toContain(demoted.email);
    expect(recipients).not.toContain(adminA.email);
    expect(recipients).not.toContain(inactiveAdmin.email);
  });
});
