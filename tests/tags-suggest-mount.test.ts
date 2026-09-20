/**
 * V-13 — POST /api/tags/suggest doğru mount testi.
 *
 * Hata: uç server.ts'te requireTenant/requireAuth OLMADAN mount edilmişti; controller
 * req.tenant + req.auth beklediği için her istek fail-closed 401 dönüyordu (ölü uç).
 * Düzeltme: mount'a requireTenant + requireAuth eklendi → kimlikli kullanıcı etiket önerebiliyor.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { agent, loginAs, tenantHeaders, type TestAgent } from './helpers/request.js';
import { cleanDb, testPrisma } from './helpers/db.js';
import { createTenant, createUser } from './helpers/factories.js';

describe('POST /api/tags/suggest — mount (V-13)', () => {
  let http: TestAgent;
  let tenantId: string;
  let token: string;

  beforeEach(async () => {
    await cleanDb();
    http = agent();
    const tenant = await createTenant();
    tenantId = tenant.id;
    const u = await createUser({ tenantId, role: 'MENTI' });
    ({ accessToken: token } = await loginAs(http, u.email, u.rawPassword));
  });

  it('kimlikli kullanıcı etiket önerebiliyor → 201 + PendingTag oluşur', async () => {
    const res = await http
      .post('/api/tags/suggest')
      .set(tenantHeaders(tenantId, token))
      .send({ value: 'yapay zeka' });

    expect(res.status).toBe(201);
    expect(res.body.tag.value).toBe('yapay zeka');

    const row = await testPrisma.pendingTag.findFirst({ where: { tenantId, value: 'yapay zeka' } });
    expect(row).not.toBeNull();
  });

  it('kimlik doğrulaması olmadan 401 (fail-closed korunur)', async () => {
    const res = await http
      .post('/api/tags/suggest')
      .set('X-Tenant-Id', tenantId)
      .send({ value: 'test etiket' });

    expect(res.status).toBe(401);
  });
});
