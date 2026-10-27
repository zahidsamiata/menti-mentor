/**
 * AJ-18 — K5-Y3'ün devamı: kurum izolasyonu / IDOR negatif testleri (5. parti).
 *
 * Kaynak: docs/raporlar/kesif/negatif-test-boslugu-2026-09-26.md — önceki beş parti
 * (`y3-yetki-kurum-izolasyonu.test.ts`, `aj04-negatif-test-devami.test.ts`,
 * `aj13-negatif-test-2-parti.test.ts`, `aj15-negatif-test-3-parti.test.ts`,
 * `aj16-negatif-test-4-parti.test.ts`, `aj17-elle-cron-kurum-kapsami.test.ts`) raporun
 * öncelik listesi + tablosundaki uçları sırayla kapattı. Bu dosya KALAN uçlardan devam
 * eder: müsaitlik/rezervasyon/çift-verimsizlik sinyali, hatırlatma e-postası toplu işi
 * (AJ-17'deki cron gibi "platform geneli iş tetikleyen" ailede), mentörlük anlaşması
 * oluşturma, öğrenme yolculuğu global-aşama özelleştirme/gizleme ve bir grup admin GET
 * ucunun eksik (a)/(b) duvarları.
 *
 * Tekrarlama kontrolü: her uç için `grep -rn <yol> tests/` ile TÜM test dosyaları
 * tarandı (yalnız önceki 6 parti değil) — bulunan gerçek çakışmalar (ör. GET
 * /api/admin/managers'ın çok-kurumlu üyelik senaryoları, GET /api/meetings'in aynı-kurum
 * IDOR'u, sertifika konusu tenant-izolasyonunun servis-katmanı testi) atlanmış, yalnız
 * GERÇEKTEN eksik olan (a)/(b)/(c) alt-testler eklenmiştir.
 *
 * Desen:
 *   (a) oturumsuz → 401
 *   (b) yanlış rol → 403
 *   (c) BAŞKA KURUMUN kaynağı/verisi → 403/404 VE kaynak/veri DEĞİŞMEZ (DB'den okunarak)
 *   (d) aynı kurumda başkasının kaydı (IDOR) → 403/404 VE kaynak değişmez
 *
 * Kaynak koda dokunulmadı; yalnız test eklendi. Beklenen kodlar controller/servis
 * OKUNARAK alındı (tahmin değil) — ilgili dosya/satır her blokta yorumda belirtilir.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { agent, tenantHeaders, type TestAgent } from './helpers/request.js';
import { cleanDb, testPrisma } from './helpers/db.js';
import {
  createTenant,
  createAdminUser,
  createMentor,
  createMenti,
} from './helpers/factories.js';
import { signToken } from '../src/middleware/jwtAuth.js';
import type { User, Tenant } from '@prisma/client';

// E-4 karantina: GET /api/meetings/pair-signal karantinada (410). Bu dosya o ucun handler davranışını korumaya
// devam eder — kapı ortam değişkeniyle yeniden açılır (vitest pool=forks: her dosya ayrı süreç,
// değişken başka dosyaya sızmaz). Kapının kendisi `e4-karantina.test.ts`'te test edilir.
process.env['QUARANTINE_REOPEN'] = 'meetings-pair-signal';

type SeededUser = Awaited<ReturnType<typeof createMenti>>;

function tokenFor(u: Pick<User, 'id' | 'tenantId' | 'role' | 'fullName'>): string {
  return signToken({ sub: u.id, tenantId: u.tenantId, role: u.role, fullName: u.fullName });
}

/** İstek sahibinin kendi kurumu başlığı + kendi token'ı. */
function authAs(u: Pick<User, 'id' | 'tenantId' | 'role' | 'fullName'>): Record<string, string> {
  return tenantHeaders(u.tenantId, tokenFor(u));
}

const stageBody = (title: string, audience: 'MENTOR' | 'MENTI' = 'MENTI') => ({
  audience,
  title,
  situationText: 'Bir durumla karşılaşıyorsun, ne yaparsın?',
  learningGoal: 'Bir şey öğren.',
  choices: [
    { key: 'a', label: 'Evet', outcome: 'correct', feedback: 'İyi.' },
    { key: 'b', label: 'Hayır', outcome: 'wrong', feedback: 'Olmadı.' },
  ],
});

