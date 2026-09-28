/**
 * AJ-87 · JWT tür ayrımı — DB'siz birim testi.
 *
 * Erişim, platform, OAuth durum (state) ve davet anahtarları AYNI sırla imzalanır. Eskiden hiçbir
 * doğrulayıcı türe bakmıyordu: state/davet anahtarı Authorization başlığında yalnız kurum
 * uyuşmazlığına (403) ya da veritabanı hatasına (500) takılıyordu. Yeni: her imzalayıcı `typ`
 * yazar, her doğrulayıcı yalnız kendi türünü kabul eder. Tür-siz ESKİ erişim anahtarı bir ömür
 * boyunca kabul edilir (geçiş) — ama davet/state alanı taşıyan tür-siz anahtar asla.
 *
 * Gerçek imzalayıcılar + gerçek requireTenant/requireAuth/requirePlatformAdmin/oauthCallback
 * koşar; yalnız DB, kurum önbelleği, üyelik sorgusu ve sağlayıcı ağ çağrısı sahtedir.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';

vi.mock('../src/db.js', () => ({
  prisma: {
    user: { findUnique: vi.fn().mockResolvedValue(null) },
    refreshToken: { create: vi.fn() },
    tenant: { findUnique: vi.fn().mockResolvedValue(null) },
    systemLog: { create: vi.fn().mockResolvedValue({}) },
  },
  runWithTenant: (_tenantId: string, fn: () => unknown) => fn(),
}));

vi.mock('../src/services/logger.js', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

vi.mock('../src/services/tenantCache.js', () => ({
  getCachedTenant:  vi.fn().mockResolvedValue({ isActive: true, verificationStatus: 'APPROVED' }),
  invalidateTenant: vi.fn(),
}));

// Üyelik sorgusu: gerçek Prisma `userId: undefined` ile doğrulama hatası fırlatır (eski 500'ün
// kaynağı: sub'sız davet anahtarı üyelik sorgusuna kadar ilerliyordu). Aynı davranış taklit edilir.
const resolveMembershipAccess = vi.fn(async (userId: unknown) => {
  if (typeof userId !== 'string') throw new Error('Argument `userId` is missing.');
  return { ok: true as const, role: 'MENTI' as const };
});
vi.mock('../src/middleware/membershipAccess.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/middleware/membershipAccess.js')>();
  return { ...actual, resolveMembershipAccess: (...a: [unknown]) => resolveMembershipAccess(...a) };
});
vi.mock('../src/services/activityService.js', () => ({ recordUserActivity: vi.fn() }));

const { signToken, verifyToken, verifyPlatformToken, PLATFORM_AUDIENCE } = await import('../src/middleware/jwtAuth.js');
const { requireTenant } = await import('../src/middleware/tenant.js');
const { requireAuth } = await import('../src/middleware/authorize.js');
const { requirePlatformAdmin } = await import('../src/middleware/platformAuth.js');
const { PLATFORM_COOKIE } = await import('../src/controllers/platformController.js');
const { createOAuthState, verifyOAuthState } = await import('../src/services/oauth/oauthStateService.js');
const { verifyInvitationToken } = await import('../src/services/invitationToken.js');
const { oauthCallback } = await import('../src/controllers/authController.js');
const { config } = await import('../src/config.js');

const TENANT = 'tenant-1';
const SECRET = config.jwt.secret;

const accessToken = () => signToken({ sub: 'user-1', tenantId: TENANT, role: 'MENTI', fullName: 'Deneme Kişi' });
const platformToken = () => signToken(
  { sub: 'platform-admin', tenantId: '__platform__', role: 'ADMIN', fullName: 'Platform', isPlatformAdmin: true },
  { audience: PLATFORM_AUDIENCE },
);
/** typ alanından önceki imzalayıcının ürettiği erişim anahtarı (AJ-87 öncesi biçim). */
const legacyAccessToken = (expiresIn: jwt.SignOptions['expiresIn'] = '1h') =>
  jwt.sign({ sub: 'user-1', tenantId: TENANT, role: 'MENTI', fullName: 'Eski', jti: 'eski-jti' }, SECRET, { expiresIn });
/** selfServeController.signInvitationToken ile aynı biçim (AJ-87 öncesi ve sonrası). */
const legacyInvitationToken = () => jwt.sign({ tenantId: TENANT, role: 'MENTI', type: 'invitation' }, SECRET, { expiresIn: '30d' });
const invitationToken = () => jwt.sign({ tenantId: TENANT, role: 'MENTI', type: 'invitation', typ: 'invitation' }, SECRET, { expiresIn: '30d' });

