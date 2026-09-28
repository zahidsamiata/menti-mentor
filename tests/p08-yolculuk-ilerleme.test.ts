/**
 * P-08 — Öğrenme Yolculuğu kalıcı ilerleme (panel denetimi M8).
 *
 * Ölçüt: menti yolculukta kaçıncı aşamada olduğunu KALICI görür — sayfadan çıkıp dönünce
 * `GET /status` geçtiği aşama sayısını ve sıradaki aşamayı verir.
 * Negatifler: başka kullanıcının ilerlemesi okunamaz/yazılamaz (kimlik oturumdan) ·
 * başka kurumun aşaması kaydedilemez (tenant izolasyonu) · gizli / başka audience aşama 404.
 * Seçilen şık KAYDEDİLMEZ (madde 145) — yalnız aşama id'si.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { agent, loginAs, tenantHeaders, type TestAgent } from './helpers/request.js';
import { cleanDb, testPrisma } from './helpers/db.js';
import { createTenant, createMenti, createMentor } from './helpers/factories.js';
import type { Tenant, LearningAudience } from '@prisma/client';

async function seedStage(opts: { tenantId: string | null; audience: LearningAudience; order: number; title: string }) {
  return testPrisma.learningStage.create({
    data: {
      tenantId: opts.tenantId,
      audience: opts.audience,
      order: opts.order,
      title: opts.title,
      situationText: 'Bir durumla karşılaşıyorsun. Ne yaparsın?',
      learningGoal: 'Bir şey öğren.',
      choices: [
        { key: 'a', label: 'Birinci', outcome: 'correct', feedback: 'İyi.' },
        { key: 'b', label: 'İkinci', outcome: 'wrong', feedback: 'Zor.' },
      ],
      isActive: true,
    },
  });
}

async function savedIds(userId: string, tenantId: string): Promise<string[]> {
  const m = await testPrisma.tenantMembership.findUnique({
    where: { userId_tenantId: { userId, tenantId } },
    select: { learningJourneyStageIds: true },
  });
  return m?.learningJourneyStageIds ?? [];
}

describe('P-08 — Öğrenme Yolculuğu kalıcı ilerleme', () => {
  let http: TestAgent;
  let tenant: Tenant;

  beforeEach(async () => {
    await cleanDb();
    http = agent();
    tenant = await createTenant();
  });

  it('geçilen aşama kalıcıdır: status "kaç aşama geçildi + sıradaki" döner (yeniden okuma)', async () => {
    const s1 = await seedStage({ tenantId: null, audience: 'MENTI', order: 0, title: 'Tanışma' });
    const s2 = await seedStage({ tenantId: null, audience: 'MENTI', order: 1, title: 'İlk görüşme' });
    await seedStage({ tenantId: null, audience: 'MENTI', order: 2, title: 'Hedef koyma' });
    const menti = await createMenti(tenant.id);
    const { accessToken } = await loginAs(http, menti.email, menti.rawPassword);
    const h = tenantHeaders(tenant.id, accessToken);

    const before = await http.get('/api/learning-journey/status').set(h).expect(200);
    expect(before.body).toMatchObject({ completedStages: 0, totalStages: 3 });
    expect(before.body.nextStage).toEqual({ id: s1.id, title: 'Tanışma', index: 0 });

    const rec = await http.post(`/api/learning-journey/stages/${s1.id}/progress`).set(h).expect(200);
    expect(rec.body).toMatchObject({ completedStages: 1, totalStages: 3 });
    expect(rec.body.nextStage).toEqual({ id: s2.id, title: 'İlk görüşme', index: 1 });

    // İdempotent: aynı aşama ikinci kez sayılmaz
    await http.post(`/api/learning-journey/stages/${s1.id}/progress`).set(h).expect(200);

    // "Sayfadan çıkıp dönme" = ayrı istek; ilerleme DB'den gelir
    const after = await http.get('/api/learning-journey/status').set(h).expect(200);
    expect(after.body.completedStages).toBe(1);
    expect(after.body.completedStageIds).toEqual([s1.id]);
    expect(after.body.nextStage).toEqual({ id: s2.id, title: 'İlk görüşme', index: 1 });
    expect(after.body.completed).toBe(false);

    // Yalnız aşama id'si tutulur — seçilen şık yok (madde 145)
    expect(await savedIds(menti.id, tenant.id)).toEqual([s1.id]);
  });

  it('negatif: başka kullanıcının ilerlemesi okunamaz ve gövdeyle başkası adına yazılamaz', async () => {
    const s1 = await seedStage({ tenantId: null, audience: 'MENTI', order: 0, title: 'Tanışma' });
    const mentiA = await createMenti(tenant.id);
    const mentiB = await createMenti(tenant.id);
    const tokenA = (await loginAs(http, mentiA.email, mentiA.rawPassword)).accessToken;
    const tokenB = (await loginAs(http, mentiB.email, mentiB.rawPassword)).accessToken;

    await http.post(`/api/learning-journey/stages/${s1.id}/progress`).set(tenantHeaders(tenant.id, tokenA)).expect(200);

    // B, A'nın ilerlemesini görmez (status yalnız oturum sahibinin kaydını okur; sorgu parametresi yok sayılır)
    const statusB = await http
      .get(`/api/learning-journey/status?userId=${mentiA.id}`)
      .set(tenantHeaders(tenant.id, tokenB))
      .expect(200);
    expect(statusB.body.completedStages).toBe(0);
    expect(statusB.body.completedStageIds).toEqual([]);

    // B gövdeye A'nın id'sini koysa da yazım B'nin kendi kaydına gider
    const s2 = await seedStage({ tenantId: null, audience: 'MENTI', order: 1, title: 'İkinci' });
    await http
      .post(`/api/learning-journey/stages/${s2.id}/progress`)
      .set(tenantHeaders(tenant.id, tokenB))
      .send({ userId: mentiA.id })
      .expect(200);
    expect(await savedIds(mentiA.id, tenant.id)).toEqual([s1.id]);
    expect(await savedIds(mentiB.id, tenant.id)).toEqual([s2.id]);
  });

  it('negatif: başka kurumun özel aşaması kaydedilemez (404) ve kayıt değişmez', async () => {
    const tenantB = await createTenant();
    const foreign = await seedStage({ tenantId: tenantB.id, audience: 'MENTI', order: 0, title: 'B-özel' });
    const menti = await createMenti(tenant.id);
    const { accessToken } = await loginAs(http, menti.email, menti.rawPassword);

    const res = await http
      .post(`/api/learning-journey/stages/${foreign.id}/progress`)
      .set(tenantHeaders(tenant.id, accessToken))
      .expect(404);
    expect(res.body.error).toBe('ASAMA_BULUNAMADI');
    expect(await savedIds(menti.id, tenant.id)).toEqual([]);

    // Kendi token'ıyla başka kurumun başlığını göndermek reddedilir (JWT kurumu ≠ istek kurumu)
    await http.get('/api/learning-journey/status').set(tenantHeaders(tenantB.id, accessToken)).expect(403);
  });

  it('negatif: gizlenmiş global aşama ve başka audience aşaması kaydedilemez (404)', async () => {
    const hidden = await seedStage({ tenantId: null, audience: 'MENTI', order: 0, title: 'Gizli' });
    await testPrisma.learningStageHide.create({ data: { stageId: hidden.id, tenantId: tenant.id } });
    const mentorStage = await seedStage({ tenantId: null, audience: 'MENTOR', order: 0, title: 'Mentör' });
    const menti = await createMenti(tenant.id);
    const { accessToken } = await loginAs(http, menti.email, menti.rawPassword);
    const h = tenantHeaders(tenant.id, accessToken);

    await http.post(`/api/learning-journey/stages/${hidden.id}/progress`).set(h).expect(404);
    await http.post(`/api/learning-journey/stages/${mentorStage.id}/progress`).set(h).expect(404);
    await http.post('/api/learning-journey/stages/yok-boyle-asama/progress').set(h).expect(404);
    expect(await savedIds(menti.id, tenant.id)).toEqual([]);
  });

  it('ilerleme rol/kurum bazlıdır: mentörün kaydı kendi yolculuğuna yazılır', async () => {
    const ms = await seedStage({ tenantId: null, audience: 'MENTOR', order: 0, title: 'Mentör aşaması' });
    const mentor = await createMentor(tenant.id);
    const { accessToken } = await loginAs(http, mentor.email, mentor.rawPassword);
    const h = tenantHeaders(tenant.id, accessToken);

    await http.post(`/api/learning-journey/stages/${ms.id}/progress`).set(h).expect(200);
    const st = await http.get('/api/learning-journey/status').set(h).expect(200);
    expect(st.body).toMatchObject({ audience: 'MENTOR', completedStages: 1, totalStages: 1, nextStage: null });
  });
});
