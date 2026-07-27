/**
 * Sertifika motoru + STK konu koruması testleri.
 *
 * Model: "ilk-deneme oranı + red-line mutlak kapı".
 *  - Payda = kurumda AÇIK konu sayısı (sabit değil). Eşik = ceil(açık × %80).
 *  - Red-line konu: ilk seçim yalnız 3 geçer VE tüm açık red-line konular geçilmeli (mutlak).
 *  - Cooldown/ceza YOK.
 *  - STK: red-line kapatılamaz; toplam açık konu min 5'in altına düşürülemez.
 *
 * Kontrollü havuz: topic1..topic5 NORMAL + topic6 RED-LINE = 6 konu (1 varyant/konu).
 * required(6) = ceil(6 × 0.8) = 5.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { agent, loginAs, tenantHeaders, type TestAgent } from './helpers/request.js';
import { cleanDb, testPrisma } from './helpers/db.js';
import { createTenant, createMentor, createAdminUser } from './helpers/factories.js';
import {
  evaluateCertification,
  getCertificationQuestions,
  revealOption,
  isFirstAttemptPass,
  listCertificationTopics,
  setCertificationTopic,
  requiredToPass,
  CertTopicError,
} from '../src/services/certification.service.js';
import type { Tenant } from '@prisma/client';

const SCORE_BY_KEY: Record<string, number> = { A: 3, B: 2, C: 1, D: 0 };

async function createCertQuestion(code: string, topic: string, isRedLine: boolean) {
  const q = await testPrisma.certificationQuestion.create({
    data: { code, dimension: topic, topic, variant: 'A', scenario: `Senaryo ${code}`, isRedLine, isActive: true },
  });
  for (const key of ['A', 'B', 'C', 'D']) {
    const score = SCORE_BY_KEY[key]!;
    await testPrisma.certificationOption.create({
      data: {
        questionId: q.id, key, label: `Seçenek ${key}`, competencyScore: score,
        explanation: `Açıklama ${key}`, outcome: score === 3 ? 'correct' : score === 2 ? 'acceptable' : 'wrong',
      },
    });
  }
}

/** 6 konu: topic1..5 normal, topic6 red-line. */
async function seedControlledPool() {
  await testPrisma.certificationOption.deleteMany({});
  await testPrisma.certificationQuestion.deleteMany({});
  for (let i = 1; i <= 5; i++) await createCertQuestion(`Q_T${i}`, `topic${i}`, false);
  await createCertQuestion('Q_T6', 'topic6', true); // red-line
}

