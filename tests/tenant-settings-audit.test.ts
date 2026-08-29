/**
 * G1-14/G1-15 — Program ayarı değişikliğinin denetim izi (SystemLog).
 *
 * PATCH /api/tenants/:id/settings artık SystemLog'a AUDIT kaydı yazıyor: kim (actorId),
 * hangi kurum (tenantId), hangi alanlar (changedFields — DEĞERLER değil). PII loglanmaz.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { cleanDb, testPrisma } from './helpers/db.js';
import { createTenant, createUser } from './helpers/factories.js';
import { agent, loginAs, tenantHeaders, type TestAgent } from './helpers/request.js';

// logger.info fire-and-forget (void) → yanıt döndükten sonra SystemLog yazımı tamamlanabilir.
async function waitForAuditLog(message: string, tries = 30): Promise<Record<string, unknown> | null> {
  for (let i = 0; i < tries; i++) {
    const log = await testPrisma.systemLog.findFirst({
      where: { category: 'AUDIT', message },
      orderBy: { createdAt: 'desc' },
    });
    if (log) return log as unknown as Record<string, unknown>;
    await new Promise((r) => setTimeout(r, 50));
  }
  return null;
}

describe('G1-14/15 — Tenant ayar değişikliği denetim izi', () => {
  let http: TestAgent;
  let tenantId: string;
  let adminId: string;
  let adminEmail: string;
  let token: string;

  beforeEach(async () => {
    await cleanDb();
    http = agent();
    const tenant = await createTenant();
    tenantId = tenant.id;
    const admin = await createUser({ tenantId, role: 'ADMIN' });
    adminId = admin.id;
    adminEmail = admin.email;
    ({ accessToken: token } = await loginAs(http, admin.email, admin.rawPassword));
  });

  it('ayar güncelleme SystemLog AUDIT kaydı üretir; PII yok', async () => {
    await http
      .patch(`/api/tenants/${tenantId}/settings`)
      .set(tenantHeaders(tenantId, token))
      .send({ maxMeetingsPerWeek: 3 })
      .expect(200);

    const log = await waitForAuditLog('Tenant program ayarları güncellendi');
    expect(log).not.toBeNull();
    const meta = log!['meta'] as Record<string, unknown>;
    expect(meta['actorId']).toBe(adminId);
    expect(meta['tenantId']).toBe(tenantId);
    expect(meta['changedFields']).toContain('maxMeetingsPerWeek');

    // PII sızmamalı: log'da admin e-postası / değer YOK
    expect(JSON.stringify(log)).not.toContain(adminEmail);
  });
});