interface FakeRes { statusCode: number; body: unknown; status(c: number): FakeRes; json(b: unknown): FakeRes }
function fakeRes(): FakeRes {
  return {
    statusCode: 200,
    body: undefined,
    status(c) { this.statusCode = c; return this; },
    json(b)   { this.body = b; return this; },
  };
}

/** Oturum isteyen bir kurum ucunu taklit eder: requireTenant → requireAuth → uç. Fırlatma = 500. */
async function callProtectedEndpoint(token: string): Promise<{ status: number; auth: unknown }> {
  const req = {
    method: 'GET',
    originalUrl: '/api/users/me',
    header: (name: string) => {
      const n = name.toLowerCase();
      if (n === 'authorization') return `Bearer ${token}`;
      if (n === 'x-tenant-id') return TENANT;
      return undefined;
    },
  } as unknown as Request & { auth?: unknown };
  const res = fakeRes();
  let reached = false;
  try {
    await requireTenant(req as never, res as unknown as Response, (() => {
      requireAuth()(req, res as unknown as Response, (() => { reached = true; }) as NextFunction);
    }) as NextFunction);
  } catch {
    res.statusCode = 500;
  }
  return { status: reached ? 200 : res.statusCode, auth: req.auth };
}

describe('AJ-87 · erişim doğrulayıcısı yalnız erişim anahtarını kabul eder', () => {
  beforeEach(() => { resolveMembershipAccess.mockClear(); });

  it('yeni erişim anahtarı (typ:access) → kabul, oturum kurulur', async () => {
    const r = await callProtectedEndpoint(accessToken());
    expect(r.status).toBe(200);
    expect(r.auth).toMatchObject({ userId: 'user-1' });
    expect((jwt.decode(accessToken()) as { typ?: string }).typ).toBe('access');
  });

  it('negatif: OAuth state anahtarı Authorization başlığında → 401 (eskiden 403 kurum uyuşmazlığı)', async () => {
    const r = await callProtectedEndpoint(createOAuthState('kurum', 'MENTI'));
    expect(r.status).toBe(401);
    expect(r.auth).toBeNull();
  });

  it('negatif: davet anahtarı Authorization başlığında → 401, 500 değil, üyelik sorgusuna inmez', async () => {
    for (const tok of [legacyInvitationToken(), invitationToken()]) {
      const r = await callProtectedEndpoint(tok);
      expect(r.status).toBe(401);
    }
    expect(resolveMembershipAccess).not.toHaveBeenCalled();
  });

  it('negatif: platform anahtarı erişim anahtarı olarak geçmez', () => {
    expect(verifyToken(platformToken())).toBeNull();
  });

  it('negatif: davet/state alanı taşıyan TÜR-SİZ anahtar geçiş penceresinde de erişim sayılmaz', () => {
    const inviteShaped = jwt.sign({ sub: 'u', tenantId: TENANT, role: 'MENTI', type: 'invitation' }, SECRET, { expiresIn: '1h' });
    const stateShaped = jwt.sign({ sub: 'u', tenantId: TENANT, role: 'MENTI', tenantSlug: 'kurum', nonce: 'n' }, SECRET, { expiresIn: '1h' });
    const inviteCarrying = jwt.sign({ sub: 'u', tenantId: TENANT, role: 'MENTI', inviteToken: 'x' }, SECRET, { expiresIn: '1h' });
    expect(verifyToken(inviteShaped)).toBeNull();
    expect(verifyToken(stateShaped)).toBeNull();
    expect(verifyToken(inviteCarrying)).toBeNull();
  });

  it('negatif: bilinmeyen typ değeri reddedilir', () => {
    const odd = jwt.sign({ sub: 'u', tenantId: TENANT, role: 'MENTI', typ: 'oauth_state' }, SECRET, { expiresIn: '1h' });
    expect(verifyToken(odd)).toBeNull();
  });
});