// ─── AJ18-1: GET /api/admin/managers (c) ────────────────────────────────────
// adminController.ts:listAdmins — where.tenantId req.tenant.tenantId. Önceki testler
// (session-revocation.test.ts, kurum-ici-rol-sayimi-uyelik.test.ts) aynı kurumun
// çok-kurumlu üyelik senaryolarını kapsıyor; B'nin listesinin A'nın yöneticisini hiç
// İÇERMEDİĞİ doğrudan hiçbir yerde iddia edilmemiş.
describe('AJ18-1: GET /api/admin/managers (c)', () => {
  it('B kurumunun yönetici listesinde A kurumunun yöneticisi GÖRÜNMEZ', async () => {
    await cleanDb();
    const http = agent();
    const tenantA = await createTenant();
    const tenantB = await createTenant();
    const adminA = await createAdminUser(tenantA.id);
    const adminB = await createAdminUser(tenantB.id);

    const res = await http.get('/api/admin/managers').set(authAs(adminB)).expect(200);
    const ids = (res.body.items as Array<{ id: string }>).map((u) => u.id);
    expect(ids).not.toContain(adminA.id);
    expect(res.body.total).toBe(1); // yalnız adminB
    expect(JSON.stringify(res.body)).not.toContain(adminA.fullName);
  });
});

// ─── AJ18-2: POST /api/meetings/reminders/send (a + c) ──────────────────────
// feedbackController.ts:sendPendingFeedbackReminders — where.tenantId req.tenant.tenantId.
// AJ-17'deki cron ailesiyle AYNI risk deseni ("platform geneli iş tetikleyen uç"); burada
// kod ZATEN tenant'a göre filtreliyor — reminder-batch-cooldown.test.ts (V-07) yalnız
// TEK kurumda batch/cooldown test ediyor, kurum-kapsamı hiç test edilmemiş.
describe('AJ18-2: POST /api/meetings/reminders/send', () => {
  let http: TestAgent;
  let tenantA: Tenant;
  let tenantB: Tenant;
  let adminB: SeededUser;
  let meetingA: { id: string };

  beforeEach(async () => {
    await cleanDb();
    http = agent();
    tenantA = await createTenant();
    tenantB = await createTenant();
    const mentorA = await createMentor(tenantA.id);
    const mentiA = await createMenti(tenantA.id);
    adminB = await createAdminUser(tenantB.id);

    meetingA = await testPrisma.meeting.create({
      data: {
        tenantId: tenantA.id,
        mentorUserId: mentorA.id,
        mentiUserId: mentiA.id,
        status: 'COMPLETED',
        hasFeedback: false,
        startsAt: new Date(Date.now() - 3 * 60 * 60 * 1000),
        endsAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
      },
    });
  });

  it('(a) oturumsuz → 401', async () => {
    await http.post('/api/meetings/reminders/send').set(tenantHeaders(tenantB.id)).expect(401);
  });

  it('(c) B kurumunun yöneticisi tetikler → A\'nın bekleyen toplantısı SAYILMAZ/hatırlatılmaz; count=0', async () => {
    const res = await http.post('/api/meetings/reminders/send').set(authAs(adminB)).expect(200);
    expect(res.body.count).toBe(0);
    expect(res.body.remaining).toBe(0);

    const stillPending = await testPrisma.meeting.findUnique({ where: { id: meetingA.id } });
    expect(stillPending?.hasFeedback).toBe(false); // A'nın kaydı hiç işlenmedi (yan etki yok)
  });
});

