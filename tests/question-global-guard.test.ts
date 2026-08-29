/**
 * 3b-2 / Y6 — Global soru yaratımı guard'ı.
 *
 * Açık (yetki haritası 2026-08-29): POST /api/questions, `tenantScoped:false` ile tenant admininin
 * GLOBAL soru (tenantId:null) yaratmasına izin veriyordu → bir kurumun admini TÜM kurumların
 * havuzuna içerik enjekte edebilirdi. Fix: bu uçtan yaratılan her soru DAİMA istek tenant'ına sınırlı.
 *
 * İddia: tenantScoped:false gönderilse bile soru tenant'a bağlanır (tenantId null OLMAZ).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { cleanDb, testPrisma } from './helpers/db.js';
import { createTenant, createUser } from './helpers/factories.js';
import { agent, loginAs, tenantHeaders, type TestAgent } from './helpers/request.js';

describe('Y6 — POST /api/questions global guard', () => {
  let http: TestAgent;
  let tenantId: string;
  let adminToken: string;

  beforeEach(async () => {
    await cleanDb();
    http = agent();
    const tenant = await createTenant();
    tenantId = tenant.id;
    const admin = await createUser({ tenantId, role: 'ADMIN' });
    ({ accessToken: adminToken } = await loginAs(http, admin.email, admin.rawPassword));
  });

  it('tenantScoped:false gönderilse bile soru TENANT\'a bağlanır (global olmaz)', async () => {
    const res = await http
      .post('/api/questions')
      .set(tenantHeaders(tenantId, adminToken))
      .send({ text: 'STK özel soru metni yeterince uzun', category: 'STK_CUSTOM', tenantScoped: false });
    expect(res.status).toBe(201);
    expect(res.body.tenantId).toBe(tenantId); // null DEĞİL

    // DB'de global (tenantId:null) soru oluşmadığını doğrula
    const globalCount = await testPrisma.question.count({ where: { tenantId: null } });
    expect(globalCount).toBe(0);
  });

  it('tenantScoped:true de tenant\'a bağlanır → 201', async () => {
    const res = await http
      .post('/api/questions')
      .set(tenantHeaders(tenantId, adminToken))
      .send({ text: 'Bir diğer STK özel soru metni', category: 'STK_CUSTOM', tenantScoped: true });
    expect(res.status).toBe(201);
    expect(res.body.tenantId).toBe(tenantId);
  });
});
