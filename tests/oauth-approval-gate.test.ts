/**
 * Y1-B8 — OAuth onay kapısı: şifreli girişle AYNI kural.
 *
 * Açık: onay bekleyen (PENDING) kullanıcı şifreyle girince 403 HESAP_ONAY_BEKLENIYOR alıyordu, ama
 * Google/LinkedIn ile girince access + refresh token alıp sohbet/randevu/anlaşma uçlarına
 * ulaşabiliyordu. Düzeltme: OAuth sonucu PENDING/REJECTED ise token VERİLMEZ (kind: 'BLOCKED');
 * callback frontend'e durum koduyla yönlenir. Savunma derinliği: düzeltmeden önce alınmış refresh
 * token'ı PENDING/REJECTED hesapta yenilenmez.
 */
import crypto from 'node:crypto';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import jwt from 'jsonwebtoken';
import { handleOAuthCallback } from '../src/services/oauth/oauthService.js';
import { createOAuthState } from '../src/services/oauth/oauthStateService.js';
import { GoogleOAuthProvider } from '../src/services/oauth/googleProvider.js';
import { hashRefreshToken } from '../src/services/refreshToken.js';
import { agent, loginAs } from './helpers/request.js';
import { cleanDb, testPrisma } from './helpers/db.js';
import { createTenant, createUser } from './helpers/factories.js';
import type { Tenant, UserApprovalStatus } from '@prisma/client';

function inviteFor(tenantId: string, role: 'MENTOR' | 'MENTI'): string {
  return jwt.sign({ tenantId, role, type: 'invitation' }, process.env['JWT_SECRET'] as string, { expiresIn: '1h' });
}

const profile = (email: string) => ({
  providerUserId: `g-${email}`,
  email,
  fullName: 'OAuth Kapı',
  provider: 'GOOGLE' as const,
});

async function createOAuthUser(tenantId: string, approvalStatus: UserApprovalStatus, isActive = true) {
  return testPrisma.user.create({
    data: {
      tenantId,
      email: `oauth-${approvalStatus.toLowerCase()}-${crypto.randomUUID()}@test.local`,
      fullName: 'OAuth Mevcut',
      role: 'MENTI',
      authProvider: 'GOOGLE',
      approvalStatus,
      isActive,
    },
  });
}

async function refreshTokenCount(userId: string) {
  return testPrisma.refreshToken.count({ where: { userId } });
}

describe('Y1-B8: OAuth servis — onay bekleyen / reddedilen hesaba token yok', () => {
  let tenant: Tenant;
  beforeEach(async () => {
    await cleanDb();
    tenant = await createTenant();
  });

  it('davetsiz yeni OAuth kaydı → başvuru oluşur ama token YOK (HESAP_ONAY_BEKLENIYOR)', async () => {
    const email = `oauth-yeni-${Date.now()}@test.local`;
    const result = await handleOAuthCallback(profile(email), { tenantSlug: tenant.slug, role: 'MENTI', nonce: 'n' });

    expect(result).toEqual({ kind: 'BLOCKED', code: 'HESAP_ONAY_BEKLENIYOR', isNewUser: true });
    const user = await testPrisma.user.findUnique({ where: { email }, select: { id: true, approvalStatus: true } });
    expect(user?.approvalStatus).toBe('PENDING');
    expect(await refreshTokenCount(user!.id)).toBe(0);
  });

  it('mevcut PENDING OAuth kullanıcısı tekrar girer → token YOK', async () => {
    const user = await createOAuthUser(tenant.id, 'PENDING');
    const result = await handleOAuthCallback(profile(user.email), { tenantSlug: tenant.slug, role: 'MENTI', nonce: 'n' });

    expect(result).toEqual({ kind: 'BLOCKED', code: 'HESAP_ONAY_BEKLENIYOR', isNewUser: false });
    expect(await refreshTokenCount(user.id)).toBe(0);
  });

  it('REJECTED (pasife alınmış) OAuth kullanıcısı → red kodu, "pasif" değil; token YOK', async () => {
    const user = await createOAuthUser(tenant.id, 'REJECTED', false);
    const result = await handleOAuthCallback(profile(user.email), { tenantSlug: tenant.slug, role: 'MENTI', nonce: 'n' });

    expect(result).toEqual({ kind: 'BLOCKED', code: 'HESAP_REDDEDILDI', isNewUser: false });
    expect(await refreshTokenCount(user.id)).toBe(0);
  });

  it('APPROVED OAuth kullanıcısı → normal oturum (access + refresh)', async () => {
    const user = await createOAuthUser(tenant.id, 'APPROVED');
    const result = await handleOAuthCallback(profile(user.email), { tenantSlug: tenant.slug, role: 'MENTI', nonce: 'n' });

    expect(result.kind).toBe('SESSION');
    if (result.kind !== 'SESSION') return;
    expect(result.accessToken).toEqual(expect.any(String));
    expect(result.isNewUser).toBe(false);
    expect(await refreshTokenCount(user.id)).toBe(1);
  });

  it('davetli yeni OAuth kaydı (APPROVED) → normal oturum', async () => {
    const email = `oauth-davetli-${Date.now()}@test.local`;
    const result = await handleOAuthCallback(profile(email), {
      tenantSlug: tenant.slug,
      role: 'MENTI',
      nonce: 'n',
      inviteToken: inviteFor(tenant.id, 'MENTI'),
    });

    expect(result.kind).toBe('SESSION');
    expect(result.isNewUser).toBe(true);
    const user = await testPrisma.user.findUnique({ where: { email }, select: { id: true, approvalStatus: true } });
    expect(user?.approvalStatus).toBe('APPROVED');
    expect(await refreshTokenCount(user!.id)).toBe(1);
  });

  it('negatif: REJECTED LOCAL hesaba Google ile gelen → red durumu SIZMAZ (sağlayıcı çatışması)', async () => {
    const local = await createUser({ tenantId: tenant.id, approvalStatus: 'REJECTED' });
    await expect(
      handleOAuthCallback(profile(local.email), { tenantSlug: tenant.slug, role: 'MENTI', nonce: 'n' }),
    ).rejects.toMatchObject({ code: 'PROVIDER_CATISMASI' });
  });
});

