/**
 * AN-30 / KARAR-34 (OAuth ayağı, 2026-09-26) — `GRANULAR_CONSENT_ENABLED` AÇIKKEN OAuth kayıt akışı.
 *
 * Flag KAPALIYKEN davranışın DEĞİŞMEDİĞİ zaten şu dosyalarla korunuyor (bu dosya onlara dokunmaz,
 * kendi izole sürecinde flag'i AÇAR — bkz. aşağıdaki `vi.stubEnv` notu):
 *   - tests/oauth-kvkk-consent.test.ts, tests/consent-dualwrite.test.ts, tests/oauth-invite-approval.test.ts
 *
 * Neden `vi.resetModules()` + dinamik import? `config.ts` boolean flag'leri (bkz.
 * `config.oauth.granularConsentEnabled`) modül YÜKLENİRKEN (import-time) env'den okunur — aynı
 * desen `tests/config-upload-max-bytes.unit.test.ts` / `tests/config-jwt-secret.unit.test.ts`'te
 * de kullanılır. `vitest.config.ts` → `pool: 'forks'` sayesinde bu dosya kendi process'inde
 * çalışır; `vi.stubEnv` burada yapılan flag değişikliği DİĞER test dosyalarını ETKİLEMEZ.
 * `agent()` / `handleOAuthCallback` de resetModules SONRASI dinamik import edilir — aksi halde
 * eski (flag kapalı) config'e bağlı kalırlardı.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { Tenant } from '@prisma/client';
import { cleanDb, testPrisma } from './helpers/db.js';
import { createTenant } from './helpers/factories.js';
import { tenantHeaders } from './helpers/request.js';
import type { OAuthCallbackResult } from '../src/services/oauth/oauthTypes.js';

type OAuthServiceModule = typeof import('../src/services/oauth/oauthService.js');
type RequestModule = typeof import('./helpers/request.js');

let handleOAuthCallback: OAuthServiceModule['handleOAuthCallback'];
let agent: RequestModule['agent'];

/** pendingConsent varyantını daraltır — flag açıkken yeni kullanıcı her zaman bunu döner. */
function expectPending(result: OAuthCallbackResult): Extract<OAuthCallbackResult, { pendingConsent: true }> {
  if (!('pendingConsent' in result)) {
    throw new Error('Beklenmeyen token sonucu — bu test GRANULAR_CONSENT_ENABLED=true varsayar.');
  }
  return result;
}

beforeAll(async () => {
  vi.stubEnv('GRANULAR_CONSENT_ENABLED', 'true');
  vi.resetModules();
  ({ handleOAuthCallback } = await import('../src/services/oauth/oauthService.js'));
  ({ agent } = await import('./helpers/request.js'));
});

