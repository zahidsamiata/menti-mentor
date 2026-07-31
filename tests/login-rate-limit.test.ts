/**
 * İŞ B — Login brute-force rate limit testi.
 *
 * POST /api/auth/login IP-bazlı loginRateLimiter ile korunuyor (generalRateLimiter'a
 * ek). Limit içindeki denemeler meşru akışı bozmaz; limiti aşan deneme 429 alır.
 */

import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { agent, type TestAgent } from './helpers/request.js';
import { cleanDb } from './helpers/db.js';
import { resetRateLimiters } from '../src/middleware/rateLimiter.js';

describe('Login rate limit — IP-bazlı brute-force koruması', () => {
  let http: TestAgent;
  // .env.test'te LOGIN_RATE_RPM=1000 (suite'in meşru login'lerini bozmasın).
  // Burada eşiği düşürüp sayaçları sıfırlayarak deterministik test yapıyoruz.
  const originalRpm = process.env['LOGIN_RATE_RPM'];

  beforeEach(async () => {
    await cleanDb();
    resetRateLimiters();
    process.env['LOGIN_RATE_RPM'] = '3';
    http = agent();
  });

  afterAll(() => {
    process.env['LOGIN_RATE_RPM'] = originalRpm;
  });

  it('limit içindeki denemeler 429 DEĞİL; limiti aşan deneme 429', async () => {
    const creds = { email: 'nobody@test.local', password: 'wrong-password' };

    // İlk 3 deneme limit içinde: geçersiz kimlik → 401, ama 429 DEĞİL (meşru akış korunur)
    for (let i = 0; i < 3; i++) {
      const res = await http.post('/api/auth/login').send(creds);
      expect(res.status).not.toBe(429);
    }

    // 4. deneme limiti aşar → 429
    const blocked = await http.post('/api/auth/login').send(creds);
    expect(blocked.status).toBe(429);
    expect(blocked.body.error).toBe('RATE_LIMIT');
  });
});
