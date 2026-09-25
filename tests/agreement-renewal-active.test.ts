/**
 * KR-18 — yenilenen anlaşma "aktif" listesinden düşmez, bitirilebilir.
 * Yenileme kaydı yeniden ACTIVE yapar; eski RENEWED kayıtlar da aktif sayılır.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { agent, tenantHeaders, type TestAgent } from './helpers/request.js';
import { cleanDb, testPrisma } from './helpers/db.js';
import { createTenant, createMentor, createMenti } from './helpers/factories.js';
import { signToken } from '../src/middleware/jwtAuth.js';
import type { User, AgreementStatus } from '@prisma/client';

function tokenFor(u: Pick<User, 'id' | 'tenantId' | 'role' | 'fullName'>): string {
  return signToken({ sub: u.id, tenantId: u.tenantId, role: u.role, fullName: u.fullName });
}

describe('KR-18: anlaşma yenileme sonrası', () => {
  let http: TestAgent;
  let tenantId: string;
  let mentor: Awaited<ReturnType<typeof createMentor>>;
  let menti: Awaited<ReturnType<typeof createMenti>>;

  async function agreementWith(status: AgreementStatus) {
    return testPrisma.mentorshipAgreement.create({
      data: {
        tenantId, mentorId: mentor.id, mentiId: menti.id,
        meetingFrequency: 'WEEKLY', communicationChannel: 'ONLINE', durationWeeks: 4, targetMeetings: 4,
        mentiGoal: 'Hedef', status, expiresAt: new Date(Date.now() + 3 * 24 * 3600_000),
        mentorConfirmedAt: new Date(), mentiConfirmedAt: new Date(),
      },
    });
  }

  beforeEach(async () => {
    await cleanDb();
    http = agent();
    const tenant = await createTenant();
    tenantId = tenant.id;
    mentor = await createMentor(tenantId);
    menti = await createMenti(tenantId);
  });

  it('yenileme sonrası anlaşma ACTIVE, süresi uzamış ve aktif listede', async () => {
    const a = await agreementWith('RENEWAL_PENDING');
    const res = await http.post(`/api/agreements/${a.id}/renew`).set(tenantHeaders(tenantId, tokenFor(menti))).expect(200);
    expect(res.body.status).toBe('ACTIVE');
    expect(new Date(res.body.expiresAt).getTime()).toBeGreaterThan(Date.now() + 20 * 24 * 3600_000);

    const active = await http.get('/api/agreements/active').set(tenantHeaders(tenantId, tokenFor(mentor))).expect(200);
    expect(active.body.id).toBe(a.id);
  });

  it('yenilenen anlaşma bitirilebilir', async () => {
    const a = await agreementWith('RENEWAL_PENDING');
    await http.post(`/api/agreements/${a.id}/renew`).set(tenantHeaders(tenantId, tokenFor(menti))).expect(200);
    const res = await http.post(`/api/agreements/${a.id}/end`).set(tenantHeaders(tenantId, tokenFor(mentor))).expect(200);
    expect(res.body.status).toBe('ENDED');
  });

  it('eski RENEWED kayıt aktif sayılır ve bitirilebilir', async () => {
    const a = await agreementWith('RENEWED');
    const active = await http.get('/api/agreements/active').set(tenantHeaders(tenantId, tokenFor(menti))).expect(200);
    expect(active.body.id).toBe(a.id);
    await http.post(`/api/agreements/${a.id}/end`).set(tenantHeaders(tenantId, tokenFor(menti))).expect(200);
  });

  it('negatif: anlaşmanın tarafı olmayan yenileyemez (403) ve durum değişmez', async () => {
    const a = await agreementWith('RENEWAL_PENDING');
    const outsider = await createMenti(tenantId);
    await http.post(`/api/agreements/${a.id}/renew`).set(tenantHeaders(tenantId, tokenFor(outsider))).expect(403);
    const after = await testPrisma.mentorshipAgreement.findUnique({ where: { id: a.id }, select: { status: true } });
    expect(after?.status).toBe('RENEWAL_PENDING');
  });
});