describe('Y1-B8: OAuth callback ucu — PENDING kullanıcıya cookie/token yok, bekleme koduyla yönlenir', () => {
  let tenant: Tenant;
  beforeEach(async () => {
    await cleanDb();
    tenant = await createTenant();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function callback(email: string, inviteToken?: string) {
    vi.spyOn(GoogleOAuthProvider.prototype, 'exchangeCodeForProfile').mockResolvedValue(profile(email));
    const state = createOAuthState(tenant.slug, 'MENTI', inviteToken);
    return agent().get('/api/auth/google/callback').query({ code: 'kod', state });
  }

  it('PENDING → 302 ?error=HESAP_ONAY_BEKLENIYOR, accessToken ve refresh cookie YOK', async () => {
    const res = await callback(`cb-pending-${Date.now()}@test.local`);

    expect(res.status).toBe(302);
    const location = new URL(res.headers['location'] as string);
    expect(location.searchParams.get('error')).toBe('HESAP_ONAY_BEKLENIYOR');
    expect(location.searchParams.has('accessToken')).toBe(false);
    const cookies = ([] as string[]).concat(res.headers['set-cookie'] ?? []);
    expect(cookies.some((c) => c.startsWith('mm_refresh='))).toBe(false);
  });

  it('davetli (APPROVED) → 302 accessToken ile + refresh cookie (davranış değişmedi)', async () => {
    const res = await callback(`cb-davetli-${Date.now()}@test.local`, inviteFor(tenant.id, 'MENTI'));

    expect(res.status).toBe(302);
    const location = new URL(res.headers['location'] as string);
    expect(location.searchParams.get('accessToken')).toEqual(expect.any(String));
    expect(location.searchParams.has('error')).toBe(false);
    const cookies = ([] as string[]).concat(res.headers['set-cookie'] ?? []);
    expect(cookies.some((c) => c.startsWith('mm_refresh='))).toBe(true);
  });
});

describe('Y1-B8 savunma derinliği: eski refresh token PENDING/REJECTED hesapta yenilenmez', () => {
  let tenant: Tenant;
  beforeEach(async () => {
    await cleanDb();
    tenant = await createTenant();
  });

  async function seedRefreshToken(userId: string) {
    const raw = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 3600 * 1000);
    await testPrisma.refreshToken.create({ data: { token: hashRefreshToken(raw), userId, expiresAt } });
    return raw;
  }

  it.each(['PENDING', 'REJECTED'] as const)(
    'NEGATİF: %s kullanıcı eski refresh token ile oturum yenileyemez; token söner',
    async (status) => {
      const user = await createOAuthUser(tenant.id, status);
      const raw = await seedRefreshToken(user.id);

      const res = await agent().post('/api/auth/refresh').set('Cookie', `mm_refresh=${raw}`);

      expect(res.status).toBe(401);
      expect(res.body).not.toHaveProperty('accessToken');
      expect(await refreshTokenCount(user.id)).toBe(0);
    },
  );

  it('APPROVED kullanıcı refresh ile normal yeniler (regresyon)', async () => {
    const user = await createOAuthUser(tenant.id, 'APPROVED');
    const raw = await seedRefreshToken(user.id);

    const res = await agent().post('/api/auth/refresh').set('Cookie', `mm_refresh=${raw}`);

    expect(res.status).toBe(200);
    expect(res.body.accessToken).toEqual(expect.any(String));
  });
});

describe('Y1-B8: şifreli giriş davranışı değişmedi', () => {
  it('PENDING şifreli giriş → 403 HESAP_ONAY_BEKLENIYOR, token yok; APPROVED → token', async () => {
    await cleanDb();
    const tenant = await createTenant();
    const pending = await createUser({ tenantId: tenant.id, approvalStatus: 'PENDING' });
    const res = await agent()
      .post('/api/auth/login')
      .send({ email: pending.email, password: pending.rawPassword });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('HESAP_ONAY_BEKLENIYOR');
    expect(res.body).not.toHaveProperty('accessToken');

    const approved = await createUser({ tenantId: tenant.id });
    const tokens = await loginAs(agent(), approved.email, approved.rawPassword);
    expect(tokens.accessToken).toEqual(expect.any(String));
  });
});
