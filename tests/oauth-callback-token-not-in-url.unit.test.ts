/**
 * AJ-73 · Sosyal giriş dönüşünde erişim anahtarı adrese yazılmaz — DB'siz birim.
 *
 * Eski davranış: başarılı dönüşte `?accessToken=<jwt>&isNewUser=…` adresine yönlendiriliyordu;
 * anahtar tarayıcı geçmişine, erişim günlüklerine ve Referer başlığına düşebiliyordu.
 * Yeni: yalnız yenileme anahtarı HttpOnly çereze yazılır, adreste yalnız `isNewUser` kalır;
 * frontend erişim anahtarını `POST /api/auth/refresh` ile (çerezle) alır.
 *
 * Test gerçek controller'ı (oauthCallback) + gerçek state imzasını (createOAuthState) koşar;
 * yalnız DB ve sağlayıcı ağ çağrısı sahtedir.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';

const userFindUnique = vi.fn();
const refreshTokenCreate = vi.fn();

vi.mock('../src/db.js', () => ({
  prisma: {
    user: { findUnique: (...a: unknown[]) => userFindUnique(...a) },
    refreshToken: { create: (...a: unknown[]) => refreshTokenCreate(...a) },
    tenant: { findUnique: vi.fn().mockResolvedValue(null) },
  },
}));
vi.mock('../src/services/activityService.js', () => ({ recordUserActivity: vi.fn() }));

const { oauthCallback } = await import('../src/controllers/authController.js');
const { GoogleOAuthProvider } = await import('../src/services/oauth/googleProvider.js');
const { createOAuthState } = await import('../src/services/oauth/oauthStateService.js');
const { REFRESH_COOKIE_NAME } = await import('../src/utils/authCookies.js');

const JWT_SHAPE = /eyJ[\w-]+\.[\w-]+\.[\w-]+/;

async function successfulGoogleCallback() {
  userFindUnique.mockResolvedValue({
    id: 'u1',
    tenantId: 't1',
    role: 'MENTI',
    fullName: 'Deneme Kişi',
    approvalStatus: 'APPROVED',
    isActive: true,
    authProvider: 'GOOGLE',
  });
  refreshTokenCreate.mockResolvedValue({ id: 'sid-1' });
  let location = '';
  const cookie = vi.fn();
  const req = {
    params: { provider: 'google' },
    query: { code: 'kod', state: createOAuthState('kurum', 'MENTI') },
  } as unknown as Request;
  const res = {
    redirect: (url: string) => { location = url; },
    cookie,
  } as unknown as Response;
  await oauthCallback(req, res);
  return { location, url: new URL(location), cookie };
}

describe('AJ-73 · OAuth dönüşünde erişim anahtarı adreste YOK, yenileme çerezi VAR', () => {
  beforeEach(() => {
    userFindUnique.mockReset();
    refreshTokenCreate.mockReset();
    vi.spyOn(GoogleOAuthProvider.prototype, 'exchangeCodeForProfile').mockResolvedValue({
      providerUserId: 'g-1',
      email: 'deneme@ornek.com',
      fullName: 'Deneme Kişi',
      provider: 'GOOGLE',
    });
  });

  it('başarılı dönüş: Location adresinde accessToken / refreshToken / JWT yok', async () => {
    const { location, url } = await successfulGoogleCallback();
    expect(url.searchParams.get('error')).toBeNull();
    expect(url.searchParams.has('accessToken')).toBe(false);
    expect(url.searchParams.has('refreshToken')).toBe(false);
    expect(location).not.toMatch(JWT_SHAPE);
    // Gizli olmayan bayrak kalır — frontend hoş geldin ekranını buna göre açar.
    expect([...url.searchParams.keys()]).toEqual(['isNewUser']);
  });

  it('başarılı dönüş: yenileme anahtarı HttpOnly çereze yazılır (oturum çerezle kurulur)', async () => {
    const { cookie } = await successfulGoogleCallback();
    expect(cookie).toHaveBeenCalledTimes(1);
    const [name, value, options] = cookie.mock.calls[0] as [string, string, Record<string, unknown>];
    expect(name).toBe(REFRESH_COOKIE_NAME);
    expect(value).toBeTruthy();
    expect(options).toMatchObject({ httpOnly: true, sameSite: 'strict' });
  });
});
