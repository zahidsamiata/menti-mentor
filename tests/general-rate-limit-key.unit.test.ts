/**
 * K-14 — genel istek sınırının kovası istemci başlığından seçilmez.
 * Saf birim testi: generalRateLimitKey yalnız imzası doğrulanmış anahtardan ya da IP'den türetilir.
 */
import { describe, it, expect } from 'vitest';
import type { Request } from 'express';
import { generalRateLimitKey } from '../src/middleware/rateLimiter.js';
import { signToken } from '../src/middleware/jwtAuth.js';

function fakeReq(headers: Record<string, string>, ip = '203.0.113.7'): Request {
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return { ip, socket: { remoteAddress: ip }, header: (name: string) => lower[name.toLowerCase()] } as unknown as Request;
}

describe('K-14: generalRateLimitKey', () => {
  const tokA = signToken({ sub: 'user-a', tenantId: 't1', role: 'MENTI', fullName: 'A' });
  const tokB = signToken({ sub: 'user-b', tenantId: 't1', role: 'MENTI', fullName: 'B' });

  it('kimliği doğrulanmış istek kullanıcı başına kovaya düşer; kurum başlığı kovayı değiştirmez', () => {
    const k1 = generalRateLimitKey(fakeReq({ Authorization: `Bearer ${tokA}`, 'X-Tenant-Id': 't1' }));
    const k2 = generalRateLimitKey(fakeReq({ Authorization: `Bearer ${tokA}`, 'X-Tenant-Id': 'rastgele-123' }));
    expect(k1).toBe('general:user:user-a');
    expect(k2).toBe(k1);
  });

  it('negatif: aynı kurumdaki iki kullanıcı aynı kovayı paylaşmaz (biri diğerini kilitleyemez)', () => {
    const kA = generalRateLimitKey(fakeReq({ Authorization: `Bearer ${tokA}`, 'X-Tenant-Id': 't1' }));
    const kB = generalRateLimitKey(fakeReq({ Authorization: `Bearer ${tokB}`, 'X-Tenant-Id': 't1' }));
    expect(kA).not.toBe(kB);
  });

  it('negatif: kimliksiz istekte kurum başlığını değiştirmek yeni kova açmaz (IP kovası)', () => {
    const k1 = generalRateLimitKey(fakeReq({ 'X-Tenant-Id': 'a' }));
    const k2 = generalRateLimitKey(fakeReq({ 'X-Tenant-Id': 'b' }));
    const k3 = generalRateLimitKey(fakeReq({}));
    expect(k1).toBe('general:ip:203.0.113.7');
    expect(k2).toBe(k1);
    expect(k3).toBe(k1);
  });

  it('negatif: imzası geçersiz anahtar kullanıcı kovası açmaz, IP kovasına düşer', () => {
    const k = generalRateLimitKey(fakeReq({ Authorization: 'Bearer sahte.anahtar.degeri' }));
    expect(k).toBe('general:ip:203.0.113.7');
  });
});
