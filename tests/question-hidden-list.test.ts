/**
 * E-3b — Gizlenen global soruları listeleme + geri açma.
 *
 * Neden: GET /api/questions gizlenenleri listeden çıkarır; yönetici bir soruyu gizleyince onu
 * ekranda göremiyor, dolayısıyla geri açamıyordu. GET /api/questions/hidden bu boşluğu kapatır.
 *
 * İddialar:
 *   - ADMIN kendi kurumunun gizlediği soruları görür; gizlenmemişler listede yok.
 *   - ADMIN olmayan (MENTOR/MENTI) 403 alır.
 *   - Başka kurumun gizleme kaydı listede GÖRÜNMEZ ve başka kurum onu geri AÇAMAZ.
 *   - Geri açılan soru gizlenenlerden çıkar, gizleme kaydı silinir.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { Question, Tenant } from '@prisma/client';
import { cleanDb, testPrisma } from './helpers/db.js';
import { createTenant, createAdminUser, createMentor, createMenti } from './helpers/factories.js';
import { agent, loginAs, tenantHeaders, type TestAgent } from './helpers/request.js';

async function createGlobalStkQuestion(label: string): Promise<Question> {
  return testPrisma.question.create({
    data: {
      text: `E-3b global STK sorusu — ${label} (${Date.now()}-${Math.random()})`,
      type: 'CORE',
      discDimension: 'GENERAL',
      category: 'STK_CUSTOM',
      tenantId: null,
      order: 1,
    },
  });
}

describe('E-3b — GET /api/questions/hidden', () => {
  let http: TestAgent;
  let tenantA: Tenant;
  let tenantB: Tenant;
  let adminAToken: string;
  let adminBToken: string;

  beforeEach(async () => {
    await cleanDb();
    http = agent();
    tenantA = await createTenant();
    tenantB = await createTenant();
    const adminA = await createAdminUser(tenantA.id);
    const adminB = await createAdminUser(tenantB.id);
    ({ accessToken: adminAToken } = await loginAs(http, adminA.email, adminA.rawPassword));
    ({ accessToken: adminBToken } = await loginAs(http, adminB.email, adminB.rawPassword));
  });

  it('ADMIN kendi kurumunun gizlediği soruyu listede görür, gizlenmemiş olan listede yok', async () => {
    const hiddenQ  = await createGlobalStkQuestion('gizlenen');
    const visibleQ = await createGlobalStkQuestion('görünen');

    await http
      .post(`/api/questions/${hiddenQ.id}/hide`)
      .set(tenantHeaders(tenantA.id, adminAToken))
      .expect(201);

    const res = await http
      .get('/api/questions/hidden')
      .set(tenantHeaders(tenantA.id, adminAToken))
      .expect(200);

    const ids = (res.body.items as Array<{ id: string }>).map((q) => q.id);
    expect(ids).toContain(hiddenQ.id);
    expect(ids).not.toContain(visibleQ.id);
    expect(res.body.items[0]).toHaveProperty('text');
    expect(res.body.items[0]).toHaveProperty('hiddenAt');
  });

  it('MENTOR 403 alır (negatif)', async () => {
    const mentor = await createMentor(tenantA.id);
    const { accessToken } = await loginAs(http, mentor.email, mentor.rawPassword);
    await http
      .get('/api/questions/hidden')
      .set(tenantHeaders(tenantA.id, accessToken))
      .expect(403);
  });

  it('MENTI 403 alır (negatif)', async () => {
    const menti = await createMenti(tenantA.id);
    const { accessToken } = await loginAs(http, menti.email, menti.rawPassword);
    await http
      .get('/api/questions/hidden')
      .set(tenantHeaders(tenantA.id, accessToken))
      .expect(403);
  });

  it('başka kurumun gizleme kaydı listede görünmez (negatif — tenant izolasyonu)', async () => {
    const q = await createGlobalStkQuestion('A gizledi');
    await http
      .post(`/api/questions/${q.id}/hide`)
      .set(tenantHeaders(tenantA.id, adminAToken))
      .expect(201);

    const res = await http
      .get('/api/questions/hidden')
      .set(tenantHeaders(tenantB.id, adminBToken))
      .expect(200);

    const ids = (res.body.items as Array<{ id: string }>).map((x) => x.id);
    expect(ids).not.toContain(q.id);
  });

  it('başka kurum, A\'nın gizleme kaydını geri açamaz (negatif — kayıt yerinde kalır)', async () => {
    const q = await createGlobalStkQuestion('B açmaya çalışır');
    await http
      .post(`/api/questions/${q.id}/hide`)
      .set(tenantHeaders(tenantA.id, adminAToken))
      .expect(201);

    await http
      .delete(`/api/questions/${q.id}/hide`)
      .set(tenantHeaders(tenantB.id, adminBToken));

    const stillHidden = await testPrisma.questionHide.findFirst({
      where: { questionId: q.id, tenantId: tenantA.id },
    });
    expect(stillHidden).not.toBeNull();
  });

  it('ADMIN geri açınca soru gizlenenlerden çıkar ve gizleme kaydı silinir', async () => {
    const q = await createGlobalStkQuestion('geri açılan');
    await http
      .post(`/api/questions/${q.id}/hide`)
      .set(tenantHeaders(tenantA.id, adminAToken))
      .expect(201);

    await http
      .delete(`/api/questions/${q.id}/hide`)
      .set(tenantHeaders(tenantA.id, adminAToken))
      .expect(204);

    const hiddenRes = await http
      .get('/api/questions/hidden')
      .set(tenantHeaders(tenantA.id, adminAToken))
      .expect(200);
    expect((hiddenRes.body.items as Array<{ id: string }>).map((x) => x.id)).not.toContain(q.id);

    // Gizleme kaydı silindi → soru artık bu kurum için gizli değil.
    // ⚠️ GÜNCELLEME (2026-09-25, E-3c): GET /api/questions artık ADMIN'e `stkQuestions` döndürüyor —
    // geri açılan STK sorusu yönetici listesine de döner. DB doğrulaması ayrıca korunur.
    const listRes = await http
      .get('/api/questions')
      .set(tenantHeaders(tenantA.id, adminAToken))
      .expect(200);
    expect((listRes.body.stkQuestions as Array<{ id: string }>).map((x) => x.id)).toContain(q.id);

    const hideRow = await testPrisma.questionHide.findFirst({
      where: { questionId: q.id, tenantId: tenantA.id },
    });
    expect(hideRow).toBeNull();
  });
});