describe('Sertifika motoru + STK koruması', () => {
  let http: TestAgent;
  let tenant: Tenant;
  let mentorId: string;
  let token: string;

  beforeEach(async () => {
    await cleanDb();
    await seedControlledPool();
    http = agent();
    tenant = await createTenant();
    const mentor = await createMentor(tenant.id);
    mentorId = mentor.id;
    const tokens = await loginAs(http, mentor.email, mentor.rawPassword);
    token = tokens.accessToken;
  });

  // ── Saf kural ───────────────────────────────────────────────────────────────
  it('isFirstAttemptPass: normal 3/2 geçer, red-line yalnız 3 geçer', () => {
    expect(isFirstAttemptPass(3, false)).toBe(true);
    expect(isFirstAttemptPass(2, false)).toBe(true);
    expect(isFirstAttemptPass(1, false)).toBe(false);
    expect(isFirstAttemptPass(3, true)).toBe(true);
    expect(isFirstAttemptPass(2, true)).toBe(false);
  });

  it('requiredToPass: ceil(aktif × %80)', () => {
    expect(requiredToPass(4)).toBe(4);  // 3.2 → 4
    expect(requiredToPass(5)).toBe(4);  // 4.0 → 4
    expect(requiredToPass(6)).toBe(5);  // 4.8 → 5
    expect(requiredToPass(7)).toBe(6);  // 5.6 → 6
    expect(requiredToPass(10)).toBe(8);
  });

  // ── Oransal eşik + certified ─────────────────────────────────────────────────
  it('tüm konularda ilk seçim doğru → %100 → CERTIFIED', async () => {
    const answers = ['Q_T1', 'Q_T2', 'Q_T3', 'Q_T4', 'Q_T5', 'Q_T6'].map((c) => ({ questionCode: c, optionKey: 'A' }));
    const r = await evaluateCertification(mentorId, tenant.id, answers);
    expect(r.totalTopics).toBe(6);
    expect(r.required).toBe(5);
    expect(r.passedTopics).toBe(6);
    expect(r.redLineOk).toBe(true);
    expect(r.passed).toBe(true);
    expect(r.status).toBe('CERTIFIED');

    const m = await testPrisma.tenantMembership.findUnique({ where: { userId_tenantId: { userId: mentorId, tenantId: tenant.id } } });
    expect(m!.isCertified).toBe(true);
  });

  it('5/6 konu geçer (red-line dahil) → CERTIFIED (required=5)', async () => {
    const answers = [
      { questionCode: 'Q_T1', optionKey: 'A' },
      { questionCode: 'Q_T2', optionKey: 'A' },
      { questionCode: 'Q_T3', optionKey: 'A' },
      { questionCode: 'Q_T4', optionKey: 'A' },
      { questionCode: 'Q_T5', optionKey: 'D' }, // normal fail
      { questionCode: 'Q_T6', optionKey: 'A' }, // red-line pass
    ];
    const r = await evaluateCertification(mentorId, tenant.id, answers);
    expect(r.passedTopics).toBe(5);
    expect(r.redLineOk).toBe(true);
    expect(r.passed).toBe(true);
  });

  it('4/6 konu geçer (%67, red-line geçse bile) → BELOW_THRESHOLD', async () => {
    const answers = [
      { questionCode: 'Q_T1', optionKey: 'A' },
      { questionCode: 'Q_T2', optionKey: 'A' },
      { questionCode: 'Q_T3', optionKey: 'A' },
      { questionCode: 'Q_T4', optionKey: 'D' }, // fail
      { questionCode: 'Q_T5', optionKey: 'D' }, // fail
      { questionCode: 'Q_T6', optionKey: 'A' }, // red-line pass
    ];
    const r = await evaluateCertification(mentorId, tenant.id, answers);
    expect(r.passedTopics).toBe(4);
    expect(r.redLineOk).toBe(true);
    expect(r.passed).toBe(false);
    expect(r.failReason).toBe('BELOW_THRESHOLD');

    const m = await testPrisma.tenantMembership.findUnique({ where: { userId_tenantId: { userId: mentorId, tenantId: tenant.id } } });
    expect(m!.isCertified).toBe(false);
    expect(m!.cooldownUntil).toBeNull();
  });

  it('red-line MUTLAK kapı: oran %80 olsa bile red-line geçilmezse RED_LINE_FAILED', async () => {
    const answers = [
      { questionCode: 'Q_T1', optionKey: 'A' },
      { questionCode: 'Q_T2', optionKey: 'A' },
      { questionCode: 'Q_T3', optionKey: 'A' },
      { questionCode: 'Q_T4', optionKey: 'A' },
      { questionCode: 'Q_T5', optionKey: 'A' }, // 5 normal geçti (required=5 karşılandı)
      { questionCode: 'Q_T6', optionKey: 'B' }, // red-line score 2 → GEÇMEZ
    ];
    const r = await evaluateCertification(mentorId, tenant.id, answers);
    expect(r.passedTopics).toBe(5);
    expect(r.passedTopics >= r.required).toBe(true); // oransal eşik karşılandı
    expect(r.redLineOk).toBe(false);                  // ama red-line mutlak kapı düştü
    expect(r.passed).toBe(false);
    expect(r.failReason).toBe('RED_LINE_FAILED');
  });

  // ── KİLİTLENME TUZAĞI: payda sabit-10 değil, AÇIK konu sayısı ────────────────
  it('kurum 4 konuya düşürüldüğünde 4/4 geçen mentör CERTIFIED (kilitlenme yok)', async () => {
    // topic4 + topic5 kapalı → açık: topic1,2,3 (normal) + topic6 (red-line) = 4 konu.
    // (Bu düşük sayı motoru test etmek için doğrudan DB'ye yazılır; panel guard'ı ayrı test edilir.)
    await testPrisma.tenant.update({
      where: { id: tenant.id },
      data:  { disabledCertTopics: ['topic4', 'topic5'] },
    });
    const answers = [
      { questionCode: 'Q_T1', optionKey: 'A' },
      { questionCode: 'Q_T2', optionKey: 'A' },
      { questionCode: 'Q_T3', optionKey: 'A' },
      { questionCode: 'Q_T6', optionKey: 'A' }, // red-line pass
    ];
    const r = await evaluateCertification(mentorId, tenant.id, answers);
    expect(r.totalTopics).toBe(4);          // payda AÇIK konu = 4 (sabit 6/10 değil)
    expect(r.required).toBe(4);             // ceil(4 × 0.8) = 4
    expect(r.passedTopics).toBe(4);
    expect(r.passed).toBe(true);            // 4/4 → sertifikalı (KİLİTLENME ÇÖZÜLDÜ)
    expect(r.certScore).toBe(100);
  });

  it('açık konu yoksa NO_ACTIVE_TOPICS (membership yazılmaz)', async () => {
    await testPrisma.tenant.update({
      where: { id: tenant.id },
      data:  { disabledCertTopics: ['topic1', 'topic2', 'topic3', 'topic4', 'topic5', 'topic6'] },
    });
    const r = await evaluateCertification(mentorId, tenant.id, [{ questionCode: 'Q_T1', optionKey: 'A' }]);
    expect(r.failReason).toBe('NO_ACTIVE_TOPICS');
    expect(r.passed).toBe(false);
    const m = await testPrisma.tenantMembership.findUnique({ where: { userId_tenantId: { userId: mentorId, tenantId: tenant.id } } });
    expect(m!.isCertified).toBe(false); // yazılmadı
  });

  it('red-line ilk seçim 2 → o konu geçmez', async () => {
    const r = await evaluateCertification(mentorId, tenant.id, [{ questionCode: 'Q_T6', optionKey: 'B' }]);
    expect(r.topicResults.find((t) => t.topic === 'topic6')!.passed).toBe(false);
  });

  it('yalnızca İLK-deneme sayılır (aynı konudan ikinci cevap yok sayılır)', async () => {
    const answers = [
      { questionCode: 'Q_T1', optionKey: 'D' }, // ilk seçim 0 → geçmez
      { questionCode: 'Q_T1', optionKey: 'A' }, // sonraki → SAYILMAZ
    ];
    const r = await evaluateCertification(mentorId, tenant.id, answers);
    const t1 = r.topicResults.find((t) => t.topic === 'topic1');
    expect(t1!.firstScore).toBe(0);
    expect(t1!.passed).toBe(false);
  });

  // ── Okuma yardımcıları ───────────────────────────────────────────────────────
  it('getCertificationQuestions doğru cevabı SIZDIRMAZ', async () => {
    const qs = await getCertificationQuestions(tenant.id);
    expect(qs.length).toBe(6);
    const opt = qs[0]!.options[0]! as Record<string, unknown>;
    expect(opt).toHaveProperty('key');
    expect(opt).toHaveProperty('label');
    expect(opt).not.toHaveProperty('explanation');
    expect(opt).not.toHaveProperty('outcome');
    expect(opt).not.toHaveProperty('competencyScore');
  });

  it('revealOption açıklama + firstAttemptPass döner', async () => {
    const r = await revealOption('Q_T1', 'A');
    expect(r.outcome).toBe('correct');
    expect(r.explanation).toBe('Açıklama A');
    expect(r.firstAttemptPass).toBe(true);
    const rWrong = await revealOption('Q_T6', 'B'); // red-line 2
    expect(rWrong.firstAttemptPass).toBe(false);
  });

  // ── STK konu aç/kapat ────────────────────────────────────────────────────────
  it('normal konu kapatılınca havuzdan çıkar ve totalTopics azalır', async () => {
    await setCertificationTopic(tenant.id, 'topic1', false); // 6 → 5 (min 5 ok)
    const list = await listCertificationTopics(tenant.id);
    expect(list.find((t) => t.topic === 'topic1')!.enabled).toBe(false);

    const qs = await getCertificationQuestions(tenant.id);
    expect(qs.some((q) => q.topic === 'topic1')).toBe(false);
    expect(qs.length).toBe(5);

    const r = await evaluateCertification(mentorId, tenant.id, [
      { questionCode: 'Q_T2', optionKey: 'A' },
      { questionCode: 'Q_T3', optionKey: 'A' },
      { questionCode: 'Q_T4', optionKey: 'A' },
      { questionCode: 'Q_T5', optionKey: 'A' },
      { questionCode: 'Q_T6', optionKey: 'A' },
    ]);
    expect(r.totalTopics).toBe(5);
    expect(r.passed).toBe(true);
  });

  it('red-line konu KAPATILAMAZ (RED_LINE_LOCKED)', async () => {
    await expect(setCertificationTopic(tenant.id, 'topic6', false)).rejects.toMatchObject({ code: 'RED_LINE_LOCKED' });
    const list = await listCertificationTopics(tenant.id);
    expect(list.find((t) => t.topic === 'topic6')!.locked).toBe(true);
    expect(list.find((t) => t.topic === 'topic6')!.enabled).toBe(true); // hâlâ açık
  });

  it('toplam açık konu min 5 altına düşürülemez (MIN_TOPICS)', async () => {
    await setCertificationTopic(tenant.id, 'topic1', false); // 6 → 5 (ok)
    await expect(setCertificationTopic(tenant.id, 'topic2', false)) // 5 → 4 → RED
      .rejects.toMatchObject({ code: 'MIN_TOPICS' });
    const list = await listCertificationTopics(tenant.id);
    expect(list.filter((t) => t.enabled).length).toBe(5); // 5'te kaldı
  });

  it('bilinmeyen konu reddedilir (UNKNOWN_TOPIC)', async () => {
    await expect(setCertificationTopic(tenant.id, 'olmayan-konu', false))
      .rejects.toMatchObject({ code: 'UNKNOWN_TOPIC' });
    expect(CertTopicError).toBeDefined();
  });

  it('konu kapatma tenant izolasyonludur', async () => {
    const tenantB = await createTenant();
    await setCertificationTopic(tenant.id, 'topic1', false);
    const listB = await listCertificationTopics(tenantB.id);
    expect(listB.find((t) => t.topic === 'topic1')!.enabled).toBe(true); // B etkilenmedi
  });

  // ── HTTP güvenlik ────────────────────────────────────────────────────────────
  it('GET /certification/questions token olmadan 401', async () => {
    await http.get('/api/scoring/certification/questions').set({ 'X-Tenant-Id': tenant.id }).expect(401);
  });

  it('GET /certification/topics ADMIN gerektirir (MENTOR → 403)', async () => {
    await http.get('/api/scoring/certification/topics').set(tenantHeaders(tenant.id, token)).expect(403);
  });

  it('ADMIN /certification/topics özet döner ve PATCH ile aç/kapat yapar', async () => {
    const admin = await createAdminUser(tenant.id);
    const adminTokens = await loginAs(http, admin.email, admin.rawPassword);
    const adminToken = adminTokens.accessToken;

    const listRes = await http
      .get('/api/scoring/certification/topics')
      .set(tenantHeaders(tenant.id, adminToken))
      .expect(200);
    expect(listRes.body.topics.length).toBe(6);
    expect(listRes.body.activeCount).toBe(6);
    expect(listRes.body.requiredToPass).toBe(5);   // ceil(6×0.8)
    expect(listRes.body.minActiveTopics).toBe(5);

    // Normal konuyu kapat → 200, activeCount düşer
    const patchRes = await http
      .patch('/api/scoring/certification/topics')
      .set(tenantHeaders(tenant.id, adminToken))
      .send({ topic: 'topic1', enabled: false })
      .expect(200);
    expect(patchRes.body.activeCount).toBe(5);
    expect(patchRes.body.topics.find((t: { topic: string; enabled: boolean }) => t.topic === 'topic1').enabled).toBe(false);
  });

  it('PATCH red-line konu kapatma → 409 (backend reddeder)', async () => {
    const admin = await createAdminUser(tenant.id);
    const adminTokens = await loginAs(http, admin.email, admin.rawPassword);
    await http
      .patch('/api/scoring/certification/topics')
      .set(tenantHeaders(tenant.id, adminTokens.accessToken))
      .send({ topic: 'topic6', enabled: false })
      .expect(409);
  });

  it('POST /certify IDOR-güvenli (userId body\'den değil req.auth\'tan)', async () => {
    const res = await http
      .post('/api/scoring/certify')
      .set(tenantHeaders(tenant.id, token))
      .send({
        userId: 'baskasinin-idsi',
        answers: ['Q_T1', 'Q_T2', 'Q_T3', 'Q_T4', 'Q_T5', 'Q_T6'].map((c) => ({ questionCode: c, optionKey: 'A' })),
      })
      .expect(200);
    expect(res.body.passed).toBe(true);
    const m = await testPrisma.tenantMembership.findUnique({ where: { userId_tenantId: { userId: mentorId, tenantId: tenant.id } } });
    expect(m!.isCertified).toBe(true);
  });
});
