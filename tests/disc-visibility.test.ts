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
import { cleanDb, testPrisma } from './helpers/db.js';
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

  // ─── AJ-21: discResultCard içinde ham psikometri (discVector + rawScores) ────────────
  // Eski onboarding kayıtları karta ham vektör/puan gömüyordu; peer bakışında sızmamalı,
  // kişinin kendi bakışı ve ADMIN (fullAccess) davranışı korunmalı.

  const LEGACY_CARD = {
    archetype: 'Lider', icon: 'x', superPower: 'Karar', description: 'd',
    strengths: ['a'], growthArea: 'g', compatibleWith: ['S'], dominant: 'D',
    completedAt: '2026-09-01T00:00:00.000Z',
    discVector: { D: 0.7, I: 0.1, S: 0.1, C: 0.1, confidence: 0.8 },
    rawScores:  { D: 5, I: 1, S: 1, C: 1 },
  };

  it('AJ-21: mentör menti detayında discResultCard ham discVector/rawScores TAŞIMAZ (kart alanları var)', async () => {
    const mentor = await createMentor(tenant.id);
    const menti  = await createMenti(tenant.id, { discType: 'D' });
    await testPrisma.user.update({ where: { id: menti.id }, data: { discResultCard: LEGACY_CARD } });
    const tokens = await loginAs(http, mentor.email, mentor.rawPassword);

    const res = await http
      .get(`/api/users/${menti.id}`)
      .set(tenantHeaders(tenant.id, tokens.accessToken))
      .expect(200);

    const card = (res.body as { discResultCard: Record<string, unknown> }).discResultCard;
    expect(card).toMatchObject({ archetype: 'Lider', dominant: 'D' });
    expect(card).not.toHaveProperty('discVector');
    expect(card).not.toHaveProperty('rawScores');
    expect(res.body).not.toHaveProperty('discVector');
  });

  it('AJ-21: kişi KENDİ profilinde (fullAccess) kartı saklandığı gibi alır', async () => {
    const menti = await createMenti(tenant.id, { discType: 'D' });
    await testPrisma.user.update({ where: { id: menti.id }, data: { discResultCard: LEGACY_CARD } });
    const tokens = await loginAs(http, menti.email, menti.rawPassword);

    const res = await http
      .get(`/api/users/${menti.id}`)
      .set(tenantHeaders(tenant.id, tokens.accessToken))
      .expect(200);

    expect((res.body as { discResultCard: unknown }).discResultCard).toEqual(LEGACY_CARD);
  });

  it('AJ-21: onboarding DISC gönderimi karta ham vektör/puan GÖMMEZ; self yanıtı vektörü taşır', async () => {
    const menti  = await createMenti(tenant.id);
    const tokens = await loginAs(http, menti.email, menti.rawPassword);
    const answers = [1, 2, 3, 4, 5, 6].map((id) => ({ questionId: id, selectedOption: 'A' }));

    const res = await http
      .post('/api/users/disc/submit')
      .set(tenantHeaders(tenant.id, tokens.accessToken))
      .send({ answers })
      .expect(200);

    // Kendi sonuç ekranı ("Uyum %") için self yanıtı korunur.
    expect((res.body as { resultCard: Record<string, unknown> }).resultCard).toHaveProperty('discVector');

    const stored = await testPrisma.user.findUnique({
      where: { id: menti.id }, select: { discResultCard: true, discVector: true },
    });
    const storedCard = stored!.discResultCard as Record<string, unknown>;
    expect(storedCard).toHaveProperty('archetype');
    expect(storedCard).not.toHaveProperty('discVector');
    expect(storedCard).not.toHaveProperty('rawScores');
    expect(stored!.discVector).not.toBeNull(); // ham vektörün tek kaynağı User.discVector
  });
});
