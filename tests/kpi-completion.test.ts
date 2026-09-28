/**
 * AJ-78 — GET /api/admin/kpi `stats.completion` + CSV "Tamamlama" bölümü:
 * "kaydını tamamlayan üye %", "DISC tamamlama %" ve "tamamlanan görüşme".
 *
 * Ölçülenler (uçtan uca, gerçek DB):
 * 1. Kurum izolasyonu: A yöneticisi B'nin üyelerini/görüşmelerini sayımda görmez (negatif).
 * 2. Kurum sınırı üyelikten: A'da aktif MENTI üyeliği olan misafir A'da sayılır; yönetici paydada yok.
 * 3. k-anonimlik: payda (grup) ya da pay (tamamlayan) eşik altındaysa yüzde ve sayılar gizli.
 * 4. CSV aynı sayıları yazar, gizli hücre "gizli" metniyle; B kurumunun sayıları A'nın CSV'sinde yok.
 * 5. Yetki: MENTOR / MENTI → 403.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { agent, tenantHeaders, type TestAgent } from './helpers/request.js';
import { cleanDb, testPrisma } from './helpers/db.js';
import { createTenant, createMentor, createMenti, createAdminUser } from './helpers/factories.js';
import { signToken } from '../src/middleware/jwtAuth.js';
import { SUPPRESSED_CELL_TEXT } from '../src/services/kpiReport.service.js';
import type { MeetingStatus, User } from '@prisma/client';

const KPI_URL = '/api/admin/kpi';
const EXPORT_URL = '/api/admin/kpi/export';

function tokenFor(u: Pick<User, 'id' | 'tenantId' | 'role' | 'fullName'>): string {
  return signToken({ sub: u.id, tenantId: u.tenantId, role: u.role, fullName: u.fullName });
}

/** DISC bitişinin gerçek izi: tamamlama yolları (onboarding/adaptif test) `discType` yazar. */
async function markDiscDone(userId: string) {
  await testPrisma.user.update({ where: { id: userId }, data: { discType: 'D' } });
}

async function addMeeting(tenantId: string, mentorUserId: string, mentiUserId: string, status: MeetingStatus) {
  const startsAt = new Date('2026-09-01T10:00:00Z');
  await testPrisma.meeting.create({
    data: { tenantId, mentorUserId, mentiUserId, startsAt, endsAt: new Date(startsAt.getTime() + 3_600_000), status },
  });
}

