/**
 * AJ-17 — POST /api/admin/cron/run-purge ve /run-tuning yalnız KENDİ kurumunu
 * etkilemeli (yetki zaten T+ADMIN ile doğruydu; kapsam KURUM'a daraltıldı).
 *
 * Arka plan (bulgu): AJ-16'da (tests/aj16-negatif-test-4-parti.test.ts, AJ16-4/5) bu iki
 * uç yalnız yetki kapısıyla (401) test edilmişti; kurumlar-arası yan etki AJ-17'ye
 * devredildi çünkü çağrılan iş (`purgeExpiredData()` / `runWeeklyTuning()`) tenant
 * parametresi ALMADAN TÜM kurumları işliyordu. Bu dosya o boşluğu, DÜZELTMEYLE BİRLİKTE
 * kapatır — testler düzeltme olmadan KIRMIZI olurdu (mutlak sonuç kontrolü, `it.fails`
 * KULLANILMADI — bağımsız incelemenin AJ-16 üzerindeki bulgusu).
 *
 * SystemLog kararı: SystemLog platform-geneli bir tablodur, `tenantId` kolonu YOK
 * (`prisma/schema.prisma:683-696` — yalnız `meta` JSON içinde, güvenilir filtre değil).
 * Bu yüzden kurum-kapsamlı (elle) çağrıda SystemLog temizliği ATLANIR — şema DEĞİŞMEDİ.
 * Negatif testte kurum sahipliği bu yüzden `FeedbackLog` (tenantId kolonu VAR) üzerinden
 * kanıtlanır (bağımsız inceleme notu).
 *
 * run-tuning için gözlemlenebilir yan etki NPS/skor verisi kurmayı gerektirdiğinden
 * (karmaşık kurulum), `tuneScoringWeights` spy'la doğrulanır: hangi tenantId'lerle
 * çağrıldığı (yalnız kendi kurumu, başka kurum ASLA).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { agent, loginAs, tenantHeaders, type TestAgent } from './helpers/request.js';
import { cleanDb, testPrisma } from './helpers/db.js';
import { createTenant, createAdminUser, createMentor, createMenti } from './helpers/factories.js';
import type { Tenant } from '@prisma/client';

const mocks = vi.hoisted(() => ({ tuneScoringWeights: vi.fn() }));

// Yalnızca kullanılan fonksiyonu mock'la; diğer export'lar gerçek kalır (partial mock,
// bkz. tests/certification-reminder-cron.test.ts deseni).
vi.mock('../src/services/algorithmTuner.js', async (orig) => ({
  ...(await orig<typeof import('../src/services/algorithmTuner.js')>()),
  tuneScoringWeights: mocks.tuneScoringWeights,
}));

const fakeTuningResult = (tenantId: string) => ({
  tenantId,
  previousWeights: { sectorWeight: 0.6, discWeight: 0.4, lastAdjustedAt: null, reason: null },
  newWeights: { sectorWeight: 0.6, discWeight: 0.4, lastAdjustedAt: null, reason: null },
  phase1Nps: { avgNps: null, sampleSize: 0 },
  phase3Nps: { avgNps: null, sampleSize: 0 },
  adjusted: false,
  reason: 'AJ-17 test — sabit mock',
});

type SeededAdmin = Awaited<ReturnType<typeof createAdminUser>>;

// ─── run-purge: kurum sahipliği FeedbackLog üzerinden kanıtlanır ────────────────────
describe('AJ-17: POST /api/admin/cron/run-purge — kurum kapsamı', () => {
  let http: TestAgent;
  let tenantA: Tenant;
  let tenantB: Tenant;
  let adminB: SeededAdmin;
  let feedbackLogAId: string;
  let feedbackLogBId: string;

  beforeEach(async () => {
    await cleanDb();
    http = agent();
    tenantA = await createTenant();
    tenantB = await createTenant();
    adminB = await createAdminUser(tenantB.id);

    const mentorA = await createMentor(tenantA.id);
    const mentiA = await createMenti(tenantA.id);
    const mentorB = await createMentor(tenantB.id);
    const mentiB = await createMenti(tenantB.id);

    // 3 yıllık yasal saklama süresini kesin aşan (4 yıl önce) kayıtlar — her iki kurumda da.
    const expiredAt = new Date();
    expiredAt.setFullYear(expiredAt.getFullYear() - 4);

    const logA = await testPrisma.feedbackLog.create({
      data: { tenantId: tenantA.id, mentorId: mentorA.id, mentiId: mentiA.id, phase: 1, starRating: 5, createdAt: expiredAt },
    });
    const logB = await testPrisma.feedbackLog.create({
      data: { tenantId: tenantB.id, mentorId: mentorB.id, mentiId: mentiB.id, phase: 1, starRating: 5, createdAt: expiredAt },
    });
    feedbackLogAId = logA.id;
    feedbackLogBId = logB.id;
  });

  it('B kurumunun yöneticisi tetikler → A kurumunun süresi dolmuş kaydı SİLİNMEZ, B\'ninki silinir', async () => {
    const { accessToken } = await loginAs(http, adminB.email, adminB.rawPassword);
    const res = await http
      .post('/api/admin/cron/run-purge')
      .set(tenantHeaders(tenantB.id, accessToken))
      .expect(200);

    expect(res.body.result.feedbackLogsDeleted).toBe(1);
    // SystemLog kurum-kapsamlı çağrıda ATLANIR (platform-geneli tablo, tenantId kolonu yok).
    expect(res.body.result.systemLogsSkipped).toBe(true);
    expect(res.body.result.systemLogsDeleted).toBe(0);

    const stillA = await testPrisma.feedbackLog.findUnique({ where: { id: feedbackLogAId } });
    expect(stillA).not.toBeNull();

    const goneB = await testPrisma.feedbackLog.findUnique({ where: { id: feedbackLogBId } });
    expect(goneB).toBeNull();
  });
});

// ─── run-tuning: kurum kapsamı spy ile kanıtlanır ───────────────────────────────────
describe('AJ-17: POST /api/admin/cron/run-tuning — kurum kapsamı', () => {
  let http: TestAgent;
  let tenantA: Tenant;
  let tenantB: Tenant;
  let adminB: SeededAdmin;

  beforeEach(async () => {
    await cleanDb();
    mocks.tuneScoringWeights.mockReset();
    mocks.tuneScoringWeights.mockImplementation(async (tenantId: string) => fakeTuningResult(tenantId));
    http = agent();
    tenantA = await createTenant();
    tenantB = await createTenant();
    adminB = await createAdminUser(tenantB.id);
  });

  it('B kurumunun yöneticisi tetikler → yalnız B işlenir, A\'nın tenantId\'siyle HİÇ çağrılmaz', async () => {
    const { accessToken } = await loginAs(http, adminB.email, adminB.rawPassword);
    const res = await http
      .post('/api/admin/cron/run-tuning')
      .set(tenantHeaders(tenantB.id, accessToken))
      .expect(200);

    expect(mocks.tuneScoringWeights).toHaveBeenCalledTimes(1);
    expect(mocks.tuneScoringWeights).toHaveBeenCalledWith(tenantB.id);
    expect(mocks.tuneScoringWeights).not.toHaveBeenCalledWith(tenantA.id);
    expect(res.body.results).toEqual({ processed: 1, skipped: 0 });
  });
});

// ─── Regresyon: argümansız (otomatik) cron davranışı DEĞİŞMEDİ ──────────────────────
describe('AJ-17: regresyon — argümansız çağrı (otomatik cron) TÜM kurumları işlemeye devam eder', () => {
  it('runWeeklyTuning() (argümansız) her iki kurumu da işler', async () => {
    await cleanDb();
    mocks.tuneScoringWeights.mockReset();
    mocks.tuneScoringWeights.mockImplementation(async (tenantId: string) => fakeTuningResult(tenantId));

    const tenantA = await createTenant();
    const tenantB = await createTenant();

    const { runWeeklyTuning } = await import('../src/services/cronScheduler.js');
    const result = await runWeeklyTuning();

    expect(mocks.tuneScoringWeights).toHaveBeenCalledWith(tenantA.id);
    expect(mocks.tuneScoringWeights).toHaveBeenCalledWith(tenantB.id);
    expect(result).toEqual({ processed: 2, skipped: 0 });
  });

  it('purgeExpiredData() (argümansız) hem SystemLog hem FeedbackLog için TÜM kurumları işler', async () => {
    await cleanDb();
    const tenantA = await createTenant();
    const tenantB = await createTenant();
    const mentorA = await createMentor(tenantA.id);
    const mentiA = await createMenti(tenantA.id);
    const mentorB = await createMentor(tenantB.id);
    const mentiB = await createMenti(tenantB.id);

    const expiredAt = new Date();
    expiredAt.setFullYear(expiredAt.getFullYear() - 4);

    await testPrisma.systemLog.create({
      data: { level: 'INFO', category: 'SYSTEM', message: 'AJ-17 regresyon', createdAt: expiredAt },
    });
    await testPrisma.feedbackLog.create({
      data: { tenantId: tenantA.id, mentorId: mentorA.id, mentiId: mentiA.id, phase: 1, starRating: 5, createdAt: expiredAt },
    });
    await testPrisma.feedbackLog.create({
      data: { tenantId: tenantB.id, mentorId: mentorB.id, mentiId: mentiB.id, phase: 1, starRating: 5, createdAt: expiredAt },
    });

    const { purgeExpiredData } = await import('../src/services/gdprService.js');
    const result = await purgeExpiredData();

    expect(result.systemLogsSkipped).toBeUndefined();
    expect(result.systemLogsDeleted).toBe(1);
    expect(result.feedbackLogsDeleted).toBe(2);
  });
});
