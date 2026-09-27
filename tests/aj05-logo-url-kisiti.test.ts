/**
 * AJ-05 (F-04 kalanı) — kurum logosu adresi YAZMA yolunda sıkılaştırılmış kural seti
 * (`backend/src/services/logoUrl.ts`): https-only + kullanıcı bilgisi/port/IP-literal/
 * localhost-özel ağ reddi + izinli görsel uzantısı. Negatif: izinsiz adresle YAZMA denemesi
 * 400 döner ve kurum kaydı DEĞİŞMEZ (ne platform admin `PATCH /api/tenants/:id` ne de kurum
 * yöneticisinin `PATCH /api/tenants/:id/onboarding` yolunda).
 *
 * Komşu uç tutarlılığı: her iki uç da aynı `logoUrlSchema`'yı kullanır (tenantController.ts,
 * selfServeController.ts) — burada ikisi de aynı kötü niyetli örneklerle sınanır.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { agent, type TestAgent } from './helpers/request.js';
import { cleanDb, testPrisma } from './helpers/db.js';
import { createTenant, createAdminUser } from './helpers/factories.js';
import { signToken, PLATFORM_AUDIENCE } from '../src/middleware/jwtAuth.js';

// tenant-verification.test.ts / platform-read-audit.test.ts ile aynı desen: platform çerezi
// path'e (`/api/platform`) bağlı olduğundan agent yönlendirmez, token üretilip çerez elle eklenir.
function makePlatformCookie(): string {
  const token = signToken(
    { sub: 'platform-admin', tenantId: '__platform__', role: 'ADMIN', fullName: 'Platform Yöneticisi', isPlatformAdmin: true },
    { audience: PLATFORM_AUDIENCE },
  );
  return `platform_token=${encodeURIComponent(token)}`;
}

const KOTU_NIYETLI_LOGO_URLS = [
  'https://user:pass@evil.example.com/logo.png', // kimlik avı (userinfo)
  'https://cdn.example.com:8443/logo.png', // açık port
  'https://169.254.169.254/logo.png', // bulut metadata (SSRF-benzeri)
  'https://localhost/logo.png', // iç host
  'https://[::1]/logo.png', // IPv6 loopback
  'https://cdn.example.com/logo.svg', // izinsiz uzantı (XSS riski)
  'http://cdn.example.com/logo.png', // https değil
];

describe('AJ-05: logoUrl YAZMA yolu — negatif (izinsiz adres reddedilir, kayıt değişmez)', () => {
  let http: TestAgent;
  let tenantId: string;

  beforeEach(async () => {
    await cleanDb();
    http = agent();
    tenantId = (await createTenant()).id; // logoUrl varsayılan olarak null
  });

  describe('PATCH /api/tenants/:id (platform admin)', () => {
    it.each(KOTU_NIYETLI_LOGO_URLS)('%s → 400; kurumun logoUrl alanı değişmez', async (bad) => {
      const before = await testPrisma.tenant.findUnique({ where: { id: tenantId }, select: { logoUrl: true } });
      const res = await http
        .patch(`/api/tenants/${tenantId}`)
        .set('Cookie', makePlatformCookie())
        .send({ logoUrl: bad })
        .expect(400);
      expect(res.body).toHaveProperty('error');
      const after = await testPrisma.tenant.findUnique({ where: { id: tenantId }, select: { logoUrl: true } });
      expect(after?.logoUrl).toBe(before?.logoUrl);
    });

    it('geçerli https + izinli uzantı 200 döner ve kaydedilir', async () => {
      await http
        .patch(`/api/tenants/${tenantId}`)
        .set('Cookie', makePlatformCookie())
        .send({ logoUrl: 'https://cdn.example.com/logo.png' })
        .expect(200);
      const after = await testPrisma.tenant.findUnique({ where: { id: tenantId }, select: { logoUrl: true } });
      expect(after?.logoUrl).toBe('https://cdn.example.com/logo.png');
    });
  });

  describe('PATCH /api/tenants/:id/onboarding (kurum yöneticisi self-serve)', () => {
    let adminToken: string;

    beforeEach(async () => {
      const admin = await createAdminUser(tenantId);
      adminToken = signToken({ sub: admin.id, tenantId, role: 'ADMIN', fullName: admin.fullName });
    });

    it.each(KOTU_NIYETLI_LOGO_URLS)('%s → 400; onboardingStep/logoUrl değişmez', async (bad) => {
      const before = await testPrisma.tenant.findUnique({ where: { id: tenantId } });
      await http
        .patch(`/api/tenants/${tenantId}/onboarding`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ logoUrl: bad })
        .expect(400);
      const after = await testPrisma.tenant.findUnique({ where: { id: tenantId } });
      expect(after?.logoUrl).toBe(before?.logoUrl);
      expect(after?.onboardingStep).toBe(before?.onboardingStep);
    });
  });
});
