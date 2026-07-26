/**
 * Aşama 1 — DISC testi tamamlanınca UserProfile.discD/I/S/C yazımı.
 *
 * recalcDiscVector() User.discVector'u güncellerken UserProfile'ın normalize DISC
 * bileşenlerini de (upsert ile) yazar. Cevap yoksa her boyut 0.25 prior'a düşer.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { cleanDb, testPrisma } from './helpers/db.js';
import { createTenant, createUser, createUserProfile } from './helpers/factories.js';
import { recalcDiscVector } from '../src/services/discVectorService.js';

describe('recalcDiscVector → UserProfile.disc*', () => {
  let userId: string;

  beforeEach(async () => {
    await cleanDb();
    const tenant = await createTenant();
    const user = await createUser({ tenantId: tenant.id, role: 'MENTI' });
    userId = user.id;
  });

  it('UserProfile yoksa oluşturur ve DISC bileşenlerini yazar', async () => {
    const vector = await recalcDiscVector(userId);

    const profile = await testPrisma.userProfile.findUnique({ where: { userId } });
    expect(profile).not.toBeNull();
    expect(profile!.discD).toBeCloseTo(vector.D, 3);
    expect(profile!.discI).toBeCloseTo(vector.I, 3);
    expect(profile!.discS).toBeCloseTo(vector.S, 3);
    expect(profile!.discC).toBeCloseTo(vector.C, 3);
    // D+I+S+C 1.0'a normalize edilir
    expect(profile!.discD + profile!.discI + profile!.discS + profile!.discC).toBeCloseTo(1, 2);
  });

  it('mevcut UserProfile DISC-dışı alanlarını korur (yalnızca DISC güncellenir)', async () => {
    await createUserProfile(userId, { skillTags: ['react'], industryCode: 'TEK', yearsExp: 4 });

    await recalcDiscVector(userId);

    const profile = await testPrisma.userProfile.findUnique({ where: { userId } });
    expect(profile!.skillTags).toEqual(['react']);
    expect(profile!.industryCode).toBe('TEK');
    expect(profile!.yearsExp).toBe(4);
    expect(profile!.discD).toBeGreaterThan(0); // DISC yazıldı
  });
});
