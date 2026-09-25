/**
 * GV-21 — `/api/auth/:provider` catch-all rotası: yalnız kayıtlı OAuth sağlayıcılarını kabul
 * eder ve kendinden önce tanımlı uçları gölgelemez.
 */
import { describe, it, expect } from 'vitest';
import { agent } from './helpers/request.js';

describe('GV-21: /api/auth rota sırası', () => {
  it('/api/auth/me OAuth rotasına düşmez (kimliksiz istek 401/400 alır, PROVIDER_BULUNAMADI değil)', async () => {
    const res = await agent().get('/api/auth/me');
    expect(res.status).not.toBe(404);
    expect(res.body.error).not.toBe('PROVIDER_BULUNAMADI');
  });

  it('negatif: kayıtlı olmayan ad OAuth başlatmaz → 404 PROVIDER_BULUNAMADI', async () => {
    for (const name of ['bilinmeyen', 'constructor', 'toString', '__proto__']) {
      const res = await agent().get(`/api/auth/${name}`);
      expect(res.status, name).toBe(404);
      expect(res.body.error, name).toBe('PROVIDER_BULUNAMADI');
    }
  });

  it('negatif: kayıtlı olmayan adın callback yolu hata ile girişe yönlendirir', async () => {
    const res = await agent().get('/api/auth/constructor/callback');
    expect(res.status).toBe(302);
    expect(res.headers['location']).toContain('PROVIDER_BULUNAMADI');
  });
});
