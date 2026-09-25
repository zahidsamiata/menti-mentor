/**
 * E-3c — GET /api/questions yönetici görünümü: tenantId + kurumun STK_CUSTOM soruları.
 *
 * Neden: yanıt `tenantId` taşımadığı için yönetici ekranındaki "global mi / kuruma özel mi" ayrımı hiç
 * tutmuyordu (DISC soruları "Kuruma Özel" altında Düzenle/Sil ile görünüyordu); kurumun eklediği
 * STK_CUSTOM sorular ise hesaplanıp (`stkQuestions`) yanıta konmuyordu → yönetici eklediği soruyu göremiyordu.
 *
 * İddialar:
 *   - ADMIN yanıtında her soru `tenantId` taşır; global soru `tenantId: null` (kuruma özel sayılmaz).
 *   - ADMIN kendi kurumunun STK_CUSTOM sorusunu `stkQuestions`'ta görür; STK soruları `items`'a (DISC havuzu) girmez.
 *   - A kurumunun özel sorusu B kurumunun yöneticisine görünmez (negatif — tenant izolasyonu).
 *   - MENTI/MENTOR yanıtı değişmez: `stkQuestions` yok, `items`'ta `tenantId` yok (negatif).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { Question, Tenant } from '@prisma/client';
import { cleanDb, testPrisma } from './helpers/db.js';
import { createTenant, createAdminUser, createMentor, createMenti } from './helpers/factories.js';
import { agent, loginAs, tenantHeaders, type TestAgent } from './helpers/request.js';

type ListedQuestion = { id: string; tenantId?: string | null; category?: string };
type ListBody = { items: ListedQuestion[]; total: number; stkQuestions?: ListedQuestion[] };

async function createGlobalDiscQuestion(): Promise<Question> {
  return testPrisma.question.create({
    data: {
      text: `E-3c global DISC sorusu (${Date.now()}-${Math.random()})`,
      type: 'CORE',
      discDimension: 'D',
      category: 'DISC_ASSESSMENT',
      tenantId: null,
      order: 1,
    },
  });
}

async function createTenantStkQuestion(tenantId: string, label: string): Promise<Question> {
  return testPrisma.question.create({
    data: {
      text: `E-3c kurum STK sorusu — ${label} (${Date.now()}-${Math.random()})`,
      type: 'CORE',
      discDimension: 'GENERAL',
      category: 'STK_CUSTOM',
      tenantId,
      order: 1,
    },
  });
}

describe('E-3c — GET /api/questions yönetici görünümü', () => {
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

  it('global soru tenantId:null ile döner — kuruma özel sayılmaz', async () => {
    const discQ = await createGlobalDiscQuestion();

    const res = await http.get('/api/questions').set(tenantHeaders(tenantA.id, adminAToken)).expect(200);
    const body = res.body as ListBody;

    const listed = body.items.find((q) => q.id === discQ.id);
    expect(listed).toBeDefined();
    expect(listed).toHaveProperty('tenantId', null);
  });

  it('ADMIN kendi kurumunun STK_CUSTOM sorusunu stkQuestions içinde görür; items (DISC havuzu) kirlenmez', async () => {
    const stkQ = await createTenantStkQuestion(tenantA.id, 'A ekledi');

    const res = await http.get('/api/questions').set(tenantHeaders(tenantA.id, adminAToken)).expect(200);
    const body = res.body as ListBody;

    const listed = (body.stkQuestions ?? []).find((q) => q.id === stkQ.id);
    expect(listed).toBeDefined();
    expect(listed).toHaveProperty('tenantId', tenantA.id);
    expect(body.items.map((q) => q.id)).not.toContain(stkQ.id);
  });

  it('A kurumunun özel sorusu B kurumunun yöneticisine görünmez (negatif — tenant izolasyonu)', async () => {
    const stkQ = await createTenantStkQuestion(tenantA.id, 'yalnız A');

    const res = await http.get('/api/questions').set(tenantHeaders(tenantB.id, adminBToken)).expect(200);
    const body = res.body as ListBody;

    const allIds = [...body.items, ...(body.stkQuestions ?? [])].map((q) => q.id);
    expect(allIds).not.toContain(stkQ.id);
  });

  it('MENTI yanıtı değişmez: stkQuestions yok, items tenantId taşımaz (negatif)', async () => {
    await createGlobalDiscQuestion();
    const stkQ = await createTenantStkQuestion(tenantA.id, 'menti görmemeli');
    const menti = await createMenti(tenantA.id);
    const { accessToken } = await loginAs(http, menti.email, menti.rawPassword);

    const res = await http.get('/api/questions').set(tenantHeaders(tenantA.id, accessToken)).expect(200);
    const body = res.body as ListBody;

    expect(body).not.toHaveProperty('stkQuestions');
    expect(body.items.length).toBeGreaterThan(0);
    for (const q of body.items) expect(q).not.toHaveProperty('tenantId');
    expect(body.items.map((q) => q.id)).not.toContain(stkQ.id);
  });

  it('MENTOR yanıtı değişmez: stkQuestions yok, items tenantId taşımaz (negatif)', async () => {
    await createGlobalDiscQuestion();
    await createTenantStkQuestion(tenantA.id, 'mentor görmemeli');
    const mentor = await createMentor(tenantA.id);
    const { accessToken } = await loginAs(http, mentor.email, mentor.rawPassword);

    const res = await http.get('/api/questions').set(tenantHeaders(tenantA.id, accessToken)).expect(200);
    const body = res.body as ListBody;

    expect(body).not.toHaveProperty('stkQuestions');
    for (const q of body.items) expect(q).not.toHaveProperty('tenantId');
  });
});
