/**
 * IDOR: PATCH /api/meetings/:id — mentör ownership.
 *
 * Route ADMIN|MENTOR'a açık ama bir MENTÖR yalnızca KENDİ görüşmesinin statüsünü
 * değiştirebilmeli. Başka bir mentör başka çiftin görüşmesini değiştiremez (403). ADMIN yetkili.
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

describe('IDOR: PATCH /api/meetings/:id — mentör ownership', () => {
  let http: TestAgent;
  let tenantId: string;
  let mentorA: Awaited<ReturnType<typeof createMentor>>;
  let mentorB: Awaited<ReturnType<typeof createMentor>>;
  let admin: Awaited<ReturnType<typeof createAdminUser>>;
  let meetingId: string;

  beforeEach(async () => {
    await cleanDb();
    http = agent();
    const tenant = await createTenant();
    tenantId = tenant.id;
    mentorA = await createMentor(tenantId);
    mentorB = await createMentor(tenantId);
    admin = await createAdminUser(tenantId);
    const menti = await createMenti(tenantId);

    const meeting = await testPrisma.meeting.create({
      data: {
        tenantId,
        mentorUserId: mentorA.id,
        mentiUserId: menti.id,
        status: 'PENDING',
        format: 'ONLINE',
        startsAt: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000),
        endsAt: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000 + 60 * 60 * 1000),
      },
    });
    meetingId = meeting.id;
  });

  it('görüşmenin mentörü statüyü değiştirebilir (200)', async () => {
    await http
      .patch(`/api/meetings/${meetingId}`)
      .set(tenantHeaders(tenantId, tokenFor(mentorA)))
      .send({ status: 'CANCELLED' })
      .expect(200);
  });

  it('BAŞKA bir mentör görüşmeyi değiştiremez (403)', async () => {
    const res = await http
      .patch(`/api/meetings/${meetingId}`)
      .set(tenantHeaders(tenantId, tokenFor(mentorB)))
      .send({ status: 'CANCELLED' })
      .expect(403);
    expect(res.body.error).toBe('YETKISIZ');
  });

  it('ADMIN görüşmeyi değiştirebilir (200)', async () => {
    await http
      .patch(`/api/meetings/${meetingId}`)
      .set(tenantHeaders(tenantId, tokenFor(admin)))
      .send({ status: 'CANCELLED' })
      .expect(200);
  });
});