// ─── AJ18-3: GET /api/meetings/pair-signal (a + d/c) ────────────────────────
// meetingCheckInController.ts:getPairEfficiencySignal — recentMeetings sorgusu tenantId +
// mentorId + mentiId ile filtrelenir. Hiç test edilmemiş uç: B kurumunun yöneticisi, A
// kurumundaki gerçek (kötü giden) bir çiftin id'lerini query'e verirse gerçek sinyal
// SIZMAMALI — 0 görüşme bulunur, INSUFFICIENT_DATA döner.
describe('AJ18-3: GET /api/meetings/pair-signal', () => {
  let http: TestAgent;
  let tenantA: Tenant;
  let tenantB: Tenant;
  let mentorA: SeededUser;
  let mentiA: SeededUser;
  let adminB: SeededUser;

  beforeEach(async () => {
    await cleanDb();
    http = agent();
    tenantA = await createTenant();
    tenantB = await createTenant();
    mentorA = await createMentor(tenantA.id);
    mentiA = await createMenti(tenantA.id);
    adminB = await createAdminUser(tenantB.id);

    const meeting = await testPrisma.meeting.create({
      data: {
        tenantId: tenantA.id,
        mentorUserId: mentorA.id,
        mentiUserId: mentiA.id,
        status: 'COMPLETED',
        startsAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
        endsAt: new Date(Date.now() - 1 * 60 * 60 * 1000),
      },
    });
    // Kötü giden çift: RED sinyali üretecek check-in'ler (avgRating düşük + çıkış niyeti).
    await testPrisma.meetingCheckIn.create({
      data: {
        meetingId: meeting.id, tenantId: tenantA.id, userId: mentorA.id, role: 'MENTOR',
        overallRating: 1, progressRating: 1, continueIntent: 'HAYIR',
      },
    });
    await testPrisma.meetingCheckIn.create({
      data: {
        meetingId: meeting.id, tenantId: tenantA.id, userId: mentiA.id, role: 'MENTI',
        overallRating: 1, progressRating: 1, continueIntent: 'HAYIR',
      },
    });
  });

  it('(a) oturumsuz → 401', async () => {
    await http.get('/api/meetings/pair-signal').query({ mentorId: mentorA.id, mentiId: mentiA.id })
      .set(tenantHeaders(tenantA.id)).expect(401);
  });

  it('pozitif kontrol: A kurumunun yöneticisi gerçek (RED) sinyali görür', async () => {
    const adminA = await createAdminUser(tenantA.id);
    const res = await http.get('/api/meetings/pair-signal')
      .query({ mentorId: mentorA.id, mentiId: mentiA.id })
      .set(authAs(adminA)).expect(200);
    expect(res.body.signal).toBe('RED');
    expect(res.body.meetingCount).toBe(1);
  });

  it('(c) B kurumunun yöneticisi A\'nın çift id\'lerini kullanır → gerçek sinyal SIZMAZ (INSUFFICIENT_DATA, meetingCount=0)', async () => {
    const res = await http.get('/api/meetings/pair-signal')
      .query({ mentorId: mentorA.id, mentiId: mentiA.id })
      .set(authAs(adminB)).expect(200);
    expect(res.body.signal).toBe('INSUFFICIENT_DATA');
    expect(res.body.meetingCount).toBe(0);
  });
});

// ─── AJ18-4: GET /api/meetings/availability (a + c IDOR) ────────────────────
// meetingController.ts:getAvailability — mentorMembership tenantId + mentorUserId ile
// aranır; başka tenant'ın mentörü için 404 döner, blokları hiç sızmaz. Hiç test edilmemiş.
describe('AJ18-4: GET /api/meetings/availability', () => {
  let http: TestAgent;
  let tenantA: Tenant;
  let tenantB: Tenant;
  let mentorA: SeededUser;
  let adminB: SeededUser;

  beforeEach(async () => {
    await cleanDb();
    http = agent();
    tenantA = await createTenant();
    tenantB = await createTenant();
    mentorA = await createMentor(tenantA.id);
    adminB = await createAdminUser(tenantB.id);
    await testPrisma.availabilityBlock.create({
      data: {
        tenantId: tenantA.id, userId: mentorA.id, weekday: 'MON',
        startTime: '09:00', endTime: '17:00', timezone: 'Europe/Istanbul', isActive: true,
      },
    });
  });

  it('(a) oturumsuz → 401', async () => {
    await http.get('/api/meetings/availability').query({ mentorUserId: mentorA.id })
      .set(tenantHeaders(tenantB.id)).expect(401);
  });

  it('(c) B kurumunun yöneticisi A\'nın mentörünün müsaitliğini SORGULAYAMAZ → 404, blok dönmez', async () => {
    const res = await http.get('/api/meetings/availability').query({ mentorUserId: mentorA.id })
      .set(authAs(adminB)).expect(404);
    expect(JSON.stringify(res.body)).not.toContain('09:00');
  });
});

