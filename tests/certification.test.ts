/**
 * Sertifika motoru testleri (Paket C) — "ilk-deneme oranı + red-line" modeli.
 *
 * Kapsam:
 *  - Normal konu: ilk seçim 3 veya 2 → geçer. Red-line konu: sadece 3 → geçer.
 *  - Sertifika eşiği: konuların en az %80'i ilk-denemede geçmeli.
 *  - Cooldown/ceza YOK.
 *  - Yalnızca İLK-deneme sayılır (aynı konudan ikinci cevap yok sayılır).
 *  - GET questions doğru cevabı SIZDIRMAZ (explanation/outcome/score dönmez).
 *  - reveal açıklama + firstAttemptPass döner.
 *  - certify IDOR-güvenli (userId body'den değil, req.auth'tan).
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
} from '../src/services/certification.service.js';
import type { Tenant } from '@prisma/client';

// Kontrollü senaryo seti: 4 normal + 1 red-line = 5 konu. Her soru A(3) B(2) C(1) D(0).
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

/** Kontrollü havuz: t1..t4 normal, t5 red-line. */
async function seedControlledPool() {
  await testPrisma.certificationOption.deleteMany({});
  await testPrisma.certificationQuestion.deleteMany({});
  await createCertQuestion('Q_T1', 'topic1', false);
  await createCertQuestion('Q_T2', 'topic2', false);
  await createCertQuestion('Q_T3', 'topic3', false);
  await createCertQuestion('Q_T4', 'topic4', false);
  await createCertQuestion('Q_T5', 'topic5', true); // red-line
}

