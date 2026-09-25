/**
 * GV-25 — POST /api/scoring/rank-mentors sahiplik kontrolü.
 * mentiId (UserProfile.id) gövdeden gelir; komşu uç compute-profile ile aynı kural uygulanır:
 * MENTI yalnız KENDİ profiliyle sıralama ister; ADMIN kurum içinde herhangi biriyle; başka kurum görünmez.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { cleanDb } from './helpers/db.js';
import { createTenant, createMenti, createMentor, createAdminUser, createUserProfile } from './helpers/factories.js';
import { agent, tenantHeaders, type TestAgent } from './helpers/request.js';
import { signToken } from '../src/middleware/jwtAuth.js';
import type { User } from '@prisma/client';

function tokenFor(u: Pick<User, 'id' | 'tenantId' | 'role' | 'fullName'>): string {
  return signToken({ sub: u.id, tenantId: u.tenantId, role: u.role, fullName: u.fullName });
}

describe('GV-25: rank-mentors yalnız kendi profiliyle', () => {
  let http: TestAgent;
  let tenantId: string;
  let mentiA: User;
  let mentiB: User;
  let profileA: string;
  let profileB: string;

  beforeEach(async () => {
    await cleanDb();
    http = agent();
    tenantId = (await createTenant()).id;
    mentiA = await createMenti(tenantId);
    mentiB = await createMenti(tenantId);
    const mentor = await createMentor(tenantId);
    profileA = (await createUserProfile(mentiA.id, { archetype: 'EXPLORER', archetypeRole: 'MENTI' })).id;
    profileB = (await createUserProfile(mentiB.id, { archetype: 'EXPLORER', archetypeRole: 'MENTI' })).id;
    await createUserProfile(mentor.id, { archetype: 'ARCHITECT', archetypeRole: 'MENTOR' });
  });

  it('negatif: menti başka kullanıcının profiliyle sıralama isteyemez (403)', async () => {
    const res = await http
      .post('/api/scoring/rank-mentors')
      .set(tenantHeaders(tenantId, tokenFor(mentiA)))
      .send({ mentiId: profileB });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('YETKISIZ');
    expect(res.body).not.toHaveProperty('results');
  });

  it('kendi profiliyle sıralama alır (200)', async () => {
    const res = await http
      .post('/api/scoring/rank-mentors')
      .set(tenantHeaders(tenantId, tokenFor(mentiA)))
      .send({ mentiId: profileA });
    expect(res.status).toBe(200);
    expect(res.body.mentiId).toBe(profileA);
    expect(Array.isArray(res.body.results)).toBe(true);
  });

  it('ADMIN kurum içindeki bir mentinin sıralamasını alabilir (200)', async () => {
    const admin = await createAdminUser(tenantId);
    const res = await http
      .post('/api/scoring/rank-mentors')
      .set(tenantHeaders(tenantId, tokenFor(admin)))
      .send({ mentiId: profileB });
    expect(res.status).toBe(200);
  });

  it('negatif: başka kurumun profili görünmez — ADMIN için bile (404)', async () => {
    const otherTenantId = (await createTenant()).id;
    const outsider = await createMenti(otherTenantId);
    const outsiderProfile = (await createUserProfile(outsider.id, { archetype: 'EXPLORER' })).id;
    const admin = await createAdminUser(tenantId);
    for (const caller of [mentiA, admin]) {
      const res = await http
        .post('/api/scoring/rank-mentors')
        .set(tenantHeaders(tenantId, tokenFor(caller)))
        .send({ mentiId: outsiderProfile });
      expect(res.status).toBe(404);
      expect(res.body).not.toHaveProperty('results');
    }
  });
});