// ─── AJ18-5: POST /api/meetings/book (c) ────────────────────────────────────
// meetingController.ts:bookMeeting — matchId yoksa availability sorgusu tenantId +
// mentorUserId ile filtrelenir; başka tenant'ın mentörü seçilirse müsaitlik boş döner →
// 409 "uymuyor". Görüşme hiç OLUŞMAZ. meetings.test.ts bu senaryoyu test etmiyor.
describe('AJ18-5: POST /api/meetings/book (c)', () => {
  it('B kurumunun mentisi A kurumunun mentörüyle görüşme AYARLAYAMAZ → 409; görüşme oluşmaz', async () => {
    await cleanDb();
    const http = agent();
    const tenantA = await createTenant();
    const tenantB = await createTenant();
    const mentorA = await createMentor(tenantA.id);
    // A'da gerçek müsaitlik var — eğer tenant filtresi atlanırsa bu slot "uyar" hâle gelirdi.
    await testPrisma.availabilityBlock.create({
      data: {
        tenantId: tenantA.id, userId: mentorA.id, weekday: 'MON',
        startTime: '00:00', endTime: '23:59', timezone: 'UTC', isActive: true,
      },
    });
    const mentiB = await createMenti(tenantB.id);

    const nextMonday = new Date();
    nextMonday.setUTCDate(nextMonday.getUTCDate() + ((8 - nextMonday.getUTCDay()) % 7 || 7));
    nextMonday.setUTCHours(10, 0, 0, 0);
    const startsAt = nextMonday.toISOString();
    const endsAt = new Date(nextMonday.getTime() + 30 * 60 * 1000).toISOString();

    const res = await http.post('/api/meetings/book').set(authAs(mentiB)).send({
      mentorUserId: mentorA.id, format: 'ONLINE', startsAt, endsAt,
      requestMessage: 'Bu görüşmede kariyer hedeflerim üzerine konuşmak istiyorum, teşekkürler.',
    }).expect(409);
    expect(res.body.error).toContain('müsaitlik');

    const count = await testPrisma.meeting.count({ where: { mentorUserId: mentorA.id } });
    expect(count).toBe(0);
  });
});

// ─── AJ18-6: GET /api/meetings (liste, a + c) ───────────────────────────────
// meetingController.ts:listMeetings — meetings-list-idor.test.ts (Y2) aynı-kurum IDOR'unu
// (menti A / menti B) ve admin'in tenant genelini gördüğünü test ediyor; (a) 401 ve
// BAŞKA KURUMUN görüşmesinin admin listesine hiç girmediği (c) test edilmemiş.
describe('AJ18-6: GET /api/meetings (liste)', () => {
  let http: TestAgent;
  let tenantA: Tenant;
  let tenantB: Tenant;
  let adminB: SeededUser;

  beforeEach(async () => {
    await cleanDb();
    http = agent();
    tenantA = await createTenant();
    tenantB = await createTenant();
    const mentorA = await createMentor(tenantA.id);
    const mentiA = await createMenti(tenantA.id);
    adminB = await createAdminUser(tenantB.id);
    await testPrisma.meeting.create({
      data: {
        tenantId: tenantA.id, mentorUserId: mentorA.id, mentiUserId: mentiA.id,
        startsAt: new Date(), endsAt: new Date(Date.now() + 3600_000),
      },
    });
  });

  it('(a) oturumsuz → 401', async () => {
    await http.get('/api/meetings').set(tenantHeaders(tenantB.id)).expect(401);
  });

  it('(c) B kurumunun yöneticisi kendi listesinde A kurumunun görüşmesini GÖRMEZ', async () => {
    const res = await http.get('/api/meetings').set(authAs(adminB)).expect(200);
    expect((res.body.items as unknown[]).length).toBe(0);
  });
});