afterAll(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

const MANDATORY_GRANULAR_CONSENT = {
  discMatching: true,
  foreignStorage: true,
  dataProcessing: true,
  anonymizedImprovement: true,
} as const;

describe('AN-30 OAuth ayağı — GRANULAR_CONSENT_ENABLED açık', () => {
  let tenant: Tenant;

  beforeEach(async () => {
    await cleanDb();
    tenant = await createTenant();
  });

  it('yeni OAuth kullanıcısı ANINDA oluşturulmaz — pendingConsent + pendingToken döner', async () => {
    const email = `oauth-pending-${Date.now()}@test.local`;
    const result = expectPending(
      await handleOAuthCallback(
        { providerUserId: 'g-p1', email, fullName: 'Bekleyen Kullanıcı', provider: 'GOOGLE' },
        { tenantSlug: tenant.slug, role: 'MENTI', nonce: 'n' },
      ),
    );
    expect(typeof result.pendingToken).toBe('string');
    expect(result.pendingToken.length).toBeGreaterThan(0);

    const user = await testPrisma.user.findUnique({ where: { email } });
    expect(user).toBeNull(); // kullanıcı henüz oluşturulmadı — asıl güvence
  });

  it('complete-registration: zorunlu onay maddesi eksikken 400 döner ve kullanıcı OLUŞMAZ', async () => {
    const email = `oauth-eksik-${Date.now()}@test.local`;
    const pending = expectPending(
      await handleOAuthCallback(
        { providerUserId: 'g-p2', email, fullName: 'Eksik Onay', provider: 'GOOGLE' },
        { tenantSlug: tenant.slug, role: 'MENTI', nonce: 'n' },
      ),
    );

    await agent()
      .post('/api/auth/oauth/complete-registration')
      .send({
        pendingToken: pending.pendingToken,
        kvkkConsent: true,
        granularConsent: { ...MANDATORY_GRANULAR_CONSENT, anonymizedImprovement: false },
      })
      .expect(400);

    const user = await testPrisma.user.findUnique({ where: { email } });
    expect(user).toBeNull();
  });

  it('complete-registration: geçersiz/bozuk pendingToken 400 döner (PENDING_TOKEN_GECERSIZ)', async () => {
    const res = await agent()
      .post('/api/auth/oauth/complete-registration')
      .send({ pendingToken: 'bozuk.token.degeri', kvkkConsent: true, granularConsent: MANDATORY_GRANULAR_CONSENT })
      .expect(400);

    expect((res.body as { error: string }).error).toBe('PENDING_TOKEN_GECERSIZ');
  });

  it('complete-registration: tam granüler rıza ile 200 + kullanıcı oluşur + doğru Consent satırları + token çalışır', async () => {
    const email = `oauth-tam-${Date.now()}@test.local`;
    const pending = expectPending(
      await handleOAuthCallback(
        { providerUserId: 'g-p3', email, fullName: 'Tam Onay', provider: 'GOOGLE' },
        { tenantSlug: tenant.slug, role: 'MENTI', nonce: 'n' },
      ),
    );

    const res = await agent()
      .post('/api/auth/oauth/complete-registration')
      .send({
        pendingToken: pending.pendingToken,
        kvkkConsent: true,
        granularConsent: { ...MANDATORY_GRANULAR_CONSENT, crossTenantSharing: true, oceanProfiling: false },
      })
      .expect(200);

    const body = res.body as { accessToken: string; isNewUser: boolean };
    expect(body.isNewUser).toBe(true);
    expect(typeof body.accessToken).toBe('string');

    const user = await testPrisma.user.findUnique({ where: { email } });
    expect(user).not.toBeNull();
    expect(user?.authProvider).toBe('GOOGLE');
    expect(user?.approvalStatus).toBe('PENDING'); // davetsiz OAuth kaydı — form kaydıyla aynı kural

    const consents = await testPrisma.consent.findMany({ where: { userId: user!.id } });
    const types = new Set(consents.map((c) => c.type));
    // MANDATORY_SIGNUP_CONSENT_TYPES (6) + crossTenantSharing=true → KURUMLARARASI_PAYLASIM da yazılır;
    // oceanProfiling=false → OCEAN_PROFIL satırı AÇILMAZ.
    expect(types.has('DISC_ESLESTIRME')).toBe(true);
    expect(types.has('YURT_DISI_SAKLAMA')).toBe(true);
    expect(types.has('VERI_ISLEME')).toBe(true);
    expect(types.has('ANONIM_IYILESTIRME')).toBe(true);
    expect(types.has('AYDINLATMA')).toBe(true);
    expect(types.has('ACIK_RIZA')).toBe(true);
    expect(types.has('KURUMLARARASI_PAYLASIM')).toBe(true);
    expect(types.has('OCEAN_PROFIL')).toBe(false);
    expect(consents.every((c) => c.source === 'OAUTH')).toBe(true);

    // Token gerçekten çalışıyor mu? /api/auth/me ile doğrula.
    const me = await agent()
      .get('/api/auth/me')
      .set(tenantHeaders(tenant.id, body.accessToken))
      .expect(200);
    expect((me.body as { email: string }).email).toBe(email);
  });

  it('negatif: pendingToken üretildikten SONRA kurum incelemeye alınırsa complete-registration reddeder (tenant TEKRAR kontrolü)', async () => {
    // Görev tarifi (adım 4): "tenant'ı YENİDEN çek — token oluşturulduktan sonra tenant'ın durumu
    // değişmiş olabilir". Bunu simüle etmek için: AUTO_APPROVED tenant'ta pendingToken üret,
    // SONRA tenant'ı PENDING_REVIEW'a çevir, complete-registration'ın bunu YAKALADIĞINI doğrula.
    const email = `oauth-race-${Date.now()}@test.local`;
    const pending = expectPending(
      await handleOAuthCallback(
        { providerUserId: 'g-race', email, fullName: 'Sonradan İncelemeye Alınan', provider: 'GOOGLE' },
        { tenantSlug: tenant.slug, role: 'MENTI', nonce: 'n' },
      ),
    );

    await testPrisma.tenant.update({ where: { id: tenant.id }, data: { verificationStatus: 'PENDING_REVIEW' } });

    const res = await agent()
      .post('/api/auth/oauth/complete-registration')
      .send({ pendingToken: pending.pendingToken, kvkkConsent: true, granularConsent: MANDATORY_GRANULAR_CONSENT })
      .expect(403);
    expect((res.body as { error: string }).error).toBe('TENANT_ONAY_BEKLENIYOR');

    const user = await testPrisma.user.findUnique({ where: { email } });
    expect(user).toBeNull();
  });
  it('complete-registration: 18 yaş + Aydınlatma beyanı (kvkkConsent) yoksa 400 döner ve kullanıcı OLUŞMAZ', async () => {
    const email = `oauth-kvkk-yok-${Date.now()}@test.local`;
    const pending = expectPending(
      await handleOAuthCallback(
        { providerUserId: 'g-kvkk', email, fullName: 'Beyansız', provider: 'GOOGLE' },
        { tenantSlug: tenant.slug, role: 'MENTI', nonce: 'n' },
      ),
    );

    await agent()
      .post('/api/auth/oauth/complete-registration')
      .send({ pendingToken: pending.pendingToken, granularConsent: MANDATORY_GRANULAR_CONSENT })
      .expect(400);

    expect(await testPrisma.user.findUnique({ where: { email } })).toBeNull();
  });

  it('complete-registration: çift tıklama (eşzamanlı iki istek) → biri 200, diğeri 409 KULLANICI_MEVCUT (500 DEĞİL)', async () => {
    const email = `oauth-cift-${Date.now()}@test.local`;
    const pending = expectPending(
      await handleOAuthCallback(
        { providerUserId: 'g-cift', email, fullName: 'Çift Tıklama', provider: 'GOOGLE' },
        { tenantSlug: tenant.slug, role: 'MENTI', nonce: 'n' },
      ),
    );
    const body = { pendingToken: pending.pendingToken, kvkkConsent: true, granularConsent: MANDATORY_GRANULAR_CONSENT };

    const [a, b] = await Promise.all([
      agent().post('/api/auth/oauth/complete-registration').send(body),
      agent().post('/api/auth/oauth/complete-registration').send(body),
    ]);

    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const conflict = a.status === 409 ? a : b;
    expect((conflict.body as { error: string }).error).toBe('KULLANICI_MEVCUT');
    expect(await testPrisma.user.count({ where: { email } })).toBe(1);
  });
});
