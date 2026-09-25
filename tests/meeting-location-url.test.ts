/**
 * GV-03 — görüşme bağlantısı yalnız http(s) adres olarak kabul edilir.
 * Reddedilen istekte görüşme kaydı oluşmaz.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { agent, loginAs, tenantHeaders, type TestAgent } from './helpers/request.js';
import { cleanDb, testPrisma } from './helpers/db.js';
import { createTenant, createMentor, createMenti } from './helpers/factories.js';
import { isHttpUrl } from '../src/services/safeUrl.js';
import type { Tenant, User } from '@prisma/client';

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

describe('GV-03: isHttpUrl', () => {
  it('http ve https kabul, diğer şemalar ve bozuk adres red', () => {
    expect(isHttpUrl('https://meet.example.com/abc')).toBe(true);
    expect(isHttpUrl('http://example.com/x')).toBe(true);
    for (const bad of ['javascript:alert(1)', 'data:text/html;base64,PHA+', 'vbscript:x', 'ftp://x.com', '//x.com', 'x', '']) {
      expect(isHttpUrl(bad), bad).toBe(false);
    }
  });
});

describe('GV-03: bookMeeting görüşme bağlantısı doğrulaması', () => {
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

  const book = (locationUrl: string) =>
    http.post('/api/meetings/book').set(tenantHeaders(tenant.id, mentiToken)).send({
      mentorUserId: mentor.id,
      format: 'ONLINE',
      startsAt: isoUtc(FUTURE_DATE, 9, 0),
      endsAt: isoUtc(FUTURE_DATE, 10, 0),
      requestMessage: 'Kariyer planlamam hakkında konuşmak ve yol haritası çıkarmak istiyorum lütfen.',
      locationUrl,
    });

  it('negatif: http(s) olmayan bağlantı 400 VALIDATION, görüşme oluşmaz', async () => {
    for (const bad of ['javascript:alert(1)', 'data:text/html;base64,PHA+']) {
      const res = await book(bad);
      expect(res.status, bad).toBe(400);
      expect((res.body as { error: string }).error).toBe('VALIDATION');
    }
    expect(await testPrisma.meeting.count({ where: { mentiUserId: menti.id } })).toBe(0);
  });
});
