/**
 * Y-02 (KVKK Md.12) — platform yöneticisinin dört OKUMA ucu da denetim izi bırakır:
 * loglar · bekleyen kurumlar (maskeli yönetici kimliği) · tüm kurumlar · şüphe bildirimleri.
 * Kardeş uçlar (VIEW_USER_REPORTS, VIEW_ANOMALIES) ile aynı desen; iz kaydında kişisel veri yok.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import supertest from 'supertest';
import { agent, createTestApp } from './helpers/request.js';
import { cleanDb, testPrisma } from './helpers/db.js';
import { createAdminUser, createTenant } from './helpers/factories.js';
import { signToken, PLATFORM_AUDIENCE } from '../src/middleware/jwtAuth.js';

// logger.info fire-and-forget olabilir → kaydı kısa süre bekle.
async function waitForAuditLog(message: string, tries = 30) {
  for (let i = 0; i < tries; i++) {
    const log = await testPrisma.systemLog.findFirst({ where: { category: 'AUDIT', message }, orderBy: { createdAt: 'desc' } });
    if (log) return log;
    await new Promise((r) => setTimeout(r, 50));
  }
  return null;
}

async function platformAgent() {
  const plat = supertest.agent(createTestApp());
  await plat
    .post('/api/platform/auth')
    .send({
      email: process.env['PLATFORM_ADMIN_EMAIL'] ?? 'admin@platform.local',
      password: process.env['PLATFORM_ADMIN_KEY'] ?? 'test-platform-key',
    })
    .expect(200);
  return plat;
}

// Platform çerezi path:'/api/platform' ile sınırlı → /api/super-admin isteklerine agent göndermez;
// tenant-verification.test.ts ile aynı desen: token doğrudan üretilip çerez elle eklenir.
function makePlatformCookie(): string {
  const token = signToken(
    { sub: 'platform-admin', tenantId: '__platform__', role: 'ADMIN', fullName: 'Platform Yöneticisi', isPlatformAdmin: true },
    { audience: PLATFORM_AUDIENCE },
  );
  return `platform_token=${encodeURIComponent(token)}`;
}

const REPORTER_CONTACT = 'gizli-bildiren@example.org';

describe('Y-02 · platform okuma uçları denetim izi', () => {
  beforeEach(async () => {
    await cleanDb();
    await testPrisma.suspicionReport.create({
      data: {
        tenantName: 'Denetim Test Kurumu',
        reporterName: 'Gizli Bildiren',
        reporterRole: 'Gönüllü',
        contact: REPORTER_CONTACT,
        description: 'Denetim izi testi için örnek şüphe açıklaması.',
      },
    });
  });

  const cases: Array<[string, string]> = [
    ['/api/platform/logs', 'VIEW_PLATFORM_LOGS'],
    ['/api/platform/tenants/pending', 'VIEW_PENDING_TENANTS'],
    ['/api/platform/tenants', 'VIEW_ALL_TENANTS'],
    ['/api/platform/suspicion-reports', 'VIEW_SUSPICION_REPORTS'],
  ];

  for (const [path, action] of cases) {
    it(`${path} → ${action} iz kaydı`, async () => {
      const plat = await platformAgent();
      await plat.get(path).expect(200);
      const log = await waitForAuditLog(action);
      expect(log).not.toBeNull();
      const meta = JSON.stringify(log?.meta ?? {});
      expect(meta).toContain('platform-admin');
      expect(meta).not.toContain(REPORTER_CONTACT);
      expect(meta).not.toContain('Gizli Bildiren');
    });
  }

  it('NEGATİF: oturumsuz okuma → 401 ve iz kaydı yazılmaz', async () => {
    await agent().get('/api/platform/suspicion-reports').expect(401);
    const log = await testPrisma.systemLog.findFirst({ where: { category: 'AUDIT', message: 'VIEW_SUSPICION_REPORTS' } });
    expect(log).toBeNull();
  });

  it('komşu uç /api/super-admin/tenants/pending: yönetici kimliği maskeli + iz kaydı', async () => {
    const tenant = await createTenant();
    await testPrisma.tenant.update({ where: { id: tenant.id }, data: { verificationStatus: 'PENDING_REVIEW' } });
    const admin = await createAdminUser(tenant.id);
    await testPrisma.user.update({
      where: { id: admin.id },
      data: { email: 'kurum-yoneticisi@ornek-kurum.org', fullName: 'Kurum Yöneticisi' },
    });
    const res = await agent().get('/api/super-admin/tenants/pending').set('Cookie', makePlatformCookie()).expect(200);
    const body = JSON.stringify(res.body);
    expect(body).not.toContain('kurum-yoneticisi@ornek-kurum.org');
    expect(body).not.toContain('Kurum Yöneticisi');
    expect(body).toContain('ornek-kurum.org');
    expect(await waitForAuditLog('VIEW_PENDING_TENANTS')).not.toBeNull();
  });
});
