/**
 * Randevu Niyet Mesajı Testleri
 *
 * bookMeeting: requestMessage zorunlu, min 50 / max 500 karakter.
 * listMeetings: PENDING kuyruğunda requestMessage dönmeli.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { agent, loginAs, tenantHeaders, type TestAgent } from './helpers/request.js';
import { cleanDb, testPrisma } from './helpers/db.js';
import { createTenant, createMentor, createMenti } from './helpers/factories.js';
import type { Tenant, User } from '@prisma/client';

const FUTURE_DATE = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 gün sonra
const DAY_NAMES   = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'] as const;

function isoUtc(d: Date, hh: number, mm: number): string {
  const t = new Date(d);
  t.setUTCHours(hh, mm, 0, 0);
  return t.toISOString();
}

describe('bookMeeting — requestMessage validasyonu', () => {
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

    // Mentor için müsaitlik bloğu — FUTURE_DATE'in haftasını kapsasın
    const weekday = DAY_NAMES[FUTURE_DATE.getUTCDay()];
    await testPrisma.availabilityBlock.create({
      data: {
        tenantId: tenant.id,
        userId:   mentor.id,
        weekday:  weekday ?? 'MON',
        startTime: '08:00',
        endTime:   '18:00',
        timezone: 'Europe/Istanbul',
        isActive: true,
      },
    });
  });

  it('requestMessage eksik → 400 VALIDATION', async () => {
    const res = await http
      .post('/api/meetings/book')
      .set(tenantHeaders(tenant.id, mentiToken))
      .send({
        mentorUserId: mentor.id,
        format:   'ONLINE',
        startsAt: isoUtc(FUTURE_DATE, 9, 0),
        endsAt:   isoUtc(FUTURE_DATE, 10, 0),
        // requestMessage YOK
      });
    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toBe('VALIDATION');
  });

  it('requestMessage 49 karakter (çok kısa) → 400 VALIDATION', async () => {
    const res = await http
      .post('/api/meetings/book')
      .set(tenantHeaders(tenant.id, mentiToken))
      .send({
        mentorUserId:   mentor.id,
        format:         'ONLINE',
        startsAt:       isoUtc(FUTURE_DATE, 9, 0),
        endsAt:         isoUtc(FUTURE_DATE, 10, 0),
        requestMessage: 'a'.repeat(49),
      });
    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toBe('VALIDATION');
  });

  it('requestMessage 501 karakter (çok uzun) → 400 VALIDATION', async () => {
    const res = await http
      .post('/api/meetings/book')
      .set(tenantHeaders(tenant.id, mentiToken))
      .send({
        mentorUserId:   mentor.id,
        format:         'ONLINE',
        startsAt:       isoUtc(FUTURE_DATE, 9, 0),
        endsAt:         isoUtc(FUTURE_DATE, 10, 0),
        requestMessage: 'a'.repeat(501),
      });
    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toBe('VALIDATION');
  });

  it('requestMessage 50-500 karakter → 201, yanıtta requestMessage dolu', async () => {
    const msg = 'Bu görüşmeyi istememin sebebi, kariyer geçişim hakkında mentorunuzun deneyiminden yararlanmak istememdir.';
    expect(msg.length).toBeGreaterThanOrEqual(50);
    expect(msg.length).toBeLessThanOrEqual(500);

    const res = await http
      .post('/api/meetings/book')
      .set(tenantHeaders(tenant.id, mentiToken))
      .send({
        mentorUserId:   mentor.id,
        format:         'ONLINE',
        startsAt:       isoUtc(FUTURE_DATE, 9, 0),
        endsAt:         isoUtc(FUTURE_DATE, 10, 0),
        requestMessage: msg,
      });
    expect(res.status).toBe(201);
    const body = res.body as { meeting: { requestMessage: string } };
    expect(body.meeting.requestMessage).toBe(msg);
  });
});

describe('bookMeeting — haftalık görüşme limiti (maxMeetingsPerWeek)', () => {
  let http: TestAgent;
  let tenant: Tenant;
  let mentor: User & { rawPassword: string };
  let menti:  User & { rawPassword: string };
  let mentiToken: string;

  const VALID_MSG =
    'Bu görüşmeyi istememin sebebi, kariyer geçişim hakkında mentorunuzun deneyiminden yararlanmak istememdir.';

  beforeEach(async () => {
    await cleanDb();
    http   = agent();
    tenant = await createTenant();
    mentor = await createMentor(tenant.id);
    menti  = await createMenti(tenant.id);
    ({ accessToken: mentiToken } = await loginAs(http, menti.email, menti.rawPassword));

    // Limiti 1'e çek — tek görüşmeden sonrası reddedilmeli.
    await testPrisma.tenant.update({
      where: { id: tenant.id },
      data:  { maxMeetingsPerWeek: 1 },
    });

    // Mentör müsaitliği: FUTURE_DATE'in günü, geniş aralık (08:00-18:00).
    const weekday = DAY_NAMES[FUTURE_DATE.getUTCDay()];
    await testPrisma.availabilityBlock.create({
      data: {
        tenantId:  tenant.id,
        userId:    mentor.id,
        weekday:   weekday ?? 'MON',
        startTime: '05:00',
        endTime:   '18:00',
        timezone:  'UTC',
        isActive:  true,
      },
    });
  });

  it('limit altında (1/1) görüşme açılır → 201', async () => {
    const res = await http
      .post('/api/meetings/book')
      .set(tenantHeaders(tenant.id, mentiToken))
      .send({
        mentorUserId:   mentor.id,
        format:         'ONLINE',
        startsAt:       isoUtc(FUTURE_DATE, 9, 0),
        endsAt:         isoUtc(FUTURE_DATE, 10, 0),
        requestMessage: VALID_MSG,
      });
    expect(res.status).toBe(201);
  });

  it('limitte (2. görüşme, aynı hafta) → 409 limit mesajı', async () => {
    // 1. görüşme — geçer.
    const first = await http
      .post('/api/meetings/book')
      .set(tenantHeaders(tenant.id, mentiToken))
      .send({
        mentorUserId:   mentor.id,
        format:         'ONLINE',
        startsAt:       isoUtc(FUTURE_DATE, 9, 0),
        endsAt:         isoUtc(FUTURE_DATE, 10, 0),
        requestMessage: VALID_MSG,
      });
    expect(first.status).toBe(201);

    // 2. görüşme — aynı gün farklı saat (çakışma yok, aynı hafta) → limit aşımı.
    const second = await http
      .post('/api/meetings/book')
      .set(tenantHeaders(tenant.id, mentiToken))
      .send({
        mentorUserId:   mentor.id,
        format:         'ONLINE',
        startsAt:       isoUtc(FUTURE_DATE, 12, 0),
        endsAt:         isoUtc(FUTURE_DATE, 13, 0),
        requestMessage: VALID_MSG,
      });
    expect(second.status).toBe(409);
    expect((second.body as { error: string }).error).toBe(
      'Bu hafta için görüşme limitinize ulaştınız.',
    );
  });

  it('iptal edilmiş (CANCELLED) görüşme sayıma dahil değil → yeni görüşme açılır 201', async () => {
    // Aynı hafta içinde bir CANCELLED görüşme önceden var — kotayı TÜKETMEMELİ.
    await testPrisma.meeting.create({
      data: {
        tenantId:     tenant.id,
        mentorUserId: mentor.id,
        mentiUserId:  menti.id,
        status:       'CANCELLED',
        format:       'ONLINE',
        startsAt:     new Date(isoUtc(FUTURE_DATE, 8, 0)),
        endsAt:       new Date(isoUtc(FUTURE_DATE, 9, 0)),
      },
    });

    const res = await http
      .post('/api/meetings/book')
      .set(tenantHeaders(tenant.id, mentiToken))
      .send({
        mentorUserId:   mentor.id,
        format:         'ONLINE',
        startsAt:       isoUtc(FUTURE_DATE, 14, 0),
        endsAt:         isoUtc(FUTURE_DATE, 15, 0),
        requestMessage: VALID_MSG,
      });
    expect(res.status).toBe(201);
  });
});

describe('listMeetings — PENDING kuyruğunda requestMessage görünür', () => {
  let http: TestAgent;
  let tenant: Tenant;
  let mentor: User & { rawPassword: string };
  let mentorToken: string;

  beforeEach(async () => {
    await cleanDb();
    http   = agent();
    tenant = await createTenant();
    mentor = await createMentor(tenant.id);
    const menti = await createMenti(tenant.id);
    ({ accessToken: mentorToken } = await loginAs(http, mentor.email, mentor.rawPassword));

    // DB'ye doğrudan PENDING meeting ekle (requestMessage dahil)
    await testPrisma.meeting.create({
      data: {
        tenantId:       tenant.id,
        mentorUserId:   mentor.id,
        mentiUserId:    menti.id,
        status:         'PENDING',
        format:         'ONLINE',
        startsAt:       new Date(Date.now() + 2 * 24 * 60 * 60 * 1000),
        endsAt:         new Date(Date.now() + 2 * 24 * 60 * 60 * 1000 + 60 * 60 * 1000),
        requestMessage: 'Test niyet mesajı — mentor bu mesajı görmeli. Yeterli uzunlukta.',
      },
    });
  });

  it('mentor PENDING listesinde requestMessage dönüyor', async () => {
    const res = await http
      .get('/api/meetings?status=PENDING')
      .set(tenantHeaders(tenant.id, mentorToken))
      .expect(200);

    const items = (res.body as { items: { requestMessage: string | null }[] }).items;
    expect(items.length).toBeGreaterThanOrEqual(1);
    expect(items[0]!.requestMessage).toBeTruthy();
    expect(typeof items[0]!.requestMessage).toBe('string');
  });
});
