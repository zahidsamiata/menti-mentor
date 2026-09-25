/**
 * GV-12 — Kurum kaydında (self-serve) e-posta numaralandırması kapalı.
 *
 * Komşu uç `POST /api/auth/register` kayıtlı e-postaya "zaten kayıtlı" demez; kurum kaydı da
 * aynı deseni uygular: kayıtlı e-postayla başvuru → yeni kayıtla aynı durum kodu + aynı mesaj,
 * ikinci kurum OLUŞMAZ, oturum AÇILMAZ, hesap sahibine bilgilendirme e-postası gider.
 * Gerçek SMTP gönderimi mock'lanır.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { agent, type TestAgent } from './helpers/request.js';
import { cleanDb, testPrisma } from './helpers/db.js';
import { createTenant, createAdminUser } from './helpers/factories.js';
import { resetRateLimiters } from '../src/middleware/rateLimiter.js';

const mocks = vi.hoisted(() => ({ sendAlreadyRegisteredEmail: vi.fn() }));

vi.mock('../src/services/emailService.js', async (orig) => ({
  ...(await orig<typeof import('../src/services/emailService.js')>()),
  sendAlreadyRegisteredEmail: mocks.sendAlreadyRegisteredEmail,
}));

function payload(email: string, slug: string) {
  return {
    email,
    password: 'Test1234!',
    name: 'Test Admin',
    tenantName: `Test Kurum ${slug}`,
    slug,
    programTemplate: 'OZEL',
    kvkkConsent: true,
  };
}

describe('GV-12 — self-serve kurum kaydı e-posta numaralandırması', () => {
  let http: TestAgent;

  beforeEach(async () => {
    await cleanDb();
    resetRateLimiters();
    mocks.sendAlreadyRegisteredEmail.mockClear();
    http = agent();
  });

  it('kayıtlı e-posta → yeni kayıtla aynı durum kodu ve mesaj; 409/EMAIL_MEVCUT yok', async () => {
    const tenant = await createTenant();
    const existing = await createAdminUser(tenant.id);

    const fresh = await http
      .post('/api/tenants/self-serve/register')
      .send(payload('yeni@dernek-ornek.org', 'gv12-yeni'));
    const dup = await http
      .post('/api/tenants/self-serve/register')
      .send(payload(existing.email, 'gv12-mevcut'));

    expect(fresh.status).toBe(201);
    expect(dup.status).toBe(fresh.status);
    expect(dup.body.error).toBeUndefined();
    expect(JSON.stringify(dup.body)).not.toMatch(/EMAIL_MEVCUT|zaten kayıtlı/);
  });

  it('kayıtlı e-postayla başvuru ikinci kurum OLUŞTURMAZ ve oturum AÇMAZ', async () => {
    const tenant = await createTenant();
    const existing = await createAdminUser(tenant.id);
    const before = await testPrisma.tenant.count();

    const res = await http
      .post('/api/tenants/self-serve/register')
      .send(payload(existing.email, 'gv12-ikinci-kurum'))
      .expect(201);

    expect(await testPrisma.tenant.count()).toBe(before);
    expect(await testPrisma.tenant.findUnique({ where: { slug: 'gv12-ikinci-kurum' } })).toBeNull();
    expect(res.body.accessToken).toBeUndefined();
    expect(String(res.headers['set-cookie'] ?? '')).not.toContain('mm_refresh');
    expect(await testPrisma.refreshToken.count({ where: { userId: existing.id } })).toBe(0);
    // Mevcut hesabın rolü/kurumu değişmedi
    const after = await testPrisma.user.findUnique({ where: { id: existing.id } });
    expect(after?.tenantId).toBe(tenant.id);
  });

  it('kayıtlı e-postayla başvuruda hesap sahibine bilgilendirme e-postası gider', async () => {
    const tenant = await createTenant();
    const existing = await createAdminUser(tenant.id);

    await http
      .post('/api/tenants/self-serve/register')
      .send(payload(existing.email, 'gv12-mail'))
      .expect(201);

    expect(mocks.sendAlreadyRegisteredEmail).toHaveBeenCalledTimes(1);
    expect(mocks.sendAlreadyRegisteredEmail).toHaveBeenCalledWith({
      toEmail: existing.email,
      userName: existing.fullName,
    });
  });

  it('yeni e-postayla kayıt eskisi gibi kurum oluşturur ve e-posta göndermez', async () => {
    const res = await http
      .post('/api/tenants/self-serve/register')
      .send(payload('kurucu@dernek-ornek.org', 'gv12-normal'))
      .expect(201);

    expect(res.body.tenant.slug).toBe('gv12-normal');
    expect(res.body.accessToken).toEqual(expect.any(String));
    expect(mocks.sendAlreadyRegisteredEmail).not.toHaveBeenCalled();
  });
});
