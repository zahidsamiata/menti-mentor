/**
 * F-24 (G4-08) — Platform tek-kullanıcı drill-down: GET /api/platform/tenants/:id/users/:userId
 *
 * Kapsam: platform admin bir kurumun ÜYE listesinde zaten gördüğü alan kümesiyle (fullName,
 * role, isActive, joinedAt, emailMasked, discType, certificationStatus, isCertified,
 * learningJourneyCompletedAt, hasKvkkConsent) tek bir kullanıcının detayına iniyor. Yeni PII
 * kategorisi YOK — bkz. `platformTenantController.ts` getTenantUserDetail üst yorumu.
 *
 * AJ-88: hasKvkkConsent artık `Consent` tablosundaki AKTİF (revokedAt=null) ACIK_RIZA satırından
 * okunur — eski `User.kvkkConsentAt` DEĞİL. Geri çekilmiş rıza → false; eski alan dolu ama
 * Consent kaydı yok → false (yeni kaynak kazanır). Üye listesi (getTenantMembers) de aynı kaynak.
 *
 * Negatif testler: tenant ADMIN JWT → 403 (platform admin değil) · başka kurumun kullanıcısı
 * bu kurum yolundan → 404 (IDOR/kurum sızıntısı yok) · denetim kaydı (SystemLog AUDIT) yazılıyor.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { agent, type TestAgent } from './helpers/request.js';
import { cleanDb, testPrisma } from './helpers/db.js';
import { createTenant, createMentor, createMenti } from './helpers/factories.js';
import { signToken, PLATFORM_AUDIENCE } from '../src/middleware/jwtAuth.js';
import { recordSignupConsent, revokeConsent } from '../src/services/consentService.js';

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

  describe('AJ-88: hasKvkkConsent kaynağı = aktif ACIK_RIZA (Consent tablosu)', () => {
    async function detail(tenantId: string, userId: string): Promise<boolean> {
      const res = await http
        .get(`/api/platform/tenants/${tenantId}/users/${userId}`)
        .set('Cookie', platformCookie())
        .expect(200);
      return res.body.hasKvkkConsent as boolean;
    }

    async function memberFlag(tenantId: string, userId: string): Promise<boolean> {
      const res = await http
        .get(`/api/platform/tenants/${tenantId}/members`)
        .set('Cookie', platformCookie())
        .expect(200);
      const member = (res.body.members as Array<{ id: string; hasKvkkConsent: boolean }>).find((m) => m.id === userId);
      expect(member).toBeDefined();
      return member!.hasKvkkConsent;
    }

    it('aktif rıza (kayıt akışı AYDINLATMA+ACIK_RIZA) → true (detay + üye listesi)', async () => {
      const tenant = await createTenant();
      const menti = await createMenti(tenant.id);
      await recordSignupConsent({ userId: menti.id }, 'FORM');

      expect(await detail(tenant.id, menti.id)).toBe(true);
      expect(await memberFlag(tenant.id, menti.id)).toBe(true);
    });

    it('negatif: rıza geri çekilmiş (eski kvkkConsentAt hâlâ dolu) → false (detay + üye listesi)', async () => {
      const tenant = await createTenant();
      const menti = await createMenti(tenant.id);
      await testPrisma.user.update({ where: { id: menti.id }, data: { kvkkConsentAt: new Date() } });
      await recordSignupConsent({ userId: menti.id }, 'FORM');
      await revokeConsent({ userId: menti.id }, 'ACIK_RIZA');

      expect(await detail(tenant.id, menti.id)).toBe(false);
      expect(await memberFlag(tenant.id, menti.id)).toBe(false);
    });

    it('negatif: yalnız AYDINLATMA aktif (ACIK_RIZA geri çekilmiş) → false', async () => {
      const tenant = await createTenant();
      const menti = await createMenti(tenant.id);
      await recordSignupConsent({ userId: menti.id }, 'FORM');
      await revokeConsent({ userId: menti.id }, 'ACIK_RIZA');

      const aydinlatma = await testPrisma.consent.count({
        where: { userId: menti.id, type: 'AYDINLATMA', revokedAt: null },
      });
      expect(aydinlatma).toBe(1);
      expect(await detail(tenant.id, menti.id)).toBe(false);
    });

    it('negatif: hiç Consent kaydı yok ama eski kvkkConsentAt dolu → false (yeni kaynak kazanır)', async () => {
      const tenant = await createTenant();
      const menti = await createMenti(tenant.id);
      await testPrisma.user.update({ where: { id: menti.id }, data: { kvkkConsentAt: new Date() } });

      expect(await detail(tenant.id, menti.id)).toBe(false);
      expect(await memberFlag(tenant.id, menti.id)).toBe(false);
    });

    it('yanıtta Consent satırı sızmaz (yalnız boolean döner)', async () => {
      const tenant = await createTenant();
      const menti = await createMenti(tenant.id);
      await recordSignupConsent({ userId: menti.id }, 'FORM');

      const res = await http
        .get(`/api/platform/tenants/${tenant.id}/users/${menti.id}`)
        .set('Cookie', platformCookie())
        .expect(200);
      expect(res.body).not.toHaveProperty('consents');
    });
  });
});