// ─── AJ18-7: GET /api/users/mentor-count (a + c) ────────────────────────────
// userController.ts:countApprovedMentors — where.tenantId req.tenant.tenantId üzerinden
// TenantMembership sayımı. mentor-count-membership.test.ts (P-16) yalnız TEK kurumda
// üyelik-rolü doğruluğunu test ediyor; (a) ve kurumlar-arası izolasyon test edilmemiş.
describe('AJ18-7: GET /api/users/mentor-count', () => {
  let http: TestAgent;
  let tenantB: Tenant;
  let adminB: SeededUser;

  beforeEach(async () => {
    await cleanDb();
    http = agent();
    const tenantA = await createTenant();
    tenantB = await createTenant();
    adminB = await createAdminUser(tenantB.id);
    for (let i = 0; i < 5; i++) await createMentor(tenantA.id); // A'da 5 mentör — B'yi etkilememeli
  });

  it('(a) oturumsuz → 401', async () => {
    await http.get('/api/users/mentor-count').set(tenantHeaders(tenantB.id)).expect(401);
  });

  it('(c) B kurumunun sayısı A kurumunun mentörlerini SAYMAZ (0)', async () => {
    const res = await http.get('/api/users/mentor-count').set(authAs(adminB)).expect(200);
    expect(res.body.count).toBe(0);
  });
});

// ─── AJ18-8: POST /api/agreements (c) ───────────────────────────────────────
// agreementController.ts:createAgreement — mentor/menti findFirst({ id, tenantId }) ile
// aranır; security-audit-2.test.ts aynı-kurum "taraf değil" (b/d benzeri) senaryosunu
// kapsıyor ama mentorId/mentiId BAŞKA kurumdan gelirse (kurumlar-arası çift) hiç test
// edilmemiş.
describe('AJ18-8: POST /api/agreements (c)', () => {
  it('B kurumunun mentörü A kurumunun mentisiyle anlaşma OLUŞTURAMAZ → 404; kayıt oluşmaz', async () => {
    await cleanDb();
    const http = agent();
    const tenantA = await createTenant();
    const tenantB = await createTenant();
    const mentiA = await createMenti(tenantA.id);
    const mentorB = await createMentor(tenantB.id);

    const res = await http.post('/api/agreements').set(authAs(mentorB)).send({
      mentorId: mentorB.id, // taraf kendisi — 403'ü atlar, tenant filtresi test edilir
      mentiId: mentiA.id,   // başka kurumun mentisi
      meetingFrequency: 'WEEKLY',
      communicationChannel: 'ONLINE',
      durationWeeks: 12,
      targetMeetings: 12,
      mentiGoal: 'Bu mentorluk sürecinde kariyer hedeflerimi netleştirmek istiyorum.',
      agendaOwner: 'MENTI',
      privacyAgreed: true,
    }).expect(404);
    expect(res.body.error).toBe('MENTI_BULUNAMADI');

    const count = await testPrisma.mentorshipAgreement.count({ where: { mentiId: mentiA.id } });
    expect(count).toBe(0);
  });
});

