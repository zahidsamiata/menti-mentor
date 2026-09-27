/**
 * P-05 / KARAR-22 (B) — POST /api/meetings/:meetingId/reject ret deneyimi.
 *
 * Eskiden ret çıplaktı: menti yalnız "İptal Edildi" rozetinden öğreniyordu (onay yolu e-posta
 * atarken ret yolu hiçbir şey göndermiyordu — asimetri). Artık menti'ye jenerik, nazik e-posta
 * gider; mentörün yazdığı gerekçe e-postaya konmaz ve menti'ye API'den de dönmez.
 * Gerçek SMTP gönderimi mock'lanır.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { agent, tenantHeaders, type TestAgent } from './helpers/request.js';
import { cleanDb, testPrisma } from './helpers/db.js';
import { createTenant, createMentor, createMenti } from './helpers/factories.js';
import { signToken } from '../src/middleware/jwtAuth.js';
import type { User } from '@prisma/client';

const mocks = vi.hoisted(() => ({ sendMeetingRejectedEmail: vi.fn().mockResolvedValue(true) }));

vi.mock('../src/services/emailService.js', async (orig) => ({
  ...(await orig<typeof import('../src/services/emailService.js')>()),
  sendMeetingRejectedEmail: mocks.sendMeetingRejectedEmail,
}));

function tokenFor(u: Pick<User, 'id' | 'tenantId' | 'role' | 'fullName'>): string {
  return signToken({ sub: u.id, tenantId: u.tenantId, role: u.role, fullName: u.fullName });
}

const REASON = 'Bu mentinin hedefleri bana uymuyor';

describe('P-05 — görüşme talebi reddi menti bildirimi', () => {
  let http: TestAgent;
  let tenantId: string;
  let mentorA: Awaited<ReturnType<typeof createMentor>>;
  let mentorB: Awaited<ReturnType<typeof createMentor>>;
  let menti: Awaited<ReturnType<typeof createMenti>>;
  let meetingId: string;
  const startsAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

  beforeEach(async () => {
    await cleanDb();
    mocks.sendMeetingRejectedEmail.mockClear();
    http = agent();
    const tenant = await createTenant();
    tenantId = tenant.id;
    mentorA = await createMentor(tenantId);
    mentorB = await createMentor(tenantId);
    menti = await createMenti(tenantId);

    const meeting = await testPrisma.meeting.create({
      data: {
        tenantId,
        mentorUserId: mentorA.id,
        mentiUserId: menti.id,
        status: 'PENDING',
        format: 'ONLINE',
        startsAt,
        endsAt: new Date(startsAt.getTime() + 60 * 60 * 1000),
      },
    });
    meetingId = meeting.id;
  });

  it('mentör reddedince menti\'ye e-posta gider: doğru alıcı, gerekçe YOK', async () => {
    await http
      .post(`/api/meetings/${meetingId}/reject`)
      .set(tenantHeaders(tenantId, tokenFor(mentorA)))
      .send({ reason: REASON })
      .expect(200);

    const updated = await testPrisma.meeting.findUnique({ where: { id: meetingId } });
    expect(updated?.status).toBe('CANCELLED');

    expect(mocks.sendMeetingRejectedEmail).toHaveBeenCalledTimes(1);
    const args = mocks.sendMeetingRejectedEmail.mock.calls[0]![0] as Record<string, unknown>;
    expect(args).toEqual({ toEmail: menti.email, mentiName: menti.fullName, scheduledAt: startsAt });
    expect(JSON.stringify(args)).not.toContain(REASON);
  });

  it('e-posta başarısız olsa da ret tamamlanır', async () => {
    mocks.sendMeetingRejectedEmail.mockRejectedValueOnce(new Error('SMTP down'));
    await http
      .post(`/api/meetings/${meetingId}/reject`)
      .set(tenantHeaders(tenantId, tokenFor(mentorA)))
      .send({})
      .expect(200);
    const updated = await testPrisma.meeting.findUnique({ where: { id: meetingId } });
    expect(updated?.status).toBe('CANCELLED');
  });

  it('BAŞKA bir mentör reddedemez (404) — e-posta gitmez, durum değişmez', async () => {
    await http
      .post(`/api/meetings/${meetingId}/reject`)
      .set(tenantHeaders(tenantId, tokenFor(mentorB)))
      .send({ reason: REASON })
      .expect(404);
    expect(mocks.sendMeetingRejectedEmail).not.toHaveBeenCalled();
    const unchanged = await testPrisma.meeting.findUnique({ where: { id: meetingId } });
    expect(unchanged?.status).toBe('PENDING');
  });

  it('menti reddedemez (403) — e-posta gitmez', async () => {
    await http
      .post(`/api/meetings/${meetingId}/reject`)
      .set(tenantHeaders(tenantId, tokenFor(menti)))
      .send({})
      .expect(403);
    expect(mocks.sendMeetingRejectedEmail).not.toHaveBeenCalled();
  });

  it('ret gerekçesi menti\'ye GET /api/meetings ile dönmez; mentör kendi notunu görür', async () => {
    await http
      .post(`/api/meetings/${meetingId}/reject`)
      .set(tenantHeaders(tenantId, tokenFor(mentorA)))
      .send({ reason: REASON })
      .expect(200);

    const asMenti = await http.get('/api/meetings').set(tenantHeaders(tenantId, tokenFor(menti))).expect(200);
    expect(asMenti.body.items).toHaveLength(1);
    expect(asMenti.body.items[0].notes).toBeNull();
    expect(JSON.stringify(asMenti.body)).not.toContain(REASON);

    const asMentor = await http.get('/api/meetings').set(tenantHeaders(tenantId, tokenFor(mentorA))).expect(200);
    expect(asMentor.body.items[0].notes).toBe(REASON);
  });
});