describe('AJ-87 · geçiş: tür-siz ESKİ erişim anahtarı bir ömür kabul edilir', () => {
  afterEach(() => vi.useRealTimers());

  it('tür-siz eski erişim anahtarı (sub/role/tenantId) → kabul', async () => {
    const r = await callProtectedEndpoint(legacyAccessToken());
    expect(r.status).toBe(200);
    expect(r.auth).toMatchObject({ userId: 'user-1' });
  });

  it('pencere (config.jwt.expiresIn) bittikten sonra tür-siz anahtar reddedilir; yeni anahtar geçer', () => {
    const longLegacy = legacyAccessToken('30d');
    const fresh = jwt.sign({ sub: 'user-1', tenantId: TENANT, role: 'MENTI', fullName: 'Yeni', typ: 'access' }, SECRET, { expiresIn: '30d' });
    expect(verifyToken(longLegacy)).not.toBeNull();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 8 * 24 * 60 * 60 * 1000);
    expect(verifyToken(longLegacy)).toBeNull();
    expect(verifyToken(fresh)).not.toBeNull();
  });
});

describe('AJ-87 · platform doğrulayıcısı', () => {
  function platformGate(token: string): number {
    const req = { headers: { cookie: `${PLATFORM_COOKIE}=${token}` } } as unknown as Request;
    const res = fakeRes();
    let passed = false;
    requirePlatformAdmin(req, res as unknown as Response, (() => { passed = true; }) as NextFunction);
    return passed ? 200 : res.statusCode;
  }

  it('platform anahtarı (aud + typ:platform) → kabul', () => {
    expect((jwt.decode(platformToken()) as { typ?: string }).typ).toBe('platform');
    expect(platformGate(platformToken())).toBe(200);
  });

  it('negatif: erişim / state / davet anahtarı platform kapısında → 403', () => {
    expect(platformGate(accessToken())).toBe(403);
    expect(platformGate(createOAuthState('kurum', 'MENTI'))).toBe(403);
    expect(platformGate(invitationToken())).toBe(403);
  });

  it('negatif: aud:platform taşıyan ama typ:access olan anahtar platform sayılmaz', () => {
    const forged = jwt.sign({ sub: 'x', tenantId: '__platform__', role: 'ADMIN', isPlatformAdmin: true, typ: 'access' }, SECRET, { expiresIn: '1h', audience: PLATFORM_AUDIENCE });
    expect(verifyPlatformToken(forged)).toBeNull();
  });
});

describe('AJ-87 · OAuth state doğrulayıcısı', () => {
  it('kendi state anahtarı → kabul', () => {
    const state = createOAuthState('kurum', 'MENTI');
    expect((jwt.decode(state) as { typ?: string }).typ).toBe('oauth_state');
    expect(verifyOAuthState(state)).toMatchObject({ tenantSlug: 'kurum', role: 'MENTI' });
  });

  it('negatif: state biçiminde ama türü access (ya da tür-siz) → ret', () => {
    const shaped = { tenantSlug: 'kurum', role: 'MENTI', nonce: 'n' };
    expect(verifyOAuthState(jwt.sign({ ...shaped, typ: 'access' }, SECRET, { expiresIn: 600 }))).toBeNull();
    expect(verifyOAuthState(jwt.sign(shaped, SECRET, { expiresIn: 600 }))).toBeNull();
  });

  it('negatif: erişim anahtarı state yerine OAuth geri çağrısına verilince → GECERSIZ_STATE', async () => {
    let location = '';
    const req = { params: { provider: 'google' }, query: { code: 'kod', state: accessToken() } } as unknown as Request;
    const res = { redirect: (url: string) => { location = url; }, cookie: vi.fn() } as unknown as Response;
    await oauthCallback(req, res);
    expect(new URL(location).searchParams.get('error')).toBe('GECERSIZ_STATE');
  });
});

describe('AJ-87 · davet doğrulayıcısı', () => {
  it('yeni ve eski (tür-siz) davet anahtarı → kabul', () => {
    expect(verifyInvitationToken(invitationToken())).toMatchObject({ tenantId: TENANT, type: 'invitation' });
    expect(verifyInvitationToken(legacyInvitationToken())).toMatchObject({ tenantId: TENANT });
  });

  it('negatif: erişim / state / platform anahtarı davet olarak kabul edilmez', () => {
    expect(verifyInvitationToken(accessToken())).toBeNull();
    expect(verifyInvitationToken(createOAuthState('kurum', 'MENTI'))).toBeNull();
    expect(verifyInvitationToken(platformToken())).toBeNull();
  });

  it('negatif: type:invitation taşısa da typ başka türse ret', () => {
    const mixed = jwt.sign({ tenantId: TENANT, role: 'MENTI', type: 'invitation', typ: 'access' }, SECRET, { expiresIn: '1h' });
    expect(verifyInvitationToken(mixed)).toBeNull();
  });
});
