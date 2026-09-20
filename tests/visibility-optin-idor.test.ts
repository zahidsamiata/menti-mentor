/**
 * IDOR: POST /mentors/:mentorId/visibility-optin — self + admin ownership. (W §4#6)
 *
 * requireSelfOrAdmin('mentorId') ile korunuyor: bir mentör :mentorId'yi başka bir
 * mentörünkiyle değiştirerek O mentör adına opt-in kaydı oluşturamaz/ezemez (403).
 * Kendi adına (mentorId=self) ve ADMIN başkası adına yazabilir (mevcut komşu uç deseni).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { agent, tenantHeaders, type TestAgent } from './helpers/request.js';
import { cleanDb } from './helpers/db.js';
import { createTenant, createMentor, createMenti, createAdminUser } from './helpers/factories.js';
import { signToken } from '../src/middleware/jwtAuth.js';
import type { User } from '@prisma/client';

function tokenFor(u: Pick<User, 'id' | 'tenantId' | 'role' | 'fullName'>): string {
  return signToken({ sub: u.id, tenantId: u.tenantId, role: u.role, fullName: u.fullName });
}

describe('IDOR: POST /mentors/:mentorId/visibility-optin — self+admin ownership', () => {
  let http: TestAgent;
  let tenantId: string;
  let mentorA: Awaited<ReturnType<typeof createMentor>>;
  let mentorB: Awaited<ReturnType<typeof createMentor>>;
  let menti: Awaited<ReturnType<typeof createMenti>>;
  let admin: Awaited<ReturnType<typeof createAdminUser>>;

  beforeEach(async () => {
    await cleanDb();
    http = agent();
    const tenant = await createTenant();
    tenantId = tenant.id;
    mentorA = await createMentor(tenantId);
    mentorB = await createMentor(tenantId);
    menti = await createMenti(tenantId);
    admin = await createAdminUser(tenantId);
  });

  it('mentör KENDİ adına opt-in yazabilir (200)', async () => {
    await http
      .post(`/api/mentors/${mentorA.id}/visibility-optin`)
      .set(tenantHeaders(tenantId, tokenFor(mentorA)))
      .send({ mentiId: menti.id })
      .expect(200);
  });

  it('mentör BAŞKA mentörün adına opt-in yazamaz (403)', async () => {
    const res = await http
      .post(`/api/mentors/${mentorB.id}/visibility-optin`)
      .set(tenantHeaders(tenantId, tokenFor(mentorA)))
      .send({ mentiId: menti.id })
      .expect(403);
    expect(res.body.error).toBe('YETKI_YETERSIZ');
  });

  it('ADMIN başka mentörün adına opt-in yazabilir (200)', async () => {
    await http
      .post(`/api/mentors/${mentorB.id}/visibility-optin`)
      .set(tenantHeaders(tenantId, tokenFor(admin)))
      .send({ mentiId: menti.id })
      .expect(200);
  });
});