describe('Sertifika motoru', () => {
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
    expect(isFirstAttemptPass(2, true)).toBe(false); // red-line: 2 yetmez
  });

  // ── evaluateCertification ────────────────────────────────────────────────────
  it('tüm konularda ilk seçim doğru → %100 → CERTIFIED', async () => {
    const answers = [
      { questionCode: 'Q_T1', optionKey: 'A' },
      { questionCode: 'Q_T2', optionKey: 'A' },
      { questionCode: 'Q_T3', optionKey: 'A' },
      { questionCode: 'Q_T4', optionKey: 'A' },
      { questionCode: 'Q_T5', optionKey: 'A' }, // red-line 3
    ];
    const r = await evaluateCertification(mentorId, tenant.id, answers);
    expect(r.totalTopics).toBe(5);
    expect(r.passedTopics).toBe(5);
    expect(r.passed).toBe(true);
    expect(r.status).toBe('CERTIFIED');
    expect(r.certScore).toBe(100);

    const m = await testPrisma.tenantMembership.findUnique({ where: { userId_tenantId: { userId: mentorId, tenantId: tenant.id } } });
    expect(m!.isCertified).toBe(true);
  });

  it('4/5 konu geçer (%80 sınırı) → CERTIFIED', async () => {
    const answers = [
      { questionCode: 'Q_T1', optionKey: 'A' }, // 3 geçer
      { questionCode: 'Q_T2', optionKey: 'B' }, // 2 geçer (normal)
      { questionCode: 'Q_T3', optionKey: 'A' }, // geçer
      { questionCode: 'Q_T4', optionKey: 'A' }, // geçer
      { questionCode: 'Q_T5', optionKey: 'B' }, // red-line 2 → GEÇMEZ
    ];
    const r = await evaluateCertification(mentorId, tenant.id, answers);
    expect(r.passedTopics).toBe(4);
    expect(r.passRate).toBeCloseTo(0.8, 5);
    expect(r.passed).toBe(true);
    expect(r.status).toBe('CERTIFIED');
  });

  it('3/5 konu geçer (%60) → sertifika YOK, cooldown YOK', async () => {
    const answers = [
      { questionCode: 'Q_T1', optionKey: 'A' },
      { questionCode: 'Q_T2', optionKey: 'A' },
      { questionCode: 'Q_T3', optionKey: 'A' },
      { questionCode: 'Q_T4', optionKey: 'D' }, // 0 geçmez
      { questionCode: 'Q_T5', optionKey: 'C' }, // red-line geçmez
    ];
    const r = await evaluateCertification(mentorId, tenant.id, answers);
    expect(r.passedTopics).toBe(3);
    expect(r.passed).toBe(false);
    expect(r.status).toBe('FAILED');
    expect(r.failReason).toBe('BELOW_THRESHOLD');

    const m = await testPrisma.tenantMembership.findUnique({ where: { userId_tenantId: { userId: mentorId, tenantId: tenant.id } } });
    expect(m!.isCertified).toBe(false);
    expect(m!.cooldownUntil).toBeNull(); // ceza/cooldown yok
  });

  it('red-line konuda ilk seçim 2 → o konu geçmez', async () => {
    const answers = [{ questionCode: 'Q_T5', optionKey: 'B' }]; // red-line, score 2
    const r = await evaluateCertification(mentorId, tenant.id, answers);
    const t5 = r.topicResults.find((t) => t.topic === 'topic5');
    expect(t5!.passed).toBe(false);
  });

  it('yalnızca İLK-deneme sayılır (aynı konudan ikinci cevap yok sayılır)', async () => {
    const answers = [
      { questionCode: 'Q_T1', optionKey: 'D' }, // ilk seçim 0 → geçmez
      { questionCode: 'Q_T1', optionKey: 'A' }, // sonraki (öğrenme) → SAYILMAZ
    ];
    const r = await evaluateCertification(mentorId, tenant.id, answers);
    const t1 = r.topicResults.find((t) => t.topic === 'topic1');
    expect(t1!.firstScore).toBe(0);
    expect(t1!.passed).toBe(false);
  });

  // ── Okuma yardımcıları ───────────────────────────────────────────────────────
  it('getCertificationQuestions doğru cevabı SIZDIRMAZ', async () => {
    const qs = await getCertificationQuestions(tenant.id);
    expect(qs.length).toBe(5);
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
    const rWrong = await revealOption('Q_T5', 'B'); // red-line 2
    expect(rWrong.firstAttemptPass).toBe(false);
  });

  // ── HTTP güvenlik ────────────────────────────────────────────────────────────
  it('GET /certification/questions MENTOR token ile 200, cevap sızdırmaz', async () => {
    const res = await http
      .get('/api/scoring/certification/questions')
      .set(tenantHeaders(tenant.id, token))
      .expect(200);
    expect(res.body.questions.length).toBe(5);
    expect(JSON.stringify(res.body)).not.toContain('Açıklama');
  });

  it('GET /certification/questions token olmadan 401', async () => {
    await http.get('/api/scoring/certification/questions').set({ 'X-Tenant-Id': tenant.id }).expect(401);
  });

  it('POST /certify userId body\'den DEĞİL req.auth\'tan alınır (IDOR-güvenli)', async () => {
    // Body'ye başka bir userId koysak bile kendi sertifikamız değerlendirilir.
    const res = await http
      .post('/api/scoring/certify')
      .set(tenantHeaders(tenant.id, token))
      .send({
        userId: 'baskasinin-idsi',
        answers: [
          { questionCode: 'Q_T1', optionKey: 'A' },
          { questionCode: 'Q_T2', optionKey: 'A' },
          { questionCode: 'Q_T3', optionKey: 'A' },
          { questionCode: 'Q_T4', optionKey: 'A' },
          { questionCode: 'Q_T5', optionKey: 'A' },
        ],
      })
      .expect(200);
    expect(res.body.passed).toBe(true);

    // Sadece giriş yapan mentörün üyeliği sertifikalı olmalı.
    const m = await testPrisma.tenantMembership.findUnique({ where: { userId_tenantId: { userId: mentorId, tenantId: tenant.id } } });
    expect(m!.isCertified).toBe(true);
  });

  // ── Paket E: STK konu aç/kapat ───────────────────────────────────────────────
  it('kapatılan konu havuzdan çıkar ve totalTopics azalır', async () => {
    await setCertificationTopic(tenant.id, 'topic1', false);

    const list = await listCertificationTopics(tenant.id);
    expect(list.find((t) => t.topic === 'topic1')!.enabled).toBe(false);
    expect(list.find((t) => t.topic === 'topic2')!.enabled).toBe(true);

    const qs = await getCertificationQuestions(tenant.id);
    expect(qs.some((q) => q.topic === 'topic1')).toBe(false); // kapalı konu gösterilmez
    expect(qs.length).toBe(4);

    // Kalan 4 konuyu ilk-denemede geç → totalTopics 4 üzerinden %100
    const r = await evaluateCertification(mentorId, tenant.id, [
      { questionCode: 'Q_T2', optionKey: 'A' },
      { questionCode: 'Q_T3', optionKey: 'A' },
      { questionCode: 'Q_T4', optionKey: 'A' },
      { questionCode: 'Q_T5', optionKey: 'A' },
    ]);
    expect(r.totalTopics).toBe(4);
    expect(r.passed).toBe(true);
  });

  it('konu kapatma tenant izolasyonludur (başka tenant etkilenmez)', async () => {
    const tenantB = await createTenant();
    await setCertificationTopic(tenant.id, 'topic1', false);

    const listA = await listCertificationTopics(tenant.id);
    const listB = await listCertificationTopics(tenantB.id);
    expect(listA.find((t) => t.topic === 'topic1')!.enabled).toBe(false);
    expect(listB.find((t) => t.topic === 'topic1')!.enabled).toBe(true); // B etkilenmedi
  });

  it('setCertificationTopic bilinmeyen konuyu reddeder', async () => {
    await expect(setCertificationTopic(tenant.id, 'olmayan-konu', false)).rejects.toThrow();
  });

  it('GET /certification/topics ADMIN gerektirir (MENTOR → 403)', async () => {
    await http
      .get('/api/scoring/certification/topics')
      .set(tenantHeaders(tenant.id, token)) // mentor token
      .expect(403);
  });

  it('ADMIN /certification/topics listeler ve PATCH ile aç/kapat yapar', async () => {
    const admin = await createAdminUser(tenant.id);
    const adminTokens = await loginAs(http, admin.email, admin.rawPassword);
    const adminToken = adminTokens.accessToken;

    const listRes = await http
      .get('/api/scoring/certification/topics')
      .set(tenantHeaders(tenant.id, adminToken))
      .expect(200);
    expect(listRes.body.topics.length).toBe(5);

    const patchRes = await http
      .patch('/api/scoring/certification/topics')
      .set(tenantHeaders(tenant.id, adminToken))
      .send({ topic: 'topic5', enabled: false })
      .expect(200);
    const t5 = patchRes.body.topics.find((t: { topic: string; enabled: boolean }) => t.topic === 'topic5');
    expect(t5.enabled).toBe(false);
  });
});
