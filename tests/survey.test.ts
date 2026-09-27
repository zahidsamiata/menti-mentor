/**
 * AN-52-2 — GET /api/surveys/pending + POST /api/surveys/:questionKey/respond.
 *
 * Kapsam: 1 kez kuralı (ikinci cevap 409), kapatılan tekrar gelmez, kimlik OTURUMDAN alınır
 * (gövdedeki sahte userId görmezden gelinir), başka kullanıcının cevabı diğerini etkilemez,
 * başka kurum (cross-tenant) engellenir, rol uygun değilse soru gösterilmez/yazılamaz.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import supertest from 'supertest';
import express from 'express';
import { tenantHeaders, type TestAgent } from './helpers/request.js';
import { cleanDb, testPrisma } from './helpers/db.js';
import { createTenant, createMentor, createMenti } from './helpers/factories.js';
import { signToken } from '../src/middleware/jwtAuth.js';
import surveyRoutes from '../src/routes/surveyRoutes.js';
import { notFoundHandler, globalErrorHandler } from '../src/middleware/errorHandler.js';
import type { User } from '@prisma/client';

// Ortak createTestApp bu rotayı bağlamıyor → feedbackLogRoutes testindeki gibi minimal uygulama.
function createSurveyTestApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/surveys', surveyRoutes);
  app.use(notFoundHandler);
  app.use(globalErrorHandler);
  return app;
}

function tokenFor(u: Pick<User, 'id' | 'tenantId' | 'role' | 'fullName'>): string {
  return signToken({ sub: u.id, tenantId: u.tenantId, role: u.role, fullName: u.fullName });
}

describe('AN-52-2: anket pending + respond uçları', () => {
  let http: TestAgent;
  let tenantId: string;
  let menti: Awaited<ReturnType<typeof createMenti>>;
  let mentor: Awaited<ReturnType<typeof createMentor>>;

  beforeEach(async () => {
    await cleanDb();
    http = supertest.agent(createSurveyTestApp());
    const tenant = await createTenant();
    tenantId = tenant.id;
    menti = await createMenti(tenantId);
    mentor = await createMentor(tenantId);
  });

  describe('GET /pending', () => {
    it('bilinen bağlam + uygun rol → soru döner', async () => {
      const res = await http
        .get('/api/surveys/pending?context=MENTI_BEKLEME')
        .set(tenantHeaders(tenantId, tokenFor(menti)));
      expect(res.status).toBe(200);
      expect(res.body.question).not.toBeNull();
      expect(res.body.question.questionKey).toBe('S1_BEKLEME');
      expect(res.body.question.options.length).toBeGreaterThan(0);
    });

    it('rol uygun değilse (mentor, menti sorusu) → question null, 403/500 DEĞİL', async () => {
      const res = await http
        .get('/api/surveys/pending?context=MENTI_BEKLEME')
        .set(tenantHeaders(tenantId, tokenFor(mentor)));
      expect(res.status).toBe(200);
      expect(res.body.question).toBeNull();
    });

    it('bilinmeyen context → 400 VALIDATION', async () => {
      const res = await http
        .get('/api/surveys/pending?context=UYDURMA_BAGLAM')
        .set(tenantHeaders(tenantId, tokenFor(menti)));
      expect(res.status).toBe(400);
    });

    it('kimlik doğrulanmadan → 401', async () => {
      const res = await http.get('/api/surveys/pending?context=MENTI_BEKLEME').set(tenantHeaders(tenantId));
      expect(res.status).toBe(401);
    });

    it('negatif — başka kurum: JWT tenantId ile X-Tenant-Id çelişince 403', async () => {
      const otherTenant = await createTenant();
      const res = await http
        .get('/api/surveys/pending?context=MENTI_BEKLEME')
        .set(tenantHeaders(otherTenant.id, tokenFor(menti)));
      expect(res.status).toBe(403);
      expect(res.body.error).toBe('CROSS_TENANT_ERISIM_ENGELLENDI');
    });
  });

  describe('POST /:questionKey/respond', () => {
    it('cevapla → 201, respondedAt dolu, dismissedAt null', async () => {
      const res = await http
        .post('/api/surveys/S1_BEKLEME/respond')
        .set(tenantHeaders(tenantId, tokenFor(menti)))
        .send({ answerKey: 'RAHAT' });
      expect(res.status).toBe(201);
      expect(res.body.answerKey).toBe('RAHAT');
      expect(res.body.respondedAt).not.toBeNull();
      expect(res.body.dismissedAt).toBeNull();

      const row = await testPrisma.productSurveyResponse.findUnique({
        where: { userId_questionKey: { userId: menti.id, questionKey: 'S1_BEKLEME' } },
      });
      expect(row).not.toBeNull();
      expect(row!.tenantId).toBe(tenantId);
    });

    it('kapat (answerKey yok) → 201, dismissedAt dolu, answerKey null; sonra pending null döner', async () => {
      const res = await http
        .post('/api/surveys/S1_BEKLEME/respond')
        .set(tenantHeaders(tenantId, tokenFor(menti)))
        .send({});
      expect(res.status).toBe(201);
      expect(res.body.answerKey).toBeNull();
      expect(res.body.dismissedAt).not.toBeNull();

      const pending = await http
        .get('/api/surveys/pending?context=MENTI_BEKLEME')
        .set(tenantHeaders(tenantId, tokenFor(menti)));
      expect(pending.body.question).toBeNull();
    });

    it('1 kez kuralı: ikinci cevap 409 döner, ilk kayıt DEĞİŞMEZ', async () => {
      await http
        .post('/api/surveys/S1_BEKLEME/respond')
        .set(tenantHeaders(tenantId, tokenFor(menti)))
        .send({ answerKey: 'RAHAT' });

      const res2 = await http
        .post('/api/surveys/S1_BEKLEME/respond')
        .set(tenantHeaders(tenantId, tokenFor(menti)))
        .send({ answerKey: 'ENDISELIYIM' });
      expect(res2.status).toBe(409);

      const row = await testPrisma.productSurveyResponse.findUnique({
        where: { userId_questionKey: { userId: menti.id, questionKey: 'S1_BEKLEME' } },
      });
      expect(row!.answerKey).toBe('RAHAT'); // ilk cevap korunur, ikinci yazma yok sayıldı
    });

    it('geçersiz şık → 400 VALIDATION, kayıt oluşmaz', async () => {
      const res = await http
        .post('/api/surveys/S1_BEKLEME/respond')
        .set(tenantHeaders(tenantId, tokenFor(menti)))
        .send({ answerKey: 'UYDURMA_SIK' });
      expect(res.status).toBe(400);
      const count = await testPrisma.productSurveyResponse.count({ where: { userId: menti.id } });
      expect(count).toBe(0);
    });

    it('bilinmeyen questionKey → 400 (Zod path enum reddeder)', async () => {
      const res = await http
        .post('/api/surveys/UYDURMA_SORU/respond')
        .set(tenantHeaders(tenantId, tokenFor(menti)))
        .send({ answerKey: 'RAHAT' });
      expect(res.status).toBe(400);
    });

    it('rol uygun değilse (mentor, menti sorusu) → 403, kayıt oluşmaz', async () => {
      const res = await http
        .post('/api/surveys/S1_BEKLEME/respond')
        .set(tenantHeaders(tenantId, tokenFor(mentor)))
        .send({ answerKey: 'RAHAT' });
      expect(res.status).toBe(403);
      const count = await testPrisma.productSurveyResponse.count({ where: { userId: mentor.id } });
      expect(count).toBe(0);
    });

    it('kimlik doğrulanmadan → 401', async () => {
      const res = await http
        .post('/api/surveys/S1_BEKLEME/respond')
        .set(tenantHeaders(tenantId))
        .send({ answerKey: 'RAHAT' });
      expect(res.status).toBe(401);
    });

    it('negatif — kimlik OTURUMDAN alınır: gövdedeki sahte userId görmezden gelinir', async () => {
      const strangerMenti = await createMenti(tenantId);
      const res = await http
        .post('/api/surveys/S1_BEKLEME/respond')
        .set(tenantHeaders(tenantId, tokenFor(menti)))
        .send({ answerKey: 'RAHAT', userId: strangerMenti.id });
      expect(res.status).toBe(201);

      // Kayıt gerçek oturum sahibine (menti) ait; sahte userId'ye yazılmadı.
      const own = await testPrisma.productSurveyResponse.findUnique({
        where: { userId_questionKey: { userId: menti.id, questionKey: 'S1_BEKLEME' } },
      });
      expect(own).not.toBeNull();
      const stranger = await testPrisma.productSurveyResponse.findUnique({
        where: { userId_questionKey: { userId: strangerMenti.id, questionKey: 'S1_BEKLEME' } },
      });
      expect(stranger).toBeNull();
    });

    it('negatif — başka kullanıcının cevabı bu kullanıcıyı etkilemez (bağımsız satırlar)', async () => {
      const mentiB = await createMenti(tenantId);

      await http
        .post('/api/surveys/S1_BEKLEME/respond')
        .set(tenantHeaders(tenantId, tokenFor(menti)))
        .send({ answerKey: 'RAHAT' });

      // B, A cevaplamış olsa da kendi pending sorusunu HÂLÂ görür.
      const pendingForB = await http
        .get('/api/surveys/pending?context=MENTI_BEKLEME')
        .set(tenantHeaders(tenantId, tokenFor(mentiB)));
      expect(pendingForB.body.question).not.toBeNull();

      const resB = await http
        .post('/api/surveys/S1_BEKLEME/respond')
        .set(tenantHeaders(tenantId, tokenFor(mentiB)))
        .send({ answerKey: 'ENDISELIYIM' });
      expect(resB.status).toBe(201);

      const rowA = await testPrisma.productSurveyResponse.findUnique({
        where: { userId_questionKey: { userId: menti.id, questionKey: 'S1_BEKLEME' } },
      });
      expect(rowA!.answerKey).toBe('RAHAT'); // B'nin yazması A'yı etkilemedi
    });

    it('negatif — başka kurum: cross-tenant JWT engellenir, kayıt oluşmaz', async () => {
      const otherTenant = await createTenant();
      const res = await http
        .post('/api/surveys/S1_BEKLEME/respond')
        .set(tenantHeaders(otherTenant.id, tokenFor(menti)))
        .send({ answerKey: 'RAHAT' });
      expect(res.status).toBe(403);
      const count = await testPrisma.productSurveyResponse.count({ where: { userId: menti.id } });
      expect(count).toBe(0);
    });
  });
});
