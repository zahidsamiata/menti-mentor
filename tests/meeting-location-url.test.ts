/**
 * GV-03 — görüşme bağlantısı yalnız http(s) adres olarak kabul edilir.
 * Reddedilen istekte görüşme kaydı/güncellemesi oluşmaz.
 *
 * ⚠️ KARAR-7 (A, 2026-09-26): online toplantı linkini artık MENTİ değil MENTÖR, randevuyu
 * ONAYLARKEN girer (`approveMeetingByMentor`) — `bookMeeting`'den `locationUrl` kaldırıldı.
 * Bu dosyanın entegrasyon testi bu yüzden `/approve` ucunu hedefler (eskiden `/book`'u hedefliyordu).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { agent, loginAs, tenantHeaders, type TestAgent } from './helpers/request.js';
import { cleanDb, testPrisma } from './helpers/db.js';
import { createTenant, createMentor, createMenti } from './helpers/factories.js';
import { signToken } from '../src/middleware/jwtAuth.js';
import { isHttpUrl } from '../src/services/safeUrl.js';
import type { Tenant, User } from '@prisma/client';

function tokenFor(u: Pick<User, 'id' | 'tenantId' | 'role' | 'fullName'>): string {
  return signToken({ sub: u.id, tenantId: u.tenantId, role: u.role, fullName: u.fullName });
}

const { sendMeetingRequestEmailMock } = vi.hoisted(() => ({ sendMeetingRequestEmailMock: vi.fn(async () => undefined) }));
vi.mock('../src/services/emailService.js', async (orig) => ({
  ...(await orig<typeof import('../src/services/emailService.js')>()),
  sendMeetingRequestEmail: sendMeetingRequestEmailMock,
}));

const FUTURE_DATE = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
function isoUtc(d: Date, hh: number, mm: number): string {
  const t = new Date(d);
  t.setUTCHours(hh, mm, 0, 0);
  return t.toISOString();
}
// bookMeeting, mentörün müsaitlik bloğuna uymayan her talebi 409 ile reddeder (K-05 ailesi,
// bu dosyanın kapsamı dışında ama testin geçmesi için gerçek koşulu sağlamak gerekiyor).
// Blok'un kendi timezone'ını 'UTC' vererek FUTURE_DATE'in UTC gün/saatiyle birebir eşleştiriyoruz.
function utcWeekday(d: Date): 'MON' | 'TUE' | 'WED' | 'THU' | 'FRI' | 'SAT' | 'SUN' {
  const label = d.toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'short' }).toUpperCase();
  return label as 'MON' | 'TUE' | 'WED' | 'THU' | 'FRI' | 'SAT' | 'SUN';
}

describe('GV-03: isHttpUrl', () => {
  it('http ve https kabul, diğer şemalar ve bozuk adres red', () => {
    expect(isHttpUrl('https://meet.example.com/abc')).toBe(true);
    expect(isHttpUrl('http://example.com/x')).toBe(true);
    for (const bad of ['javascript:alert(1)', 'data:text/html;base64,PHA+', 'vbscript:x', 'ftp://x.com', '//x.com', 'x', '']) {
      expect(isHttpUrl(bad), bad).toBe(false);
    }
  });
});

describe('KARAR-7: bookMeeting artık locationUrl kabul etmiyor (mentör onayda girer)', () => {
  let http: TestAgent;
  let tenant: Tenant;
  let mentor: User & { rawPassword: string };
  let menti: User & { rawPassword: string };
  let mentiToken: string;

  beforeEach(async () => {
    await cleanDb();
    http = agent();
    tenant = await createTenant();
    mentor = await createMentor(tenant.id);
    menti = await createMenti(tenant.id);
    ({ accessToken: mentiToken } = await loginAs(http, menti.email, menti.rawPassword));
  });

  it('menti locationUrl gönderse bile görüşme linksiz (null) oluşur — mentör onayda girecek', async () => {
    // K-05 ailesi: bookMeeting, mentörün müsaitlik bloğuna uymayan talebi 409 ile reddeder —
    // bu testin odağı locationUrl olduğu için mentöre isteğin saatini kapsayan bir blok tanımlanır.
    await testPrisma.availabilityBlock.create({
      data: {
        tenantId: tenant.id, userId: mentor.id, isActive: true, timezone: 'UTC',
        weekday: utcWeekday(FUTURE_DATE), startTime: '08:00', endTime: '12:00',
      },
    });
    const res = await http.post('/api/meetings/book').set(tenantHeaders(tenant.id, mentiToken)).send({
      mentorUserId: mentor.id,
      format: 'ONLINE',
      startsAt: isoUtc(FUTURE_DATE, 9, 0),
      endsAt: isoUtc(FUTURE_DATE, 10, 0),
      requestMessage: 'Kariyer planlamam hakkında konuşmak ve yol haritası çıkarmak istiyorum lütfen.',
      locationUrl: 'javascript:alert(1)', // kötü niyetli değer bile — alan artık okunmuyor
    });
    expect(res.status).toBe(201);
    const meeting = await testPrisma.meeting.findFirst({ where: { mentiUserId: menti.id } });
    expect(meeting?.locationUrl).toBeNull();
  });
});

describe('GV-03 / KARAR-7: mentör onayında görüşme bağlantısı doğrulaması', () => {
  let http: TestAgent;
  let tenant: Tenant;
  let mentor: User & { rawPassword: string };
  let menti: User & { rawPassword: string };

  beforeEach(async () => {
    await cleanDb();
    http = agent();
    tenant = await createTenant();
    mentor = await createMentor(tenant.id);
    menti = await createMenti(tenant.id);
  });

  async function pendingOnlineMeeting() {
    return testPrisma.meeting.create({
      data: {
        tenantId: tenant.id,
        mentorUserId: mentor.id,
        mentiUserId: menti.id,
        status: 'PENDING',
        format: 'ONLINE',
        startsAt: new Date(Date.now() + 7 * 24 * 3600_000),
        endsAt: new Date(Date.now() + 7 * 24 * 3600_000 + 3600_000),
      },
    });
  }

  const approve = (id: string, body: Record<string, unknown>) =>
    http.post(`/api/meetings/${id}/approve`).set(tenantHeaders(tenant.id, tokenFor(mentor))).send(body);

  it('negatif: http(s) olmayan bağlantıyla onay 400 VALIDATION, görüşme PENDING kalır', async () => {
    for (const bad of ['javascript:alert(1)', 'data:text/html;base64,PHA+']) {
      const meeting = await pendingOnlineMeeting();
      const res = await approve(meeting.id, { locationUrl: bad });
      expect(res.status, bad).toBe(400);
      expect((res.body as { error: string }).error).toBe('VALIDATION');
      const after = await testPrisma.meeting.findUnique({ where: { id: meeting.id }, select: { status: true } });
      expect(after?.status).toBe('PENDING');
    }
  });

  it('negatif: ONLINE görüşme linksiz onaylanamaz (400), PENDING kalır', async () => {
    const meeting = await pendingOnlineMeeting();
    const res = await approve(meeting.id, {});
    expect(res.status).toBe(400);
    const after = await testPrisma.meeting.findUnique({ where: { id: meeting.id }, select: { status: true } });
    expect(after?.status).toBe('PENDING');
  });

  it('pozitif: geçerli http(s) linkiyle onay 200, görüşme SCHEDULED + link kaydedilir', async () => {
    const meeting = await pendingOnlineMeeting();
    const res = await approve(meeting.id, { locationUrl: 'https://meet.google.com/abc-defg-hij' });
    expect(res.status).toBe(200);
    const after = await testPrisma.meeting.findUnique({ where: { id: meeting.id }, select: { status: true, locationUrl: true } });
    expect(after?.status).toBe('SCHEDULED');
    expect(after?.locationUrl).toBe('https://meet.google.com/abc-defg-hij');
  });
});
