/**
 * ensureUserProfile servisi testleri.
 *
 * Kapsam (Aşama 1 — UserProfile yaşam döngüsü):
 *  - İlk çağrıda kullanıcı için tek bir UserProfile satırı oluşur (varsayılan alanlarla).
 *  - İkinci çağrı idempotenttir: yeni satır oluşmaz, aynı kayıt döner.
 *  - Mevcut alanlar (skillTags vb.) korunur — ensure çağrısı veriyi sıfırlamaz.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { cleanDb, testPrisma } from './helpers/db.js';
import { createTenant, createUser } from './helpers/factories.js';
import { ensureUserProfile } from '../src/services/userProfile.service.js';

describe('ensureUserProfile', () => {
  let userId: string;

  beforeEach(async () => {
    await cleanDb();
    const tenant = await createTenant();
    const user = await createUser({ tenantId: tenant.id, role: 'MENTI' });
    userId = user.id;
  });

  it('ilk çağrıda tek bir UserProfile satırı oluşturur (varsayılan alanlar)', async () => {
    const profile = await ensureUserProfile(userId);

    expect(profile.userId).toBe(userId);
    expect(profile.skillTags).toEqual([]);
    expect(profile.goalTags).toEqual([]);
    expect(profile.schools).toEqual([]);
    expect(profile.companies).toEqual([]);
    expect(profile.communities).toEqual([]);
    expect(profile.industryCode).toBeNull();
    expect(profile.yearsExp).toBeNull();
    expect(profile.discD).toBe(0);

    const count = await testPrisma.userProfile.count({ where: { userId } });
    expect(count).toBe(1);
  });

  it('idempotenttir: ikinci çağrı yeni satır oluşturmaz, aynı kaydı döner', async () => {
    const first  = await ensureUserProfile(userId);
    const second = await ensureUserProfile(userId);

    expect(second.id).toBe(first.id);

    const count = await testPrisma.userProfile.count({ where: { userId } });
    expect(count).toBe(1);
  });

  it('mevcut alanları sıfırlamaz — ensure yalnızca varlığı garanti eder', async () => {
    await ensureUserProfile(userId);
    await testPrisma.userProfile.update({
      where: { userId },
      data:  { skillTags: ['react'], industryCode: 'TEK.YZ', yearsExp: 5 },
    });

    const again = await ensureUserProfile(userId);

    expect(again.skillTags).toEqual(['react']);
    expect(again.industryCode).toBe('TEK.YZ');
    expect(again.yearsExp).toBe(5);
  });
});
