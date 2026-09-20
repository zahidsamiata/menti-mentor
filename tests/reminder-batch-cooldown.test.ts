/**
 * V-07 — POST /api/meetings/reminders/send batch + cooldown testi.
 *
 * Hata: uç bekleyen TÜM toplantılara (2 mail/toplantı) batch/cooldown olmadan mail atıyordu;
 * admin arka arkaya tıklayınca kurum spam'lenir, SMTP itibarı yanardı. Düzeltme: çağrı başına
 * batch tavanı + toplantı başına in-memory cooldown (şema değişmeden).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { agent, loginAs, tenantHeaders, type TestAgent } from './helpers/request.js';
import { cleanDb, testPrisma } from './helpers/db.js';
import { createTenant, createAdminUser, createMentor, createMenti } from './helpers/factories.js';
import { resetFeedbackReminderCooldown } from '../src/controllers/feedbackController.js';

async function completedMeetingNoFeedback(tenantId: string, mentorId: string, mentiId: string) {
  return testPrisma.meeting.create({
    data: {
      tenantId,
      mentorUserId: mentorId,
      mentiUserId: mentiId,
      startsAt: new Date(Date.now() - 3 * 60 * 60 * 1000),
      endsAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
      status: 'COMPLETED',
      hasFeedback: false,
      feedbackPrompted: false,
    },
  });
}

describe('POST /api/meetings/reminders/send — batch + cooldown (V-07)', () => {
  let http: TestAgent;
  let tenantId: string;
  let mentorId: string;
  let mentiId: string;
  let adminToken: string;
  const originalBatch = process.env['FEEDBACK_REMINDER_BATCH_LIMIT'];

  beforeEach(async () => {
    await cleanDb();
    resetFeedbackReminderCooldown();
    http = agent();
    const tenant = await createTenant();
    tenantId = tenant.id;
    const admin = await createAdminUser(tenantId);
    const mentor = await createMentor(tenantId);
    const menti = await createMenti(tenantId);
    mentorId = mentor.id;
    mentiId = menti.id;
    ({ accessToken: adminToken } = await loginAs(http, admin.email, admin.rawPassword));
  });

  afterEach(() => {
    process.env['FEEDBACK_REMINDER_BATCH_LIMIT'] = originalBatch;
    resetFeedbackReminderCooldown();
  });

  it('cooldown: ikinci çağrı aynı toplantıya tekrar göndermez', async () => {
    await completedMeetingNoFeedback(tenantId, mentorId, mentiId);

    const first = await http
      .post('/api/meetings/reminders/send')
      .set(tenantHeaders(tenantId, adminToken));
    expect(first.status).toBe(200);
    expect(first.body.count).toBe(1);

    const second = await http
      .post('/api/meetings/reminders/send')
      .set(tenantHeaders(tenantId, adminToken));
    expect(second.status).toBe(200);
    expect(second.body.count).toBe(0);
    expect(second.body.skippedCooldown).toBe(1);
  });

  it('batch tavanı: tavanı aşan toplantılar remaining olarak raporlanır', async () => {
    process.env['FEEDBACK_REMINDER_BATCH_LIMIT'] = '1';
    await completedMeetingNoFeedback(tenantId, mentorId, mentiId);
    await completedMeetingNoFeedback(tenantId, mentorId, mentiId);

    const res = await http
      .post('/api/meetings/reminders/send')
      .set(tenantHeaders(tenantId, adminToken));
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(1);
    expect(res.body.remaining).toBe(1);
  });
});
