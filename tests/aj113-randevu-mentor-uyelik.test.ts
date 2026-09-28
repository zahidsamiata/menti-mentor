/**
 * AJ-113 — pasif ya da istek kurumundan çıkarılmış mentöre eski müsaitlik bloklarıyla randevu.
 *
 * Sorun: bookMeeting yalnız aktif müsaitlik bloklarına bakıyordu. Bloklar mentör pasifleşince
 * (User.isActive=false) ya da istek kurumundaki üyeliği kaldırılınca pasifleşmediği için menti
 * bu mentöre randevu talebi açabiliyordu.
 * Düzeltme: müsaitlik adımında mentörün hesabı aktif mi ve istek kurumunda AKTİF MENTOR üyeliği
 * (TenantMembership.role) var mı diye bakılır; yoksa müsaitlik yanıtıyla AYNI 409 döner
 * (hesap/üyelik/engel durumu yanıttan ayırt edilemez — AJ-100 sırası korunur).
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

type SeededUser = Awaited<ReturnType<typeof createMenti>>;
type Outcome = { status: number; body: unknown };

function tokenFor(u: Pick<User, 'id' | 'role' | 'fullName'>, tenantId: string): string {
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

async function blockPair(tenantId: string, a: SeededUser, b: SeededUser): Promise<void> {
  await testPrisma.tenant.update({
    where: { id: tenantId },
    data: {
      blockedPairs: [{ fromUserId: a.id, toUserId: b.id, blockedAt: new Date().toISOString(), blockedBy: 'test-admin' }],
    },
  });
}

async function addAvailability(tenantId: string, mentor: SeededUser): Promise<void> {
  await testPrisma.availabilityBlock.create({
    data: {
      tenantId, userId: mentor.id, isActive: true, timezone: 'UTC',
      weekday: utcWeekday(FUTURE_DATE), startTime: '08:00', endTime: '12:00',
    },
  });
}

let http: TestAgent;
let requestTenant: Tenant; // istek kurumu (mentinin kurumu)

beforeEach(async () => {
  await cleanDb();
  http = agent();
  requestTenant = await createTenant({ isSharedPoolActive: true });
});

async function book(menti: SeededUser, mentor: SeededUser): Promise<Outcome> {
  const res = await http
    .post('/api/meetings/book')
    .set(tenantHeaders(requestTenant.id, tokenFor(menti, requestTenant.id)))
    .send({
      mentorUserId: mentor.id,
      format: 'ONLINE',
      startsAt: isoUtc(FUTURE_DATE, 9, 0),
      endsAt: isoUtc(FUTURE_DATE, 10, 0),
      requestMessage: REQUEST_MESSAGE,
    });
  return { status: res.status, body: res.body };
}

const NO_AVAILABILITY = { error: 'Seçilen saat mentörün müsaitlik aralığına uymuyor.' };

describe('AJ-113: randevu talebi — mentör randevu alabilir durumda değilse', () => {
  it('pasif mentör + aktif eski blok → müsaitlik yok yanıtıyla aynı 409; görüşme yazılmaz', async () => {
    const mentor = await createMentor(requestTenant.id);
    const menti = await createMenti(requestTenant.id);
    await addAvailability(requestTenant.id, mentor);
    await testPrisma.user.update({ where: { id: mentor.id }, data: { isActive: false } });

    const res = await book(menti, mentor);
    expect(res).toEqual({ status: 409, body: NO_AVAILABILITY });
    expect(await testPrisma.meeting.count()).toBe(0);
  });

  it('istek kurumundaki üyeliği kaldırılmış mentör + eski aktif blok → aynı 409; görüşme yazılmaz', async () => {
    const homeTenant = await createTenant({ isSharedPoolActive: true });
    const mentor = await createMentor(homeTenant.id);
    await testPrisma.tenantMembership.create({
      data: { userId: mentor.id, tenantId: requestTenant.id, role: 'MENTOR', isActive: true },
    });
    const menti = await createMenti(requestTenant.id);
    await addAvailability(requestTenant.id, mentor);
    await testPrisma.tenantMembership.delete({
      where: { userId_tenantId: { userId: mentor.id, tenantId: requestTenant.id } },
    });

    const res = await book(menti, mentor);
    expect(res).toEqual({ status: 409, body: NO_AVAILABILITY });
    expect(await testPrisma.meeting.count()).toBe(0);
  });

  it('istek kurumunda üyeliği pasifleştirilmiş mentör + eski aktif blok → aynı 409', async () => {
    const mentor = await createMentor(requestTenant.id);
    const menti = await createMenti(requestTenant.id);
    await addAvailability(requestTenant.id, mentor);
    await testPrisma.tenantMembership.update({
      where: { userId_tenantId: { userId: mentor.id, tenantId: requestTenant.id } },
      data: { isActive: false },
    });

    const res = await book(menti, mentor);
    expect(res).toEqual({ status: 409, body: NO_AVAILABILITY });
    expect(await testPrisma.meeting.count()).toBe(0);
  });

  it('istek kurumunda rolü MENTOR olmayan (MENTI üyeliği) kullanıcı + eski blok → aynı 409', async () => {
    const mentor = await createMentor(requestTenant.id);
    const menti = await createMenti(requestTenant.id);
    await addAvailability(requestTenant.id, mentor);
    await testPrisma.tenantMembership.update({
      where: { userId_tenantId: { userId: mentor.id, tenantId: requestTenant.id } },
      data: { role: 'MENTI' },
    });

    const res = await book(menti, mentor);
    expect(res).toEqual({ status: 409, body: NO_AVAILABILITY });
    expect(await testPrisma.meeting.count()).toBe(0);
  });

  it('engelli çift + pasif mentör → engelsiz çiftle aynı 409 (engel sızmaz); görüşme yazılmaz', async () => {
    const mentor = await createMentor(requestTenant.id);
    const blockedMenti = await createMenti(requestTenant.id);
    const freeMenti = await createMenti(requestTenant.id);
    await addAvailability(requestTenant.id, mentor);
    await blockPair(requestTenant.id, blockedMenti, mentor);
    await testPrisma.user.update({ where: { id: mentor.id }, data: { isActive: false } });

    const free = await book(freeMenti, mentor);
    expect(free).toEqual({ status: 409, body: NO_AVAILABILITY });
    expect(await book(blockedMenti, mentor)).toEqual(free);
    expect(await testPrisma.meeting.count()).toBe(0);
  });

  it('pozitif kontrol: başka kurumlu mentör istek kurumunda aktif MENTOR üyesi + blok → 201', async () => {
    const homeTenant = await createTenant({ isSharedPoolActive: true });
    const mentor = await createMentor(homeTenant.id);
    await testPrisma.tenantMembership.create({
      data: { userId: mentor.id, tenantId: requestTenant.id, role: 'MENTOR', isActive: true },
    });
    const menti = await createMenti(requestTenant.id);
    await addAvailability(requestTenant.id, mentor);

    const res = await book(menti, mentor);
    expect(res.status).toBe(201);
    expect(await testPrisma.meeting.count({ where: { mentiUserId: menti.id, mentorUserId: mentor.id } })).toBe(1);
  });

  it('pozitif kontrol: aktif mentör + aktif MENTOR üyeliği + blok → 201', async () => {
    const mentor = await createMentor(requestTenant.id);
    const menti = await createMenti(requestTenant.id);
    await addAvailability(requestTenant.id, mentor);

    const res = await book(menti, mentor);
    expect(res.status).toBe(201);
    expect(await testPrisma.meeting.count()).toBe(1);
  });
});