describe('AJ-78: yönetici KPI — tamamlama oranları ve tamamlanan görüşme', () => {
  let http: TestAgent;
  beforeEach(async () => { await cleanDb(); http = agent(); });

  it('negatif: A yöneticisi yalnız A kurumunu görür — B\'nin üyeleri ve görüşmeleri sayılmaz', async () => {
    const tenantA = await createTenant({ name: 'Kurum A' });
    const tenantB = await createTenant({ name: 'Kurum B' });
    const adminA = await createAdminUser(tenantA.id);

    // A: 1 mentör + 3 onaylı menti (hepsi DISC bitirmiş) + 1 onay bekleyen menti → 5 katılımcı.
    const mentorA = await createMentor(tenantA.id);
    await markDiscDone(mentorA.id);
    const mentisA = [];
    for (let i = 0; i < 3; i++) {
      const m = await createMenti(tenantA.id);
      await markDiscDone(m.id);
      mentisA.push(m);
    }
    await createMenti(tenantA.id, { approvalStatus: 'PENDING' });
    await addMeeting(tenantA.id, mentorA.id, mentisA[0]!.id, 'COMPLETED');
    await addMeeting(tenantA.id, mentorA.id, mentisA[1]!.id, 'COMPLETED');
    await addMeeting(tenantA.id, mentorA.id, mentisA[2]!.id, 'SCHEDULED'); // tamamlanmamış — sayılmaz

    // B: 6 onaylı, DISC bitirmiş menti + 4 tamamlanan görüşme — A'da görünmemeli.
    const mentorB = await createMentor(tenantB.id);
    for (let i = 0; i < 6; i++) {
      const m = await createMenti(tenantB.id);
      await markDiscDone(m.id);
      if (i < 4) await addMeeting(tenantB.id, mentorB.id, m.id, 'COMPLETED');
    }

    const res = await http.get(KPI_URL).set(tenantHeaders(tenantA.id, tokenFor(adminA))).expect(200);
    expect(res.body.stats.completion).toEqual({
      registration: { completed: 4, eligible: 5, percent: 80, suppressed: false },
      disc: { completed: 4, eligible: 5, percent: 80, suppressed: false },
      completedMeetings: 2,
      minGroupSize: 3,
    });
  });

  it('kurum sınırı üyelikten: A\'da MENTI üyesi misafir sayılır, yönetici ve pasif üyelik paydada yok', async () => {
    const tenantA = await createTenant({ name: 'Kurum A' });
    const tenantB = await createTenant({ name: 'Kurum B' });
    const adminA = await createAdminUser(tenantA.id);
    await markDiscDone(adminA.id); // yönetici katılımcı değil — DISC'i olsa da sayılmaz

    for (let i = 0; i < 3; i++) {
      const m = await createMenti(tenantA.id);
      await markDiscDone(m.id);
    }
    // Ev kurumu B (User.role MENTOR), A'da aktif MENTI üyeliği, onaylı + DISC bitirmiş → A'da sayılır.
    const guest = await createMentor(tenantB.id);
    await markDiscDone(guest.id);
    await testPrisma.tenantMembership.create({ data: { userId: guest.id, tenantId: tenantA.id, role: 'MENTI', isActive: true } });
    // Ev kurumu A ama A'daki üyeliği pasif (onay bekliyor, DISC yok) → hiçbir sayıma girmez.
    // Ev kurumundan (User.tenantId) sayan bir hesap misafiri kaçırıp bunu sayar → oranlar değişir.
    const left = await createMenti(tenantA.id, { approvalStatus: 'PENDING' });
    await testPrisma.tenantMembership.updateMany({ where: { userId: left.id, tenantId: tenantA.id }, data: { isActive: false } });

    const res = await http.get(KPI_URL).set(tenantHeaders(tenantA.id, tokenFor(adminA))).expect(200);
    expect(res.body.stats.completion.registration).toEqual({ completed: 4, eligible: 4, percent: 100, suppressed: false });
    expect(res.body.stats.completion.disc).toEqual({ completed: 4, eligible: 4, percent: 100, suppressed: false });
  });

  it('negatif (k-anonim): 2 kişilik grupta oranlar gizli — "%100" bile dönmez', async () => {
    const tenant = await createTenant();
    const admin = await createAdminUser(tenant.id);
    for (let i = 0; i < 2; i++) {
      const m = await createMenti(tenant.id);
      await markDiscDone(m.id);
    }
    const res = await http.get(KPI_URL).set(tenantHeaders(tenant.id, tokenFor(admin))).expect(200);
    const hidden = { completed: 0, eligible: 0, percent: null, suppressed: true };
    expect(res.body.stats.completion.registration).toEqual(hidden);
    expect(res.body.stats.completion.disc).toEqual(hidden);
  });

  it('negatif (k-anonim): grup yeterli ama tamamlayan 1 kişi → o oran gizli, diğeri görünür', async () => {
    const tenant = await createTenant();
    const admin = await createAdminUser(tenant.id);
    const mentis = [];
    for (let i = 0; i < 5; i++) mentis.push(await createMenti(tenant.id));
    await markDiscDone(mentis[0]!.id);

    const res = await http.get(KPI_URL).set(tenantHeaders(tenant.id, tokenFor(admin))).expect(200);
    expect(res.body.stats.completion.disc).toEqual({ completed: 0, eligible: 0, percent: null, suppressed: true });
    expect(res.body.stats.completion.registration).toEqual({ completed: 5, eligible: 5, percent: 100, suppressed: false });
  });

  it('CSV: Tamamlama satırları panelle aynı; gizli oran "gizli"; B kurumunun sayıları yok', async () => {
    const tenantA = await createTenant({ name: 'Kurum A' });
    const tenantB = await createTenant({ name: 'Kurum B' });
    const adminA = await createAdminUser(tenantA.id);
    const mentorA = await createMentor(tenantA.id);
    const mentisA = [];
    for (let i = 0; i < 3; i++) mentisA.push(await createMenti(tenantA.id));
    await markDiscDone(mentisA[0]!.id); // DISC: 1/4 → gizli
    for (const m of mentisA) await addMeeting(tenantA.id, mentorA.id, m.id, 'COMPLETED');

    const mentorB = await createMentor(tenantB.id);
    for (let i = 0; i < 8; i++) {
      const m = await createMenti(tenantB.id);
      await markDiscDone(m.id);
      await addMeeting(tenantB.id, mentorB.id, m.id, 'COMPLETED');
    }

    const panel = await http.get(KPI_URL).set(tenantHeaders(tenantA.id, tokenFor(adminA))).expect(200);
    expect(panel.body.stats.completion.completedMeetings).toBe(3);

    const res = await http.get(EXPORT_URL).set(tenantHeaders(tenantA.id, tokenFor(adminA))).buffer(true).expect(200);
    expect(res.text).toContain('Tamamlama;Kaydını tamamlayan üye (%);100;4/4 kişi.');
    expect(res.text).toContain(`Tamamlama;DISC tamamlama (%);${SUPPRESSED_CELL_TEXT};`);
    expect(res.text).not.toMatch(/DISC tamamlama \(%\);\d/);
    expect(res.text).toContain('Tamamlama;Tamamlanan görüşme;3;');
    expect(res.text).not.toContain('Tamamlanan görüşme;11;');
    expect(res.text).not.toContain('Tamamlanan görüşme;8;');
  });

  it('davetle onaylı gelen (APPROVED) kullanıcı DISC\'i bitirdiyse sayılır — bekleme odası damgası gerekmez', async () => {
    const tenant = await createTenant();
    const admin = await createAdminUser(tenant.id);
    // Davetle gelen kullanıcı kayıtta APPROVED: bekleme odası bildirimi (discAssessmentCompletedAt) hiç yazılmaz.
    for (let i = 0; i < 3; i++) await createMenti(tenant.id, { approvalStatus: 'APPROVED', discType: 'S' });
    await createMenti(tenant.id); // DISC'i bitirmemiş
    const invited = await testPrisma.user.count({ where: { tenantId: tenant.id, discAssessmentCompletedAt: { not: null } } });
    expect(invited).toBe(0);

    const res = await http.get(KPI_URL).set(tenantHeaders(tenant.id, tokenFor(admin))).expect(200);
    expect(res.body.stats.completion.disc).toEqual({ completed: 3, eligible: 4, percent: 75, suppressed: false });
  });

  it('negatif: MENTOR → 403', async () => {
    const tenant = await createTenant();
    const m = await createMentor(tenant.id);
    await http.get(KPI_URL).set(tenantHeaders(tenant.id, tokenFor(m))).expect(403);
  });

  it('negatif: MENTI → 403', async () => {
    const tenant = await createTenant();
    const m = await createMenti(tenant.id);
    await http.get(KPI_URL).set(tenantHeaders(tenant.id, tokenFor(m))).expect(403);
  });
});
