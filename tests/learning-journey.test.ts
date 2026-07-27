/**
 * Öğrenme Yolculuğu — keşif motoru + STK kopya-üzerine-düzenle + tenant izolasyonu.
 *
 * Model: "sınav DEĞİL keşif" — puanlama/geçme-kalma YOK.
 *  - Oyuncu (menti/mentör): aşamaları görür, seçince outcome + feedback alır, tamamlar.
 *  - Global (tenantId=null) aşamalar KİLİTLİ: yalnızca gizlenir ya da klonlanarak özelleştirilir.
 *  - Tenant izolasyonu: A'nın özel aşaması/gizlemesi B'yi etkilemez.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { agent, loginAs, tenantHeaders, type TestAgent } from './helpers/request.js';
import { cleanDb, testPrisma } from './helpers/db.js';
import { createTenant, createMentor, createMenti, createAdminUser } from './helpers/factories.js';
import type { Tenant, LearningAudience } from '@prisma/client';

type Outcome = 'correct' | 'warn' | 'wrong';

function choices(): { key: string; label: string; outcome: Outcome; feedback: string }[] {
  return [
    { key: 'a', label: 'Doğru seçim', outcome: 'correct', feedback: 'İyi düşündün.' },
    { key: 'b', label: 'Kısmi seçim', outcome: 'warn', feedback: 'Fena değil ama.' },
    { key: 'c', label: 'Yanlış seçim', outcome: 'wrong', feedback: 'Burada zorlanırsın.' },
  ];
}

async function seedStage(opts: {
  tenantId: string | null;
  audience: LearningAudience;
  order: number;
  title?: string;
  id?: string;
}) {
  return testPrisma.learningStage.create({
    data: {
      ...(opts.id ? { id: opts.id } : {}),
      tenantId: opts.tenantId,
      audience: opts.audience,
      order: opts.order,
      title: opts.title ?? `Aşama ${opts.order}`,
      situationText: 'Bir durumla karşılaşıyorsun. Ne yaparsın?',
      learningGoal: 'Bir şey öğren.',
      authoringGuide: 'Rehber metni.',
      isStkSpecific: false,
      choices: choices(),
      isActive: true,
    },
  });
}

describe('Öğrenme Yolculuğu — keşif motoru', () => {
  let http: TestAgent;
  let tenant: Tenant;

  beforeEach(async () => {
    await cleanDb();
    http = agent();
    tenant = await createTenant();
  });

  // ── Oyuncu akışı ─────────────────────────────────────────────────────────────
  it('mentör kendi audience aşamalarını görür; cevap anahtarı (outcome/feedback) sızmaz', async () => {
    await seedStage({ tenantId: null, audience: 'MENTOR', order: 0 });
    await seedStage({ tenantId: null, audience: 'MENTI', order: 0 });
    const mentor = await createMentor(tenant.id);
    const { accessToken } = await loginAs(http, mentor.email, mentor.rawPassword);

    const res = await http
      .get('/api/learning-journey/stages')
      .set(tenantHeaders(tenant.id, accessToken))
      .expect(200);

    expect(res.body.audience).toBe('MENTOR');
    expect(res.body.items).toHaveLength(1);
    expect(res.body.frame.journeyTitle).toBeTruthy();
    const choice = res.body.items[0].choices[0];
    expect(choice.key).toBeTruthy();
    expect(choice.label).toBeTruthy();
    // Keşif: outcome ve feedback listede DÖNMEZ
    expect(choice.outcome).toBeUndefined();
    expect(choice.feedback).toBeUndefined();
  });

  it('menti kendi audience aşamalarını görür (audience ayrımı)', async () => {
    await seedStage({ tenantId: null, audience: 'MENTOR', order: 0 });
    await seedStage({ tenantId: null, audience: 'MENTI', order: 0, title: 'Menti aşaması' });
    const menti = await createMenti(tenant.id);
    const { accessToken } = await loginAs(http, menti.email, menti.rawPassword);

    const res = await http
      .get('/api/learning-journey/stages')
      .set(tenantHeaders(tenant.id, accessToken))
      .expect(200);

    expect(res.body.audience).toBe('MENTI');
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].title).toBe('Menti aşaması');
  });

  it('seçim outcome + feedback döner; PUAN alanı yoktur', async () => {
    const stage = await seedStage({ tenantId: null, audience: 'MENTOR', order: 0 });
    const mentor = await createMentor(tenant.id);
    const { accessToken } = await loginAs(http, mentor.email, mentor.rawPassword);

    const res = await http
      .post(`/api/learning-journey/stages/${stage.id}/select`)
      .set(tenantHeaders(tenant.id, accessToken))
      .send({ choiceKey: 'c' })
      .expect(200);

    expect(res.body).toMatchObject({ key: 'c', outcome: 'wrong', feedback: 'Burada zorlanırsın.' });
    expect(res.body).not.toHaveProperty('score');
    expect(res.body).not.toHaveProperty('competencyScore');
    expect(res.body).not.toHaveProperty('passed');
  });

  it('geçersiz seçim/aşama 404 döner', async () => {
    const stage = await seedStage({ tenantId: null, audience: 'MENTOR', order: 0 });
    const mentor = await createMentor(tenant.id);
    const { accessToken } = await loginAs(http, mentor.email, mentor.rawPassword);

    await http
      .post(`/api/learning-journey/stages/${stage.id}/select`)
      .set(tenantHeaders(tenant.id, accessToken))
      .send({ choiceKey: 'zzz' })
      .expect(404);
  });

  it('tamamlama idempotent; status tamamlandı olarak yansır', async () => {
    await seedStage({ tenantId: null, audience: 'MENTOR', order: 0 });
    const mentor = await createMentor(tenant.id);
    const { accessToken } = await loginAs(http, mentor.email, mentor.rawPassword);
    const h = tenantHeaders(tenant.id, accessToken);

    const first = await http.post('/api/learning-journey/complete').set(h).expect(200);
    expect(first.body.completed).toBe(true);
    const firstAt = first.body.completedAt;

    // İkinci çağrı idempotent — aynı an korunur
    const second = await http.post('/api/learning-journey/complete').set(h).expect(200);
    expect(second.body.completedAt).toBe(firstAt);

    const status = await http.get('/api/learning-journey/status').set(h).expect(200);
    expect(status.body.completed).toBe(true);
    expect(status.body.totalStages).toBe(1);
  });

  // ── Tenant override + gizleme ────────────────────────────────────────────────
  it('gizlenen global aşama oyuncuya dönmez; tenant-özel aşama döner', async () => {
    const globalStage = await seedStage({ tenantId: null, audience: 'MENTOR', order: 0 });
    await testPrisma.learningStageHide.create({ data: { stageId: globalStage.id, tenantId: tenant.id } });
    await seedStage({ tenantId: tenant.id, audience: 'MENTOR', order: 1, title: 'Kuruma özel' });

    const mentor = await createMentor(tenant.id);
    const { accessToken } = await loginAs(http, mentor.email, mentor.rawPassword);

    const res = await http
      .get('/api/learning-journey/stages')
      .set(tenantHeaders(tenant.id, accessToken))
      .expect(200);

    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].title).toBe('Kuruma özel');
  });
});

describe('Öğrenme Yolculuğu — STK yönetici CRUD', () => {
  let http: TestAgent;
  let tenant: Tenant;
  let adminToken: string;

  beforeEach(async () => {
    await cleanDb();
    http = agent();
    tenant = await createTenant();
    const admin = await createAdminUser(tenant.id);
    adminToken = (await loginAs(http, admin.email, admin.rawPassword)).accessToken;
  });

  it('özelleştir: global aşamayı klonlar + globali gizler; oyuncu klonu görür', async () => {
    const globalStage = await seedStage({ tenantId: null, audience: 'MENTOR', order: 0, title: 'Global 1' });
    const h = tenantHeaders(tenant.id, adminToken);

    const cust = await http
      .post(`/api/admin/learning-journey/stages/${globalStage.id}/customize`)
      .set(h)
      .expect(201);
    expect(cust.body.tenantId).toBe(tenant.id);
    expect(cust.body.clonedFromId).toBe(globalStage.id);

    // Yönetici listesi: global gizli + klon var
    const list = await http.get('/api/admin/learning-journey/stages?audience=MENTOR').set(h).expect(200);
    const globalRow = list.body.items.find((s: { id: string }) => s.id === globalStage.id);
    expect(globalRow.isHidden).toBe(true);

    // Oyuncu: yalnızca klonu görür
    const mentor = await createMentor(tenant.id);
    const mToken = (await loginAs(http, mentor.email, mentor.rawPassword)).accessToken;
    const stages = await http
      .get('/api/learning-journey/stages')
      .set(tenantHeaders(tenant.id, mToken))
      .expect(200);
    expect(stages.body.items).toHaveLength(1);
    expect(stages.body.items[0].id).toBe(cust.body.id);
  });

  it('global aşama mutasyonu reddedilir (PATCH/DELETE → 403)', async () => {
    const globalStage = await seedStage({ tenantId: null, audience: 'MENTOR', order: 0 });
    const h = tenantHeaders(tenant.id, adminToken);

    await http
      .patch(`/api/admin/learning-journey/stages/${globalStage.id}`)
      .set(h)
      .send({ title: 'Hack' })
      .expect(403);

    await http.delete(`/api/admin/learning-journey/stages/${globalStage.id}`).set(h).expect(403);
  });

  it('yeni aşama ekle → düzenle → sil (kendi kopyası)', async () => {
    const h = tenantHeaders(tenant.id, adminToken);
    const created = await http
      .post('/api/admin/learning-journey/stages')
      .set(h)
      .send({
        audience: 'MENTI',
        title: 'Yeni',
        situationText: 'Bir durum var ve karar vermen gerekiyor.',
        learningGoal: 'Karar ver.',
        choices: [
          { key: 'a', label: 'Evet', outcome: 'correct', feedback: 'Güzel.' },
          { key: 'b', label: 'Hayır', outcome: 'wrong', feedback: 'Olmadı.' },
        ],
      })
      .expect(201);
    expect(created.body.tenantId).toBe(tenant.id);

    await http
      .patch(`/api/admin/learning-journey/stages/${created.body.id}`)
      .set(h)
      .send({ title: 'Güncellendi' })
      .expect(200);

    await http.delete(`/api/admin/learning-journey/stages/${created.body.id}`).set(h).expect(204);
  });

  it('varsayılana dön: klon silinince kaynak globalin gizlemesi kalkar', async () => {
    const globalStage = await seedStage({ tenantId: null, audience: 'MENTOR', order: 0 });
    const h = tenantHeaders(tenant.id, adminToken);

    const cust = await http
      .post(`/api/admin/learning-journey/stages/${globalStage.id}/customize`)
      .set(h)
      .expect(201);

    await http.delete(`/api/admin/learning-journey/stages/${cust.body.id}`).set(h).expect(204);

    // Global yeniden görünür (gizleme kalktı)
    const hide = await testPrisma.learningStageHide.findFirst({
      where: { stageId: globalStage.id, tenantId: tenant.id },
    });
    expect(hide).toBeNull();
  });

  it('reorder yalnızca tenant aşamalarını kabul eder; global id 403', async () => {
    const globalStage = await seedStage({ tenantId: null, audience: 'MENTOR', order: 0 });
    const own = await seedStage({ tenantId: tenant.id, audience: 'MENTOR', order: 1 });
    const h = tenantHeaders(tenant.id, adminToken);

    await http
      .post('/api/admin/learning-journey/stages/reorder')
      .set(h)
      .send({ order: [globalStage.id, own.id] })
      .expect(403);

    await http
      .post('/api/admin/learning-journey/stages/reorder')
      .set(h)
      .send({ order: [own.id] })
      .expect(200);
  });

  it('non-admin (mentör) yönetici endpoint\'ine erişemez (403)', async () => {
    const mentor = await createMentor(tenant.id);
    const mToken = (await loginAs(http, mentor.email, mentor.rawPassword)).accessToken;
    await http
      .get('/api/admin/learning-journey/stages')
      .set(tenantHeaders(tenant.id, mToken))
      .expect(403);
  });
});

describe('Öğrenme Yolculuğu — tenant izolasyonu', () => {
  let http: TestAgent;

  beforeEach(async () => {
    await cleanDb();
    http = agent();
  });

  it('A kurumunun özel aşaması ve gizlemesi B kurumunu etkilemez', async () => {
    const globalStage = await seedStage({ tenantId: null, audience: 'MENTOR', order: 0, title: 'Global' });
    const tenantA = await createTenant();
    const tenantB = await createTenant();

    // A: global'i gizle + kendi özel aşamasını ekle
    await testPrisma.learningStageHide.create({ data: { stageId: globalStage.id, tenantId: tenantA.id } });
    await seedStage({ tenantId: tenantA.id, audience: 'MENTOR', order: 1, title: 'A-özel' });

    const mentorA = await createMentor(tenantA.id);
    const mentorB = await createMentor(tenantB.id);
    const tokenA = (await loginAs(http, mentorA.email, mentorA.rawPassword)).accessToken;
    const tokenB = (await loginAs(http, mentorB.email, mentorB.rawPassword)).accessToken;

    // A: global gizli, A-özel görünür
    const listA = await http.get('/api/learning-journey/stages').set(tenantHeaders(tenantA.id, tokenA)).expect(200);
    const titlesA = listA.body.items.map((s: { title: string }) => s.title);
    expect(titlesA).toContain('A-özel');
    expect(titlesA).not.toContain('Global');

    // B: global hâlâ görünür, A-özel görünmez
    const listB = await http.get('/api/learning-journey/stages').set(tenantHeaders(tenantB.id, tokenB)).expect(200);
    const titlesB = listB.body.items.map((s: { title: string }) => s.title);
    expect(titlesB).toContain('Global');
    expect(titlesB).not.toContain('A-özel');
  });
});
