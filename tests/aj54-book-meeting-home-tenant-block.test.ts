/**
 * AJ-54 — randevu talebi (POST /api/meetings/book) idari çift engelini mentörün ANA kurumunda da arar.
 *
 * Kök sebep: bookMeeting engeli yalnız isteğin yapıldığı kurumda (A) arıyordu. Mentörün ana
 * kurumu B ise ve mentör A'da da MENTOR üyesiyse (A'da müsaitlik girmişse), B yöneticisinin
 * koyduğu engel randevu talebinde atlanıyordu. Konuşma (POST /api/conversations) ve eşleşme
 * isteği (POST /api/requests) aynı çifti zaten durduruyordu (isPairBlockedInTenants:
 * istek kurumu + karşı tarafın ana kurumu). Bu dosya üç ucun aynı kod/durumla reddettiğini
 * ve engel yokken randevu talebinin çalıştığını (pozitif kontrol) doğrular.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { agent, tenantHeaders, type TestAgent } from './helpers/request.js';
import { cleanDb, testPrisma } from './helpers/db.js';
import { createTenant, createMentor, createMenti } from './helpers/factories.js';
import { signToken } from '../src/middleware/jwtAuth.js';
import type { Tenant, User } from '@prisma/client';

// Randevu talebi mentöre e-posta gönderir — test dışarıya gönderim yapmasın.
vi.mock('../src/services/emailService.js', async (orig) => ({
  ...(await orig<typeof import('../src/services/emailService.js')>()),
  sendMeetingRequestEmail: vi.fn(async () => undefined),
}));

function tokenFor(u: Pick<User, 'id' | 'tenantId' | 'role' | 'fullName'>, tenantId: string): string {
  return signToken({ sub: u.id, tenantId, role: u.role, fullName: u.fullName });
}

const FUTURE_DATE = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
function isoUtc(d: Date, hh: number, mm: number): string {
  const t = new Date(d);
  t.setUTCHours(hh, mm, 0, 0);
  return t.toISOString();
}
function utcWeekday(d: Date): 'MON' | 'TUE' | 'WED' | 'THU' | 'FRI' | 'SAT' | 'SUN' {
  return d.toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'short' }).toUpperCase() as
    'MON' | 'TUE' | 'WED' | 'THU' | 'FRI' | 'SAT' | 'SUN';
}

const REQUEST_MESSAGE = 'Kariyer planlamam hakkında konuşmak ve yol haritası çıkarmak istiyorum lütfen.';

describe('AJ-54 — randevu talebi mentörün ana kurumundaki engeli de uygular', () => {
  let http: TestAgent;
  let tenantA: Tenant; // istek kurumu (mentinin kurumu; mentör burada da üye)
  let tenantB: Tenant; // mentörün ana kurumu
  let mentor: Awaited<ReturnType<typeof createMentor>>;
  let menti: Awaited<ReturnType<typeof createMenti>>;

  beforeEach(async () => {
    await cleanDb();
    http = agent();
    // Paylaşımlı havuz açık: konuşma/istek uçları kurumlar arası hedefe izin versin ki
    // karşılaştırmada red sebebi havuz değil engel olsun.
    tenantA = await createTenant({ isSharedPoolActive: true });
    tenantB = await createTenant({ isSharedPoolActive: true });
    mentor = await createMentor(tenantB.id);
    menti = await createMenti(tenantA.id);

    // Mentör A kurumunda da MENTOR üyesi ve A'da müsaitlik girmiş.
    await testPrisma.tenantMembership.create({
      data: { userId: mentor.id, tenantId: tenantA.id, role: 'MENTOR', isActive: true },
    });
    await testPrisma.availabilityBlock.create({
      data: {
        tenantId: tenantA.id, userId: mentor.id, isActive: true, timezone: 'UTC',
        weekday: utcWeekday(FUTURE_DATE), startTime: '08:00', endTime: '12:00',
      },
    });
  });

  async function blockInTenant(tenantId: string) {
    await testPrisma.tenant.update({
      where: { id: tenantId },
      data: {
        blockedPairs: [{ fromUserId: mentor.id, toUserId: menti.id, blockedAt: new Date().toISOString(), blockedBy: 'test-admin' }],
      },
    });
  }

  function book() {
    return http
      .post('/api/meetings/book')
      .set(tenantHeaders(tenantA.id, tokenFor(menti, tenantA.id)))
      .send({
        mentorUserId: mentor.id,
        format: 'ONLINE',
        startsAt: isoUtc(FUTURE_DATE, 9, 0),
        endsAt: isoUtc(FUTURE_DATE, 10, 0),
        requestMessage: REQUEST_MESSAGE,
      });
  }

  it('mentörün ana kurumunda (B) engel varsa A\'dan randevu talebi 403 ISLEM_YAPILAMIYOR, görüşme yazılmaz', async () => {
    await blockInTenant(tenantB.id);

    const res = await book();
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('ISLEM_YAPILAMIYOR');
    expect(await testPrisma.meeting.count({ where: { mentiUserId: menti.id } })).toBe(0);
  });

  it('aynı engel konuşma ve eşleşme isteği uçlarında da aynı kod/durumla reddeder (komşu uç hizası)', async () => {
    await blockInTenant(tenantB.id);
    const headers = tenantHeaders(tenantA.id, tokenFor(menti, tenantA.id));

    const convo = await http
      .post('/api/conversations')
      .set(headers)
      .send({ mentorUserId: mentor.id, message: 'Merhaba, tanışmak isterim.' });
    expect(convo.status).toBe(403);
    expect(convo.body.error).toBe('ISLEM_YAPILAMIYOR');

    const request = await http
      .post('/api/requests')
      .set(headers)
      .send({ targetType: 'USER', targetId: mentor.id, requestMessage: 'Görüşebilir miyiz?' });
    expect(request.status).toBe(403);
    expect(request.body.error).toBe('ISLEM_YAPILAMIYOR');

    const booking = await book();
    expect(booking.status).toBe(convo.status);
    expect(booking.body.error).toBe(convo.body.error);
  });

  it('istek kurumundaki (A) engel de randevu talebini durdurmaya devam eder', async () => {
    await blockInTenant(tenantA.id);

    const res = await book();
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('ISLEM_YAPILAMIYOR');
  });

  it('pozitif kontrol: hiçbir kurumda engel yokken randevu talebi 201 ile oluşur', async () => {
    const res = await book();
    expect(res.status).toBe(201);
    expect(await testPrisma.meeting.count({ where: { mentiUserId: menti.id, mentorUserId: mentor.id } })).toBe(1);
  });
});
