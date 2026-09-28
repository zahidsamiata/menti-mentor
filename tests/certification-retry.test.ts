/**
 * Sertifika deneme döngüsü (sınav seviyesi) + ağırlıklı tekrar.
 *
 * - Türkiye takvim gününde en fazla 2 deneme (madde 158 · I-08); günün 2. denemesi de
 *   kalınırsa mola ertesi gün 00:00'a kadar (eski "2 başarısızda 24 saat" kuralının yerine).
 * - Bekleme sırasında yeni deneme COOLDOWN_ACTIVE ile reddedilir (sayaç artmaz).
 * - Başarısız denemede geçilemeyen konular certWrongTopics'e yazılır.
 * - getCertificationQuestions(priorityTopics) yanlış konuları başa alır (ağırlık).
 * - Geçince cooldown + wrongTopics temizlenir.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { agent, loginAs, tenantHeaders } from './helpers/request.js';
import { cleanDb, testPrisma } from './helpers/db.js';
import { createTenant, createMentor } from './helpers/factories.js';
import {
  evaluateCertification,
  getCertificationQuestions,
  CERT_CONFIG,
} from '../src/services/certification.service.js';
import type { Tenant } from '@prisma/client';

const DAY_MS = 24 * 60 * 60 * 1000;
const SCORE_BY_KEY: Record<string, number> = { A: 3, B: 2, C: 1, D: 0 };

async function createCertQuestion(code: string, topic: string, variant = 'A') {
  const q = await testPrisma.certificationQuestion.create({
    data: { code, dimension: topic, topic, variant, scenario: `Senaryo ${code}`, isRedLine: false, isActive: true },
  });
  for (const key of ['A', 'B', 'C', 'D']) {
    await testPrisma.certificationOption.create({
      data: {
        questionId: q.id, key, label: `Seçenek ${key}`, competencyScore: SCORE_BY_KEY[key]!,
        explanation: `Açıklama ${key}`, outcome: 'wrong',
      },
    });
  }
}

// 5 normal konu → required = ceil(5×0.8) = 4.
async function seedPool() {
  await testPrisma.certificationOption.deleteMany({});
  await testPrisma.certificationQuestion.deleteMany({});
  for (let i = 1; i <= 5; i++) await createCertQuestion(`Q_T${i}`, `topic${i}`);
}

const failAll = [1, 2, 3, 4, 5].map((i) => ({ questionCode: `Q_T${i}`, optionKey: 'D' })); // hepsi 0
const passAll = [1, 2, 3, 4, 5].map((i) => ({ questionCode: `Q_T${i}`, optionKey: 'A' })); // hepsi 3

describe('Sertifika deneme döngüsü', () => {
  let tenant: Tenant;
  let mentorId: string;

  async function membership() {
    return testPrisma.tenantMembership.findUnique({ where: { userId_tenantId: { userId: mentorId, tenantId: tenant.id } } });
  }

  beforeEach(async () => {
    await cleanDb();
    await seedPool();
    tenant = await createTenant();
    const mentor = await createMentor(tenant.id);
    mentorId = mentor.id;
  });

  it('1. başarısız deneme: attempts=1, cooldown yok, wrongTopics dolu', async () => {
    const r = await evaluateCertification(mentorId, tenant.id, failAll);
    expect(r.passed).toBe(false);
    expect(r.attempts).toBe(1);
    expect(r.cooldownUntil).toBeNull();

    const m = await membership();
    expect(m!.certWrongTopics.sort()).toEqual(['topic1', 'topic2', 'topic3', 'topic4', 'topic5']);
    expect(m!.cooldownUntil).toBeNull();
  });

  it('2. başarısız denemede cooldown başlar; 3. deneme COOLDOWN_ACTIVE ile reddedilir', async () => {
    await evaluateCertification(mentorId, tenant.id, failAll); // 1
    const r2 = await evaluateCertification(mentorId, tenant.id, failAll); // 2
    expect(r2.attempts).toBe(2);
    expect(r2.cooldownUntil).not.toBeNull();
    expect(r2.cooldownUntil!.getTime()).toBeGreaterThan(Date.now());

    // Bekleme sırasında 3. deneme → değerlendirilmez, sayaç artmaz.
    const r3 = await evaluateCertification(mentorId, tenant.id, passAll);
    expect(r3.failReason).toBe('COOLDOWN_ACTIVE');
    expect(r3.passed).toBe(false);
    const m = await membership();
    expect(m!.certAttempts).toBe(2); // artmadı
    expect(m!.isCertified).toBe(false);
  });

  it('cooldown dolunca yeni deneme geçerse sertifika + temizlik', async () => {
    await evaluateCertification(mentorId, tenant.id, failAll);
    await evaluateCertification(mentorId, tenant.id, failAll); // cooldown set
    // Beklemeyi geçmişe çek (süre doldu senaryosu): mola bitti + son deneme dün.
    await testPrisma.tenantMembership.update({
      where: { userId_tenantId: { userId: mentorId, tenantId: tenant.id } },
      data:  { cooldownUntil: new Date(Date.now() - 1000), certLastAttemptAt: new Date(Date.now() - DAY_MS) },
    });

    const r = await evaluateCertification(mentorId, tenant.id, passAll);
    expect(r.passed).toBe(true);
    expect(r.cooldownUntil).toBeNull();
    const m = await membership();
    expect(m!.isCertified).toBe(true);
    expect(m!.cooldownUntil).toBeNull();
    expect(m!.certWrongTopics).toEqual([]); // temizlendi
  });

  it('config: günlük hak ve gün saat dilimi tek kaynakta', () => {
    expect(CERT_CONFIG.attemptsBeforeCooldown).toBe(2);
    expect(CERT_CONFIG.attemptDayTimeZone).toBe('Europe/Istanbul');
  });

  it('ağırlıklı tekrar: yanlış konular getCertificationQuestions listesinin başında', async () => {
    await evaluateCertification(mentorId, tenant.id, [
      { questionCode: 'Q_T1', optionKey: 'A' }, // topic1 geçer
      { questionCode: 'Q_T2', optionKey: 'A' }, // topic2 geçer
      { questionCode: 'Q_T3', optionKey: 'D' }, // topic3 KALDI
      { questionCode: 'Q_T4', optionKey: 'D' }, // topic4 KALDI
      { questionCode: 'Q_T5', optionKey: 'A' }, // topic5 geçer
    ]);
    const m = await membership();
    const wrong = m!.certWrongTopics.sort();
    expect(wrong).toEqual(['topic3', 'topic4']);

    const weighted = await getCertificationQuestions(tenant.id, m!.certWrongTopics);
    // İlk iki soru yanlış konulara ait olmalı (başa alındı).
    expect(weighted.slice(0, 2).every((q) => wrong.includes(q.topic!))).toBe(true);
  });
});

// madde 157 (I-07): yanlış yapılan konu bir sonraki sınavda başta ve DİĞER varyantıyla gelir.
// Uçtan uca: evaluate → certWrongTopics/certAttempts → GET /certification/questions.
const failAll5A = [1, 2, 3, 4, 5].map((i) => ({ questionCode: `Q_T${i}_A`, optionKey: 'D' }));

describe('Tekrar sınavda yanlış konu farklı sahneyle gelir (HTTP)', () => {
  let tenant: Tenant;
  let token: string;
  let mentorId: string;

  beforeEach(async () => {
    await cleanDb();
    await testPrisma.certificationOption.deleteMany({});
    await testPrisma.certificationQuestion.deleteMany({});
    for (let i = 1; i <= 5; i++) {
      await createCertQuestion(`Q_T${i}_A`, `topic${i}`, 'A');
      await createCertQuestion(`Q_T${i}_B`, `topic${i}`, 'B');
    }
    tenant = await createTenant();
    const mentor = await createMentor(tenant.id);
    mentorId = mentor.id;
    token = (await loginAs(agent(), mentor.email, mentor.rawPassword)).accessToken;
  });

  async function fetchExam() {
    const res = await agent()
      .get('/api/scoring/certification/questions')
      .set(tenantHeaders(tenant.id, token))
      .expect(200);
    return res.body as {
      questions: { code: string; topic: string }[];
      retryTopics: string[];
      cooldownUntil: string | null;
    };
  }

  async function setCooldown(userId: string, until: Date | null) {
    await testPrisma.tenantMembership.update({
      where: { userId_tenantId: { userId, tenantId: tenant.id } },
      data:  { cooldownUntil: until },
    });
  }

  it('ilk kez giren: sıra değişmez, her konu A ile başlar, retryTopics boş', async () => {
    const exam = await fetchExam();
    expect(exam.retryTopics).toEqual([]);
    expect(exam.cooldownUntil).toBeNull();
    expect(exam.questions.map((q) => q.code)).toEqual(
      [1, 2, 3, 4, 5].flatMap((i) => [`Q_T${i}_A`, `Q_T${i}_B`]),
    );
  });

  it('başarısız denemeden sonra yanlış konu başta ve B sahnesiyle; retryTopics dolu', async () => {
    await evaluateCertification(mentorId, tenant.id, [
      { questionCode: 'Q_T1_A', optionKey: 'A' },
      { questionCode: 'Q_T2_A', optionKey: 'A' },
      { questionCode: 'Q_T3_A', optionKey: 'A' },
      { questionCode: 'Q_T4_A', optionKey: 'D' }, // topic4 KALDI
      { questionCode: 'Q_T5_A', optionKey: 'D' }, // topic5 KALDI
    ]);
    const exam = await fetchExam();
    expect([...exam.retryTopics].sort()).toEqual(['topic4', 'topic5']);
    // Yanlış iki konu başta; ilk gösterilen (puanlanan) varyant B — geçen seferki A değil.
    expect(exam.questions.slice(0, 4).map((q) => q.code)).toEqual(['Q_T4_B', 'Q_T4_A', 'Q_T5_B', 'Q_T5_A']);
    // Tüm konular hâlâ sınavda (puanlama paydası değişmedi).
    expect(new Set(exam.questions.map((q) => q.topic)).size).toBe(5);
  });

  // AJ-60: sayfa yeniden açılınca mola kalan süresi görünsün — soru ucu KENDİ molasını döndürür.
  it('mola sürüyorsa cooldownUntil bitiş anını döndürür (skor/deneme sayısı sızdırmaz)', async () => {
    await evaluateCertification(mentorId, tenant.id, failAll5A);
    await evaluateCertification(mentorId, tenant.id, failAll5A); // 2. başarısız → mola başlar
    const m = await testPrisma.tenantMembership.findUnique({
      where: { userId_tenantId: { userId: mentorId, tenantId: tenant.id } },
    });
    expect(m!.cooldownUntil).not.toBeNull();

    const exam = await fetchExam();
    expect(exam.cooldownUntil).toBe(m!.cooldownUntil!.toISOString());
    expect(Date.parse(exam.cooldownUntil!)).toBeGreaterThan(Date.now());
    // Yanıt yalnız bu üç alanı taşır — certAttempts / certScore yok.
    expect(Object.keys(exam).sort()).toEqual(['cooldownUntil', 'questions', 'retryTopics']);
  });

  it('süresi geçmiş mola null döner', async () => {
    await setCooldown(mentorId, new Date(Date.now() - 60_000));
    const exam = await fetchExam();
    expect(exam.cooldownUntil).toBeNull();
  });

  it('başka mentörün molası çağırana sızmaz (yalnız kendi kaydı)', async () => {
    const other = await createMentor(tenant.id);
    await setCooldown(other.id, new Date(Date.now() + 3_600_000));
    const exam = await fetchExam();
    expect(exam.cooldownUntil).toBeNull();

    const otherToken = (await loginAs(agent(), other.email, other.rawPassword)).accessToken;
    const res = await agent()
      .get('/api/scoring/certification/questions')
      .set(tenantHeaders(tenant.id, otherToken))
      .expect(200);
    expect(res.body.cooldownUntil).not.toBeNull();
  });
});

// ── I-08 (madde 158): Türkiye takvim gününde en fazla 2 deneme ─────────────────
// Günlük sayaç TenantMembership.certDayAttempts + certLastAttemptAt; gün = Europe/Istanbul.
describe('I-08 · günde en fazla 2 deneme (HTTP + servis)', () => {
  let tenant: Tenant;
  let mentorId: string;
  let token: string;

  const where = () => ({ userId_tenantId: { userId: mentorId, tenantId: tenant.id } });
  const membership = () => testPrisma.tenantMembership.findUnique({ where: where() });
  const certify = (answers: typeof failAll) =>
    agent().post('/api/scoring/certify').set(tenantHeaders(tenant.id, token)).send({ answers });

  /** İstanbul'da ertesi günün 00:00'ı (UTC+3, yaz saati yok). */
  function nextIstanbulMidnight(from: Date): string {
    const ist = new Date(from.getTime() + 3 * 60 * 60 * 1000);
    return new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate() + 1) - 3 * 60 * 60 * 1000)
      .toISOString();
  }

  beforeEach(async () => {
    await cleanDb();
    await seedPool();
    tenant = await createTenant();
    const mentor = await createMentor(tenant.id);
    mentorId = mentor.id;
    token = (await loginAs(agent(), mentor.email, mentor.rawPassword)).accessToken;
  });

  it('aynı gün 3. deneme 409 COOLDOWN_ACTIVE; mola ertesi gün 00:00 İstanbul; sayaç artmaz', async () => {
    const first = await certify(failAll).expect(200);
    expect(first.body.cooldownUntil).toBeNull();
    const second = await certify(failAll).expect(200);
    const expectedEnd = nextIstanbulMidnight(new Date());
    expect(second.body.cooldownUntil).toBe(expectedEnd);

    const third = await certify(passAll).expect(409);
    expect(third.body.error).toBe('COOLDOWN_ACTIVE');
    expect(third.body.message).toMatch(/günde en fazla 2 deneme/);
    expect(third.body.cooldownUntil).toBe(expectedEnd);

    const m = await membership();
    expect(m!.certAttempts).toBe(2);
    expect(m!.certDayAttempts).toBe(2);
    expect(m!.isCertified).toBe(false);
  });

  it('geçen deneme de günlük hakka sayılır: başarısız + geçti → aynı gün 3. deneme reddedilir', async () => {
    await certify(failAll).expect(200);
    const passed = await certify(passAll).expect(200);
    expect(passed.body.passed).toBe(true);
    expect(passed.body.cooldownUntil).toBeNull(); // geçene mola yazılmaz

    const third = await certify(failAll).expect(409);
    expect(third.body.error).toBe('COOLDOWN_ACTIVE');
    const m = await membership();
    expect(m!.certAttempts).toBe(2);
    expect(m!.isCertified).toBe(true); // 3. deneme sertifikayı düşüremedi
    // Soru ucu da kilidi gösterir (sayfa yeniden açılınca AJ-60 metni).
    const exam = await agent().get('/api/scoring/certification/questions')
      .set(tenantHeaders(tenant.id, token)).expect(200);
    expect(exam.body.cooldownUntil).toBe(nextIstanbulMidnight(new Date()));
  });

  it('son deneme dünse sayaç sıfırlanır: bugün 1. deneme mola başlatmaz (eski 24s kuralı başlatırdı)', async () => {
    await certify(failAll).expect(200);
    // Dünkü tek deneme — eski kuralda bugünkü deneme "2. başarısız" sayılıp 24 saat mola verirdi.
    await testPrisma.tenantMembership.update({
      where: where(), data: { certLastAttemptAt: new Date(Date.now() - DAY_MS - 60_000) },
    });
    const today = await certify(failAll).expect(200);
    expect(today.body.attempts).toBe(2);
    expect(today.body.cooldownUntil).toBeNull();
    const m = await membership();
    expect(m!.certDayAttempts).toBe(1);
  });

  it('I-08 öncesi yazılmış 24 saatlik mola (günlük alanlar boş) aynen geçerli', async () => {
    const legacyEnd = new Date(Date.now() + 20 * 60 * 60 * 1000);
    await testPrisma.tenantMembership.update({
      where: where(), data: { certAttempts: 2, cooldownUntil: legacyEnd, certDayAttempts: null, certLastAttemptAt: null },
    });
    const res = await certify(passAll).expect(409);
    expect(res.body.cooldownUntil).toBe(legacyEnd.toISOString());
  });

  it('eşzamanlı iki gönderim günün son hakkını aşamaz (biri değerlendirilir, biri reddedilir)', async () => {
    await evaluateCertification(mentorId, tenant.id, failAll); // bugün 1
    const results = await Promise.all([
      evaluateCertification(mentorId, tenant.id, failAll),
      evaluateCertification(mentorId, tenant.id, failAll),
    ]);
    const reasons = results.map((r) => r.failReason).sort();
    expect(reasons).toEqual(['BELOW_THRESHOLD', 'COOLDOWN_ACTIVE']);
    const m = await membership();
    expect(m!.certAttempts).toBe(2);
    expect(m!.certDayAttempts).toBe(2);
  });
});
