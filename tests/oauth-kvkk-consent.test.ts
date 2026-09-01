/**
 * K2 — OAuth kvkkConsentAt regresyon testi (KVKK Md.5, ispat yükü).
 *
 * Açık: OAuth ile oluşturulan kullanıcıda `kvkkConsentAt` set edilmiyordu (NULL kalıyordu) —
 * local register / self-serve `new Date()` ile set ederken OAuth yolu atlıyordu. KVKK Md.5
 * rıza anının kanıtlanmasını gerektirir. Bu test, OAuth yeni-kullanıcı yolunda rıza anının
 * yazıldığını doğrular ve açığın geri gelmesini önler (regression guard).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { handleOAuthCallback } from '../src/services/oauth/oauthService.js';
import { cleanDb, testPrisma } from './helpers/db.js';
import { createTenant } from './helpers/factories.js';
import type { Tenant } from '@prisma/client';

describe('OAuth — yeni kullanıcıda kvkkConsentAt set edilir (K2)', () => {
  let tenant: Tenant;

  beforeEach(async () => {
    await cleanDb();
    tenant = await createTenant();
  });

  it('OAuth ile oluşturulan yeni kullanıcının kvkkConsentAt değeri NULL değildir', async () => {
    const email = `oauth-yeni-${Date.now()}@test.local`;

    const result = await handleOAuthCallback(
      { providerUserId: 'g-123', email, fullName: 'OAuth Test', provider: 'GOOGLE' },
      { tenantSlug: tenant.slug, role: 'MENTI', nonce: 'test-nonce' },
    );
    expect(result.isNewUser).toBe(true);

    const user = await testPrisma.user.findUnique({
      where: { email },
      select: { kvkkConsentAt: true, authProvider: true },
    });
    expect(user).not.toBeNull();
    expect(user?.authProvider).toBe('GOOGLE');
    // Asıl güvence: rıza anı yazıldı (local register deseniyle aynı).
    expect(user?.kvkkConsentAt).not.toBeNull();
    expect(user?.kvkkConsentAt).toBeInstanceOf(Date);
  });

  // REGRESYON (PO 2026-09-01, Seçenek A): LOCAL register'a eklenen "davet=APPROVED" iyileştirmesi
  // OAuth'u ETKİLEMEZ — OAuth zinciri davet token'ı taşımıyor (4 katman), `oauthService` kapsam dışı.
  // OAuth yeni kullanıcı hâlâ PENDING yazılır. Gelecek "OAuth davet token'ı taşıma" turunda beklenti
  // burada nettir (o tur bu testi APPROVED-for-invite'a genişletecek). Bkz. 00-KARAR-TAKIP.
  it('OAuth yeni kullanıcı APPROVED DEĞİL → PENDING kalır (LOCAL fix OAuth\'u etkilemez)', async () => {
    const email = `oauth-pending-${Date.now()}@test.local`;

    await handleOAuthCallback(
      { providerUserId: 'g-456', email, fullName: 'OAuth Pending', provider: 'GOOGLE' },
      { tenantSlug: tenant.slug, role: 'MENTI', nonce: 'test-nonce' },
    );

    const user = await testPrisma.user.findUnique({
      where: { email },
      select: { approvalStatus: true },
    });
    expect(user?.approvalStatus).toBe('PENDING');
  });
});
