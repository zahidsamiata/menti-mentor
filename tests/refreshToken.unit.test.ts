/**
 * GV-13 — refresh token saklama kuralı (DB'siz birim testi).
 * Özet biçimi + eski açık-metin kayıtlar için geçiş araması.
 */
import crypto from 'node:crypto';
import { describe, it, expect } from 'vitest';
import { hashRefreshToken, refreshTokenLookupKeys, refreshTokenWhere } from '../src/services/refreshToken.js';

const legacyRaw = () => crypto.randomBytes(64).toString('hex'); // üretim biçimi: 128 hex

describe('refreshToken servis (GV-13)', () => {
  it('hashRefreshToken: SHA-256 hex (64 karakter), ham değerden farklı ve deterministik', () => {
    const raw = legacyRaw();
    const h = hashRefreshToken(raw);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(h).not.toBe(raw);
    expect(hashRefreshToken(raw)).toBe(h);
    expect(h).toBe(crypto.createHash('sha256').update(raw).digest('hex'));
  });

  it('lookup: önce özet, sonra (geçiş) üretim biçimindeki ham değer', () => {
    const raw = legacyRaw();
    expect(refreshTokenLookupKeys(raw)).toEqual([hashRefreshToken(raw), raw]);
    expect(refreshTokenWhere(raw)).toEqual({ token: { in: [hashRefreshToken(raw), raw] } });
  });

  it('lookup: üretim biçiminde olmayan değer için ham-değer anahtarı eklenmez (yalnız özet)', () => {
    const storedHash = hashRefreshToken(legacyRaw()); // 64 hex — sütunda duran özet biçimi
    expect(refreshTokenLookupKeys(storedHash)).toEqual([hashRefreshToken(storedHash)]);
    expect(refreshTokenLookupKeys('kisa-deger')).toEqual([hashRefreshToken('kisa-deger')]);
    const upper = legacyRaw().toUpperCase(); // 128 karakter ama küçük-harf hex değil
    expect(refreshTokenLookupKeys(upper)).toEqual([hashRefreshToken(upper)]);
  });
});
