/**
 * POST /api/meetings/:meetingId/mark-not-happened — U-01 mentör düzeltmesi.
 *
 * KARAR-80/M11: otomatik-tamamlanmış (COMPLETED) bir toplantı yanlışsa mentör
 * "gerçekleşmedi" diyerek düzeltebilir (→ CANCELLED). Yalnızca görüşmenin KENDİ
 * mentörü yapabilir (approveMeetingByMentor/rejectMeetingByMentor ile aynı IDOR deseni).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { agent, tenantHeaders, type TestAgent } from './helpers/request.js';
import { cleanDb, testPrisma } from './helpers/db.js';
import { createTenant, createMentor, createMenti } from './helpers/factories.js';
import { signToken } from '../src/middleware/jwtAuth.js';
import type { User } from '@prisma/client';

function tokenFor(u: Pick<User, 'id' | 'tenantId' | 'role' | 'fullName'>): string {
  return signToken({ sub: u.id, tenantId: u.tenantId, role: u.role, fullName: u.fullName });
}

describe('POST /api/meetings/:meetingId/mark-not-happened', () => {
  let http: TestAgent;
  let tenantId: string;
  let mentorA: Awaited<ReturnType<typeof createMentor>>;
  let mentorB: Awaited<ReturnType<typeof createMentor>>;
  let meetingId: string;

  beforeEach(async () => {
    await cleanDb();
    http = agent();
    const tenant = await createTenant();
    tenantId = tenant.id;
    mentorA = await createMentor(tenantId);
    mentorB = await createMentor(tenantId);
    const menti = await createMenti(tenantId);

    const meeting = await testPrisma.meeting.create({
      data: {
        tenantId,
        mentorUserId: mentorA.id,
        mentiUserId: menti.id,
        status: 'COMPLETED',
        format: 'ONLINE',
        startsAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
        endsAt: new Date(Date.now() - 60 * 60 * 1000),
      },
    });
    meetingId = meeting.id;
  });

  it('görüşmenin mentörü COMPLETED toplantıyı "gerçekleşmedi" işaretleyebilir (CANCELLED olur)', async () => {
    const res = await http
      .post(`/api/meetings/${meetingId}/mark-not-happened`)
      .set(tenantHeaders(tenantId, tokenFor(mentorA)))
      .send({ reason: 'Menti gelmedi' })
      .expect(200);

    expect(res.body.meeting.status).toBe('CANCELLED');
    const updated = await testPrisma.meeting.findUnique({ where: { id: meetingId } });
    expect(updated?.status).toBe('CANCELLED');
    expect(updated?.notes).toBe('Menti gelmedi');
  });

  it('BAŞKA bir mentör işaretleyemez (404 — sahiplik sızdırmaz)', async () => {
    const res = await http
      .post(`/api/meetings/${meetingId}/mark-not-happened`)
      .set(tenantHeaders(tenantId, tokenFor(mentorB)))
      .send({})
      .expect(404);

    expect(res.body.error).toBe('NOT_FOUND');
    const unchanged = await testPrisma.meeting.findUnique({ where: { id: meetingId } });
    expect(unchanged?.status).toBe('COMPLETED');
  });

  it('MENTI bu ucu çağıramaz (403 — rol yalnızca MENTOR)', async () => {
    const menti = await createMenti(tenantId);
    await http
      .post(`/api/meetings/${meetingId}/mark-not-happened`)
      .set(tenantHeaders(tenantId, tokenFor(menti)))
      .send({})
      .expect(403);
  });

  it('SCHEDULED (henüz tamamlanmamış) toplantı işaretlenemez (404)', async () => {
    const menti = await createMenti(tenantId);
    const scheduled = await testPrisma.meeting.create({
      data: {
        tenantId,
        mentorUserId: mentorA.id,
        mentiUserId: menti.id,
        status: 'SCHEDULED',
        format: 'ONLINE',
        startsAt: new Date(Date.now() + 60 * 60 * 1000),
        endsAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
      },
    });

    await http
      .post(`/api/meetings/${scheduled.id}/mark-not-happened`)
      .set(tenantHeaders(tenantId, tokenFor(mentorA)))
      .send({})
      .expect(404);
  });
});
