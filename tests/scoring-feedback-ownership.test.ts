/**
 * GÜVENLİK (CB ①): POST /api/scoring/feedback — eşleşme tarafı sahipliği.
 *
 * Eskiden `fromUserId` ve `role` İSTEK GÖVDESİNDEN alınıyordu ve servis yalnız eşleşmenin
 * tenant'a ait olduğunu doğruluyordu → aynı kurumdaki herhangi biri, tarafı olmadığı bir
 * eşleşmeye geri bildirim yazabiliyor, gerçek geri bildirimin üzerine basabiliyor ve
 * `earlyExit` ile ilişkiyi EARLY_EXIT'e çekebiliyordu.
 *
 * Şimdi: kimlik yalnız oturumdan, rol TenantMembership'ten, taraf olmayan 403.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { agent, tenantHeaders, type TestAgent } from './helpers/request.js';
import { cleanDb, testPrisma } from './helpers/db.js';
import { createTenant, createMentor, createMenti, createUserProfile } from './helpers/factories.js';
import { signToken } from '../src/middleware/jwtAuth.js';
import type { User } from '@prisma/client';

function tokenFor(u: Pick<User, 'id' | 'tenantId' | 'role' | 'fullName'>): string {
  return signToken({ sub: u.id, tenantId: u.tenantId, role: u.role, fullName: u.fullName });
}

describe('GÜVENLİK: POST /api/scoring/feedback — yalnız eşleşmenin tarafı', () => {
  let http: TestAgent;
  let tenantId: string;
  let mentor: Awaited<ReturnType<typeof createMentor>>;
  let menti: Awaited<ReturnType<typeof createMenti>>;
  let outsider: Awaited<ReturnType<typeof createMenti>>;
  let matchId: string;

  beforeEach(async () => {
    await cleanDb();
    http = agent();
    const tenant = await createTenant();
    tenantId = tenant.id;

    mentor   = await createMentor(tenantId);
    menti    = await createMenti(tenantId);
    outsider = await createMenti(tenantId);   // aynı kurumda ama eşleşmenin TARAFI DEĞİL

    // Match.mentorId/mentiId → UserProfile.id (User.id değil)
    const mentorProfile = await createUserProfile(mentor.id, { archetypeRole: 'MENTOR' });
    const mentiProfile  = await createUserProfile(menti.id,  { archetypeRole: 'MENTI' });

    const match = await testPrisma.match.create({
      data: {
        tenantId,
        mentorId:        mentorProfile.id,
        mentiId:         mentiProfile.id,
        mentorArchetype: 'M1',
        mentiArchetype:  'm1',
        predictedScore:  0.8,
        sectorScore:     0.6,
        characterScore:  0.4,
        status:          'ACTIVE',
      },
    });
    matchId = match.id;
  });

  it('eşleşmenin tarafı (menti) geri bildirim yazabilir (201)', async () => {
    const res = await http
      .post('/api/scoring/feedback')
      .set(tenantHeaders(tenantId, tokenFor(menti)))
      .send({ matchId, checkpoint: 'DAY_3', progressScore: 4, rapportScore: 5 })
      .expect(201);

    expect(res.body.recorded).toBe(true);

    // Kimlik oturumdan alındı, rol kurum üyeliğinden yazıldı
    const saved = await testPrisma.matchFeedback.findFirst({ where: { matchId } });
    expect(saved?.fromUserId).toBe(menti.id);
    expect(saved?.role).toBe('MENTI');
  });

  it('eşleşmenin tarafı (mentör) de yazabilir (201)', async () => {
    await http
      .post('/api/scoring/feedback')
      .set(tenantHeaders(tenantId, tokenFor(mentor)))
      .send({ matchId, checkpoint: 'DAY_3', rapportScore: 3 })
      .expect(201);

    const saved = await testPrisma.matchFeedback.findFirst({ where: { fromUserId: mentor.id } });
    expect(saved?.role).toBe('MENTOR');
  });

  it('taraf OLMAYAN aynı kurum kullanıcısı yazamaz (403) ve eşleşme durumu DEĞİŞMEZ', async () => {
    const res = await http
      .post('/api/scoring/feedback')
      .set(tenantHeaders(tenantId, tokenFor(outsider)))
      .send({ matchId, checkpoint: 'DAY_3', earlyExit: true, rapportScore: 1 })
      .expect(403);

    expect(res.body.error).toBe('NOT_MATCH_PARTY');

    const match = await testPrisma.match.findUnique({ where: { id: matchId } });
    expect(match?.status).toBe('ACTIVE');            // earlyExit UYGULANMADI
    expect(await testPrisma.matchFeedback.count({ where: { matchId } })).toBe(0);
  });

  it('sahte fromUserId/role gönderilse bile OTURUMDAKİ kimlik kullanılır', async () => {
    await http
      .post('/api/scoring/feedback')
      .set(tenantHeaders(tenantId, tokenFor(menti)))
      // Eski istemciler bu alanları göndermeye devam edebilir: istek REDDEDİLMEZ, alanlar yok sayılır.
      .send({
        matchId, checkpoint: 'DAY_14', rapportScore: 4,
        fromUserId: outsider.id,   // sahte kimlik
        role:       'ADMIN',       // sahte rol
      })
      .expect(201);

    const saved = await testPrisma.matchFeedback.findFirst({ where: { matchId, checkpoint: 'DAY_14' } });
    expect(saved?.fromUserId).toBe(menti.id);   // sahte değil, oturumdaki
    expect(saved?.role).toBe('MENTI');          // sahte değil, üyelikten
  });

  it('başka kurumdan kullanıcı yazamaz', async () => {
    const otherTenant = await createTenant();
    const stranger = await createMenti(otherTenant.id);

    // Kendi kurumunun başlığıyla: eşleşme o tenant'ta yok → 404
    await http
      .post('/api/scoring/feedback')
      .set(tenantHeaders(otherTenant.id, tokenFor(stranger)))
      .send({ matchId, checkpoint: 'DAY_3', rapportScore: 5 })
      .expect(404);

    expect(await testPrisma.matchFeedback.count({ where: { matchId } })).toBe(0);
  });
});
