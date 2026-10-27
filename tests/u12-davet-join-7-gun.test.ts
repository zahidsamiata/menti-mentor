/**
 * U-12 (KARAR-82 A) — davet katılım ucu 7 günlük sınırı uygular (7b notu: selfServeController'daki
 * ayrı doğrulayıcı kopyası birim testte ölçülmüyordu).
 * Ölçüt: 30 günlük `exp` taşıyan ama 8 günlük davetle GET /api/invitations/:token/join → 401.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import jwt from 'jsonwebtoken';
import { agent, type TestAgent } from './helpers/request.js';
import { cleanDb } from './helpers/db.js';
import { createTenant } from './helpers/factories.js';
import { config } from '../src/config.js';
import { resetRateLimiters } from '../src/middleware/rateLimiter.js';

const DAY = 24 * 60 * 60;

function inviteAged(tenantId: string, ageSeconds: number): string {
  const iat = Math.floor(Date.now() / 1000) - ageSeconds;
  return jwt.sign(
    { tenantId, role: 'MENTI', type: 'invitation', typ: 'invitation', iat, exp: iat + 30 * DAY },
    config.jwt.secret,
  );
}

describe('U-12: davet katılım ucu 7 gün', () => {
  let http: TestAgent;
  let tenantId: string;

  beforeEach(async () => {
    await cleanDb();
    resetRateLimiters();
    http = agent();
    tenantId = (await createTenant()).id;
  });

  it('6 günlük davet kabul edilir (401 değil)', async () => {
    const res = await http.get(`/api/invitations/${inviteAged(tenantId, 6 * DAY)}/join`);
    expect(res.status).not.toBe(401);
  });

  it('NEGATİF: 8 günlük davet — exp dolmamış olsa da — 401 TOKEN_GECERSIZ', async () => {
    const res = await http.get(`/api/invitations/${inviteAged(tenantId, 8 * DAY)}/join`);
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('TOKEN_GECERSIZ');
  });
});
