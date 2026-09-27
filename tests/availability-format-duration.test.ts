/**
 * K-15 (KARAR-1 → A, "tam mimari"): AvailabilityBlock'a format + süre.
 *
 * Mentör artık müsaitlik bloğu açarken görüşme formatını ve süresini de belirler;
 * menti yalnız hazır bir slotu seçer — kendi format/süresini DAYATAMAZ. Bu dosya:
 *   1) saveAvailability format+durationMin'i kaydediyor mu (ve getAvailability geri veriyor mu)
 *   2) bookMeeting, slotun format/süresine UYMAYAN talebi reddediyor mu (negatif)
 *   3) bir mentörün saveAvailability çağrısı BAŞKA mentörün bloklarına dokunuyor mu (negatif, izolasyon)
 *   4) durationMin doğrulama sınırları (block penceresinden uzun / aralık dışı)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { agent, loginAs, tenantHeaders, type TestAgent } from './helpers/request.js';
import { cleanDb, testPrisma } from './helpers/db.js';
import { createTenant, createMentor, createMenti } from './helpers/factories.js';
import type { Tenant, User } from '@prisma/client';

// P-10 deseniyle aynı: e-posta servisi mock'lanır (fire-and-forget çağrı gerçek SMTP'ye gitmesin).
vi.mock('../src/services/emailService.js', async (orig) => ({
  ...(await orig<typeof import('../src/services/emailService.js')>()),
  sendMeetingRequestEmail: vi.fn(async () => undefined),
}));

const FUTURE_DATE = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 gün sonra
const DAY_NAMES   = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'] as const;

function isoUtc(d: Date, hh: number, mm: number): string {
  const t = new Date(d);
  t.setUTCHours(hh, mm, 0, 0);
  return t.toISOString();
}

const futureWeekday = () => DAY_NAMES[FUTURE_DATE.getUTCDay()] ?? 'MON';

describe('K-15 · saveAvailability — format + durationMin kaydı', () => {
  let http: TestAgent;
  let tenant: Tenant;
  let mentor: User & { rawPassword: string };
  let mentorToken: string;

  beforeEach(async () => {
    await cleanDb();
    http   = agent();
    tenant = await createTenant();
    mentor = await createMentor(tenant.id);
    ({ accessToken: mentorToken } = await loginAs(http, mentor.email, mentor.rawPassword));
  });

  it('format+durationMin gönderilirse kaydedilir ve GET ile geri döner', async () => {
    const res = await http
      .post('/api/meetings/availability')
      .set(tenantHeaders(tenant.id, mentorToken))
      .send({
        blocks: [
          { weekday: 'MON', startTime: '14:00', endTime: '16:00', format: 'IN_PERSON', durationMin: 45 },
        ],
      });
    expect(res.status).toBe(200);
    const saved = (res.body as { blocks: Array<{ format: string; durationMin: number }> }).blocks;
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ format: 'IN_PERSON', durationMin: 45 });

    const getRes = await http
      .get(`/api/meetings/availability?mentorUserId=${mentor.id}`)
      .set(tenantHeaders(tenant.id, mentorToken));
    expect(getRes.status).toBe(200);
    const fetched = (getRes.body as { blocks: Array<{ format: string; durationMin: number }> }).blocks;
    expect(fetched[0]).toMatchObject({ format: 'IN_PERSON', durationMin: 45 });
  });

  it('format/durationMin gönderilmezse şema varsayılanı (ONLINE/60) uygulanır — eski istemciler bozulmaz', async () => {
    const res = await http
      .post('/api/meetings/availability')
      .set(tenantHeaders(tenant.id, mentorToken))
      .send({ blocks: [{ weekday: 'TUE', startTime: '09:00', endTime: '17:00' }] });
    expect(res.status).toBe(200);
    const saved = (res.body as { blocks: Array<{ format: string; durationMin: number }> }).blocks;
    expect(saved[0]).toMatchObject({ format: 'ONLINE', durationMin: 60 });
  });

  it('durationMin blok penceresinden uzunsa 400 döner, hiçbir şey kaydedilmez', async () => {
    const res = await http
      .post('/api/meetings/availability')
      .set(tenantHeaders(tenant.id, mentorToken))
      .send({ blocks: [{ weekday: 'WED', startTime: '09:00', endTime: '09:30', durationMin: 60 }] });
    expect(res.status).toBe(400);
    const count = await testPrisma.availabilityBlock.count({ where: { tenantId: tenant.id, userId: mentor.id } });
    expect(count).toBe(0);
  });

  it('durationMin izin verilen sınırların dışındaysa (ör. 5 dk) 400 döner', async () => {
    const res = await http
      .post('/api/meetings/availability')
      .set(tenantHeaders(tenant.id, mentorToken))
      .send({ blocks: [{ weekday: 'THU', startTime: '09:00', endTime: '17:00', durationMin: 5 }] });
    expect(res.status).toBe(400);
  });

  it('negatif — bir mentörün saveAvailability çağrısı BAŞKA mentörün bloklarını değiştirmez', async () => {
    const otherMentor = await createMentor(tenant.id);
    await testPrisma.availabilityBlock.create({
      data: {
        tenantId: tenant.id, userId: otherMentor.id, isActive: true,
        weekday: 'FRI', startTime: '10:00', endTime: '12:00',
        format: 'PHONE', durationMin: 30,
      },
    });

    const res = await http
      .post('/api/meetings/availability')
      .set(tenantHeaders(tenant.id, mentorToken))
      .send({ blocks: [{ weekday: 'MON', startTime: '08:00', endTime: '09:00', format: 'ONLINE', durationMin: 60 }] });
    expect(res.status).toBe(200);

    const otherBlocks = await testPrisma.availabilityBlock.findMany({ where: { userId: otherMentor.id } });
    expect(otherBlocks).toHaveLength(1);
    expect(otherBlocks[0]).toMatchObject({ format: 'PHONE', durationMin: 30, startTime: '10:00', endTime: '12:00' });
  });
});

describe('K-15 · bookMeeting — menti farklı format/süre DAYATAMAZ', () => {
  let http: TestAgent;
  let tenant: Tenant;
  let mentor: User & { rawPassword: string };
  let menti:  User & { rawPassword: string };
  let mentiToken: string;

  beforeEach(async () => {
    await cleanDb();
    http   = agent();
    tenant = await createTenant();
    mentor = await createMentor(tenant.id);
    menti  = await createMenti(tenant.id);
    ({ accessToken: mentiToken } = await loginAs(http, menti.email, menti.rawPassword));

    // Mentör 45dk / YÜZ YÜZE bir slot açmış.
    await testPrisma.availabilityBlock.create({
      data: {
        tenantId: tenant.id, userId: mentor.id, isActive: true,
        weekday: futureWeekday(), startTime: '08:00', endTime: '18:00',
        timezone: 'Europe/Istanbul', format: 'IN_PERSON', durationMin: 45,
      },
    });
  });

  function book(body: Record<string, unknown>) {
    return http.post('/api/meetings/book').set(tenantHeaders(tenant.id, mentiToken)).send({
      mentorUserId: mentor.id,
      requestMessage: 'Kariyer planlamam hakkında konuşmak ve yol haritası çıkarmak istiyorum lütfen.',
      ...body,
    });
  }

  it('slotun süresine (45dk) uymayan bir talep (60dk) reddedilir — 409, görüşme oluşmaz', async () => {
    const res = await book({
      format:   'IN_PERSON',
      startsAt: isoUtc(FUTURE_DATE, 9, 0),
      endsAt:   isoUtc(FUTURE_DATE, 10, 0), // 60dk — blok 45dk sunuyor
    });
    expect(res.status).toBe(409);
    const meeting = await testPrisma.meeting.findFirst({ where: { mentiUserId: menti.id } });
    expect(meeting).toBeNull();
  });

  it('slotun formatına (IN_PERSON) uymayan bir talep (ONLINE) reddedilir — 409, görüşme oluşmaz', async () => {
    const res = await book({
      format:   'ONLINE',
      startsAt: isoUtc(FUTURE_DATE, 9, 0),
      endsAt:   isoUtc(FUTURE_DATE, 9, 45), // süre doğru (45dk), format yanlış
    });
    expect(res.status).toBe(409);
    const meeting = await testPrisma.meeting.findFirst({ where: { mentiUserId: menti.id } });
    expect(meeting).toBeNull();
  });

  it('slotun format+süresiyle BİREBİR uyan talep kabul edilir — 201, Meeting.durationMin doğru yazılır', async () => {
    const res = await book({
      format:   'IN_PERSON',
      startsAt: isoUtc(FUTURE_DATE, 9, 0),
      endsAt:   isoUtc(FUTURE_DATE, 9, 45),
    });
    expect(res.status).toBe(201);
    const meeting = await testPrisma.meeting.findFirst({ where: { mentiUserId: menti.id } });
    expect(meeting).toMatchObject({ format: 'IN_PERSON', durationMin: 45 });
  });
});
