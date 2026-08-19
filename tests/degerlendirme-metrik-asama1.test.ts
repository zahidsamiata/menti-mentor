/**
 * #7 Aşama 1 — Değerlendirme + Metrik: ölü uçları bağlama testleri
 *
 * FAZ 1: Kalite katsayısını TenantMembership'e KALICI yaz (persistMentorQualityMultiplier)
 * FAZ 2: Kalite puanı + risk sinyali yönetici görünürlüğü — KVKK: kişi kendi puanını/sinyalini GÖRMEZ
 * FAZ 3: Periyodik değerlendirme checkpoint cron'u (findMatchesDueForCheckpoint bağlandı, LOG-ONLY)
 *
 * KVKK KRİTİK: Kalite puanı ve risk sinyali YALNIZ yönetici (ADMIN) endpoint'lerinde döner;
 * menti/mentör (peer/self) bu endpoint'lere erişemez (403) → puan/sinyal sızmaz. Bu dosyanın
 * en önemli güvenlik kanıtı budur (disc-visibility.test.ts KARAR 5 deseniyle aynı ruh).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { agent, loginAs, tenantHeaders, type TestAgent } from './helpers/request.js';
import { cleanDb, testPrisma } from './helpers/db.js';
import { createTenant, createAdminUser, createUser, createUserProfile } from './helpers/factories.js';
import { persistMentorQualityMultiplier } from '../src/services/scoring.js';
import { computePairSignalFromCheckIns } from '../src/services/pairSignal.service.js';
import { runCheckpointFeedbackReminderCron } from '../src/services/cronScheduler.js';
import type { Tenant } from '@prisma/client';

const HOUR = 60 * 60 * 1000;
const DAY  = 24 * HOUR;

// menti→mentör puanlı (guidance/resourceSharing/trust) tamamlanmış görüşme + feedback
async function seedMentorFeedback(
  tenantId: string,
  mentorId: string,
  mentiId: string,
  scores: { guidanceScore?: number; resourceSharingScore?: number; trustScore?: number },
) {
  const meeting = await testPrisma.meeting.create({
    data: {
      tenantId, mentorUserId: mentorId, mentiUserId: mentiId,
      startsAt: new Date(Date.now() - 2 * HOUR),
      endsAt:   new Date(Date.now() - 1 * HOUR),
      status: 'COMPLETED', hasFeedback: true,
    },
  });
  await testPrisma.feedback.create({
    data: { meetingId: meeting.id, tenantId, mentorId, mentiId, ...scores },
  });
  return meeting;
}

// UserProfile'lı mentör+menti + ACTIVE Match (checkpoint/eşleşme testleri için)
async function seedMatch(
  tenantId: string,
  opts: { createdAt?: Date } = {},
): Promise<{ mentorUserId: string; mentiUserId: string; matchId: string }> {
  const mentor = await createUser({ tenantId, role: 'MENTOR' });
  const menti  = await createUser({ tenantId, role: 'MENTI' });
  const mentorProfile = await createUserProfile(mentor.id, { archetype: 'ARCHITECT', archetypeRole: 'MENTOR' });
  const mentiProfile  = await createUserProfile(menti.id,  { archetype: 'EXPLORER',  archetypeRole: 'MENTI' });

  const match = await testPrisma.match.create({
    data: {
      tenantId,
      mentorId: mentorProfile.id,
      mentiId:  mentiProfile.id,
      predictedScore: 80, sectorScore: 80, characterScore: 80,
      mentorArchetype: 'ARCHITECT', mentiArchetype: 'EXPLORER',
      status: 'ACTIVE',
      ...(opts.createdAt ? { createdAt: opts.createdAt } : {}),
    },
  });
  return { mentorUserId: mentor.id, mentiUserId: menti.id, matchId: match.id };
}

// ─── FAZ 1: Kalıcı kalite puanı ──────────────────────────────────────────────

describe('FAZ 1: persistMentorQualityMultiplier', () => {
  let tenant: Tenant;
  let mentorId: string;
  let mentiId: string;

  beforeEach(async () => {
    await cleanDb();
    tenant = await createTenant();
    const mentor = await createUser({ tenantId: tenant.id, role: 'MENTOR' });
    const menti  = await createUser({ tenantId: tenant.id, role: 'MENTI' });
    mentorId = mentor.id;
    mentiId  = menti.id;
  });

  it('3 kötü feedback → qualityMultiplier TenantMembership\'e 0.8 KALICI yazılır', async () => {
    for (let i = 0; i < 3; i++) {
      await seedMentorFeedback(tenant.id, mentorId, mentiId, { guidanceScore: 1, resourceSharingScore: 1, trustScore: 1 });
    }
    const mult = await persistMentorQualityMultiplier(mentorId, tenant.id);
    expect(mult).toBe(0.8);

    const m = await testPrisma.tenantMembership.findUnique({
      where: { userId_tenantId: { userId: mentorId, tenantId: tenant.id } },
    });
    expect(m?.qualityMultiplier).toBe(0.8);
  });

  it('3 mükemmel feedback → 1.2 yazılır', async () => {
    for (let i = 0; i < 3; i++) {
      await seedMentorFeedback(tenant.id, mentorId, mentiId, { guidanceScore: 5, resourceSharingScore: 5, trustScore: 5 });
    }
    await persistMentorQualityMultiplier(mentorId, tenant.id);
    const m = await testPrisma.tenantMembership.findUnique({
      where: { userId_tenantId: { userId: mentorId, tenantId: tenant.id } },
    });
    expect(m?.qualityMultiplier).toBe(1.2);
  });

  it('sertifika STARTING_MULTIPLIER (1.0) baseline\'ı feedback üstüne yazar (çakışmaz)', async () => {
    // Sertifika akışı membership.qualityMultiplier = 1.0 yazmış olsun (baseline)
    await testPrisma.tenantMembership.update({
      where: { userId_tenantId: { userId: mentorId, tenantId: tenant.id } },
      data:  { qualityMultiplier: 1.0, isCertified: true },
    });
    for (let i = 0; i < 3; i++) {
      await seedMentorFeedback(tenant.id, mentorId, mentiId, { guidanceScore: 1, resourceSharingScore: 1, trustScore: 1 });
    }
    await persistMentorQualityMultiplier(mentorId, tenant.id);
    const m = await testPrisma.tenantMembership.findUnique({
      where: { userId_tenantId: { userId: mentorId, tenantId: tenant.id } },
    });
    expect(m?.qualityMultiplier).toBe(0.8); // feedback baseline'ı günceller, sertifika bozulmaz
    expect(m?.isCertified).toBe(true);      // sertifika durumu KORUNUR
  });

  it('tenant-scoped: başka tenant\'ın aynı-rol üyeliği etkilenmez', async () => {
    const otherTenant = await createTenant();
    const otherMentor = await createUser({ tenantId: otherTenant.id, role: 'MENTOR' });

    for (let i = 0; i < 3; i++) {
      await seedMentorFeedback(tenant.id, mentorId, mentiId, { guidanceScore: 1, resourceSharingScore: 1, trustScore: 1 });
    }
    await persistMentorQualityMultiplier(mentorId, tenant.id);

    const other = await testPrisma.tenantMembership.findUnique({
      where: { userId_tenantId: { userId: otherMentor.id, tenantId: otherTenant.id } },
    });
    expect(other?.qualityMultiplier).toBe(1.0); // dokunulmadı
  });
});

// ─── FAZ 2: KVKK — kalite puanı + risk sinyali yalnız yöneticiye ─────────────

describe('FAZ 2: adminListUsers kalite puanı (KVKK)', () => {
  let http: TestAgent;
  let tenant: Tenant;

  beforeEach(async () => {
    await cleanDb();
    http = agent();
    tenant = await createTenant();
  });

  it('ADMIN havuz listesinde qualityMultiplier alanı DÖNER', async () => {
    const admin = await createAdminUser(tenant.id);
    const mentor = await createUser({ tenantId: tenant.id, role: 'MENTOR' });
    await testPrisma.tenantMembership.update({
      where: { userId_tenantId: { userId: mentor.id, tenantId: tenant.id } },
      data:  { qualityMultiplier: 0.9 },
    });
    const tokens = await loginAs(http, admin.email, admin.rawPassword);

    const res = await http
      .get('/api/admin/users?role=MENTOR')
      .set(tenantHeaders(tenant.id, tokens.accessToken))
      .expect(200);

    const items = (res.body as { items: { id: string; qualityMultiplier: number | null }[] }).items;
    const row = items.find((u) => u.id === mentor.id);
    expect(row).toBeDefined();
    expect(row?.qualityMultiplier).toBe(0.9);
  });

  it('#34: ADMIN havuz listesinde learningJourneyCompletedAt DÖNER (tamamlandıysa tarih)', async () => {
    const admin = await createAdminUser(tenant.id);
    const done = await createUser({ tenantId: tenant.id, role: 'MENTI' });
    const notDone = await createUser({ tenantId: tenant.id, role: 'MENTI' });
    const completedAt = new Date('2026-08-01T00:00:00.000Z');
    await testPrisma.tenantMembership.update({
      where: { userId_tenantId: { userId: done.id, tenantId: tenant.id } },
      data:  { learningJourneyCompletedAt: completedAt },
    });
    const tokens = await loginAs(http, admin.email, admin.rawPassword);

    const res = await http
      .get('/api/admin/users?role=MENTI')
      .set(tenantHeaders(tenant.id, tokens.accessToken))
      .expect(200);

    const items = (res.body as { items: { id: string; learningJourneyCompletedAt: string | null }[] }).items;
    const doneRow = items.find((u) => u.id === done.id);
    const notDoneRow = items.find((u) => u.id === notDone.id);
    expect(doneRow?.learningJourneyCompletedAt).toBe(completedAt.toISOString());
    // Tamamlamayan → null (FE "—" gösterir)
    expect(notDoneRow?.learningJourneyCompletedAt).toBeNull();
  });

  it('KVKK: MENTİ /api/admin/users çağıramaz (403) → puan sızmaz', async () => {
    const menti = await createUser({ tenantId: tenant.id, role: 'MENTI' });
    const tokens = await loginAs(http, menti.email, menti.rawPassword);
    await http
      .get('/api/admin/users?role=MENTOR')
      .set(tenantHeaders(tenant.id, tokens.accessToken))
      .expect(403);
  });

  it('KVKK: MENTÖR /api/admin/users çağıramaz (403) → kendi puanını görmez', async () => {
    const mentor = await createUser({ tenantId: tenant.id, role: 'MENTOR' });
    const tokens = await loginAs(http, mentor.email, mentor.rawPassword);
    await http
      .get('/api/admin/users?role=MENTOR')
      .set(tenantHeaders(tenant.id, tokens.accessToken))
      .expect(403);
  });

  it('tenant izolasyonu: başka tenant\'ın mentörü listede yok', async () => {
    const admin = await createAdminUser(tenant.id);
    const otherTenant = await createTenant();
    const otherMentor = await createUser({ tenantId: otherTenant.id, role: 'MENTOR' });
    const tokens = await loginAs(http, admin.email, admin.rawPassword);

    const res = await http
      .get('/api/admin/users?role=MENTOR')
      .set(tenantHeaders(tenant.id, tokens.accessToken))
      .expect(200);

    const items = (res.body as { items: { id: string }[] }).items;
    expect(items.find((u) => u.id === otherMentor.id)).toBeUndefined();
  });
});

describe('FAZ 2: adminListMatches risk sinyali (KVKK)', () => {
  let http: TestAgent;
  let tenant: Tenant;

  beforeEach(async () => {
    await cleanDb();
    http = agent();
    tenant = await createTenant();
  });

  it('ADMIN eşleşme listesinde riskSignal DÖNER; 2x "HAYIR" → RED', async () => {
    const admin = await createAdminUser(tenant.id);
    const { mentorUserId, mentiUserId, matchId } = await seedMatch(tenant.id);

    // Bu eşleşmeye bağlı tamamlanmış görüşme + 2 check-in (mentor+menti) continueIntent HAYIR
    const meeting = await testPrisma.meeting.create({
      data: {
        tenantId: tenant.id, matchId, mentorUserId, mentiUserId,
        startsAt: new Date(Date.now() - 2 * HOUR), endsAt: new Date(Date.now() - 1 * HOUR),
        status: 'COMPLETED',
      },
    });
    await testPrisma.meetingCheckIn.createMany({
      data: [
        { meetingId: meeting.id, tenantId: tenant.id, userId: mentorUserId, role: 'MENTOR', overallRating: 2, progressRating: 2, continueIntent: 'HAYIR' },
        { meetingId: meeting.id, tenantId: tenant.id, userId: mentiUserId,  role: 'MENTI',  overallRating: 2, progressRating: 2, continueIntent: 'HAYIR' },
      ],
    });

    const tokens = await loginAs(http, admin.email, admin.rawPassword);
    const res = await http
      .get('/api/admin/matches')
      .set(tenantHeaders(tenant.id, tokens.accessToken))
      .expect(200);

    const items = (res.body as { items: { id: string; riskSignal: string }[] }).items;
    const row = items.find((m) => m.id === matchId);
    expect(row).toBeDefined();
    expect(row?.riskSignal).toBe('RED');
  });

  it('check-in yoksa riskSignal = INSUFFICIENT_DATA (yanıltıcı "İyi" göstermez)', async () => {
    const admin = await createAdminUser(tenant.id);
    const { matchId } = await seedMatch(tenant.id);
    const tokens = await loginAs(http, admin.email, admin.rawPassword);

    const res = await http
      .get('/api/admin/matches')
      .set(tenantHeaders(tenant.id, tokens.accessToken))
      .expect(200);

    const items = (res.body as { items: { id: string; riskSignal: string }[] }).items;
    const row = items.find((m) => m.id === matchId);
    expect(row?.riskSignal).toBe('INSUFFICIENT_DATA');
  });

  it('KVKK: MENTİ /api/admin/matches çağıramaz (403) → risk sinyali sızmaz', async () => {
    const menti = await createUser({ tenantId: tenant.id, role: 'MENTI' });
    const tokens = await loginAs(http, menti.email, menti.rawPassword);
    await http
      .get('/api/admin/matches')
      .set(tenantHeaders(tenant.id, tokens.accessToken))
      .expect(403);
  });
});

// ─── FAZ 2: Saf sinyal hesabı (DB'siz birim test) ────────────────────────────

describe('computePairSignalFromCheckIns (saf)', () => {
  it('boş → INSUFFICIENT_DATA', () => {
    expect(computePairSignalFromCheckIns([]).signal).toBe('INSUFFICIENT_DATA');
  });
  it('yüksek puan → GREEN', () => {
    const r = computePairSignalFromCheckIns([
      { overallRating: 5, continueIntent: 'EVET' },
      { overallRating: 4, continueIntent: 'EVET' },
    ]);
    expect(r.signal).toBe('GREEN');
  });
  it('orta puan (2.5–3.5) → YELLOW', () => {
    const r = computePairSignalFromCheckIns([
      { overallRating: 3, continueIntent: 'EVET' },
      { overallRating: 3, continueIntent: 'BELIRSIZ' },
    ]);
    expect(r.signal).toBe('YELLOW');
  });
  it('düşük ortalama (<2.5) → RED', () => {
    const r = computePairSignalFromCheckIns([
      { overallRating: 2, continueIntent: 'EVET' },
      { overallRating: 2, continueIntent: 'EVET' },
    ]);
    expect(r.signal).toBe('RED');
  });
  it('2x "HAYIR" → RED (puan iyi olsa bile)', () => {
    const r = computePairSignalFromCheckIns([
      { overallRating: 5, continueIntent: 'HAYIR' },
      { overallRating: 5, continueIntent: 'HAYIR' },
    ]);
    expect(r.signal).toBe('RED');
    expect(r.exitIntents).toBe(2);
  });
});

// ─── FAZ 3: Periyodik checkpoint cron (log-only) ─────────────────────────────

describe('FAZ 3: runCheckpointFeedbackReminderCron', () => {
  let tenant: Tenant;

  beforeEach(async () => {
    await cleanDb();
    tenant = await createTenant();
  });

  it('DAY_3 vadesi dolan ACTIVE eşleşmeyi bulur (feedback yoksa)', async () => {
    // 3.4 gün önce oluşmuş ACTIVE eşleşme → DAY_3 penceresi [now-4g, now-3g] içinde
    await seedMatch(tenant.id, { createdAt: new Date(Date.now() - 3.4 * DAY) });

    const result = await runCheckpointFeedbackReminderCron();
    expect(result.due.DAY_3).toBeGreaterThanOrEqual(1);
  });

  it('DAY_3 feedback zaten varsa saymaz', async () => {
    const { matchId, mentorUserId } = await seedMatch(tenant.id, { createdAt: new Date(Date.now() - 3.4 * DAY) });
    await testPrisma.matchFeedback.create({
      data: { matchId, checkpoint: 'DAY_3', fromUserId: mentorUserId, role: 'MENTOR', progressScore: 4, rapportScore: 4 },
    });

    const result = await runCheckpointFeedbackReminderCron();
    expect(result.due.DAY_3).toBe(0);
  });
});
