/**
 * Geri Bildirim Döngüsü + Anlaşma + Oryantasyon Entegrasyon Testleri
 *
 * İş 1: Kalite katsayısı — düşük puanlı mentor cezalanıyor, yeni nötr kalıyor
 * İş 2: Oryantasyon kilidi otomatik açma
 * İş 3: Cron feedback hatırlatıcısı (feedbackPrompted koruması)
 * İş 4: MentorshipAgreement CRUD + dijital onay akışı
 * İş 5: Anlaşma yenileme cron'u
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { agent, loginAs, tenantHeaders, type TestAgent } from './helpers/request.js';
import { cleanDb, testPrisma } from './helpers/db.js';
import { createTenant, createAdminUser, createUser, createMentor, createMenti } from './helpers/factories.js';
import { computeMentorQualityMultiplier } from '../src/services/scoring.js';
import { runFeedbackReminderCron } from '../src/services/cronScheduler.js';
import { runAgreementRenewalCron } from '../src/services/cronScheduler.js';
import type { Tenant } from '@prisma/client';

// ─── Yardımcı: Meeting + Feedback oluştur ─────────────────────────────────────

async function seedMeetingWithFeedback(
  tenantId: string,
  mentorId: string,
  mentiId: string,
  scores: { guidanceScore?: number; resourceSharingScore?: number; trustScore?: number },
) {
  const meeting = await testPrisma.meeting.create({
    data: {
      tenantId,
      mentorUserId: mentorId,
      mentiUserId:  mentiId,
      startsAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
      endsAt:   new Date(Date.now() - 1 * 60 * 60 * 1000),
      status:   'COMPLETED',
      hasFeedback: true,
    },
  });
  await testPrisma.feedback.create({
    data: {
      meetingId: meeting.id,
      tenantId,
      mentorId,
      mentiId,
      ...scores,
    },
  });
  return meeting;
}

// ─── İŞ 1: Kalite Katsayısı ─────────────────────────────────────────────────

describe('İş 1: computeMentorQualityMultiplier', () => {
  let tenant: Tenant;
  let mentorId: string;
  let mentiId:  string;

  beforeEach(async () => {
    await cleanDb();
    tenant = await createTenant();
    const mentor = await createUser({ tenantId: tenant.id, role: 'MENTOR' });
    const menti  = await createUser({ tenantId: tenant.id, role: 'MENTI' });
    mentorId = mentor.id;
    mentiId  = menti.id;
  });

  it('yeni mentor (0 görüşme) → nötr katsayı (1.0)', async () => {
    const mult = await computeMentorQualityMultiplier(mentorId);
    expect(mult).toBe(1.0);
  });

  it('2 görüşme (< 3 eşik) → nötr katsayı (1.0)', async () => {
    await seedMeetingWithFeedback(tenant.id, mentorId, mentiId, { guidanceScore: 1, resourceSharingScore: 1, trustScore: 1 });
    await seedMeetingWithFeedback(tenant.id, mentorId, mentiId, { guidanceScore: 1 });
    const mult = await computeMentorQualityMultiplier(mentorId);
    expect(mult).toBe(1.0);
  });

  it('3 görüşme, mükemmel puan (5) → yüksek katsayı (1.2)', async () => {
    for (let i = 0; i < 3; i++) {
      await seedMeetingWithFeedback(tenant.id, mentorId, mentiId, { guidanceScore: 5, resourceSharingScore: 5, trustScore: 5 });
    }
    const mult = await computeMentorQualityMultiplier(mentorId);
    expect(mult).toBe(1.2);
  });

  it('3 görüşme, çok kötü puan (1) → düşük katsayı (0.8)', async () => {
    for (let i = 0; i < 3; i++) {
      await seedMeetingWithFeedback(tenant.id, mentorId, mentiId, { guidanceScore: 1, resourceSharingScore: 1, trustScore: 1 });
    }
    const mult = await computeMentorQualityMultiplier(mentorId);
    expect(mult).toBe(0.8);
  });

  it('API: düşük puanlı mentor sıralamada eşleşme skoru azalmış', async () => {
    const http = agent();
    const admin = await createAdminUser(tenant.id);
    const adminTokens = await loginAs(http, admin.email, admin.rawPassword);

    const goodMentor = await createMentor(tenant.id, { sectorTags: ['teknoloji'] });
    const badMentor  = await createMentor(tenant.id, { sectorTags: ['teknoloji'] });
    await createMenti(tenant.id, { sectorTags: ['teknoloji'] });

    // badMentor'a 3 kötü puan ver
    const anotherMenti = await createUser({ tenantId: tenant.id, role: 'MENTI' });
    for (let i = 0; i < 3; i++) {
      await seedMeetingWithFeedback(tenant.id, badMentor.id, anotherMenti.id, { guidanceScore: 1, resourceSharingScore: 1, trustScore: 1 });
    }

    const goodRes = await http
      .get(`/api/mentors/${goodMentor.id}/candidates`)
      .set(tenantHeaders(tenant.id, adminTokens.accessToken))
      .expect(200);

    const badRes = await http
      .get(`/api/mentors/${badMentor.id}/candidates`)
      .set(tenantHeaders(tenant.id, adminTokens.accessToken))
      .expect(200);

    const goodItems = (goodRes.body as { items: { totalScore: number; qualityMultiplier: number }[] }).items;
    const badItems  = (badRes.body as { items: { totalScore: number; qualityMultiplier: number }[] }).items;

    if (goodItems.length > 0 && badItems.length > 0) {
      // İyi mentorun katsayısı 1.0, kötü mentorun 0.8 → aynı ham skor için total daha düşük
      expect(badItems[0].qualityMultiplier).toBe(0.8);
      expect(goodItems[0].qualityMultiplier).toBe(1.0);
      expect(badItems[0].totalScore).toBeLessThan(goodItems[0].totalScore);
    }
  });
});

// ─── İŞ 2: Oryantasyon Kilidi Otomatik Açma ─────────────────────────────────

describe('İş 2: orientation-completed endpoint', () => {
  let http: TestAgent;
  let tenant: Tenant;
  let mentiToken: string;
  let mentiId: string;

  beforeEach(async () => {
    await cleanDb();
    http = agent();
    tenant = await createTenant();
    const menti = await createUser({ tenantId: tenant.id, role: 'MENTI', approvalStatus: 'APPROVED' });
    const tokens = await loginAs(http, menti.email, menti.rawPassword);
    mentiToken = tokens.accessToken;
    mentiId = menti.id;
  });

  it('kilitli menti rehberi tamamlayınca kilit kalkar', async () => {
    await testPrisma.user.update({ where: { id: mentiId }, data: { needsOrientation: true } });

    const res = await http
      .post('/api/users/me/orientation-completed')
      .set(tenantHeaders(tenant.id, mentiToken))
      .expect(200);

    expect((res.body as { needsOrientation: boolean }).needsOrientation).toBe(false);

    const dbUser = await testPrisma.user.findUnique({ where: { id: mentiId } });
    expect(dbUser?.needsOrientation).toBe(false);
  });

  it('zaten açık kilit → 200 (idempotent)', async () => {
    const res = await http
      .post('/api/users/me/orientation-completed')
      .set(tenantHeaders(tenant.id, mentiToken))
      .expect(200);

    expect((res.body as { needsOrientation: boolean }).needsOrientation).toBe(false);
  });

  it('MENTOR rolü bu endpoint erişemez (403)', async () => {
    const mentor = await createUser({ tenantId: tenant.id, role: 'MENTOR' });
    const mentorTokens = await loginAs(http, mentor.email, mentor.rawPassword);

    await http
      .post('/api/users/me/orientation-completed')
      .set(tenantHeaders(tenant.id, mentorTokens.accessToken))
      .expect(403);
  });
});

// ─── İŞ 3: Feedback Reminder Cron ────────────────────────────────────────────

describe('İş 3: runFeedbackReminderCron', () => {
  let tenant: Tenant;
  let mentorId: string;
  let mentiId:  string;

  beforeEach(async () => {
    await cleanDb();
    tenant = await createTenant();
    const mentor = await createUser({ tenantId: tenant.id, role: 'MENTOR' });
    const menti  = await createUser({ tenantId: tenant.id, role: 'MENTI' });
    mentorId = mentor.id;
    mentiId  = menti.id;
  });

  it('tamamlanmış ve feedback eksik toplantıya hatırlatma gönderir + feedbackPrompted=true', async () => {
    const meeting = await testPrisma.meeting.create({
      data: {
        tenantId:     tenant.id,
        mentorUserId: mentorId,
        mentiUserId:  mentiId,
        startsAt: new Date(Date.now() - 3 * 60 * 60 * 1000),
        endsAt:   new Date(Date.now() - 2 * 60 * 60 * 1000),
        status:   'COMPLETED',
        hasFeedback:      false,
        feedbackPrompted: false,
      },
    });

    const result = await runFeedbackReminderCron();
    expect(result.sent).toBeGreaterThanOrEqual(1);

    const updated = await testPrisma.meeting.findUnique({ where: { id: meeting.id } });
    expect(updated?.feedbackPrompted).toBe(true);
  });

  it('feedbackPrompted=true olan toplantıya tekrar göndermez', async () => {
    await testPrisma.meeting.create({
      data: {
        tenantId: tenant.id, mentorUserId: mentorId, mentiUserId: mentiId,
        startsAt: new Date(Date.now() - 3 * 60 * 60 * 1000),
        endsAt:   new Date(Date.now() - 2 * 60 * 60 * 1000),
        status: 'COMPLETED', hasFeedback: false, feedbackPrompted: true,
      },
    });

    const result = await runFeedbackReminderCron();
    expect(result.sent).toBe(0);
  });

  it('hasFeedback=true olan toplantıyı atlar', async () => {
    await testPrisma.meeting.create({
      data: {
        tenantId: tenant.id, mentorUserId: mentorId, mentiUserId: mentiId,
        startsAt: new Date(Date.now() - 3 * 60 * 60 * 1000),
        endsAt:   new Date(Date.now() - 2 * 60 * 60 * 1000),
        status: 'COMPLETED', hasFeedback: true, feedbackPrompted: false,
      },
    });

    const result = await runFeedbackReminderCron();
    expect(result.sent).toBe(0);
  });
});

// ─── İŞ 4: MentorshipAgreement ───────────────────────────────────────────────

describe('İş 4: MentorshipAgreement', () => {
  let http: TestAgent;
  let tenant: Tenant;
  let mentorToken: string;
  let mentiToken:  string;
  let mentorId: string;
  let mentiId:  string;

  beforeEach(async () => {
    await cleanDb();
    http = agent();
    tenant = await createTenant();
    const mentor = await createUser({ tenantId: tenant.id, role: 'MENTOR', approvalStatus: 'APPROVED' });
    const menti  = await createUser({ tenantId: tenant.id, role: 'MENTI',  approvalStatus: 'APPROVED' });
    const mentorTokens = await loginAs(http, mentor.email, mentor.rawPassword);
    const mentiTokens  = await loginAs(http, menti.email,  menti.rawPassword);
    mentorToken = mentorTokens.accessToken;
    mentiToken  = mentiTokens.accessToken;
    mentorId = mentor.id;
    mentiId  = menti.id;
  });

  const validPayload = () => ({
    mentorId,
    mentiId,
    meetingFrequency: 'BIWEEKLY',
    communicationChannel: 'ONLINE',
    durationWeeks: 12,
    targetMeetings: 6,
    mentiGoal: 'Teknoloji sektöründe kariyer geçişimi tamamlamak ve ilk iş fırsatını bulmak.',
    privacyAgreed: true,
  });

  it('mentor anlaşma taslağı oluşturabilir (201)', async () => {
    const res = await http
      .post('/api/agreements')
      .set(tenantHeaders(tenant.id, mentorToken))
      .send(validPayload())
      .expect(201);

    const body = res.body as { status: string; mentorId: string; mentiId: string };
    expect(body.status).toBe('DRAFT');
    expect(body.mentorId).toBe(mentorId);
    expect(body.mentiId).toBe(mentiId);
  });

  it('menti onaylayınca ACTIVE olur', async () => {
    const created = await http
      .post('/api/agreements')
      .set(tenantHeaders(tenant.id, mentorToken))
      .send(validPayload())
      .expect(201);

    const agreementId = (created.body as { id: string }).id;

    // Mentor onaylar
    await http
      .post(`/api/agreements/${agreementId}/confirm`)
      .set(tenantHeaders(tenant.id, mentorToken))
      .expect(200);

    // Menti onaylar → ACTIVE
    const finalRes = await http
      .post(`/api/agreements/${agreementId}/confirm`)
      .set(tenantHeaders(tenant.id, mentiToken))
      .expect(200);

    expect((finalRes.body as { status: string }).status).toBe('ACTIVE');
  });

  it('active anlaşmayı GET /active ile getirir', async () => {
    const created = await http.post('/api/agreements').set(tenantHeaders(tenant.id, mentorToken)).send(validPayload()).expect(201);
    const id = (created.body as { id: string }).id;
    await http.post(`/api/agreements/${id}/confirm`).set(tenantHeaders(tenant.id, mentorToken));
    await http.post(`/api/agreements/${id}/confirm`).set(tenantHeaders(tenant.id, mentiToken));

    const res = await http.get('/api/agreements/active').set(tenantHeaders(tenant.id, mentiToken)).expect(200);
    expect((res.body as { id: string; status: string }).status).toBe('ACTIVE');
  });

  it('yabancı kullanıcı başka çiftin anlaşmasını onaylayamaz (403)', async () => {
    const outsider = await createUser({ tenantId: tenant.id, role: 'MENTI', approvalStatus: 'APPROVED' });
    const outsiderTokens = await loginAs(http, outsider.email, outsider.rawPassword);

    const created = await http.post('/api/agreements').set(tenantHeaders(tenant.id, mentorToken)).send(validPayload()).expect(201);
    const id = (created.body as { id: string }).id;

    await http.post(`/api/agreements/${id}/confirm`).set(tenantHeaders(tenant.id, outsiderTokens.accessToken)).expect(403);
  });
});

// ─── İŞ 5: Anlaşma Yenileme Cron ────────────────────────────────────────────

describe('İş 5: runAgreementRenewalCron', () => {
  let tenant: Tenant;

  beforeEach(async () => {
    await cleanDb();
    tenant = await createTenant();
  });

  it('bitmek üzere anlaşmayı RENEWAL_PENDING yapar', async () => {
    const mentor = await createUser({ tenantId: tenant.id, role: 'MENTOR' });
    const menti  = await createUser({ tenantId: tenant.id, role: 'MENTI' });

    const agreement = await testPrisma.mentorshipAgreement.create({
      data: {
        tenantId: tenant.id,
        mentorId: mentor.id,
        mentiId:  menti.id,
        meetingFrequency: 'BIWEEKLY',
        communicationChannel: 'ONLINE',
        durationWeeks: 4,
        targetMeetings: 4,
        mentiGoal: 'Test hedef — yenileme testinde kullanılıyor.',
        privacyAgreed: true,
        status: 'ACTIVE',
        mentorConfirmedAt: new Date(),
        mentiConfirmedAt:  new Date(),
        expiresAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000), // 3 gün sonra
      },
    });

    const result = await runAgreementRenewalCron();
    expect(result.prompted).toBeGreaterThanOrEqual(1);

    const updated = await testPrisma.mentorshipAgreement.findUnique({ where: { id: agreement.id } });
    expect(updated?.status).toBe('RENEWAL_PENDING');
    expect(updated?.renewalAskedAt).not.toBeNull();
  });

  it('yeterince uzak anlaşma etkilenmez', async () => {
    const mentor = await createUser({ tenantId: tenant.id, role: 'MENTOR' });
    const menti  = await createUser({ tenantId: tenant.id, role: 'MENTI' });

    await testPrisma.mentorshipAgreement.create({
      data: {
        tenantId: tenant.id, mentorId: mentor.id, mentiId: menti.id,
        meetingFrequency: 'MONTHLY', communicationChannel: 'ONLINE',
        durationWeeks: 24, targetMeetings: 6,
        mentiGoal: 'Uzun süre kalan anlaşma — etkilenmemeli.',
        privacyAgreed: true, status: 'ACTIVE',
        mentorConfirmedAt: new Date(), mentiConfirmedAt: new Date(),
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 gün sonra
      },
    });

    const result = await runAgreementRenewalCron();
    expect(result.prompted).toBe(0);
  });
});
