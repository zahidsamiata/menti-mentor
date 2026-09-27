/**
 * AJ-20 — POST /api/scoring/rank-mentors onay kapısı (U-08 kalanı).
 * Onay bekleyen hesap, komşu eşleşme uçlarındaki (matchingController) gibi 403 ONAY_BEKLENIYOR alır ve
 * yanıtta sıralama verisi (results/totalEligible) YOKTUR. Reddedilmiş hesap requireTenant'ta (GV-10)
 * 401 HESAP_PASIF ile kesilir — yine veri dönmez. Onaylı hesap ve kurum yöneticisi 200 alır.
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

describe('AJ-20: rank-mentors onay kapısı', () => {
  let http: TestAgent;
  let tenantId: string;

  beforeEach(async () => {
    await cleanDb();
    http = agent();
    tenantId = (await createTenant()).id;
    const mentor = await createMentor(tenantId);
    await createUserProfile(mentor.id, { archetype: 'ARCHITECT', archetypeRole: 'MENTOR' });
  });

  async function mentiWithProfile(approvalStatus: 'APPROVED' | 'PENDING' | 'REJECTED') {
    const menti = await createMenti(tenantId, { approvalStatus });
    const profileId = (await createUserProfile(menti.id, { archetype: 'EXPLORER', archetypeRole: 'MENTI' })).id;
    return { menti, profileId };
  }

  it('onaylı menti kendi mentör sıralamasını alır (200, sıralama yanıtı)', async () => {
    const { menti, profileId } = await mentiWithProfile('APPROVED');
    const res = await http
      .post('/api/scoring/rank-mentors')
      .set(tenantHeaders(tenantId, tokenFor(menti)))
      .send({ mentiId: profileId });
    expect(res.status).toBe(200);
    expect(typeof res.body.totalEligible).toBe('number');
    expect(Array.isArray(res.body.results)).toBe(true);
  });

  it('negatif: onay bekleyen menti kendi sıralamasını alamaz (403 ONAY_BEKLENIYOR, veri yok)', async () => {
    const { menti, profileId } = await mentiWithProfile('PENDING');
    const res = await http
      .post('/api/scoring/rank-mentors')
      .set(tenantHeaders(tenantId, tokenFor(menti)))
      .send({ mentiId: profileId });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('ONAY_BEKLENIYOR');
    expect(res.body.message).toBe('Eşleşme önerilerini görmek için yönetici onayı gerekli.');
    expect(res.body).not.toHaveProperty('results');
    expect(res.body).not.toHaveProperty('totalEligible');
  });

  it('negatif: reddedilmiş menti de alamaz (401 HESAP_PASIF, veri yok)', async () => {
    // GV-10: requireTenant REJECTED hesabı route'a ulaştırmadan keser (matching-approval-gate.test.ts ile aynı).
    const { menti, profileId } = await mentiWithProfile('REJECTED');
    const res = await http
      .post('/api/scoring/rank-mentors')
      .set(tenantHeaders(tenantId, tokenFor(menti)))
      .send({ mentiId: profileId });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('HESAP_PASIF');
    expect(res.body).not.toHaveProperty('results');
  });

  it('kurum yöneticisi onay bekleyen mentinin sıralamasını görebilir (kapıya takılmaz, 200)', async () => {
    const { profileId } = await mentiWithProfile('PENDING');
    const admin = await createAdminUser(tenantId);
    const res = await http
      .post('/api/scoring/rank-mentors')
      .set(tenantHeaders(tenantId, tokenFor(admin)))
      .send({ mentiId: profileId });
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.results)).toBe(true);
  });
});
