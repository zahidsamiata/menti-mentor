/**
 * Kayıt (register) spam rate-limit testi.
 *
 * POST /api/auth/register IP-bazlı registerRateLimiter ile korunuyor (generalRateLimiter'a
 * ek). Limit içindeki denemeler meşru akışı bozmaz; limiti aşan deneme 429 alır.
 */

import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { agent, type TestAgent } from './helpers/request.js';
import { resetRateLimiters } from '../src/middleware/rateLimiter.js';

describe('Register rate limit — IP-bazlı spam koruması', () => {
  let http: TestAgent;
  // .env.test'te REGISTER_RATE_RPM=1000 (suite'in meşru register'larını bozmasın).
  // Burada eşiği düşürüp sayaçları sıfırlayarak deterministik test yapıyoruz.
  const originalRpm = process.env['REGISTER_RATE_RPM'];

  beforeEach(() => {
    resetRateLimiters();
    process.env['REGISTER_RATE_RPM'] = '3';
    http = agent();
  });

  afterAll(() => {
    process.env['REGISTER_RATE_RPM'] = originalRpm;
  });

  it('limit içindeki denemeler 429 DEĞİL; limiti aşan deneme 429', async () => {
    // Geçersiz gövde → 400 VALIDATION (limiter controller'dan ÖNCE çalışır, sayacı artırır).
    const body = { email: 'not-an-email' };

    for (let i = 0; i < 3; i++) {
      const res = await http.post('/api/auth/register').send(body);
      expect(res.status).not.toBe(429);
    }

    const blocked = await http.post('/api/auth/register').send(body);
    expect(blocked.status).toBe(429);
    expect(blocked.body.error).toBe('RATE_LIMIT');
  });
});
