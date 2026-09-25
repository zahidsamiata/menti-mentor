/**
 * GV-05 — POST /api/feedback-logs: mentör yalnız kendi adına ve görüştüğü menti için yazar.
 * Reddedilen istekte kayıt oluşmaz ve DISC kombinasyon skoru değişmez.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import supertest from 'supertest';
import express from 'express';
import { tenantHeaders, type TestAgent } from './helpers/request.js';
import { cleanDb, testPrisma } from './helpers/db.js';
import { createTenant, createMentor, createMenti, createAdminUser } from './helpers/factories.js';
import { signToken } from '../src/middleware/jwtAuth.js';
import feedbackLogRoutes from '../src/routes/feedbackLogRoutes.js';
import { notFoundHandler, globalErrorHandler } from '../src/middleware/errorHandler.js';
import type { User } from '@prisma/client';

// Ortak createTestApp bu rotayı bağlamıyor → security-audit-2.test.ts'teki gibi minimal uygulama.
function createFeedbackLogTestApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/feedback-logs', feedbackLogRoutes);
  app.use(notFoundHandler);
  app.use(globalErrorHandler);
  return app;
}

function tokenFor(u: Pick<User, 'id' | 'tenantId' | 'role' | 'fullName'>): string {
  return signToken({ sub: u.id, tenantId: u.tenantId, role: u.role, fullName: u.fullName });
}

describe('GV-05: POST /api/feedback-logs kimlik ve taraf kontrolü', () => {
  let http: TestAgent;
  let tenantId: string;
  let mentor: Awaited<ReturnType<typeof createMentor>>;
  let otherMentor: Awaited<ReturnType<typeof createMentor>>;
  let menti: Awaited<ReturnType<typeof createMenti>>;
  let strangerMenti: Awaited<ReturnType<typeof createMenti>>;

  beforeEach(async () => {
    await cleanDb();
    http = supertest.agent(createFeedbackLogTestApp());
    const tenant = await createTenant();
    tenantId = tenant.id;
    mentor        = await createMentor(tenantId, { discType: 'D' });
    otherMentor   = await createMentor(tenantId, { discType: 'I' });
    menti         = await createMenti(tenantId, { discType: 'S' });
    strangerMenti = await createMenti(tenantId, { discType: 'C' });
    await testPrisma.meeting.create({
      data: {
        tenantId, mentorUserId: mentor.id, mentiUserId: menti.id, status: 'COMPLETED', format: 'ONLINE',
        startsAt: new Date(Date.now() - 2 * 3600_000), endsAt: new Date(Date.now() - 3600_000),
      },
    });
  });

  const body = (mentorId: string, mentiId: string) => ({ mentorId, mentiId, phase: 1, starRating: 5 });

  it('mentör görüştüğü menti için kendi adına yazabilir (201)', async () => {
    const res = await http.post('/api/feedback-logs').set(tenantHeaders(tenantId, tokenFor(mentor))).send(body(mentor.id, menti.id));
    expect(res.status).toBe(201);
    expect(res.body.mentorId).toBe(mentor.id);
  });

  it('negatif: mentör başka mentör adına yazamaz (403); kayıt ve kombinasyon skoru değişmez', async () => {
    const before = await testPrisma.matchCombinationScore.count({ where: { tenantId } });
    const res = await http.post('/api/feedback-logs').set(tenantHeaders(tenantId, tokenFor(otherMentor))).send(body(mentor.id, menti.id));
    expect(res.status).toBe(403);
    expect(await testPrisma.feedbackLog.count({ where: { mentorId: mentor.id } })).toBe(0);
    expect(await testPrisma.matchCombinationScore.count({ where: { tenantId } })).toBe(before);
  });

  it('negatif: mentör hiç görüşmediği menti için yazamaz (403)', async () => {
    const res = await http.post('/api/feedback-logs').set(tenantHeaders(tenantId, tokenFor(mentor))).send(body(mentor.id, strangerMenti.id));
    expect(res.status).toBe(403);
    expect(await testPrisma.feedbackLog.count({ where: { mentiId: strangerMenti.id } })).toBe(0);
  });

  it('negatif: menti bu uçtan yazamaz (403)', async () => {
    const res = await http.post('/api/feedback-logs').set(tenantHeaders(tenantId, tokenFor(menti))).send(body(mentor.id, menti.id));
    expect(res.status).toBe(403);
  });

  it('kurum yöneticisi yolu korunur (201)', async () => {
    const admin = await createAdminUser(tenantId);
    const res = await http.post('/api/feedback-logs').set(tenantHeaders(tenantId, tokenFor(admin))).send(body(mentor.id, menti.id));
    expect(res.status).toBe(201);
  });
});
