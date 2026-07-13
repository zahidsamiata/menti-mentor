/**
 * DISC Soru Havuzu Kilitleme Testleri
 *
 * Kapsam: kurum admini DISC sorularını gizleyemiyor, DISC kategorisinde soru oluşturamıyor.
 * STK_CUSTOM sorular ise eklenip silinebilir.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { agent, loginAs, tenantHeaders, type TestAgent } from './helpers/request.js';
import { cleanDb, testPrisma } from './helpers/db.js';
import { createTenant, createAdminUser, createUser } from './helpers/factories.js';
import type { Tenant } from '@prisma/client';

async function createDiscQuestion() {
  return testPrisma.question.create({
    data: {
      text: 'DISC test sorusu — kararlı ve sonuç odaklı bir yaklaşım benimserim.',
      type: 'CORE',
      discDimension: 'D',
      category: 'DISC_ASSESSMENT',
      tenantId: null,
      order: 1,
    },
  });
}

describe('Questions: DISC Kilitleme', () => {
  let http: TestAgent;
  let tenant: Tenant;
  let adminToken: string;

  beforeEach(async () => {
    await cleanDb();
    http = agent();
    tenant = await createTenant();
    const admin = await createAdminUser(tenant.id);
    const tokens = await loginAs(http, admin.email, admin.rawPassword);
    adminToken = tokens.accessToken;
  });

  it('kurum admini DISC sorusunu gizleyemiyor (403)', async () => {
    const discQ = await createDiscQuestion();

    const res = await http
      .post(`/api/questions/${discQ.id}/hide`)
      .set(tenantHeaders(tenant.id, adminToken))
      .expect(403);

    expect((res.body as { error: string }).error).toBe('DISC_SORULARI_KILITLI');

    const hidden = await testPrisma.questionHide.findFirst({ where: { questionId: discQ.id } });
    expect(hidden).toBeNull();
  });

  it('kurum admini DISC_ASSESSMENT kategorisinde soru oluşturamıyor (403)', async () => {
    const res = await http
      .post('/api/questions')
      .set(tenantHeaders(tenant.id, adminToken))
      .send({
        text: 'Yetkisiz DISC sorusu — sisteme enjekte edilmemeli.',
        category: 'DISC_ASSESSMENT',
        tenantScoped: true,
      })
      .expect(403);

    expect((res.body as { error: string }).error).toBe('DISC_KATEGORI_KILITLI');
  });

  it('kurum admini STK_CUSTOM soru ekleyebilir (201)', async () => {
    const res = await http
      .post('/api/questions')
      .set(tenantHeaders(tenant.id, adminToken))
      .send({
        text: 'Kurumunuzda kaç yıldır çalışıyorsunuz? Deneyiminizi kısaca anlatın.',
        category: 'STK_CUSTOM',
        tenantScoped: true,
      })
      .expect(201);

    const body = res.body as { category: string; tenantId: string };
    expect(body.category).toBe('STK_CUSTOM');
    expect(body.tenantId).toBe(tenant.id);
  });

  it('kurum admini kendi STK_CUSTOM sorusunu silebilir (204)', async () => {
    const q = await testPrisma.question.create({
      data: {
        text: 'Silinecek kuruma özel soru — test verisi.',
        type: 'CORE',
        discDimension: 'GENERAL',
        category: 'STK_CUSTOM',
        tenantId: tenant.id,
        order: 0,
      },
    });

    await http
      .delete(`/api/questions/${q.id}`)
      .set(tenantHeaders(tenant.id, adminToken))
      .expect(204);

    const deleted = await testPrisma.question.findUnique({ where: { id: q.id } });
    expect(deleted).toBeNull();
  });

  it('MENTOR DISC sorusunu gizlemeye çalışırsa 403 (rol koruması)', async () => {
    const discQ = await createDiscQuestion();
    const mentor = await createUser({ tenantId: tenant.id, role: 'MENTOR' });
    const mentorTokens = await loginAs(http, mentor.email, mentor.rawPassword);

    await http
      .post(`/api/questions/${discQ.id}/hide`)
      .set(tenantHeaders(tenant.id, mentorTokens.accessToken))
      .expect(403);
  });
});
