/**
 * AJ-51 · platform çıkışının yeniden başlatmadan sonra da geçerli kalması — DB'siz birim testi.
 *
 * Saf karar (decidePlatformSession) + DB sorgusu sahte Prisma ile (resolvePlatformSession /
 * recordPlatformLogout). Uçtan uca (gerçek DB, yeniden başlatma taklidi):
 * tests/platform-logout-persistent.test.ts.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const findFirst = vi.fn();
const create = vi.fn();
vi.mock('../src/db.js', () => ({
  prisma: { systemLog: { findFirst: (...a: unknown[]) => findFirst(...a), create: (...a: unknown[]) => create(...a) } },
}));

const {
  decidePlatformSession,
  needsLogoutRecordLookup,
  resolvePlatformSession,
  recordPlatformLogout,
  PLATFORM_LOGOUT_CATEGORY,
  PLATFORM_LOGOUT_MESSAGE,
} = await import('../src/services/platformSessionRevocation.js');
const { __resetAccessTokenRevocationForTests, isAccessTokenRevoked, revokeAccessToken } =
  await import('../src/services/accessTokenRevocation.js');

const nowSec = () => Math.floor(Date.now() / 1000);

describe('AJ-51 · decidePlatformSession (saf karar)', () => {
  it('jti var + çıkış kaydı var → ret (LOGOUT_RECORDED)', () => {
    expect(decidePlatformSession('jti-1', false, true)).toEqual({ ok: false, reason: 'LOGOUT_RECORDED' });
  });

  it('jti var + kayıt yok + bellekte yok → kabul', () => {
    expect(decidePlatformSession('jti-1', false, false)).toEqual({ ok: true });
  });

  it('bellekte iptal → ret (REVOKED_IN_MEMORY), DB sonucundan bağımsız', () => {
    expect(decidePlatformSession('jti-1', true, false)).toEqual({ ok: false, reason: 'REVOKED_IN_MEMORY' });
  });

  it('jti yok → yalnız bellek kararı (DB sonucu yok sayılır)', () => {
    expect(decidePlatformSession(undefined, false, true)).toEqual({ ok: true });
    expect(needsLogoutRecordLookup(undefined, false)).toBe(false);
    expect(needsLogoutRecordLookup('', false)).toBe(false);
  });

  it('DB araması: yalnız jti varken ve bellekte iptal değilken', () => {
    expect(needsLogoutRecordLookup('jti-1', false)).toBe(true);
    expect(needsLogoutRecordLookup('jti-1', true)).toBe(false);
  });
});

describe('AJ-51 · resolvePlatformSession / recordPlatformLogout (sahte DB)', () => {
  beforeEach(() => {
    __resetAccessTokenRevocationForTests();
    findFirst.mockReset();
    create.mockReset();
  });

  it('bellek boş (yeniden başlatma) + DB\'de çıkış kaydı → ret; jti belleğe alınır, ikinci istekte DB\'ye gidilmez', async () => {
    findFirst.mockResolvedValue({ id: 'log-1' });
    const payload = { jti: 'jti-restart', iat: nowSec() - 60, exp: nowSec() + 3000 };

    expect(await resolvePlatformSession(payload)).toEqual({ ok: false, reason: 'LOGOUT_RECORDED' });
    expect(findFirst).toHaveBeenCalledTimes(1);
    const where = findFirst.mock.calls[0]![0].where;
    expect(where.category).toBe(PLATFORM_LOGOUT_CATEGORY);
    expect(where.message).toBe(PLATFORM_LOGOUT_MESSAGE);
    expect(where.meta).toEqual({ path: ['jti'], equals: 'jti-restart' });
    // Alt sınır anahtarın verildiği andan önce (saat farkı payı) — kayıt aralık dışında kalmaz.
    expect(where.createdAt.gte.getTime()).toBeLessThanOrEqual(payload.iat * 1000);

    expect(isAccessTokenRevoked('jti-restart')).toBe(true);
    expect(await resolvePlatformSession(payload)).toEqual({ ok: false, reason: 'REVOKED_IN_MEMORY' });
    expect(findFirst).toHaveBeenCalledTimes(1);
  });

  it('DB\'de kayıt yok → kabul', async () => {
    findFirst.mockResolvedValue(null);
    expect(await resolvePlatformSession({ jti: 'jti-open', iat: nowSec(), exp: nowSec() + 3600 })).toEqual({ ok: true });
  });

  it('jti\'siz anahtar → DB\'ye gidilmez, kabul (yalnız bellek)', async () => {
    expect(await resolvePlatformSession({ iat: nowSec(), exp: nowSec() + 3600 })).toEqual({ ok: true });
    expect(findFirst).not.toHaveBeenCalled();
  });

  it('bellekte iptal edilmiş anahtar → DB\'ye gidilmez, ret', async () => {
    revokeAccessToken('jti-mem', nowSec() + 3600);
    expect(await resolvePlatformSession({ jti: 'jti-mem', iat: nowSec(), exp: nowSec() + 3600 }))
      .toEqual({ ok: false, reason: 'REVOKED_IN_MEMORY' });
    expect(findFirst).not.toHaveBeenCalled();
  });

  it('DB hatası yukarı fırlar (kapalı başarısızlık — istek kabul edilmez)', async () => {
    findFirst.mockRejectedValue(new Error('db down'));
    await expect(resolvePlatformSession({ jti: 'jti-x', iat: nowSec(), exp: nowSec() + 3600 })).rejects.toThrow('db down');
  });

  it('recordPlatformLogout: belleğe + SystemLog\'a jti/exp ile yazar (kişisel veri yok)', async () => {
    create.mockResolvedValue({});
    const exp = nowSec() + 3600;
    await recordPlatformLogout('jti-out', exp);
    expect(isAccessTokenRevoked('jti-out')).toBe(true);
    expect(create).toHaveBeenCalledWith({
      data: { level: 'INFO', category: PLATFORM_LOGOUT_CATEGORY, message: PLATFORM_LOGOUT_MESSAGE, meta: { jti: 'jti-out', exp } },
    });
  });
});
