/**
 * DISC görünürlük güvenlik testi (KARAR 5 — regresyon guard'ı).
 *
 * Açık: bir MENTİ, listelenen/önerilen MENTÖRÜN DISC tipini (harf) + arketip kartını görüyordu.
 * Bu, "menti mentörün DISC tipini GÖRMEZ — sadece uyum skoru" kuralına (KARAR 5) aykırı bir
 * PII/mahremiyet sızıntısıydı. Bu testler, kapatmanın BACKEND'de (response'ta alan hiç yok)
 * olduğunu ve mentör/admin yönlerinin bozulmadığını kanıtlar; açığın geri gelmesini önler.
 *
 * Kapsanan yollar:
 *   - GET /api/users (listUsers, peer havuzu)
 *   - GET /api/users/:id (getUser, public detay)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { agent, loginAs, tenantHeaders, type TestAgent } from './helpers/request.js';
import { cleanDb } from './helpers/db.js';
import { createTenant, createMentor, createMenti, createAdminUser } from './helpers/factories.js';
import type { Tenant } from '@prisma/client';

describe('DISC görünürlük — menti mentörün DISC tipini görmez (KARAR 5)', () => {
  let http: TestAgent;
  let tenant: Tenant;

  beforeEach(async () => {
    await cleanDb();
    http = agent();
    tenant = await createTenant();
  });

  // ─── listUsers (GET /api/users) ─────────────────────────────────────────────

  it('menti mentör listesi çektiğinde response item\'larında discType YOK', async () => {
    const menti  = await createMenti(tenant.id);                 // bakan: menti (APPROVED)
    const mentor = await createMentor(tenant.id, { discType: 'C' });
    const tokens = await loginAs(http, menti.email, menti.rawPassword);

    const res = await http
      .get('/api/users?role=MENTOR&isActive=true&pageSize=100')
      .set(tenantHeaders(tenant.id, tokens.accessToken))
      .expect(200);

    const item = (res.body as { items: Array<Record<string, unknown>> }).items
      .find((u) => u['id'] === mentor.id);
    expect(item).toBeDefined();
    expect(item).not.toHaveProperty('discType');       // alan hiç dönmemeli (sadece skor kalır)
  });

  it('mentör menti listesi çektiğinde response item\'larında discType VAR', async () => {
    const mentor = await createMentor(tenant.id);               // bakan: mentör (APPROVED)
    const menti  = await createMenti(tenant.id, { discType: 'D' });
    const tokens = await loginAs(http, mentor.email, mentor.rawPassword);

    const res = await http
      .get('/api/users?role=MENTI&isActive=true&pageSize=100')
      .set(tenantHeaders(tenant.id, tokens.accessToken))
      .expect(200);

    const item = (res.body as { items: Array<Record<string, unknown>> }).items
      .find((u) => u['id'] === menti.id);
    expect(item).toBeDefined();
    expect(item).toHaveProperty('discType', 'D');      // mentör adayının tipini görebilir
  });

  it('admin mentör listesi çektiğinde discType VAR (admin hepsini görür)', async () => {
    const admin  = await createAdminUser(tenant.id);
    const mentor = await createMentor(tenant.id, { discType: 'C' });
    const tokens = await loginAs(http, admin.email, admin.rawPassword);

    const res = await http
      .get('/api/users?role=MENTOR&isActive=true&pageSize=100')
      .set(tenantHeaders(tenant.id, tokens.accessToken))
      .expect(200);

    const item = (res.body as { items: Array<Record<string, unknown>> }).items
      .find((u) => u['id'] === mentor.id);
    expect(item).toBeDefined();
    expect(item).toHaveProperty('discType', 'C');
  });

  // ─── getUser (GET /api/users/:id) ───────────────────────────────────────────

  it('menti mentör detayı çektiğinde discType + discResultCard YOK', async () => {
    const menti  = await createMenti(tenant.id);
    const mentor = await createMentor(tenant.id, { discType: 'C' });
    const tokens = await loginAs(http, menti.email, menti.rawPassword);

    const res = await http
      .get(`/api/users/${mentor.id}`)
      .set(tenantHeaders(tenant.id, tokens.accessToken))
      .expect(200);

    expect(res.body).not.toHaveProperty('discType');
    expect(res.body).not.toHaveProperty('discResultCard');
  });

  it('mentör menti detayı çektiğinde discType VAR', async () => {
    const mentor = await createMentor(tenant.id);
    const menti  = await createMenti(tenant.id, { discType: 'D' });
    const tokens = await loginAs(http, mentor.email, mentor.rawPassword);

    const res = await http
      .get(`/api/users/${menti.id}`)
      .set(tenantHeaders(tenant.id, tokens.accessToken))
      .expect(200);

    expect(res.body).toHaveProperty('discType', 'D');
  });
});
