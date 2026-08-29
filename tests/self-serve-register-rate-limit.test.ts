/**
 * G1-26 — Self-serve kurum başvurusu spam rate-limit testi.
 *
 * POST /api/tenants/self-serve/register IP-bazlı selfServeRegisterRateLimiter ile korunuyor.
 * Limit içindeki denemeler meşru akışı bozmaz; limiti aşan deneme 429 alır.
 * (Limiter controller'dan ÖNCE çalışır → geçersiz gövde bile sayacı artırır, DB'ye yazılmaz.)
 */

import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { agent, type TestAgent } from './helpers/request.js';
import { resetRateLimiters } from '../src/middleware/rateLimiter.js';

describe('Self-serve register rate limit — IP-bazlı spam koruması', () => {
  let http: TestAgent;
  const original = process.env['SELF_SERVE_REGISTER_RATE_RPM'];

  beforeEach(() => {
    resetRateLimiters();
    process.env['SELF_SERVE_REGISTER_RATE_RPM'] = '3';
    http = agent();
  });

  afterAll(() => {
    process.env['SELF_SERVE_REGISTER_RATE_RPM'] = original;
  });

  it('limit içindeki denemeler 429 DEĞİL; limiti aşan deneme 429', async () => {
    const body = { email: 'not-an-email' }; // 400 VALIDATION — DB'ye yazmaz, limiter sayar

    for (let i = 0; i < 3; i++) {
      const res = await http.post('/api/tenants/self-serve/register').send(body);
      expect(res.status).not.toBe(429);
    }

    const blocked = await http.post('/api/tenants/self-serve/register').send(body);
    expect(blocked.status).toBe(429);
    expect(blocked.body.error).toBe('RATE_LIMIT');
  });
});
