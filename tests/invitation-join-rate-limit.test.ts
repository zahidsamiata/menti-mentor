/**
 * Davet-join token deneme rate-limit testi.
 *
 * GET /api/invitations/:token/join IP-bazlı invitationJoinRateLimiter ile korunuyor.
 * Token imzalı JWT olduğundan brute-force zaten infeasible; bu limit token-deneme + DoS
 * azaltmadır. Limit içindeki denemeler meşru akışı (401 geçersiz token) bozmaz; limiti
 * aşan deneme 429 alır.
 */

import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { agent, type TestAgent } from './helpers/request.js';
import { resetRateLimiters } from '../src/middleware/rateLimiter.js';

describe('Invitation-join rate limit — IP-bazlı token deneme koruması', () => {
  let http: TestAgent;
  // .env.test'te INVITE_JOIN_RATE_RPM=1000 (suite'i bozmasın). Burada eşik düşürülür.
  const originalRpm = process.env['INVITE_JOIN_RATE_RPM'];

  beforeEach(() => {
    resetRateLimiters();
    process.env['INVITE_JOIN_RATE_RPM'] = '3';
    http = agent();
  });

  afterAll(() => {
    process.env['INVITE_JOIN_RATE_RPM'] = originalRpm;
  });

  it('limit içindeki denemeler 429 DEĞİL (geçersiz token → 401); limiti aşan deneme 429', async () => {
    // Geçersiz token → 401 (limiter controller'dan ÖNCE çalışır, sayacı artırır).
    const path = '/api/invitations/gecersiz-token/join';

    for (let i = 0; i < 3; i++) {
      const res = await http.get(path);
      expect(res.status).not.toBe(429);
    }

    const blocked = await http.get(path);
    expect(blocked.status).toBe(429);
    expect(blocked.body.error).toBe('RATE_LIMIT');
  });
});
