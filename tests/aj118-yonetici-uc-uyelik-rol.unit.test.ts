/**
 * AJ-118 — kurum-yönetici kapısı (`authenticateTenantAdmin`, middleware/tenantAdminAuth.ts) yöneticilik
 * kararını YALNIZ kurum üyeliğinin rolünden (`resolveMembershipAccess` → `access.role`) verir; anahtardaki
 * kişi-genel `role` claim'i (= User.role) ön-kontrol olarak kullanılmaz. DB'siz birim testi: üyelik ve
 * kurum önbelleği sahte, gerçek JWT imzalanır.
 *
 * Ölçüt:
 *  - üyelikte ADMIN, anahtarda MENTOR → geçer (eskiden 403 YETKI_YOK);
 *  - üyelikte MENTOR, anahtarda ADMIN → 403 UYELIK_BULUNAMADI (negatif);
 *  - geçersiz anahtar / platform anahtarı (aud) → eski yanıt AYNEN (403 YETKI_YOK, aynı gövde), üyeliğe bakılmaz;
 *  - anahtar yoksa → 401 (değişmedi).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';

const membershipByUser = vi.hoisted(() => new Map<string, { ok: true; role: string }>());
const resolveMock = vi.hoisted(() => vi.fn());

vi.mock('../src/middleware/membershipAccess.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/middleware/membershipAccess.js')>();
  return { ...actual, resolveMembershipAccess: resolveMock };
});

vi.mock('../src/services/tenantCache.js', () => ({
  getCachedTenant:  vi.fn().mockResolvedValue({ isActive: true, verificationStatus: 'APPROVED' }),
  invalidateTenant: vi.fn(),
}));

import { signToken, PLATFORM_AUDIENCE } from '../src/middleware/jwtAuth.js';
import { authenticateTenantAdmin, authenticateTenantAdminForParam } from '../src/middleware/tenantAdminAuth.js';

const TENANT = 'tenant-own';
const OLD_REJECT_BODY = { error: 'YETKI_YOK', message: 'Bu işlem için yönetici yetkisi gereklidir.' };

interface FakeRes {
  statusCode: number;
  body: unknown;
  status(code: number): FakeRes;
  json(body: unknown): FakeRes;
}

function fakeRes(): FakeRes {
  return {
    statusCode: 200,
    body: undefined,
    status(code) { this.statusCode = code; return this; },
    json(body)   { this.body = body; return this; },
  };
}

function fakeReq(authorization: string | undefined, params: Record<string, string> = { id: TENANT }): Request {
  return {
    params,
    header: (name: string) => (name.toLowerCase() === 'authorization' ? authorization : undefined),
  } as unknown as Request;
}

const memberAdminClaimMentor = signToken({ sub: 'u-uye-admin', tenantId: TENANT, role: 'MENTOR', fullName: 'Deneme Bir' });
const memberMentorClaimAdmin = signToken({ sub: 'u-uye-mentor', tenantId: TENANT, role: 'ADMIN', fullName: 'Deneme İki' });

beforeEach(() => {
  membershipByUser.clear();
  membershipByUser.set('u-uye-admin', { ok: true, role: 'ADMIN' });
  membershipByUser.set('u-uye-mentor', { ok: true, role: 'MENTOR' });
  resolveMock.mockReset();
  resolveMock.mockImplementation(async (userId: string) => membershipByUser.get(userId) ?? { ok: false, reason: 'NO_MEMBERSHIP' });
});

describe('AJ-118 — yönetici kapısı üyelik rolüne dayanır, anahtardaki role claim\'ine değil', () => {
  it('üyelikte ADMIN, anahtarda MENTOR → geçer (kimlik oturumdan döner)', async () => {
    const res = fakeRes();
    const payload = await authenticateTenantAdmin(fakeReq(`Bearer ${memberAdminClaimMentor}`), res as unknown as Response);
    expect(payload?.sub).toBe('u-uye-admin');
    expect(res.body).toBeUndefined();
    expect(resolveMock).toHaveBeenCalledWith('u-uye-admin', TENANT, undefined);
  });

  it('URL :id\'li kapı da aynı kişiyi geçirir (authenticateTenantAdminForParam)', async () => {
    const res = fakeRes();
    const ctx = await authenticateTenantAdminForParam(fakeReq(`Bearer ${memberAdminClaimMentor}`), res as unknown as Response, 'x');
    expect(ctx?.tenantId).toBe(TENANT);
    expect(res.body).toBeUndefined();
  });

  it('negatif: üyelikte MENTOR, anahtarda ADMIN → 403 UYELIK_BULUNAMADI', async () => {
    const res = fakeRes();
    const payload = await authenticateTenantAdmin(fakeReq(`Bearer ${memberMentorClaimAdmin}`), res as unknown as Response);
    expect(payload).toBeNull();
    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual({ error: 'UYELIK_BULUNAMADI', message: 'Bu kurum için aktif yönetici üyeliğiniz bulunmuyor.' });
  });

  it('geçersiz anahtar → eski yanıt aynen (403 YETKI_YOK), üyeliğe bakılmaz', async () => {
    const res = fakeRes();
    const payload = await authenticateTenantAdmin(fakeReq('Bearer bozuk.anahtar.degeri'), res as unknown as Response);
    expect(payload).toBeNull();
    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual(OLD_REJECT_BODY);
    expect(resolveMock).not.toHaveBeenCalled();
  });

  it('platform anahtarı (aud) — üyelikte ADMIN olsa bile → eski yanıt aynen (403 YETKI_YOK), üyeliğe bakılmaz', async () => {
    const platformToken = signToken(
      { sub: 'u-uye-admin', tenantId: TENANT, role: 'ADMIN', fullName: 'Deneme Bir', isPlatformAdmin: true },
      { audience: PLATFORM_AUDIENCE },
    );
    const res = fakeRes();
    const payload = await authenticateTenantAdmin(fakeReq(`Bearer ${platformToken}`), res as unknown as Response);
    expect(payload).toBeNull();
    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual(OLD_REJECT_BODY);
    expect(resolveMock).not.toHaveBeenCalled();
  });

  it('anahtar yoksa → 401 KIMLIK_DOGRULANMADI (değişmedi)', async () => {
    const res = fakeRes();
    const payload = await authenticateTenantAdmin(fakeReq(undefined), res as unknown as Response);
    expect(payload).toBeNull();
    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({ error: 'KIMLIK_DOGRULANMADI', message: 'JWT token gereklidir.' });
  });
});
