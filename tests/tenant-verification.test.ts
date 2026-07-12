/**
 * Tenant Kayıt Doğrulama Testleri (İŞ 3)
 *
 * Kapsam:
 *  - Kurum domain'i → AUTO_APPROVED
 *  - .edu.tr → PENDING_REVIEW
 *  - Generic e-posta → PENDING_REVIEW
 *  - PENDING_REVIEW tenant davet gönderemiyor (backend guard)
 *  - PENDING_REVIEW tenant'a kullanıcı kaydı engellenmiş
 *  - Platform admin onaylayınca APPROVED
 *  - Reddedilen slug tekrar kullanılabiliyor
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { agent, type TestAgent } from './helpers/request.js';
import { cleanDb, testPrisma } from './helpers/db.js';
import { createTenant } from './helpers/factories.js';

const PLATFORM_KEY = process.env.PLATFORM_ADMIN_KEY ?? 'platform-dev-key-change-in-production';

// ─── Yardımcı: selfServeRegister isteği ──────────────────────────────────────

function selfServeRegisterPayload(email: string, slug?: string) {
  return {
    email,
    password: 'Test1234!',
    name: 'Test Admin',
    tenantName: `Test Kurum ${Date.now()}`,
    slug: slug ?? `test-kurum-${Date.now()}`,
    programTemplate: 'OZEL',
    kvkkConsent: true,
    institutionRole: 'Kulüp Başkanı',
    verificationNote: 'https://instagram.com/testkulup',
  };
}

describe('Tenant Verification: Domain Sınıflandırma', () => {
  let http: TestAgent;

  beforeEach(async () => {
    await cleanDb();
    http = agent();
  });

  it('kurumsal domain ile kayıt → AUTO_APPROVED ve aktif', async () => {
    const res = await http
      .post('/api/tenants/self-serve/register')
      .send(selfServeRegisterPayload('admin@dernekadi.org'))
      .expect(201);

    expect(res.body.tenant.verificationStatus).toBe('AUTO_APPROVED');
    expect(res.body.message).toContain('başarıyla oluşturuldu');
  });

  it('.edu.tr ile kayıt → PENDING_REVIEW', async () => {
    const res = await http
      .post('/api/tenants/self-serve/register')
      .send(selfServeRegisterPayload('baskan@kulup.istanbul.edu.tr'))
      .expect(201);

    expect(res.body.tenant.verificationStatus).toBe('PENDING_REVIEW');
    expect(res.body.message).toContain('inceleyecektir');
  });

  it('gmail ile kayıt → PENDING_REVIEW', async () => {
    const res = await http
      .post('/api/tenants/self-serve/register')
      .send(selfServeRegisterPayload('admin@gmail.com'))
      .expect(201);

    expect(res.body.tenant.verificationStatus).toBe('PENDING_REVIEW');
  });
});

describe('Tenant Verification: PENDING_REVIEW Kısıtlamaları', () => {
  let http: TestAgent;

  beforeEach(async () => {
    await cleanDb();
    http = agent();
  });

  it('PENDING_REVIEW tenant davet gönderemiyor (backend guard)', async () => {
    // Kayıt: gmail → PENDING_REVIEW
    const reg = await http
      .post('/api/tenants/self-serve/register')
      .send(selfServeRegisterPayload('admin@gmail.com'))
      .expect(201);

    const { tenant, accessToken } = reg.body as { tenant: { id: string }; accessToken: string };

    const invRes = await http
      .post(`/api/tenants/${tenant.id}/invitations`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ role: 'MENTOR' })
      .expect(403);

    expect(invRes.body.error).toBe('TENANT_ONAY_BEKLENIYOR');
  });

  it('PENDING_REVIEW tenant slug\'ına kullanıcı kaydı engellenmiş', async () => {
    // Farklı bir tenant oluştur — PENDING_REVIEW
    const pendingTenant = await createTenant({ verificationStatus: 'PENDING_REVIEW' });

    const res = await http
      .post('/api/auth/register')
      .send({
        email: 'newuser@test.local',
        password: 'Test1234!',
        fullName: 'Yeni Kullanıcı',
        role: 'MENTI',
        tenantSlug: pendingTenant.slug,
        kvkkConsent: true,
      })
      .expect(403);

    expect(res.body.error).toBe('TENANT_ONAY_BEKLENIYOR');
  });
});

describe('Tenant Verification: Platform Admin Onay/Red', () => {
  let http: TestAgent;

  beforeEach(async () => {
    await cleanDb();
    http = agent();
  });

  it('platform admin onaylayınca verificationStatus APPROVED olur', async () => {
    const reg = await http
      .post('/api/tenants/self-serve/register')
      .send(selfServeRegisterPayload('admin@gmail.com'))
      .expect(201);

    const tenantId = (reg.body as { tenant: { id: string } }).tenant.id;

    // Platform auth
    const authRes = await http
      .post('/api/platform/auth')
      .send({ key: PLATFORM_KEY })
      .expect(200);

    const platformToken = (authRes.body as { accessToken: string }).accessToken;

    const verifyRes = await http
      .patch(`/api/super-admin/tenants/${tenantId}/verify`)
      .set('Authorization', `Bearer ${platformToken}`)
      .send({ action: 'approve' })
      .expect(200);

    expect(verifyRes.body.tenant.verificationStatus).toBe('APPROVED');
  });

  it('reddedilen tenant slug\'ı serbest bırakılır — aynı slug yeniden kullanılabilir', async () => {
    const originalSlug = `test-slug-${Date.now()}`;

    const reg = await http
      .post('/api/tenants/self-serve/register')
      .send(selfServeRegisterPayload('admin@gmail.com', originalSlug))
      .expect(201);

    const tenantId = (reg.body as { tenant: { id: string } }).tenant.id;

    const authRes = await http
      .post('/api/platform/auth')
      .send({ key: PLATFORM_KEY })
      .expect(200);

    const platformToken = (authRes.body as { accessToken: string }).accessToken;

    await http
      .patch(`/api/super-admin/tenants/${tenantId}/verify`)
      .set('Authorization', `Bearer ${platformToken}`)
      .send({ action: 'reject', note: 'Kanıt yetersiz' })
      .expect(200);

    // Slug artık serbest — DB'de slug değişti
    const rejectedTenant = await testPrisma.tenant.findUnique({ where: { id: tenantId } });
    expect(rejectedTenant?.slug).not.toBe(originalSlug);
    expect(rejectedTenant?.slug).toContain('__rej_');

    // Aynı slug ile yeni kayıt başarılı olmalı
    const newEmail = `newadmin${Date.now()}@yenidernek.org`;
    const newReg = await http
      .post('/api/tenants/self-serve/register')
      .send(selfServeRegisterPayload(newEmail, originalSlug))
      .expect(201);

    expect(newReg.body.tenant.slug).toBe(originalSlug);
  });

  it('pending tenant listesi platform admin tarafından görülebilir', async () => {
    await http
      .post('/api/tenants/self-serve/register')
      .send(selfServeRegisterPayload('admin1@gmail.com'))
      .expect(201);

    await http
      .post('/api/tenants/self-serve/register')
      .send(selfServeRegisterPayload('admin2@gmail.com'))
      .expect(201);

    const authRes = await http
      .post('/api/platform/auth')
      .send({ key: PLATFORM_KEY })
      .expect(200);

    const platformToken = (authRes.body as { accessToken: string }).accessToken;

    const listRes = await http
      .get('/api/super-admin/tenants/pending')
      .set('Authorization', `Bearer ${platformToken}`)
      .expect(200);

    expect(listRes.body.total).toBeGreaterThanOrEqual(2);
    for (const t of listRes.body.items as { verificationStatus: string }[]) {
      expect(t.verificationStatus).toBe('PENDING_REVIEW');
    }
  });
});
