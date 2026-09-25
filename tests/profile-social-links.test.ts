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

describe('K-08: sosyal bağlantı yalnız ilgili platformun adresi olabilir', () => {
  let http: TestAgent;
  let tenantId: string;
  let token: string;
  let userId: string;

  beforeEach(async () => {
    await cleanDb();
    http = agent();
    const tenant = await createTenant();
    tenantId = tenant.id;
    const menti = await createMenti(tenantId);
    userId = menti.id;
    token = tokenFor(menti);
  });

  for (const path of ['/api/users/me/profile', '/api/users/me/social']) {
    it(`${path}: doğru platform adresi kaydedilir, boş dize alanı temizler`, async () => {
      await http
        .patch(path)
        .set(tenantHeaders(tenantId, token))
        .send({ linkedinUrl: 'https://tr.linkedin.com/in/ornek', instagramUrl: 'https://www.instagram.com/ornek' })
        .expect(200);
      let u = await testPrisma.user.findUnique({ where: { id: userId } });
      expect(u!.linkedinUrl).toBe('https://tr.linkedin.com/in/ornek');
      expect(u!.instagramUrl).toBe('https://www.instagram.com/ornek');

      await http.patch(path).set(tenantHeaders(tenantId, token)).send({ instagramUrl: '' }).expect(200);
      u = await testPrisma.user.findUnique({ where: { id: userId } });
      expect(u!.instagramUrl).toBeNull();
    });

    it(`negatif: ${path} başka sitenin adresini ya da http(s) olmayan adresi reddeder, kayıt değişmez`, async () => {
      const bad = [
        { linkedinUrl: 'https://www.youtube.com/watch?v=abc' },
        { linkedinUrl: 'https://linkedin.com.example.com/in/x' },
        { instagramUrl: 'https://www.linkedin.com/in/ornek' },
        { linkedinUrl: 'javascript:alert(1)' },
      ];
      for (const body of bad) {
        const res = await http.patch(path).set(tenantHeaders(tenantId, token)).send(body);
        expect(res.status, JSON.stringify(body)).toBe(400);
      }
      const res = await http.patch(path).set(tenantHeaders(tenantId, token)).send(bad[0]);
      expect(JSON.stringify(res.body)).toContain('LinkedIn alanına yalnız linkedin.com adresi girilebilir');
      const u = await testPrisma.user.findUnique({ where: { id: userId } });
      expect(u!.linkedinUrl).toBeNull();
      expect(u!.instagramUrl).toBeNull();
    });
  }
});
