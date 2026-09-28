/**
 * AJ-100 — randevu talebinde (POST /api/meetings/book) idari çift engelinin SIRASI.
 *
 * Sorun: bookMeeting engeli en başta, müsaitlik kontrolünden ÖNCE arıyordu. Havuzu kapalı bir
 * kurumdaki (istek kurumunda müsaitliği olmayan) mentör için engelli çift 403 ISLEM_YAPILAMIYOR,
 * engelsiz çift 409 (müsaitlik) alıyordu → menti, başka kurumdaki engelin varlığını bu farktan
 * öğrenebiliyordu. Komşu uçlar (konuşma, istek) bu durumda engeli "hedef yok" yanıtının
 * arkasına saklıyor (AJ-103).
 * Düzeltme: engel yalnız talep gerçekten oluşacakken (müsaitlik/çakışma/limit geçtikten sonra,
 * create'ten hemen önce) bakılır. Ek olarak "istek kurumu = mentinin ana kurumu" varsayımı bu
 * uçta sorguyla zorlanmadığı için mentinin ana kurumundaki engel de aranır.
 *
 * Her senaryoda: engelli ve engelsiz çift birebir aynı kod + gövde, DB'ye görüşme yazılmaz.
 * Pozitif kontrol: talep oluşabilir durumda engel → 403; engel yok → 201 (mevcut davranış).
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

describe('AJ-100: randevu talebi — engel, talep oluşamayacakken sızmaz', () => {
  it('havuzu kapalı kurumdaki mentör: engelli (ana kurumda) ve engelsiz çift → aynı kod + aynı gövde; görüşme yazılmaz', async () => {
    const closedTenant = await createTenant({ isSharedPoolActive: false });
    const mentor = await createMentor(closedTenant.id);
    const blockedMenti = await createMenti(requestTenant.id);
    const freeMenti = await createMenti(requestTenant.id);
    await blockPair(closedTenant.id, mentor, blockedMenti);

    const free = await book(freeMenti, mentor);
    expect(free.status).toBe(409);
    expect(await book(blockedMenti, mentor)).toEqual(free);
    expect(await testPrisma.meeting.count()).toBe(0);
  });

  it('havuzu kapalı kurumdaki mentör: istek kurumundaki engel de aynı yanıtın arkasında kalır', async () => {
    const closedTenant = await createTenant({ isSharedPoolActive: false });
    const mentor = await createMentor(closedTenant.id);
    const blockedMenti = await createMenti(requestTenant.id);
    const freeMenti = await createMenti(requestTenant.id);
    await blockPair(requestTenant.id, blockedMenti, mentor);

    const free = await book(freeMenti, mentor);
    expect(free.status).toBe(409);
    expect(await book(blockedMenti, mentor)).toEqual(free);
    expect(await testPrisma.meeting.count()).toBe(0);
  });

  it('aynı kurumda müsaitliği olmayan mentör: engelli ve engelsiz çift → aynı kod + aynı gövde; görüşme yazılmaz', async () => {
    const mentor = await createMentor(requestTenant.id);
    const blockedMenti = await createMenti(requestTenant.id);
    const freeMenti = await createMenti(requestTenant.id);
    await blockPair(requestTenant.id, blockedMenti, mentor);

    const free = await book(freeMenti, mentor);
    expect(free.status).toBe(409);
    expect(await book(blockedMenti, mentor)).toEqual(free);
    expect(await testPrisma.meeting.count()).toBe(0);
  });
});

describe('AJ-100: randevu talebi — talep oluşabilir durumda engel uygulanır', () => {
  it('müsaitlik uygun + engel var → 403 ISLEM_YAPILAMIYOR; görüşme yazılmaz', async () => {
    const mentor = await createMentor(requestTenant.id);
    const menti = await createMenti(requestTenant.id);
    await addAvailability(requestTenant.id, mentor);
    await blockPair(requestTenant.id, menti, mentor);

    const res = await book(menti, mentor);
    expect(res.status).toBe(403);
    expect((res.body as { error: string }).error).toBe('ISLEM_YAPILAMIYOR');
    expect(await testPrisma.meeting.count()).toBe(0);
  });

  it('menti istek kurumunda yalnız üye (ana kurumu başka): ana kurumundaki engel de randevuyu durdurur', async () => {
    const mentiHomeTenant = await createTenant({ isSharedPoolActive: false });
    const menti = await createMenti(mentiHomeTenant.id);
    await testPrisma.tenantMembership.create({
      data: { userId: menti.id, tenantId: requestTenant.id, role: 'MENTI', isActive: true },
    });
    const mentor = await createMentor(requestTenant.id);
    await addAvailability(requestTenant.id, mentor);
    await blockPair(mentiHomeTenant.id, mentor, menti);

    const res = await book(menti, mentor);
    expect(res.status).toBe(403);
    expect((res.body as { error: string }).error).toBe('ISLEM_YAPILAMIYOR');
    expect(await testPrisma.meeting.count()).toBe(0);
  });

  it('pozitif kontrol: müsaitlik uygun + engel yok → 201, görüşme oluşur (mevcut davranış)', async () => {
    const mentor = await createMentor(requestTenant.id);
    const menti = await createMenti(requestTenant.id);
    await addAvailability(requestTenant.id, mentor);

    const res = await book(menti, mentor);
    expect(res.status).toBe(201);
    expect(await testPrisma.meeting.count({ where: { mentiUserId: menti.id, mentorUserId: mentor.id } })).toBe(1);
  });
});
