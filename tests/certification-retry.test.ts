/**
 * Sertifika deneme döngüsü (sınav seviyesi) + ağırlıklı tekrar.
 *
 * - 2 başarısız denemeden sonra 24s bekleme (cooldown).
 * - Bekleme sırasında yeni deneme COOLDOWN_ACTIVE ile reddedilir (sayaç artmaz).
 * - Başarısız denemede geçilemeyen konular certWrongTopics'e yazılır.
 * - getCertificationQuestions(priorityTopics) yanlış konuları başa alır (ağırlık).
 * - Geçince cooldown + wrongTopics temizlenir.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { cleanDb, testPrisma } from './helpers/db.js';
import { createTenant, createMentor } from './helpers/factories.js';
import {
  evaluateCertification,
  getCertificationQuestions,
  CERT_CONFIG,
} from '../src/services/certification.service.js';
import type { Tenant } from '@prisma/client';

const SCORE_BY_KEY: Record<string, number> = { A: 3, B: 2, C: 1, D: 0 };

async function createCertQuestion(code: string, topic: string) {
  const q = await testPrisma.certificationQuestion.create({
    data: { code, dimension: topic, topic, variant: 'A', scenario: `Senaryo ${code}`, isRedLine: false, isActive: true },
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
    // Beklemeyi geçmişe çek (süre doldu senaryosu)
    await testPrisma.tenantMembership.update({
      where: { userId_tenantId: { userId: mentorId, tenantId: tenant.id } },
      data:  { cooldownUntil: new Date(Date.now() - 1000) },
    });

    const r = await evaluateCertification(mentorId, tenant.id, passAll);
    expect(r.passed).toBe(true);
    expect(r.cooldownUntil).toBeNull();
    const m = await membership();
    expect(m!.isCertified).toBe(true);
    expect(m!.cooldownUntil).toBeNull();
    expect(m!.certWrongTopics).toEqual([]); // temizlendi
  });

  it('config: attemptsBeforeCooldown ve cooldownHours tek kaynakta', () => {
    expect(CERT_CONFIG.attemptsBeforeCooldown).toBe(2);
    expect(CERT_CONFIG.cooldownHours).toBe(24);
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
