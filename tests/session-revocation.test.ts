/**
 * GV-10 — rol düşürme / red / pasife alma / çıkış sonrası erişim.
 *
 * Kural: requireTenant her istekte üyelik + hesap durumunu veritabanından okur; kurum-içi rol
 * JWT'den değil TenantMembership'ten gelir. Rol düşürme, red ve pasife alma o kullanıcının
 * refresh token'larını siler (oturum yenilenemez).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { agent, loginAs, tenantHeaders, type TestAgent } from './helpers/request.js';
import { cleanDb, testPrisma } from './helpers/db.js';
import { createTenant, createAdminUser, createMentor, createMenti } from './helpers/factories.js';

describe('GV-10 — oturum ve rol her istekte güncel durumdan okunur', () => {
  let tenantId: string;
  let actorHttp: TestAgent;
  let actorToken: string;

  beforeEach(async () => {
    await cleanDb();
    tenantId = (await createTenant()).id;
    const actor = await createAdminUser(tenantId);
    actorHttp = agent();
    actorToken = (await loginAs(actorHttp, actor.email, actor.rawPassword)).accessToken;
  });

  it('pozitif: normal yönetici ve mentör etkilenmez', async () => {
    await actorHttp.get('/api/admin/managers').set(tenantHeaders(tenantId, actorToken)).expect(200);

    const mentor = await createMentor(tenantId);
    const http = agent();
    const { accessToken } = await loginAs(http, mentor.email, mentor.rawPassword);
    const me = await http.get('/api/auth/me').set(tenantHeaders(tenantId, accessToken)).expect(200);
    expect(me.body.role ?? me.body.user?.role).toBe('MENTOR');
    await http.post('/api/auth/refresh').expect(200);
  });

  it('negatif: rolü MENTOR\'a düşürülen eski yönetici aynı access token\'la yönetici ucuna erişemez (403) ve oturumu yenileyemez', async () => {
    const second = await createAdminUser(tenantId);
    const http = agent();
    const { accessToken } = await loginAs(http, second.email, second.rawPassword);
    await http.get('/api/admin/managers').set(tenantHeaders(tenantId, accessToken)).expect(200);

    await actorHttp
      .post(`/api/admin/users/${second.id}/demote-admin`)
      .set(tenantHeaders(tenantId, actorToken))
      .expect(200);

    const res = await http.get('/api/admin/managers').set(tenantHeaders(tenantId, accessToken));
    expect(res.status).toBe(403);

    expect(await testPrisma.refreshToken.count({ where: { userId: second.id } })).toBe(0);
    await http.post('/api/auth/refresh').expect(401);
  });

  it('negatif: token rolü ADMIN ama üyelik rolü MENTOR ise yönetici ucu 403 (kaynak üyelik)', async () => {
    const second = await createAdminUser(tenantId);
    const http = agent();
    const { accessToken } = await loginAs(http, second.email, second.rawPassword);
    await testPrisma.tenantMembership.update({
      where: { userId_tenantId: { userId: second.id, tenantId } },
      data:  { role: 'MENTOR' },
    });

    const res = await http.get('/api/admin/managers').set(tenantHeaders(tenantId, accessToken));
    expect(res.status).toBe(403);
  });

  it('negatif: reddedilen kullanıcı mevcut access token\'la erişemez (401) ve oturumu yenileyemez', async () => {
    const menti = await createMenti(tenantId);
    const http = agent();
    const { accessToken } = await loginAs(http, menti.email, menti.rawPassword);
    await http.get('/api/auth/me').set(tenantHeaders(tenantId, accessToken)).expect(200);

    await actorHttp
      .post(`/api/admin/users/${menti.id}/reject`)
      .set(tenantHeaders(tenantId, actorToken))
      .send({})
      .expect(200);

    const res = await http.get('/api/auth/me').set(tenantHeaders(tenantId, accessToken));
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('HESAP_PASIF');

    expect(await testPrisma.refreshToken.count({ where: { userId: menti.id } })).toBe(0);
    await http.post('/api/auth/refresh').expect(401);
  });

  it('negatif: pasife alınan kullanıcı mevcut access token\'la erişemez (401) ve oturumu yenileyemez', async () => {
    const mentor = await createMentor(tenantId);
    const http = agent();
    const { accessToken } = await loginAs(http, mentor.email, mentor.rawPassword);

    await actorHttp
      .patch(`/api/users/${mentor.id}`)
      .set(tenantHeaders(tenantId, actorToken))
      .send({ isActive: false })
      .expect(200);

    const res = await http.get('/api/auth/me').set(tenantHeaders(tenantId, accessToken));
    expect(res.status).toBe(401);
    expect(await testPrisma.refreshToken.count({ where: { userId: mentor.id } })).toBe(0);
    await http.post('/api/auth/refresh').expect(401);
  });

  it('negatif: çıkış sonrası refresh çalışmaz', async () => {
    const mentor = await createMentor(tenantId);
    const http = agent();
    await loginAs(http, mentor.email, mentor.rawPassword);
    await http.post('/api/auth/logout').expect(204);
    await http.post('/api/auth/refresh').expect(401);
  });
});
