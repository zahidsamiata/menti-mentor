/**
 * U-06 — OAuth ile gelen davetli kullanıcı, form kaydıyla aynı kuralla APPROVED olur.
 * Davet token'ı OAuth state'inde taşınır; doğru kurum + doğru rol → APPROVED,
 * aksi hâlde (token yok / başka kurum / başka rol / sahte) PENDING kalır.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import jwt from 'jsonwebtoken';
import { handleOAuthCallback } from '../src/services/oauth/oauthService.js';
import { createOAuthState, verifyOAuthState } from '../src/services/oauth/oauthStateService.js';
import { cleanDb, testPrisma } from './helpers/db.js';
import { createTenant } from './helpers/factories.js';
import type { Tenant } from '@prisma/client';

function inviteFor(tenantId: string, role: 'MENTOR' | 'MENTI'): string {
  return jwt.sign({ tenantId, role, type: 'invitation' }, process.env['JWT_SECRET'] as string, { expiresIn: '1h' });
}

async function approvalOf(email: string) {
  const u = await testPrisma.user.findUnique({ where: { email }, select: { approvalStatus: true } });
  return u?.approvalStatus;
}

describe('U-06: OAuth davetli kullanıcı onayı', () => {
  let tenant: Tenant;
  beforeEach(async () => {
    await cleanDb();
    tenant = await createTenant();
  });

  const profile = (email: string) => ({ providerUserId: `g-${email}`, email, fullName: 'OAuth Davetli', provider: 'GOOGLE' as const });

  it('davet token\'ı OAuth state\'inde korunur', () => {
    const token = inviteFor(tenant.id, 'MENTI');
    const state = verifyOAuthState(createOAuthState(tenant.slug, 'MENTI', token));
    expect(state?.inviteToken).toBe(token);
  });

  it('geçerli davet (doğru kurum + rol) ile OAuth kaydı APPROVED olur', async () => {
    const email = `oauth-davet-${Date.now()}@test.local`;
    await handleOAuthCallback(profile(email), { tenantSlug: tenant.slug, role: 'MENTI', nonce: 'n', inviteToken: inviteFor(tenant.id, 'MENTI') });
    expect(await approvalOf(email)).toBe('APPROVED');
  });

  it('negatif: başka kurumun daveti PENDING bırakır', async () => {
    const other = await createTenant();
    const email = `oauth-baska-${Date.now()}@test.local`;
    await handleOAuthCallback(profile(email), { tenantSlug: tenant.slug, role: 'MENTI', nonce: 'n', inviteToken: inviteFor(other.id, 'MENTI') });
    expect(await approvalOf(email)).toBe('PENDING');
  });

  it('negatif: başka rolün daveti PENDING bırakır', async () => {
    const email = `oauth-rol-${Date.now()}@test.local`;
    await handleOAuthCallback(profile(email), { tenantSlug: tenant.slug, role: 'MENTOR', nonce: 'n', inviteToken: inviteFor(tenant.id, 'MENTI') });
    expect(await approvalOf(email)).toBe('PENDING');
  });

  it('negatif: imzası geçersiz ya da davet olmayan token PENDING bırakır', async () => {
    const e1 = `oauth-sahte-${Date.now()}@test.local`;
    await handleOAuthCallback(profile(e1), { tenantSlug: tenant.slug, role: 'MENTI', nonce: 'n', inviteToken: 'sahte.token.degeri' });
    expect(await approvalOf(e1)).toBe('PENDING');
    const e2 = `oauth-tip-${Date.now()}@test.local`;
    const notInvite = jwt.sign({ tenantId: tenant.id, role: 'MENTI' }, process.env['JWT_SECRET'] as string);
    await handleOAuthCallback(profile(e2), { tenantSlug: tenant.slug, role: 'MENTI', nonce: 'n', inviteToken: notInvite });
    expect(await approvalOf(e2)).toBe('PENDING');
  });
});

describe('U-06: incelemedeki kuruma OAuth kaydı (form kaydıyla aynı kapı)', () => {
  beforeEach(async () => { await cleanDb(); });

  it('negatif: PENDING_REVIEW kuruma geçerli davetle bile OAuth kaydı açılmaz', async () => {
    const tenant = await createTenant({ verificationStatus: 'PENDING_REVIEW' });
    const email = `oauth-inceleme-${Date.now()}@test.local`;
    await expect(
      handleOAuthCallback(
        { providerUserId: 'g-inc', email, fullName: 'OAuth İnceleme', provider: 'GOOGLE' },
        { tenantSlug: tenant.slug, role: 'MENTI', nonce: 'n', inviteToken: inviteFor(tenant.id, 'MENTI') },
      ),
    ).rejects.toMatchObject({ code: 'TENANT_ONAY_BEKLENIYOR' });
    expect(await testPrisma.user.count({ where: { email } })).toBe(0);
  });
});