// ─── AJ18-9/10/11: global aşama özelleştirme/gizleme/geri-getirme ───────────
// learningJourneyAdminController.ts:adminCustomizeStage/adminHideStage/adminUnhideStage →
// learningJourney.service.ts — global (tenantId:null) aşamalar tüm kurumlarca paylaşılır;
// bir kurumun özelleştirmesi/gizlemesi DİĞER kurumun görünümünü ETKİLEMEMELİ. Hiç test
// edilmemiş (AJ16-7/8/9/10 yalnız TENANT'A ÖZEL aşamaları kapsadı, global aşama
// customize/hide/unhide'ı değil).
describe('AJ18-9/10/11: global öğrenme yolculuğu aşaması özelleştirme/gizleme kurum izolasyonu', () => {
  let http: TestAgent;
  let tenantA: Tenant;
  let tenantB: Tenant;
  let adminA: SeededUser;
  let adminB: SeededUser;
  let globalStageId: string;

  beforeEach(async () => {
    await cleanDb();
    http = agent();
    tenantA = await createTenant();
    tenantB = await createTenant();
    adminA = await createAdminUser(tenantA.id);
    adminB = await createAdminUser(tenantB.id);
    const global = await testPrisma.learningStage.create({
      data: {
        tenantId: null, audience: 'MENTI', order: 0,
        title: 'AJ18 global aşama', situationText: 'Durum metni.', learningGoal: 'Hedef.',
        choices: [
          { key: 'a', label: 'Evet', outcome: 'correct', feedback: 'İyi.' },
          { key: 'b', label: 'Hayır', outcome: 'wrong', feedback: 'Olmadı.' },
        ],
        isActive: true,
      },
    });
    globalStageId = global.id;
  });

  it('(a) oturumsuz → 401 (customize + hide + unhide)', async () => {
    await http.post(`/api/admin/learning-journey/stages/${globalStageId}/customize`).set(tenantHeaders(tenantA.id)).expect(401);
    await http.post(`/api/admin/learning-journey/stages/${globalStageId}/hide`).set(tenantHeaders(tenantA.id)).expect(401);
    await http.delete(`/api/admin/learning-journey/stages/${globalStageId}/hide`).set(tenantHeaders(tenantA.id)).expect(401);
  });

  it('B kurumunun global aşamayı ÖZELLEŞTİRMESİ (klonlaması), A\'nın global aşama görünümünü ETKİLEMEZ', async () => {
    await http.post(`/api/admin/learning-journey/stages/${globalStageId}/customize`).set(authAs(adminB)).expect(201);

    const listA = await http.get('/api/admin/learning-journey/stages').set(authAs(adminA)).expect(200);
    const stageInA = (listA.body.items as Array<{ id: string; title: string }>).find((s) => s.id === globalStageId);
    expect(stageInA).toBeDefined();
    expect(stageInA?.title).toBe('AJ18 global aşama'); // hâlâ orijinal, B'nin klonundan etkilenmedi

    // B'nin klonu A'nın listesinde hiç görünmez.
    const clone = await testPrisma.learningStage.findFirst({ where: { clonedFromId: globalStageId, tenantId: tenantB.id } });
    expect(clone).not.toBeNull();
    expect((listA.body.items as Array<{ id: string }>).map((s) => s.id)).not.toContain(clone!.id);
  });

  it('B kurumunun global aşamayı GİZLEMESİ, A\'nın kurumunda aşamayı gizli YAPMAZ', async () => {
    await http.post(`/api/admin/learning-journey/stages/${globalStageId}/hide`).set(authAs(adminB)).expect(201);

    const hideForA = await testPrisma.learningStageHide.findUnique({
      where: { stageId_tenantId: { stageId: globalStageId, tenantId: tenantA.id } },
    });
    expect(hideForA).toBeNull(); // A için gizleme kaydı YOK

    const hideForB = await testPrisma.learningStageHide.findUnique({
      where: { stageId_tenantId: { stageId: globalStageId, tenantId: tenantB.id } },
    });
    expect(hideForB).not.toBeNull(); // B için VAR
  });

  it('B\'nin gizlemeyi geri alması (unhide) yalnız B\'nin kaydını siler; A hiç etkilenmez', async () => {
    await http.post(`/api/admin/learning-journey/stages/${globalStageId}/hide`).set(authAs(adminA)).expect(201);
    await http.post(`/api/admin/learning-journey/stages/${globalStageId}/hide`).set(authAs(adminB)).expect(201);

    await http.delete(`/api/admin/learning-journey/stages/${globalStageId}/hide`).set(authAs(adminB)).expect(204);

    const hideForA = await testPrisma.learningStageHide.findUnique({
      where: { stageId_tenantId: { stageId: globalStageId, tenantId: tenantA.id } },
    });
    expect(hideForA).not.toBeNull(); // A'nın gizlemesi HÂLÂ DURUYOR — B'nin unhide'ından etkilenmedi
  });

  it('B kurumunun yöneticisi A\'nın (tenant\'a-özel, global OLMAYAN) aşamasını özelleştiremez/gizleyemez → 400 SADECE_GLOBAL', async () => {
    const created = await http.post('/api/admin/learning-journey/stages').set(authAs(adminA)).send(stageBody('A-özel aşama')).expect(201);
    const stageIdA = created.body.id as string;

    const custRes = await http.post(`/api/admin/learning-journey/stages/${stageIdA}/customize`).set(authAs(adminB)).expect(400);
    expect(custRes.body.error).toBe('SADECE_GLOBAL');

    const hideRes = await http.post(`/api/admin/learning-journey/stages/${stageIdA}/hide`).set(authAs(adminB)).expect(400);
    expect(hideRes.body.error).toBe('SADECE_GLOBAL');

    const stage = await testPrisma.learningStage.findUnique({ where: { id: stageIdA } });
    expect(stage?.title).toBe('A-özel aşama'); // değişmedi
    const hideRecord = await testPrisma.learningStageHide.findFirst({ where: { stageId: stageIdA } });
    expect(hideRecord).toBeNull(); // hiçbir gizleme kaydı oluşmadı
  });
});

