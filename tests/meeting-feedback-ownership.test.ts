/**
 * GÜVENLİK (CB ②): POST /api/meetings/:meetingId/feedback — görüşme tarafı sahipliği.
 *
 * Eskiden yazma ucu `req.auth`'a HİÇ bakmıyordu → kimliği doğrulanmış herhangi bir kullanıcı,
 * tarafı olmadığı bir görüşmeye değerlendirme yazıp (a) mentörün kalıcı kalite katsayısını
 * düşürebiliyor, (b) mentiye oryantasyon kilidi bastırabiliyor, (c) `hasFeedback` bayrağını
 * yakarak gerçek tarafların yazmasını engelleyebiliyordu.
 *
 * Şimdi: aynı dosyadaki OKUMA ucunun taraf kontrolü yazma yolunda da uygulanıyor; ayrıca
 * değerlendirenin yönü istekten değil görüşme kaydından çıkarılıyor.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { agent, tenantHeaders, type TestAgent } from './helpers/request.js';
import { cleanDb, testPrisma } from './helpers/db.js';
import { createTenant, createMentor, createMenti, createAdminUser } from './helpers/factories.js';
import { signToken } from '../src/middleware/jwtAuth.js';
import type { User } from '@prisma/client';

function tokenFor(u: Pick<User, 'id' | 'tenantId' | 'role' | 'fullName'>): string {
  return signToken({ sub: u.id, tenantId: u.tenantId, role: u.role, fullName: u.fullName });
}

describe('GÜVENLİK: POST /api/meetings/:id/feedback — yalnız görüşmenin tarafları', () => {
  let http: TestAgent;
  let tenantId: string;
  let mentor: Awaited<ReturnType<typeof createMentor>>;
  let menti: Awaited<ReturnType<typeof createMenti>>;
  let outsider: Awaited<ReturnType<typeof createMentor>>;
  let meetingId: string;

  beforeEach(async () => {
    await cleanDb();
    http = agent();
    const tenant = await createTenant();
    tenantId = tenant.id;

    mentor   = await createMentor(tenantId);
    menti    = await createMenti(tenantId);
    outsider = await createMentor(tenantId);   // aynı kurumda ama bu görüşmenin TARAFI DEĞİL

    const meeting = await testPrisma.meeting.create({
      data: {
        tenantId,
        mentorUserId: mentor.id,
        mentiUserId:  menti.id,
        status:       'COMPLETED',
        format:       'ONLINE',
        startsAt:     new Date(Date.now() - 2 * 60 * 60 * 1000),
        endsAt:       new Date(Date.now() - 1 * 60 * 60 * 1000),
      },
    });
    meetingId = meeting.id;
  });

  it('görüşmenin mentisi değerlendirme yazabilir (201)', async () => {
    await http
      .post(`/api/meetings/${meetingId}/feedback`)
      .set(tenantHeaders(tenantId, tokenFor(menti)))
      .send({ guidanceScore: 5, trustScore: 4 })
      .expect(201);

    const m = await testPrisma.meeting.findUnique({ where: { id: meetingId } });
    expect(m?.hasFeedback).toBe(true);
  });

  it('görüşmenin mentörü değerlendirme yazabilir (201)', async () => {
    await http
      .post(`/api/meetings/${meetingId}/feedback`)
      .set(tenantHeaders(tenantId, tokenFor(mentor)))
      .send({ preparednessScore: 4, proactivityScore: 5 })
      .expect(201);

    expect(await testPrisma.feedback.count({ where: { meetingId } })).toBe(1);
  });

  it('taraf OLMAYAN kullanıcı yazamaz (403); kilit · kalite · hasFeedback DEĞİŞMEZ', async () => {
    const res = await http
      .post(`/api/meetings/${meetingId}/feedback`)
      .set(tenantHeaders(tenantId, tokenFor(outsider)))
      .send({ preparednessScore: 1, guidanceScore: 1 })   // kilit + kalite düşürme denemesi
      .expect(403);

    expect(res.body.error).toBe('YETKISIZ');

    const m = await testPrisma.meeting.findUnique({ where: { id: meetingId } });
    expect(m?.hasFeedback).toBe(false);                                   // bayrak yakılmadı
    expect(await testPrisma.feedback.count({ where: { meetingId } })).toBe(0);

    const lockedMenti = await testPrisma.user.findUnique({ where: { id: menti.id } });
    expect(lockedMenti?.needsOrientation).toBe(false);                    // kilit basılmadı
  });

  it('mentör, mentinin mentöre verdiği puanları gönderemez (403)', async () => {
    const res = await http
      .post(`/api/meetings/${meetingId}/feedback`)
      .set(tenantHeaders(tenantId, tokenFor(mentor)))
      .send({ guidanceScore: 5, trustScore: 5 })   // kendi kalite katsayısını besleme denemesi
      .expect(403);

    expect(res.body.error).toBe('YETKISIZ_ALAN');
    expect(await testPrisma.feedback.count({ where: { meetingId } })).toBe(0);
  });

  it('menti, mentörün mentiye verdiği puanları gönderemez (403)', async () => {
    const res = await http
      .post(`/api/meetings/${meetingId}/feedback`)
      .set(tenantHeaders(tenantId, tokenFor(menti)))
      .send({ preparednessScore: 1 })              // kendine kilit bastırma denemesi
      .expect(403);

    expect(res.body.error).toBe('YETKISIZ_ALAN');

    const lockedMenti = await testPrisma.user.findUnique({ where: { id: menti.id } });
    expect(lockedMenti?.needsOrientation).toBe(false);
  });

  it('OKUMA ucunun mevcut davranışı BOZULMADI: admin okuyabilir, taraf olmayan okuyamaz', async () => {
    await http
      .post(`/api/meetings/${meetingId}/feedback`)
      .set(tenantHeaders(tenantId, tokenFor(menti)))
      .send({ guidanceScore: 5 })
      .expect(201);

    const admin = await createAdminUser(tenantId);
    await http
      .get(`/api/meetings/${meetingId}/feedback`)
      .set(tenantHeaders(tenantId, tokenFor(admin)))
      .expect(200);

    await http
      .get(`/api/meetings/${meetingId}/feedback`)
      .set(tenantHeaders(tenantId, tokenFor(outsider)))
      .expect(403);
  });
});
