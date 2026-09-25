/**
 * PS-06 — DISC güven paydası kurum izolasyonu (entegrasyon).
 *
 * confidence = cevaplanmış boyutsal soru / havuzdaki aktif boyutsal soru.
 * Havuz = global sorular + YALNIZ kullanıcının kurumunun soruları.
 * Eskiden payda tüm kurumların sorularını sayıyordu → başka kurumun özel sorusu
 * bu kurumun kullanıcısının güvenini düşürüyordu. Cache de kurum-bazlı olmalı:
 * önce A için hesaplanan sayı B'ye dönmemeli.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { cleanDb, testPrisma } from './helpers/db.js';
import { createTenant, createUser } from './helpers/factories.js';
import {
  recalcDiscVector,
  invalidateDimensionalCountCache,
} from '../src/services/discVectorService.js';

describe('recalcDiscVector — güven paydası kurum izolasyonu (PS-06)', () => {
  let tenantAId: string;
  let tenantBId: string;
  let userAId: string;
  let userBId: string;
  let globalDId: string;

  beforeEach(async () => {
    await cleanDb();
    // Modül-düzeyi cache testler arası taşınmasın
    invalidateDimensionalCountCache();

    const tenantA = await createTenant();
    const tenantB = await createTenant();
    tenantAId = tenantA.id;
    tenantBId = tenantB.id;
    userAId = (await createUser({ tenantId: tenantAId, role: 'MENTI' })).id;
    userBId = (await createUser({ tenantId: tenantBId, role: 'MENTI' })).id;

    // Global havuz: 2 boyutlu soru
    const globalD = await testPrisma.question.create({
      data: { text: 'Global D sorusu metni', discDimension: 'D', category: 'DISC_ASSESSMENT', tenantId: null },
    });
    globalDId = globalD.id;
    await testPrisma.question.create({
      data: { text: 'Global I sorusu metni', discDimension: 'I', category: 'DISC_ASSESSMENT', tenantId: null },
    });

    // A kurumunun özel boyutlu sorusu (kurum admini createQuestion ile ekleyebilir)
    await testPrisma.question.create({
      data: { text: 'A kurumuna özel S sorusu', discDimension: 'S', category: 'STK_CUSTOM', tenantId: tenantAId },
    });

    // Her iki kullanıcı yalnız global D sorusunu cevaplar
    await testPrisma.userResponse.createMany({
      data: [
        { userId: userAId, questionId: globalDId, value: 5 },
        { userId: userBId, questionId: globalDId, value: 5 },
      ],
    });
  });

  it('A kurumunun özel sorusu B kurumunun güven paydasına girmez (1/2, 1/3 değil)', async () => {
    const vector = await recalcDiscVector(userBId, tenantBId);
    expect(vector.confidence).toBe(0.5);
  });

  it('A kurumunun kullanıcısı için kendi özel sorusu paydaya girer (1/3)', async () => {
    const vector = await recalcDiscVector(userAId, tenantAId);
    expect(vector.confidence).toBe(0.333);
  });

  it('cache kurum-bazlıdır: önce A hesaplansa da B kendi sayısını alır', async () => {
    const a = await recalcDiscVector(userAId, tenantAId);
    const b = await recalcDiscVector(userBId, tenantBId);
    expect(a.confidence).toBe(0.333);
    expect(b.confidence).toBe(0.5);

    // Sonra B tekrar (cache hit) — değer değişmez
    const b2 = await recalcDiscVector(userBId, tenantBId);
    expect(b2.confidence).toBe(0.5);
  });
});