// ─── AJ18-12: eksik (a)/(b) duvarları — bir grup admin GET ucu ─────────────
// Aşağıdaki uçların (c) hâli önceki partilerde (AJ15-16/17/18/19) zaten test edildi;
// yalnız (a) oturumsuz-401 ve (varsa) (b) yanlış-rol-403 eksikti — bu blok yalnız o
// boşlukları kapatır (kurgu tekrarını önlemek için minimal).
describe('AJ18-12: eksik (a)/(b) duvarları — admin GET uçları', () => {
  let http: TestAgent;
  let tenant: Tenant;

  beforeEach(async () => {
    await cleanDb();
    http = agent();
    tenant = await createTenant();
  });

  it('GET /api/admin/kpi (a) oturumsuz → 401', async () => {
    await http.get('/api/admin/kpi').set(tenantHeaders(tenant.id)).expect(401);
  });

  it('GET /api/admin/matches (a) oturumsuz → 401', async () => {
    await http.get('/api/admin/matches').set(tenantHeaders(tenant.id)).expect(401);
  });

  it('GET /api/admin/health-metrics (a) oturumsuz → 401; (b) MENTOR rolü → 403', async () => {
    await http.get('/api/admin/health-metrics').set(tenantHeaders(tenant.id)).expect(401);
    const mentor = await createMentor(tenant.id);
    await http.get('/api/admin/health-metrics').set(authAs(mentor)).expect(403);
  });

  it('GET /api/admin/mentors/certification-results (a) oturumsuz → 401; (b) MENTI rolü → 403', async () => {
    await http.get('/api/admin/mentors/certification-results').set(tenantHeaders(tenant.id)).expect(401);
    const menti = await createMenti(tenant.id);
    await http.get('/api/admin/mentors/certification-results').set(authAs(menti)).expect(403);
  });

  it('GET /api/admin/tags/pending (a) oturumsuz → 401; (b) MENTOR rolü → 403', async () => {
    await http.get('/api/admin/tags/pending').set(tenantHeaders(tenant.id)).expect(401);
    const mentor = await createMentor(tenant.id);
    await http.get('/api/admin/tags/pending').set(authAs(mentor)).expect(403);
  });
});

// ─── AJ18-13: eksik (a) duvarları — sertifika ve anlaşma öz-kaynak uçları ───
// GET /certification/questions (a) zaten test edilmiş (certification.test.ts); topics
// GET/PATCH ve agreements/active (a) eksikti.
describe('AJ18-13: eksik (a) duvarları — sertifika konuları + aktif anlaşma', () => {
  it('GET /api/scoring/certification/topics (a) oturumsuz → 401', async () => {
    await cleanDb();
    const http = agent();
    const tenant = await createTenant();
    await http.get('/api/scoring/certification/topics').set(tenantHeaders(tenant.id)).expect(401);
  });

  it('PATCH /api/scoring/certification/topics (a) oturumsuz → 401', async () => {
    await cleanDb();
    const http = agent();
    const tenant = await createTenant();
    await http.patch('/api/scoring/certification/topics').set(tenantHeaders(tenant.id)).send({ topic: 'x', enabled: false }).expect(401);
  });

  it('GET /api/agreements/active (a) oturumsuz → 401', async () => {
    await cleanDb();
    const http = agent();
    const tenant = await createTenant();
    await http.get('/api/agreements/active').set(tenantHeaders(tenant.id)).expect(401);
  });
});
