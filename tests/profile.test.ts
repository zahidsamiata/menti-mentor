/**
 * Profil düzenleme endpoint testleri — PATCH /api/users/me/profile
 *
 * Kapsam:
 *  - Kullanıcı kendi profilini güncelleyebilir
 *  - Başka kullanıcının profilini güncelleyemez (403)
 *  - role / approvalStatus gibi korumalı alanlar strict şema tarafından reddedilir
 *  - Uzunluk sınırları aşıldığında 400 döner
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { agent, loginAs, tenantHeaders, type TestAgent } from './helpers/request.js';
import { cleanDb } from './helpers/db.js';
import { createTenant, createUser } from './helpers/factories.js';
import type { Tenant } from '@prisma/client';

describe('PATCH /api/users/me/profile', () => {
  let http: TestAgent;
  let tenant: Tenant;
  let userToken: string;
  let userId: string;

  beforeEach(async () => {
    await cleanDb();
    http = agent();
    tenant = await createTenant();
    const user = await createUser({ tenantId: tenant.id, role: 'MENTOR', approvalStatus: 'APPROVED' });
    userId = user.id;
    const tokens = await loginAs(http, user.email, user.rawPassword);
    userToken = tokens.accessToken;
  });

  it('kendi profilini başarıyla günceller', async () => {
    const res = await http
      .patch('/api/users/me/profile')
      .set(tenantHeaders(tenant.id, userToken))
      .send({
        bioSummary: 'Ben bir mentor olarak 10 yıldır teknoloji sektöründeyim.',
        expertiseDetails: 'Backend geliştirme, sistem tasarımı',
        targetAudience: 'Yazılım mühendisliğine geçiş yapmak isteyen adaylar',
        linkedinUrl: 'https://linkedin.com/in/testuser',
        skills: ['Yazılım Geliştirme', 'Proje Yönetimi'],
      })
      .expect(200);

    const body = res.body as Record<string, unknown>;
    expect(body.bioSummary).toBe('Ben bir mentor olarak 10 yıldır teknoloji sektöründeyim.');
    expect(body.expertiseDetails).toBe('Backend geliştirme, sistem tasarımı');
    expect(body.linkedinUrl).toBe('https://linkedin.com/in/testuser');
    expect(Array.isArray(body.skills)).toBe(true);
  });

  it('boş string gönderilince ilgili alan null olarak kaydedilir', async () => {
    await http
      .patch('/api/users/me/profile')
      .set(tenantHeaders(tenant.id, userToken))
      .send({ bioSummary: 'Var olan bio' })
      .expect(200);

    const res = await http
      .patch('/api/users/me/profile')
      .set(tenantHeaders(tenant.id, userToken))
      .send({ bioSummary: '' })
      .expect(200);

    expect((res.body as Record<string, unknown>).bioSummary).toBeNull();
  });

  it('role alanı gönderilince 400 döner (strict şema)', async () => {
    await http
      .patch('/api/users/me/profile')
      .set(tenantHeaders(tenant.id, userToken))
      .send({ role: 'ADMIN' })
      .expect(400);
  });

  it('approvalStatus alanı gönderilince 400 döner', async () => {
    await http
      .patch('/api/users/me/profile')
      .set(tenantHeaders(tenant.id, userToken))
      .send({ approvalStatus: 'APPROVED' })
      .expect(400);
  });

  it('bioSummary 1000 karakteri aşarsa 400 döner', async () => {
    await http
      .patch('/api/users/me/profile')
      .set(tenantHeaders(tenant.id, userToken))
      .send({ bioSummary: 'a'.repeat(1001) })
      .expect(400);
  });

  it('geçersiz URL gönderilince 400 döner', async () => {
    await http
      .patch('/api/users/me/profile')
      .set(tenantHeaders(tenant.id, userToken))
      .send({ linkedinUrl: 'bu-bir-url-degil' })
      .expect(400);
  });

  it('token olmadan 401 döner', async () => {
    await http
      .patch('/api/users/me/profile')
      .set({ 'X-Tenant-Id': tenant.id })
      .send({ bioSummary: 'test' })
      .expect(401);
  });

  it('başka bir kullanıcının profili /me endpoint ile değiştirilemez — kendi userId hedef alınır', async () => {
    const otherUser = await createUser({ tenantId: tenant.id, role: 'MENTI', approvalStatus: 'APPROVED' });

    // /me endpoint kendi kaydını günceller — otherUser'ın ID'si parametre olarak gönderilemiyor
    // Bu test, /users/:id PATCH'in ADMIN gerektirdiğini doğrular
    const res = await http
      .patch(`/api/users/${otherUser.id}`)
      .set(tenantHeaders(tenant.id, userToken))
      .send({ bioSummary: 'hack attempt' })
      .expect(403); // ADMIN değil

    expect(res.body).toBeTruthy();
  });

  it('sectorTags geçerli biçimde kaydedilir ve normalize edilir', async () => {
    const res = await http
      .patch('/api/users/me/profile')
      .set(tenantHeaders(tenant.id, userToken))
      .send({ sectorTags: ['  Teknoloji  ', 'Finans'] })
      .expect(200);

    const tags = (res.body as Record<string, unknown>).sectorTags as string[];
    expect(tags).toContain('teknoloji');
    expect(tags).toContain('finans');
  });
});
