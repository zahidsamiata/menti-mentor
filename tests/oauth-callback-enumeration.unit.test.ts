/**
 * AJ-30 (IC-06 kalanı) · Sosyal giriş dönüşündeki ?error= kodu hesabın durumunu ele vermez — DB'siz birim.
 *
 * Eski davranış: pasif/reddedilmiş hesap → `?error=HESAP_PASIF`, şifreyle (LOCAL) ya da başka
 * sağlayıcıyla açılmış hesap → `?error=PROVIDER_CATISMASI`. Adres çubuğundaki kod, o e-postanın
 * hesabının hangi durumda olduğunu ayırt ettiriyordu. Yeni: hepsi TEK kod, token verilmez.
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
const { OAUTH_ACCOUNT_MISMATCH_CODE } = await import('../src/services/oauth/oauthService.js');

const EMAIL = 'hedef@ornek.com';

type ExistingUser = {
  approvalStatus: 'PENDING' | 'APPROVED' | 'REJECTED';
  isActive: boolean;
  authProvider: 'LOCAL' | 'GOOGLE' | 'LINKEDIN';
};

/** Google ile dönüşü taklit eder; controller'ın yönlendirdiği adresi döndürür. */
async function googleCallbackRedirect(existing: ExistingUser): Promise<URL> {
  userFindUnique.mockResolvedValue({
    id: 'u1',
    tenantId: 't1',
    role: 'MENTI',
    fullName: 'Hedef Kişi',
    ...existing,
  });
  let location = '';
  const req = {
    params: { provider: 'google' },
    query: { code: 'kod', state: createOAuthState('kurum', 'MENTI') },
  } as unknown as Request;
  const res = {
    redirect: (url: string) => { location = url; },
    cookie: vi.fn(),
  } as unknown as Response;
  await oauthCallback(req, res);
  return new URL(location);
}

describe('AJ-30 · OAuth dönüş hata kodu hesabın durumunu ayırt ettirmez', () => {
  beforeEach(() => {
    userFindUnique.mockReset();
    refreshTokenCreate.mockReset();
    vi.spyOn(GoogleOAuthProvider.prototype, 'exchangeCodeForProfile').mockResolvedValue({
      providerUserId: 'g-1',
      email: EMAIL,
      fullName: 'Deneyen',
      provider: 'GOOGLE',
    });
  });

  const cases: Array<[string, ExistingUser]> = [
    ['onay bekleyen, şifreyle açılmış hesap', { approvalStatus: 'PENDING', isActive: true, authProvider: 'LOCAL' }],
    ['reddedilmiş (pasif) Google hesabı', { approvalStatus: 'REJECTED', isActive: false, authProvider: 'GOOGLE' }],
    ['pasif, şifreyle açılmış hesap', { approvalStatus: 'APPROVED', isActive: false, authProvider: 'LOCAL' }],
    ['aktif, başka sağlayıcıyla (LinkedIn) açılmış hesap', { approvalStatus: 'APPROVED', isActive: true, authProvider: 'LINKEDIN' }],
  ];

  it('onay bekleyen / reddedilmiş / pasif / başka yöntemli hesap → hepsi AYNI ?error= kodu', async () => {
    const codes = [];
    for (const [, user] of cases) {
      const url = await googleCallbackRedirect(user);
      codes.push(url.searchParams.get('error'));
    }
    expect(new Set(codes).size).toBe(1);
    expect(codes[0]).toBe(OAUTH_ACCOUNT_MISMATCH_CODE);
  });

  it.each(cases)('%s → eski durum kodları (HESAP_PASIF / PROVIDER_CATISMASI) adreste YOK, token verilmez', async (_label, user) => {
    const url = await googleCallbackRedirect(user);
    expect(url.searchParams.get('error')).not.toMatch(/HESAP_PASIF|PROVIDER_CATISMASI|REDDEDILDI|ONAY/);
    expect(url.searchParams.get('accessToken')).toBeNull();
    expect(url.search).not.toMatch(/LOCAL|LINKEDIN|GOOGLE/i);
    expect(refreshTokenCreate).not.toHaveBeenCalled();
  });

  it('kontrol: aynı sağlayıcıyla açılmış aktif hesap → hata yok, oturum açılır (kapı fazla kapatmıyor)', async () => {
    refreshTokenCreate.mockResolvedValue({});
    const url = await googleCallbackRedirect({ approvalStatus: 'APPROVED', isActive: true, authProvider: 'GOOGLE' });
    expect(url.searchParams.get('error')).toBeNull();
    // AJ-73: oturum artık adresteki anahtarla değil, yenileme çereziyle kurulur.
    expect(url.searchParams.get('accessToken')).toBeNull();
    expect(url.searchParams.get('isNewUser')).toBe('false');
    expect(refreshTokenCreate).toHaveBeenCalledTimes(1);
  });
});
