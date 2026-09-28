/**
 * GV-06 — POST /api/meetings: menti yalnız kendi adına görüşme talebi açabilir.
 * Kimlik oturumdan gelir (komşu uç POST /api/meetings/book ile aynı ilke).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { agent, tenantHeaders, type TestAgent } from './helpers/request.js';
import { cleanDb, testPrisma } from './helpers/db.js';
import { createTenant, createMentor, createMenti, createAdminUser } from './helpers/factories.js';
import { signToken } from '../src/middleware/jwtAuth.js';
import type { User } from '@prisma/client';

function tokenFor(u: Pick<User, 'id' | 'tenantId' | 'role' | 'fullName'>): string {
  return signToken({ sub: u.id, tenantId: u.tenantId, role: u.role, fullName: u.fullName });
}

const inTwoDays = () => new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString();

describe('GV-06: POST /api/meetings kimlik kaynağı', () => {
  let http: TestAgent;
  let tenantId: string;
  let mentor: Awaited<ReturnType<typeof createMentor>>;
  let menti: Awaited<ReturnType<typeof createMenti>>;
  let otherMenti: Awaited<ReturnType<typeof createMenti>>;

  beforeEach(async () => {
    await cleanDb();
    http = agent();
    const tenant = await createTenant();
    tenantId = tenant.id;
    mentor     = await createMentor(tenantId);
    menti      = await createMenti(tenantId);
    otherMenti = await createMenti(tenantId);
  });

  it('menti kendi adına talep açabilir (201)', async () => {
    const res = await http.post('/api/meetings').set(tenantHeaders(tenantId, tokenFor(menti)))
      .send({ mentorId: mentor.id, mentiId: menti.id, scheduledAt: inTwoDays() });
    expect(res.status).toBe(201);
    expect(res.body.mentiUserId).toBe(menti.id);
  });

  it('negatif: menti başka bir menti adına talep açamaz (403) ve kayıt oluşmaz', async () => {
    const res = await http.post('/api/meetings').set(tenantHeaders(tenantId, tokenFor(menti)))
      .send({ mentorId: mentor.id, mentiId: otherMenti.id, scheduledAt: inTwoDays() });
    expect(res.status).toBe(403);
    const count = await testPrisma.meeting.count({ where: { mentiUserId: otherMenti.id } });
    expect(count).toBe(0);
  });

  it('kurum yöneticisi bir menti adına talep açabilir (yönetici yolu korunur)', async () => {
    const admin = await createAdminUser(tenantId);
    const res = await http.post('/api/meetings').set(tenantHeaders(tenantId, tokenFor(admin)))
      .send({ mentorId: mentor.id, mentiId: otherMenti.id, scheduledAt: inTwoDays() });
    expect(res.status).toBe(201);
    expect(res.body.mentiUserId).toBe(otherMenti.id);
  });

  it('negatif: mentör bu uçtan talep açamaz (403)', async () => {
    const res = await http.post('/api/meetings').set(tenantHeaders(tenantId, tokenFor(mentor)))
      .send({ mentorId: mentor.id, mentiId: menti.id, scheduledAt: inTwoDays() });
    expect(res.status).toBe(403);
  });

  // KR-19: yönetici bloğu — admin yolu (createMeeting) da kontrol etmiyordu.
  it('negatif: yönetici tarafından bloklanmış çift için admin dahi talep açamaz (403), kayıt oluşmaz', async () => {
    await testPrisma.tenant.update({
      where: { id: tenantId },
      data: {
        blockedPairs: [
          { fromUserId: menti.id, toUserId: mentor.id, blockedAt: new Date().toISOString(), blockedBy: 'test-admin' },
        ],
      },
    });
    const admin = await createAdminUser(tenantId);
    const res = await http.post('/api/meetings').set(tenantHeaders(tenantId, tokenFor(admin)))
      .send({ mentorId: mentor.id, mentiId: menti.id, scheduledAt: inTwoDays() });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('ISLEM_YAPILAMIYOR');
    const count = await testPrisma.meeting.count({ where: { mentorUserId: mentor.id, mentiUserId: menti.id } });
    expect(count).toBe(0);
  });
});

// AJ-74: oryantasyon kilidi kurum-kapsamlı menti bulunduktan SONRA kontrol edilir.
// Başka kurumdaki bir menti kimliğiyle istek, o kaydın kilit durumundan bağımsız AYNI 404'ü alır.
describe('AJ-74: POST /api/meetings oryantasyon kilidi kurum izolasyonu', () => {
  let http: TestAgent;
  let tenantId: string;
  let otherTenantId: string;
  let mentor: Awaited<ReturnType<typeof createMentor>>;
  let admin: Awaited<ReturnType<typeof createAdminUser>>;

  beforeEach(async () => {
    await cleanDb();
    http = agent();
    tenantId      = (await createTenant()).id;
    otherTenantId = (await createTenant()).id;
    mentor = await createMentor(tenantId);
    admin  = await createAdminUser(tenantId);
  });

  async function createLockedMenti(tid: string) {
    const m = await createMenti(tid);
    await testPrisma.user.update({ where: { id: m.id }, data: { needsOrientation: true } });
    return m;
  }

  function postAsAdmin(mentiId: string) {
    return http.post('/api/meetings').set(tenantHeaders(tenantId, tokenFor(admin)))
      .send({ mentorId: mentor.id, mentiId, scheduledAt: inTwoDays() });
  }

  it('negatif: başka kurumdaki kilitli ve kilitsiz menti için yanıt AYNI (404, aynı gövde), kayıt oluşmaz', async () => {
    const foreignLocked   = await createLockedMenti(otherTenantId);
    const foreignUnlocked = await createMenti(otherTenantId);

    const lockedRes   = await postAsAdmin(foreignLocked.id);
    const unlockedRes = await postAsAdmin(foreignUnlocked.id);

    expect(lockedRes.status).toBe(404);
    expect(unlockedRes.status).toBe(404);
    expect(lockedRes.body).toEqual(unlockedRes.body);
    expect(lockedRes.body.error).not.toBe('ORYANTASYON_KILIDI');

    const count = await testPrisma.meeting.count({
      where: { mentiUserId: { in: [foreignLocked.id, foreignUnlocked.id] } },
    });
    expect(count).toBe(0);
  });

  it('kendi kurumundaki kilitli menti için 403 ORYANTASYON_KILIDI (davranış korunur), kayıt oluşmaz', async () => {
    const lockedMenti = await createLockedMenti(tenantId);
    const res = await postAsAdmin(lockedMenti.id);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('ORYANTASYON_KILIDI');
    const count = await testPrisma.meeting.count({ where: { mentiUserId: lockedMenti.id } });
    expect(count).toBe(0);
  });

  it('kilitli menti kendi adına talep açamaz (403 ORYANTASYON_KILIDI)', async () => {
    const lockedMenti = await createLockedMenti(tenantId);
    const res = await http.post('/api/meetings').set(tenantHeaders(tenantId, tokenFor(lockedMenti)))
      .send({ mentorId: mentor.id, mentiId: lockedMenti.id, scheduledAt: inTwoDays() });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('ORYANTASYON_KILIDI');
  });
});
