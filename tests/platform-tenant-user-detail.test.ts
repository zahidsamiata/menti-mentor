/**
 * F-24 (G4-08) — Platform tek-kullanıcı drill-down: GET /api/platform/tenants/:id/users/:userId
 *
 * Kapsam: platform admin bir kurumun ÜYE listesinde zaten gördüğü alan kümesiyle (fullName,
 * role, isActive, joinedAt, emailMasked, discType, certificationStatus, isCertified,
 * learningJourneyCompletedAt, hasKvkkConsent) tek bir kullanıcının detayına iniyor. Yeni PII
 * kategorisi YOK — bkz. `platformTenantController.ts` getTenantUserDetail üst yorumu.
 *
 * Negatif testler: tenant ADMIN JWT → 403 (platform admin değil) · başka kurumun kullanıcısı
 * bu kurum yolundan → 404 (IDOR/kurum sızıntısı yok) · denetim kaydı (SystemLog AUDIT) yazılıyor.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { agent, type TestAgent } from './helpers/request.js';
import { cleanDb, testPrisma } from './helpers/db.js';
import { createTenant, createMentor, createMenti } from './helpers/factories.js';
import { signToken, PLATFORM_AUDIENCE } from '../src/middleware/jwtAuth.js';

function platformCookie(): string {
  const token = signToken(
    { sub: 'platform-admin', tenantId: '__platform__', role: 'ADMIN', fullName: 'Platform Yöneticisi', isPlatformAdmin: true },
    { audience: PLATFORM_AUDIENCE },
  );
  return `platform_token=${encodeURIComponent(token)}`;
}

// requirePlatformAdmin cookie okur (Bearer değil) — tenant ADMIN JWT'sini cookie'ye koyup
// aud/isPlatformAdmin eksikliğinden 403 aldığını doğrular (authorization.test.ts ile aynı desen).
function platformCookieHeader(token: string): string {
  return `platform_token=${encodeURIComponent(token)}`;
}

describe('F-24: GET /api/platform/tenants/:id/users/:userId', () => {
  let http: TestAgent;

  beforeEach(async () => {
    await cleanDb();
    http = agent();
  });

  it('platform admin → 200, yalnız izinli alanlar (password/hash yok)', async () => {
    const tenant = await createTenant();
    const mentor = await createMentor(tenant.id, { discType: 'D' });

    const res = await http
      .get(`/api/platform/tenants/${tenant.id}/users/${mentor.id}`)
      .set('Cookie', platformCookie())
      .expect(200);

    expect(res.body).toMatchObject({
      id: mentor.id,
      fullName: mentor.fullName,
      role: 'MENTOR',
      isActive: true,
      discType: 'D',
      certificationStatus: 'NOT_STARTED',
      isCertified: false,
      learningJourneyCompletedAt: null,
      hasKvkkConsent: false,
    });
    expect(res.body.emailMasked).not.toBe(mentor.email);
    expect(res.body.emailMasked).toMatch(/^.\*\*\*@/);
    expect(res.body.joinedAt).toBeDefined();

    // Ham PII / kimlik bilgisi ASLA sızmaz.
    const raw = JSON.stringify(res.body);
    expect(raw).not.toContain('password');
    expect(raw).not.toContain(mentor.rawPassword);
    expect(raw.toLowerCase()).not.toContain('hash');
    expect(raw).not.toContain(mentor.email);
  });

  it('negatif: tenant ADMIN JWT ile → 403 (platform admin değil)', async () => {
    const tenant = await createTenant();
    const menti = await createMenti(tenant.id);
    const tenantAdminToken = signToken({
      sub: 'admin-id',
      tenantId: tenant.id,
      role: 'ADMIN',
      fullName: 'Kurum Admin',
    });

    const res = await http
      .get(`/api/platform/tenants/${tenant.id}/users/${menti.id}`)
      .set('Cookie', platformCookieHeader(tenantAdminToken));

    expect(res.status).toBe(403);
  });

  it('negatif: başka kurumun kullanıcısı bu kurum yolundan → 404 (IDOR yok)', async () => {
    const tenantA = await createTenant();
    const tenantB = await createTenant();
    const mentiOfB = await createMenti(tenantB.id);

    const res = await http
      .get(`/api/platform/tenants/${tenantA.id}/users/${mentiOfB.id}`)
      .set('Cookie', platformCookie());

    expect(res.status).toBe(404);
  });

  it('negatif: kurumun kendisi yoksa da → 404', async () => {
    const res = await http
      .get('/api/platform/tenants/olmayan-kurum/users/olmayan-kullanici')
      .set('Cookie', platformCookie());

    expect(res.status).toBe(404);
  });

  it('denetim kaydı: görüntüleme SystemLog AUDIT olarak yazılır (PII sızmadan meta)', async () => {
    const tenant = await createTenant();
    const menti = await createMenti(tenant.id);

    await http
      .get(`/api/platform/tenants/${tenant.id}/users/${menti.id}`)
      .set('Cookie', platformCookie())
      .expect(200);

    const logs = await testPrisma.systemLog.findMany({
      where: { category: 'AUDIT', message: 'VIEW_TENANT_USER' },
      orderBy: { createdAt: 'desc' },
    });
    expect(logs.length).toBeGreaterThan(0);
    const meta = logs[0]!.meta as Record<string, unknown>;
    expect(meta['targetTenantId']).toBe(tenant.id);
    expect(meta['userId']).toBe(menti.id);
    // PII (ad/e-posta/DISC) log meta'sına ASLA konmaz.
    expect(JSON.stringify(meta)).not.toContain(menti.fullName);
    expect(JSON.stringify(meta)).not.toContain(menti.email);
  });
});
