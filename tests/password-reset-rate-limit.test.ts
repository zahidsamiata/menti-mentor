/**
 * Şifre sıfırlama rate limit testi.
 *
 * POST /api/auth/forgot-password + /reset-password IP-bazlı passwordResetRateLimiter ile
 * korunuyor (generalRateLimiter'a ek). Limit içindeki denemeler meşru akışı bozmaz; aşan 429.
 */

import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { agent, type TestAgent } from './helpers/request.js';
import { cleanDb } from './helpers/db.js';
import { resetRateLimiters } from '../src/middleware/rateLimiter.js';

describe('Password reset rate limit — IP-bazlı brute-force/mail-DoS koruması', () => {
  let http: TestAgent;
  const originalRpm = process.env['PASSWORD_RESET_RATE_RPM'];

  beforeEach(async () => {
    await cleanDb();
    resetRateLimiters();
    process.env['PASSWORD_RESET_RATE_RPM'] = '3';
    http = agent();
  });

  afterAll(() => {
    process.env['PASSWORD_RESET_RATE_RPM'] = originalRpm;
  });

  it('limit içindeki denemeler 429 DEĞİL; limiti aşan deneme 429', async () => {
    // forgot-password bilinmeyen e-postada da 200 (kullanıcı tespiti engelleme) döner.
    const body = { email: 'nobody@test.local' };

    for (let i = 0; i < 3; i++) {
      const res = await http.post('/api/auth/forgot-password').send(body);
      expect(res.status).not.toBe(429);
    }

    const blocked = await http.post('/api/auth/forgot-password').send(body);
    expect(blocked.status).toBe(429);
    expect(blocked.body.error).toBe('RATE_LIMIT');
  });
});
