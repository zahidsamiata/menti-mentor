/**
 * V-10 — GET /api/users/:id/export rate limit testi.
 *
 * Hata: ağır KVKK export'unun ikizi /me/data-export dataExportRateLimiter ile 5/dk
 * korunuyordu ama /users/:id/export korumasızdı → kendi ID'sini :id'ye yazan kullanıcı
 * limiti atlatıp export'u sınırsız tetikleyebiliyordu. Düzeltme: aynı limiter route'a eklendi.
 */

import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { cleanDb } from './helpers/db.js';
import { createTenant, createUser } from './helpers/factories.js';
import { agent, loginAs, tenantHeaders, type TestAgent } from './helpers/request.js';
import { resetRateLimiters } from '../src/middleware/rateLimiter.js';

describe('GET /api/users/:id/export — kullanıcı başına rate limit (V-10)', () => {
  let http: TestAgent;
  let tenantId: string;
  let userId: string;
  let token: string;
  const originalRpm = process.env['DATA_EXPORT_RATE_RPM'];

  beforeEach(async () => {
    await cleanDb();
    resetRateLimiters();
    process.env['DATA_EXPORT_RATE_RPM'] = '3';
    http = agent();
    const tenant = await createTenant();
    tenantId = tenant.id;
    const u = await createUser({ tenantId, role: 'MENTOR' });
    userId = u.id;
    ({ accessToken: token } = await loginAs(http, u.email, u.rawPassword));
  });

  afterAll(() => {
    process.env['DATA_EXPORT_RATE_RPM'] = originalRpm;
  });

  it('limit içindeki kendi export istekleri 429 DEĞİL; limiti aşan istek 429', async () => {
    for (let i = 0; i < 3; i++) {
      const res = await http
        .get(`/api/users/${userId}/export`)
        .set(tenantHeaders(tenantId, token));
      expect(res.status).not.toBe(429);
    }

    const blocked = await http
      .get(`/api/users/${userId}/export`)
      .set(tenantHeaders(tenantId, token));
    expect(blocked.status).toBe(429);
    expect(blocked.body.error).toBe('RATE_LIMIT');
  });
});
