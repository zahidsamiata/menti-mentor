/**
 * KR-02 / KR-03 — oturum yenilemede kullanıcı + KENDİ kurum markası.
 *
 * Neden: sayfa yenilenince (sessiz refresh) istemci kullanıcı bilgisini ve kurum
 * markasını alamıyordu; marka için çağrılan uç yalnız platform yöneticisine açıktı.
 * Artık /api/auth/refresh ve /api/auth/me, oturumdaki kullanıcının KENDİ kurumunu
 * döndürür. Negatif: başka kurumun markası hiçbir yoldan dönmez.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { agent, type TestAgent, loginAs, tenantHeaders } from './helpers/request.js';
import { cleanDb, testPrisma } from './helpers/db.js';
import { createTenant, createUser } from './helpers/factories.js';

describe('KR-02/KR-03: refresh + me kurum markası', () => {
  let http: TestAgent;

  beforeEach(async () => {
    await cleanDb();
    http = agent();
  });

  it('refresh: kullanıcıyı ve KENDİ kurumunun markasını döndürür; şifre ve ham DISC vektörü dönmez', async () => {
    const own = await createTenant({ name: 'Kendi Kurum' });
    const other = await createTenant({ name: 'Başka Kurum' });
    await testPrisma.tenant.update({ where: { id: own.id }, data: { primaryColor: '#112233', logoUrl: 'https://example.com/own.png' } });
    await testPrisma.tenant.update({ where: { id: other.id }, data: { primaryColor: '#abcdef' } });
    const user = await createUser({ tenantId: own.id, role: 'MENTI' });
    await loginAs(http, user.email, user.rawPassword);

    const res = await http.post('/api/auth/refresh').expect(200);

    expect(res.body.accessToken).toBeDefined();
    expect(res.body.user).toMatchObject({ id: user.id, tenantId: own.id, email: user.email, role: 'MENTI' });
    expect(res.body.user).not.toHaveProperty('password');
    expect(res.body.user).not.toHaveProperty('discVector');
    expect(res.body.tenant).toEqual({
      id: own.id,
      name: 'Kendi Kurum',
      slug: own.slug,
      logoUrl: 'https://example.com/own.png',
      primaryColor: '#112233',
    });
    expect(res.body.tenant.id).not.toBe(other.id);
  });

  it('me: tenantId ve kendi kurum markası döner', async () => {
    const own = await createTenant({ name: 'Kendi Kurum' });
    await testPrisma.tenant.update({ where: { id: own.id }, data: { primaryColor: '#112233' } });
    const user = await createUser({ tenantId: own.id, role: 'MENTOR' });
    const tok = await loginAs(http, user.email, user.rawPassword);

    const res = await http.get('/api/auth/me').set(tenantHeaders(own.id, tok.accessToken)).expect(200);

    expect(res.body.tenantId).toBe(own.id);
    expect(res.body.tenant).toMatchObject({ id: own.id, name: 'Kendi Kurum', slug: own.slug, primaryColor: '#112233' });
    expect(res.body.tenant.correctionNote).toBeNull(); // MENTOR'a düzeltme notu sızmaz (#37 korunur)
  });

  it('negatif: başka kurumun başlığıyla me çağrısı o kurumun markasını döndürmez', async () => {
    const own = await createTenant({ name: 'Kendi Kurum' });
    const other = await createTenant({ name: 'Başka Kurum' });
    const user = await createUser({ tenantId: own.id, role: 'MENTI' });
    const tok = await loginAs(http, user.email, user.rawPassword);

    const res = await http.get('/api/auth/me').set(tenantHeaders(other.id, tok.accessToken));

    expect(res.status).not.toBe(200);
    expect(JSON.stringify(res.body)).not.toContain('Başka Kurum');
  });

  it('negatif: çerez olmadan refresh 401 döner ve hiçbir kullanıcı/kurum bilgisi içermez', async () => {
    const res = await agent().post('/api/auth/refresh').expect(401);
    expect(res.body).not.toHaveProperty('user');
    expect(res.body).not.toHaveProperty('tenant');
  });
});
