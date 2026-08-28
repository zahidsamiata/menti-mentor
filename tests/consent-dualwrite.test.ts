/**
 * G1-07 — Dual-write entegrasyon testleri.
 * Kayıt akışları (normal / self-serve / OAuth) hem `kvkkConsentAt` hem tipli `Consent` yazar.
 * OAuth MEVCUT kullanıcı girişinde YENİ rıza yazılmaz.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { agent } from './helpers/request.js';
import { cleanDb, testPrisma } from './helpers/db.js';
import { createTenant } from './helpers/factories.js';
import { handleOAuthCallback } from '../src/services/oauth/oauthService.js';
import type { Tenant } from '@prisma/client';

describe('Dual-write — kayıt akışları Consent + kvkkConsentAt yazar', () => {
  let tenant: Tenant;

  beforeEach(async () => {
    await cleanDb();
    tenant = await createTenant();
  });

  it('normal kayıt: kvkkConsentAt + Consent(AYDINLATMA+ACIK_RIZA, FORM)', async () => {
    const email = `reg-${Date.now()}@test.local`;
    await agent()
      .post('/api/auth/register')
      .send({ email, password: 'Test1234!', fullName: 'Reg User', role: 'MENTI', tenantSlug: tenant.slug, kvkkConsent: true })
      .expect(201);

    const user = await testPrisma.user.findUnique({ where: { email }, select: { id: true, kvkkConsentAt: true } });
    expect(user?.kvkkConsentAt).not.toBeNull();

    const consents = await testPrisma.consent.findMany({ where: { userId: user!.id } });
    expect(consents).toHaveLength(2);
    expect(new Set(consents.map((c) => c.type))).toEqual(new Set(['AYDINLATMA', 'ACIK_RIZA']));
    expect(consents.every((c) => c.source === 'FORM')).toBe(true);
  });

  it('self-serve kayıt: tenant + user için Consent(SELF_SERVE)', async () => {
    const stamp = Date.now();
    const email = `stk-${stamp}@test.local`;
    const slug = `stk-${stamp}`;
    await agent()
      .post('/api/tenants/self-serve/register')
      .send({ email, password: 'Test1234!', name: 'Kurucu Admin', tenantName: 'Test STK', slug, programTemplate: 'OZEL', kvkkConsent: true })
      .expect(201);

    const createdTenant = await testPrisma.tenant.findUnique({ where: { slug }, select: { id: true } });
    const createdUser = await testPrisma.user.findUnique({ where: { email }, select: { id: true } });

    const tConsents = await testPrisma.consent.findMany({ where: { tenantId: createdTenant!.id } });
    const uConsents = await testPrisma.consent.findMany({ where: { userId: createdUser!.id } });
    expect(tConsents).toHaveLength(2);
    expect(uConsents).toHaveLength(2);
    expect(tConsents.every((c) => c.source === 'SELF_SERVE')).toBe(true);
    expect(uConsents.every((c) => c.source === 'SELF_SERVE')).toBe(true);
  });

  it('OAuth yeni kullanıcı: Consent(OAUTH) yazılır', async () => {
    const email = `oauth-${Date.now()}@test.local`;
    const res = await handleOAuthCallback(
      { providerUserId: 'g-1', email, fullName: 'OAuth User', provider: 'GOOGLE' },
      { tenantSlug: tenant.slug, role: 'MENTI', nonce: 'n' },
    );
    expect(res.isNewUser).toBe(true);

    const user = await testPrisma.user.findUnique({ where: { email }, select: { id: true } });
    const consents = await testPrisma.consent.findMany({ where: { userId: user!.id } });
    expect(consents).toHaveLength(2);
    expect(consents.every((c) => c.source === 'OAUTH')).toBe(true);
  });

  it('OAuth MEVCUT kullanıcı girişi: YENİ Consent YAZILMAZ', async () => {
    const email = `oauth-ex-${Date.now()}@test.local`;
    await handleOAuthCallback(
      { providerUserId: 'g-2', email, fullName: 'OAuth User', provider: 'GOOGLE' },
      { tenantSlug: tenant.slug, role: 'MENTI', nonce: 'n1' },
    );
    const user = await testPrisma.user.findUnique({ where: { email }, select: { id: true } });
    const before = await testPrisma.consent.count({ where: { userId: user!.id } });

    const res2 = await handleOAuthCallback(
      { providerUserId: 'g-2', email, fullName: 'OAuth User', provider: 'GOOGLE' },
      { tenantSlug: tenant.slug, role: 'MENTI', nonce: 'n2' },
    );
    expect(res2.isNewUser).toBe(false);

    const after = await testPrisma.consent.count({ where: { userId: user!.id } });
    expect(after).toBe(before); // yeni satır YOK
  });
});
