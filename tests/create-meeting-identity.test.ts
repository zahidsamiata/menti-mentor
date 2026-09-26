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
