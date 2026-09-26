/**
 * Y1-B9 — Dondurulmuş ya da reddedilmiş kurumun kullanıcıları kurum uçlarını kullanamaz.
 *
 * Kapı: requireTenant adım 4b + authenticateTenantAdmin (kural: middleware/tenantSuspension.ts).
 * Askı yalnız iki niyetli durumdur: platform dondurması (Tenant.isActive=false) ve başvuru reddi
 * (verificationStatus=REJECTED). Kurulumdaki / incelemedeki kurum KİLİTLENMEZ — burada kanıtlanır.
 * Dondurma/aktif etme gerçek platform uçlarıyla yapılır: önbellek (tenantCache) temizliği de sınanır.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import jwt from 'jsonwebtoken';
import { agent, type TestAgent, tenantHeaders } from './helpers/request.js';
import { cleanDb, testPrisma } from './helpers/db.js';
import { createTenant, createAdminUser, createMentor, createMenti } from './helpers/factories.js';
import { signToken, PLATFORM_AUDIENCE } from '../src/middleware/jwtAuth.js';
import { handleOAuthCallback } from '../src/services/oauth/oauthService.js';
import type { Tenant, User } from '@prisma/client';

function tokenFor(u: Pick<User, 'id' | 'tenantId' | 'role' | 'fullName'>): string {
  return signToken({ sub: u.id, tenantId: u.tenantId, role: u.role, fullName: u.fullName });
}

function platformCookie(): string {
  const token = signToken(
    { sub: 'platform-admin', tenantId: '__platform__', role: 'ADMIN', fullName: 'Platform Yöneticisi', isPlatformAdmin: true },
    { audience: PLATFORM_AUDIENCE },
  );
  return `platform_token=${encodeURIComponent(token)}`;
}

function inviteFor(tenantId: string, role: 'MENTOR' | 'MENTI'): string {
  return jwt.sign({ tenantId, role, type: 'invitation' }, process.env['JWT_SECRET'] as string, { expiresIn: '1h' });
}

const SUSPENDED = 'KURUM_ASKIDA';

describe('Y1-B9: askıdaki kurumun kullanıcıları erişemez', () => {
  let http: TestAgent;
  let tenant: Tenant;
  let admin: User;
  let mentor: User;
  let menti: User;

  beforeEach(async () => {
    await cleanDb();
    http = agent();
    tenant = await createTenant();
    admin = await createAdminUser(tenant.id);
    mentor = await createMentor(tenant.id);
    menti = await createMenti(tenant.id);
  });

  const platform = (action: 'freeze' | 'activate' | 'reject' | 'approve', id: string) =>
    http.post(`/api/platform/tenants/${id}/${action}`).set('Cookie', platformCookie()).send({});

  const activeMeetings = (u: User) =>
    http.get('/api/meetings/active').set(tenantHeaders(u.tenantId, tokenFor(u)));
  const adminKpi = (u: User) =>
    http.get('/api/admin/kpi').set(tenantHeaders(u.tenantId, tokenFor(u)));
  const inviteTemplates = (u: User) =>
    http.get(`/api/tenants/${u.tenantId}/invitation-templates`).set('Authorization', `Bearer ${tokenFor(u)}`);

  it('dondurulmuş kurumun menti, mentör ve yöneticisi 403 KURUM_ASKIDA alır; mesaj Türkçe ve iç detaysız', async () => {
    // Önce erişim var (önbellek dolar → dondurmanın önbelleği temizlediği de sınanır)
    expect((await activeMeetings(menti)).status).toBe(200);
    expect((await adminKpi(admin)).status).toBe(200);

    await platform('freeze', tenant.id).expect(200);

    for (const u of [menti, mentor]) {
      const res = await activeMeetings(u);
      expect(res.status).toBe(403);
      expect(res.body).toEqual({
        error: SUSPENDED,
        message: 'Kurumunuzun hesabı şu an askıda. Kurum yöneticinizle iletişime geçin.',
      });
    }
    const kpi = await adminKpi(admin);
    expect(kpi.status).toBe(403);
    expect(kpi.body.error).toBe(SUSPENDED);

    // X-Tenant-Id kullanmayan kurum-yönetici uçları da kapalı
    const tpl = await inviteTemplates(admin);
    expect(tpl.status).toBe(403);
    expect(tpl.body.error).toBe(SUSPENDED);
  });

  it('aktif edilince erişim geri gelir', async () => {
    await platform('freeze', tenant.id).expect(200);
    expect((await activeMeetings(menti)).status).toBe(403);

    await platform('activate', tenant.id).expect(200);
    expect((await activeMeetings(menti)).status).toBe(200);
    expect((await adminKpi(admin)).status).toBe(200);
    expect((await inviteTemplates(admin)).status).toBe(200);
  });

  it('başvurusu reddedilen kurum (platform reddi) → 403; onaylanınca erişim geri gelir', async () => {
    await platform('reject', tenant.id).expect(200);
    const res = await activeMeetings(menti);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe(SUSPENDED);
    expect((await adminKpi(admin)).status).toBe(403);

    await platform('approve', tenant.id).expect(200);
    expect((await activeMeetings(menti)).status).toBe(200);
  });

  it('askıdaki kurumda /api/auth/me açık kalır ve askı bilgisini döner (bekleme/ret ekranı çalışır)', async () => {
    await platform('reject', tenant.id).expect(200);
    const res = await http.get('/api/auth/me').set(tenantHeaders(tenant.id, tokenFor(admin))).expect(200);
    expect(res.body.tenant).toMatchObject({ id: tenant.id, verificationStatus: 'REJECTED', isSuspended: true });

    const ok = await createTenant();
    const okUser = await createMenti(ok.id);
    const okMe = await http.get('/api/auth/me').set(tenantHeaders(ok.id, tokenFor(okUser))).expect(200);
    expect(okMe.body.tenant.isSuspended).toBe(false);
  });

  it('başka kurum etkilenmez', async () => {
    const other = await createTenant();
    const otherMenti = await createMenti(other.id);
    const otherAdmin = await createAdminUser(other.id);

    await platform('freeze', tenant.id).expect(200);

    expect((await activeMeetings(otherMenti)).status).toBe(200);
    expect((await adminKpi(otherAdmin)).status).toBe(200);
    expect((await inviteTemplates(otherAdmin)).status).toBe(200);
  });

  it('kurum üyesi olmayan biri askı bilgisini öğrenemez (üyelik kapısı önce gelir)', async () => {
    const other = await createTenant();
    const outsider = await createMenti(other.id);
    await platform('freeze', tenant.id).expect(200);

    // Başka kurumun token'ıyla askıdaki kurum başlığı → cross-tenant 403, KURUM_ASKIDA DEĞİL
    const res = await http.get('/api/meetings/active').set(tenantHeaders(tenant.id, tokenFor(outsider)));
    expect(res.status).toBe(403);
    expect(res.body.error).not.toBe(SUSPENDED);
  });

  it('platform uçları etkilenmez: dondurulmuş kurumu listeleyebilir ve tekrar aktif edebilir', async () => {
    await platform('freeze', tenant.id).expect(200);
    const list = await http.get('/api/platform/tenants').set('Cookie', platformCookie());
    expect(list.status).toBe(200);
    await platform('activate', tenant.id).expect(200);
    const row = await testPrisma.tenant.findUnique({ where: { id: tenant.id }, select: { isActive: true } });
    expect(row?.isActive).toBe(true);
  });
});

describe('Y1-B9: askıdaki kuruma yeni üye alınmaz', () => {
  let http: TestAgent;

  beforeEach(async () => {
    await cleanDb();
    http = agent();
  });

  const registerTo = (slug: string, email: string, inviteToken?: string) =>
    http.post('/api/auth/register').send({
      email,
      password: 'Test1234!',
      fullName: 'Yeni Üye',
      role: 'MENTI',
      tenantSlug: slug,
      kvkkConsent: true,
      ...(inviteToken ? { inviteToken } : {}),
    });

  const freeze = (id: string) =>
    http.post(`/api/platform/tenants/${id}/freeze`).set('Cookie', platformCookie()).send({}).expect(200);

  it('form kaydı: dondurulmuş kuruma (davetli bile olsa) 403 KURUM_KAYDA_KAPALI, kullanıcı oluşmaz', async () => {
    const tenant = await createTenant();
    await freeze(tenant.id);
    const email = `askida-${Date.now()}@test.local`;

    const res = await registerTo(tenant.slug, email, inviteFor(tenant.id, 'MENTI'));
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('KURUM_KAYDA_KAPALI');
    expect(await testPrisma.user.findUnique({ where: { email } })).toBeNull();
  });

  it('form kaydı: reddedilmiş kuruma 403; kayıtlı e-posta ile de AYNI yanıt (numaralandırma yok)', async () => {
    const tenant = await createTenant({ verificationStatus: 'REJECTED' });
    const existing = await createMenti((await createTenant()).id);

    const fresh = await registerTo(tenant.slug, `yeni-${Date.now()}@test.local`);
    const known = await registerTo(tenant.slug, existing.email);
    expect(fresh.status).toBe(403);
    expect(known.status).toBe(403);
    expect(known.body).toEqual(fresh.body);
  });

  it('OAuth kaydı: dondurulmuş kuruma yeni kullanıcı oluşmaz', async () => {
    const tenant = await createTenant();
    await freeze(tenant.id);
    const email = `oauth-askida-${Date.now()}@test.local`;

    await expect(
      handleOAuthCallback(
        { providerUserId: `g-${email}`, email, fullName: 'OAuth Üye', provider: 'GOOGLE' },
        { tenantSlug: tenant.slug, role: 'MENTI', nonce: 'n', inviteToken: inviteFor(tenant.id, 'MENTI') },
      ),
    ).rejects.toMatchObject({ code: 'KURUM_KAYDA_KAPALI' });
    expect(await testPrisma.user.findUnique({ where: { email } })).toBeNull();
  });

  it('davet linki: askıdaki kurumun daveti geçersiz döner; aktif kurumun daveti çalışır', async () => {
    const tenant = await createTenant();
    const ok = await http.get(`/api/invitations/${inviteFor(tenant.id, 'MENTI')}/join`);
    expect(ok.status).toBe(200);
    expect(ok.body.valid).toBe(true);

    await freeze(tenant.id);
    const res = await http.get(`/api/invitations/${inviteFor(tenant.id, 'MENTI')}/join`);
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ error: 'KURUM_KAYDA_KAPALI', valid: false });
  });

  it('aktif kurumun kaydı etkilenmez', async () => {
    const tenant = await createTenant();
    const res = await registerTo(tenant.slug, `aktif-${Date.now()}@test.local`);
    expect(res.status).toBe(201);
  });
});

describe('Y1-B9: kurulumdaki / incelemedeki kurum KİLİTLENMEZ', () => {
  let http: TestAgent;

  beforeEach(async () => {
    await cleanDb();
    http = agent();
  });

  function selfServePayload(email: string) {
    const n = Date.now();
    return {
      email,
      password: 'Test1234!',
      name: 'Kurulum Yöneticisi',
      tenantName: `Kurulum Kurumu ${n}`,
      slug: `kurulum-${n}`,
      programTemplate: 'OZEL',
      kvkkConsent: true,
      institutionRole: 'Kulüp Başkanı',
      verificationNote: 'https://instagram.com/kurulumkulup',
    };
  }

  it('PENDING_REVIEW kurum yöneticisi: me, kurulum (onboarding), davet şablonu ve kurum uçları çalışır', async () => {
    const reg = await http.post('/api/tenants/self-serve/register').send(selfServePayload('kurulum@gmail.com')).expect(201);
    const { tenant, accessToken } = reg.body as { tenant: { id: string; verificationStatus: string }; accessToken: string };
    expect(tenant.verificationStatus).toBe('PENDING_REVIEW');

    const me = await http.get('/api/auth/me').set(tenantHeaders(tenant.id, accessToken)).expect(200);
    expect(me.body.tenant).toMatchObject({ verificationStatus: 'PENDING_REVIEW', isSuspended: false });

    await http
      .patch(`/api/tenants/${tenant.id}/onboarding`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ primaryColor: '#123456' })
      .expect(200);

    await http
      .get(`/api/tenants/${tenant.id}/invitation-templates`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    await http.get('/api/admin/kpi').set(tenantHeaders(tenant.id, accessToken)).expect(200);
  });

  it('CORRECTION_REQUESTED kurum yöneticisi düzeltmeyi gönderebilir (kilitlenmez)', async () => {
    const tenant = await createTenant({ verificationStatus: 'CORRECTION_REQUESTED' });
    const admin = await createAdminUser(tenant.id);

    const res = await http
      .post('/api/tenants/self-serve/resubmit')
      .set('Authorization', `Bearer ${tokenFor(admin)}`)
      .send({ institutionRole: 'Başkan', verificationNote: 'Güncel kanıt bağlantısı' });
    expect(res.status).toBe(200);
    expect(res.body.verificationStatus).toBe('PENDING_REVIEW');
  });
});
