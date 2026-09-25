/**
 * GV-04 — GET /api/meetings/:meetingId/check-ins erişim kapsamı.
 *
 * Kural: görüşmenin tarafı yalnız KENDİ kaydını görür; karşı tarafın kaydını görmez.
 * Kurum yöneticisi hepsini görür. Görüşmenin tarafı olmayan kurum üyesi 403 alır.
 * Başka kurumun görüşmesi hiç bulunamaz.
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

describe('GV-04: check-in kayıtlarını kim görür', () => {
  let http: TestAgent;
  let tenantId: string;
  let mentor: Awaited<ReturnType<typeof createMentor>>;
  let menti: Awaited<ReturnType<typeof createMenti>>;
  let outsider: Awaited<ReturnType<typeof createMenti>>;
  let admin: Awaited<ReturnType<typeof createAdminUser>>;
  let meetingId: string;

  beforeEach(async () => {
    await cleanDb();
    http = agent();
    const tenant = await createTenant();
    tenantId = tenant.id;
    mentor   = await createMentor(tenantId);
    menti    = await createMenti(tenantId);
    outsider = await createMenti(tenantId); // aynı kurum, bu görüşmenin tarafı değil
    admin    = await createAdminUser(tenantId);

    const meeting = await testPrisma.meeting.create({
      data: {
        tenantId,
        mentorUserId: mentor.id,
        mentiUserId:  menti.id,
        status:       'COMPLETED',
        format:       'ONLINE',
        startsAt:     new Date(Date.now() - 2 * 60 * 60 * 1000),
        endsAt:       new Date(Date.now() - 1 * 60 * 60 * 1000),
      },
    });
    meetingId = meeting.id;

    await http.post(`/api/meetings/${meetingId}/check-in`).set(tenantHeaders(tenantId, tokenFor(mentor)))
      .send({ overallRating: 4, progressRating: 3, continueIntent: 'EVET', menteePreparedness: 2, openNote: 'mentör notu' })
      .expect(201);
    await http.post(`/api/meetings/${meetingId}/check-in`).set(tenantHeaders(tenantId, tokenFor(menti)))
      .send({ overallRating: 5, progressRating: 4, continueIntent: 'EVET', openNote: 'menti notu' })
      .expect(201);
  });

  it('mentör yalnız kendi kaydını görür; mentinin notu dönmez', async () => {
    const res = await http.get(`/api/meetings/${meetingId}/check-ins`).set(tenantHeaders(tenantId, tokenFor(mentor))).expect(200);
    expect(res.body.total).toBe(1);
    expect(res.body.items[0].userId).toBe(mentor.id);
    expect(JSON.stringify(res.body)).not.toContain('menti notu');
  });

  it('menti yalnız kendi kaydını görür; mentörün hazırlık puanı ve notu dönmez', async () => {
    const res = await http.get(`/api/meetings/${meetingId}/check-ins`).set(tenantHeaders(tenantId, tokenFor(menti))).expect(200);
    expect(res.body.total).toBe(1);
    expect(res.body.items[0].userId).toBe(menti.id);
    expect(JSON.stringify(res.body)).not.toContain('mentör notu');
    expect(res.body.items[0].menteePreparedness ?? null).toBeNull();
  });

  it('kurum yöneticisi görüşmenin tüm kayıtlarını görür', async () => {
    const res = await http.get(`/api/meetings/${meetingId}/check-ins`).set(tenantHeaders(tenantId, tokenFor(admin))).expect(200);
    expect(res.body.total).toBe(2);
  });

  it('negatif: görüşmenin tarafı olmayan kurum üyesi 403 alır ve hiçbir kayıt görmez', async () => {
    const res = await http.get(`/api/meetings/${meetingId}/check-ins`).set(tenantHeaders(tenantId, tokenFor(outsider))).expect(403);
    expect(res.body.items).toBeUndefined();
  });

  it('negatif: başka kurumun yöneticisi görüşmeyi bulamaz (404)', async () => {
    const other = await createTenant();
    const otherAdmin = await createAdminUser(other.id);
    const res = await http.get(`/api/meetings/${meetingId}/check-ins`).set(tenantHeaders(other.id, tokenFor(otherAdmin))).expect(404);
    expect(res.body.items).toBeUndefined();
  });

  it('negatif: kimliksiz istek 401', async () => {
    await http.get(`/api/meetings/${meetingId}/check-ins`).set(tenantHeaders(tenantId)).expect(401);
  });
});
