/**
 * KR-17 — mentör aynı saatteki ikinci görüşme talebini onaylayamaz.
 * Onay anında çakışma yeniden kontrol edilir; çakışan talep 409 alır ve PENDING kalır.
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

describe('KR-17: onayda çakışma kontrolü', () => {
  let http: TestAgent;
  let tenantId: string;
  let mentor: Awaited<ReturnType<typeof createMentor>>;
  let mentiA: Awaited<ReturnType<typeof createMenti>>;
  let mentiB: Awaited<ReturnType<typeof createMenti>>;
  const slotStart = new Date(Date.now() + 7 * 24 * 3600_000);
  const slotEnd = new Date(slotStart.getTime() + 3600_000);

  async function pending(mentiId: string, start = slotStart, end = slotEnd) {
    return testPrisma.meeting.create({
      data: { tenantId, mentorUserId: mentor.id, mentiUserId: mentiId, status: 'PENDING', format: 'ONLINE', startsAt: start, endsAt: end },
    });
  }

  beforeEach(async () => {
    await cleanDb();
    http = agent();
    const tenant = await createTenant();
    tenantId = tenant.id;
    mentor = await createMentor(tenantId);
    mentiA = await createMenti(tenantId);
    mentiB = await createMenti(tenantId);
  });

  // KARAR-7 (A): ONLINE görüşme onayı artık toplantı linki ister — bu dosyanın odağı (KR-17
  // çakışma kontrolü) bundan bağımsız, o yüzden testler geçerli bir link gönderir.
  const approve = (id: string) =>
    http.post(`/api/meetings/${id}/approve`)
      .set(tenantHeaders(tenantId, tokenFor(mentor)))
      .send({ locationUrl: 'https://meet.google.com/abc-defg-hij' });

  it('ilk talep onaylanır; aynı saatteki ikinci talep 409 alır ve PENDING kalır (negatif)', async () => {
    const a = await pending(mentiA.id);
    const b = await pending(mentiB.id);
    await approve(a.id).expect(200);
    const res = await approve(b.id);
    expect(res.status).toBe(409);
    const after = await testPrisma.meeting.findUnique({ where: { id: b.id }, select: { status: true } });
    expect(after?.status).toBe('PENDING');
  });

  it('çakışmayan saatteki talep onaylanabilir', async () => {
    const a = await pending(mentiA.id);
    const laterStart = new Date(slotEnd.getTime() + 3600_000);
    const b = await pending(mentiB.id, laterStart, new Date(laterStart.getTime() + 3600_000));
    await approve(a.id).expect(200);
    await approve(b.id).expect(200);
  });
});
