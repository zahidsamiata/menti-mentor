/**
 * AN-29 / KARAR-34 SORU 1 — topluluk tipi kurum (entegrasyon; DB → CI'da koşar).
 *
 * Kapsam: kayıt yolunda tür kaydı (Zod izin listesi) · mevcut kurum kaydı değişmedi · topluluk
 * başvurusu platform onayına düşer ve onay listesinde türüyle görünür · negatifler: geçersiz tür
 * reddedilir (kurum oluşmaz), kurum yöneticisi türü değiştiremez (ayar/kurulum uçları alanı reddeder),
 * yönetici olmayan üye ayar ucuna erişemez, platform yetkisi olmayan onay listesini göremez.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { agent, loginAs, tenantHeaders, type TestAgent } from './helpers/request.js';
import { cleanDb, testPrisma } from './helpers/db.js';
import { createTenant, createUser } from './helpers/factories.js';
import { signToken, PLATFORM_AUDIENCE } from '../src/middleware/jwtAuth.js';

function makePlatformCookie(): string {
  const token = signToken(
    { sub: 'platform-admin', tenantId: '__platform__', role: 'ADMIN', fullName: 'Platform Yöneticisi', isPlatformAdmin: true },
    { audience: PLATFORM_AUDIENCE },
  );
  return `platform_token=${encodeURIComponent(token)}`;
}

function payload(email: string, slug: string, extra: Record<string, unknown> = {}) {
  return {
    email,
    password: 'Test1234!',
    name: 'Test Lider',
    tenantName: `Test ${slug}`,
    slug,
    programTemplate: 'OZEL',
    kvkkConsent: true,
    institutionRole: 'Topluluk Lideri',
    verificationNote: 'https://example.com/topluluk',
    ...extra,
  };
}

describe('AN-29: self-serve kayıtta kurum türü', () => {
  let http: TestAgent;

  beforeEach(async () => {
    await cleanDb();
    http = agent();
  });

  it('topluluk: kurumsal alan adıyla bile PENDING_REVIEW, tür DB\'ye yazılır ve yanıtta döner', async () => {
    const res = await http
      .post('/api/tenants/self-serve/register')
      .send(payload('lider@topluluk-ornek.org', 'an29-topluluk', { kind: 'COMMUNITY' }))
      .expect(201);
    expect(res.body.tenant.kind).toBe('COMMUNITY');
    expect(res.body.tenant.verificationStatus).toBe('PENDING_REVIEW');
    const t = await testPrisma.tenant.findUnique({ where: { slug: 'an29-topluluk' }, select: { kind: true, verificationStatus: true } });
    expect(t).toEqual({ kind: 'COMMUNITY', verificationStatus: 'PENDING_REVIEW' });
  });

  it('mevcut kurum kaydı değişmedi: tür gönderilmezse NULL + kurumsal alan adı otomatik onay', async () => {
    const res = await http
      .post('/api/tenants/self-serve/register')
      .send(payload('admin@dernek-ornek.org', 'an29-eski'))
      .expect(201);
    expect(res.body.tenant.verificationStatus).toBe('AUTO_APPROVED');
    expect(res.body.tenant.kind).toBeNull();
    const t = await testPrisma.tenant.findUnique({ where: { slug: 'an29-eski' }, select: { kind: true } });
    expect(t?.kind).toBeNull();
  });

  it('ORGANIZATION seçilirse tür yazılır, alan adı davranışı aynı kalır', async () => {
    const res = await http
      .post('/api/tenants/self-serve/register')
      .send(payload('admin@kurum-ornek.org', 'an29-kurum', { kind: 'ORGANIZATION' }))
      .expect(201);
    expect(res.body.tenant.kind).toBe('ORGANIZATION');
    expect(res.body.tenant.verificationStatus).toBe('AUTO_APPROVED');
  });

  it('negatif: izin listesinde olmayan tür 400, kurum oluşmaz', async () => {
    await http
      .post('/api/tenants/self-serve/register')
      .send(payload('admin@kurum-ornek.org', 'an29-gecersiz', { kind: 'CLUB' }))
      .expect(400);
    expect(await testPrisma.tenant.count({ where: { slug: 'an29-gecersiz' } })).toBe(0);
  });
});

describe('AN-29: platform onay görünümü', () => {
  let http: TestAgent;

  beforeEach(async () => {
    await cleanDb();
    http = agent();
  });

  it('topluluk başvurusu bekleyen listede türüyle görünür; tüm kurumlar listesinde de tür var', async () => {
    await http.post('/api/tenants/self-serve/register')
      .send(payload('lider@gmail.com', 'an29-bekleyen', { kind: 'COMMUNITY' })).expect(201);

    const pending = await http.get('/api/platform/tenants/pending').set('Cookie', makePlatformCookie()).expect(200);
    const row = (pending.body.items as { slug: string; kind: string | null }[]).find((i) => i.slug === 'an29-bekleyen');
    expect(row?.kind).toBe('COMMUNITY');

    const all = await http.get('/api/platform/tenants').set('Cookie', makePlatformCookie()).expect(200);
    const allRow = (all.body.items as { slug: string; kind: string | null }[]).find((i) => i.slug === 'an29-bekleyen');
    expect(allRow?.kind).toBe('COMMUNITY');

    const id = (await testPrisma.tenant.findUnique({ where: { slug: 'an29-bekleyen' }, select: { id: true } }))!.id;
    const overview = await http.get(`/api/platform/tenants/${id}/overview`).set('Cookie', makePlatformCookie()).expect(200);
    expect(overview.body.tenant.kind).toBe('COMMUNITY');
  });

  it('negatif: platform yetkisi olmadan bekleyen listesi görülemez', async () => {
    const res = await http.get('/api/platform/tenants/pending');
    expect([401, 403]).toContain(res.status);
  });
});

describe('AN-29: türü kayıttan sonra kimse değiştiremez (negatif)', () => {
  let http: TestAgent;
  let tenantId: string;

  beforeEach(async () => {
    await cleanDb();
    http = agent();
    const tenant = await createTenant();
    tenantId = tenant.id;
    await testPrisma.tenant.update({ where: { id: tenantId }, data: { kind: 'COMMUNITY' } });
  });

  it('kurum yöneticisi ayar ucunda türü gönderirse 400, tür değişmez', async () => {
    const admin = await createUser({ tenantId, role: 'ADMIN' });
    const { accessToken } = await loginAs(http, admin.email, admin.rawPassword);
    await http.patch(`/api/tenants/${tenantId}/settings`).set(tenantHeaders(tenantId, accessToken))
      .send({ kind: 'ORGANIZATION' }).expect(400);
    await http.patch(`/api/tenants/${tenantId}/onboarding`).set('Authorization', `Bearer ${accessToken}`)
      .send({ kind: 'ORGANIZATION' }).expect(400);
    const t = await testPrisma.tenant.findUnique({ where: { id: tenantId }, select: { kind: true } });
    expect(t?.kind).toBe('COMMUNITY');
  });

  it('yönetici olmayan üye (mentör) ayar ucuna erişemez, tür değişmez', async () => {
    const mentor = await createUser({ tenantId, role: 'MENTOR' });
    const { accessToken } = await loginAs(http, mentor.email, mentor.rawPassword);
    const res = await http.patch(`/api/tenants/${tenantId}/settings`).set(tenantHeaders(tenantId, accessToken))
      .send({ kind: 'ORGANIZATION' });
    expect([401, 403]).toContain(res.status);
    const t = await testPrisma.tenant.findUnique({ where: { id: tenantId }, select: { kind: true } });
    expect(t?.kind).toBe('COMMUNITY');
  });
});
