/**
 * KR-06 — GET /api/users/:id kendi kaydında LinkedIn/Instagram bağlantılarını döndürür
 * (profil formu bu uçtan doluyor; eksik olunca kayıtta bağlantılar siliniyordu).
 * Başka bir kullanıcının herkese açık görünümünde bu alanlar yer almaz.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { agent, tenantHeaders, type TestAgent } from './helpers/request.js';
import { cleanDb, testPrisma } from './helpers/db.js';
import { createTenant, createMentor, createMenti } from './helpers/factories.js';
import { signToken } from '../src/middleware/jwtAuth.js';
import type { User } from '@prisma/client';

function tokenFor(u: Pick<User, 'id' | 'tenantId' | 'role' | 'fullName'>): string {
  return signToken({ sub: u.id, tenantId: u.tenantId, role: u.role, fullName: u.fullName });
}

describe('KR-06: profil sosyal bağlantıları', () => {
  let http: TestAgent;
  let tenantId: string;
  let menti: Awaited<ReturnType<typeof createMenti>>;

  beforeEach(async () => {
    await cleanDb();
    http = agent();
    const tenant = await createTenant();
    tenantId = tenant.id;
    menti = await createMenti(tenantId);
    await testPrisma.user.update({
      where: { id: menti.id },
      data: { linkedinUrl: 'https://www.linkedin.com/in/ornek', instagramUrl: 'https://instagram.com/ornek' },
    });
  });

  it('kişi kendi kaydında bağlantılarını görür (form dolu açılır)', async () => {
    const res = await http.get(`/api/users/${menti.id}`).set(tenantHeaders(tenantId, tokenFor(menti))).expect(200);
    expect(res.body.linkedinUrl).toBe('https://www.linkedin.com/in/ornek');
    expect(res.body.instagramUrl).toBe('https://instagram.com/ornek');
  });

  it('negatif: başka kullanıcının herkese açık görünümünde bağlantılar yok', async () => {
    const mentor = await createMentor(tenantId);
    const res = await http.get(`/api/users/${menti.id}`).set(tenantHeaders(tenantId, tokenFor(mentor)));
    expect(res.body).not.toHaveProperty('linkedinUrl');
    expect(res.body).not.toHaveProperty('instagramUrl');
  });
});
