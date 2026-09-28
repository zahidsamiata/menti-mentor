/**
 * AJ-127 — platform kurum uçları (POST /api/tenants · GET/PATCH /api/tenants/:id) Tenant kaydını
 * AÇIK select ile döndürür: yanıt anahtarları TAM OLARAK `TENANT_ADMIN_RESPONSE_SELECT`; hariç
 * listedeki iç/hassas alanlar (abonelikten çıkma belirteci, başvuru kanıtı, engellenen çiftler …)
 * yanıtta YOK. Negatif: kurum kaydına bu alanlar doldurulur, yanıtta görünmemesi beklenir.
 * Mutasyon: select kaldırılınca (`res.json(tenant)` tüm kolonlar) bu test KIRMIZI olur.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { agent, type TestAgent } from './helpers/request.js';
import { cleanDb, testPrisma } from './helpers/db.js';
import { createTenant } from './helpers/factories.js';
import { signToken, PLATFORM_AUDIENCE } from '../src/middleware/jwtAuth.js';
import {
  TENANT_ADMIN_RESPONSE_SELECT,
  TENANT_ADMIN_RESPONSE_EXCLUDED,
} from '../src/controllers/tenantController.js';

// aj05-logo-url-kisiti.test.ts ile aynı desen: platform çerezi elle eklenir.
function makePlatformCookie(): string {
  const token = signToken(
    { sub: 'platform-admin', tenantId: '__platform__', role: 'ADMIN', fullName: 'Platform Yöneticisi', isPlatformAdmin: true },
    { audience: PLATFORM_AUDIENCE },
  );
  return `platform_token=${encodeURIComponent(token)}`;
}

const EXPECTED_KEYS = Object.keys(TENANT_ADMIN_RESPONSE_SELECT).sort();
const HIDDEN_KEYS = Object.keys(TENANT_ADMIN_RESPONSE_EXCLUDED);

function expectOnlyAllowedKeys(body: Record<string, unknown>) {
  expect(Object.keys(body).sort()).toEqual(EXPECTED_KEYS);
  for (const k of HIDDEN_KEYS) expect(body).not.toHaveProperty(k);
}

describe('AJ-127: platform kurum uçları yalnız izinli alanları döndürür', () => {
  let http: TestAgent;
  let tenantId: string;

  beforeEach(async () => {
    await cleanDb();
    http = agent();
    tenantId = (await createTenant()).id;
    // Hassas/iç alanları doldur — yanıtta görünmemeliler.
    await testPrisma.tenant.update({
      where: { id: tenantId },
      data: {
        unsubscribeToken: 'aj127-gizli-belirtec',
        verificationNote: 'Görev: dernek başkanı · kanıt: https://ornek.test/kanit',
        verifiedBy: 'platform-admin-id',
        blockedPairs: [{ fromUserId: 'u1', toUserId: 'u2' }],
        kvkkConsentAt: new Date(),
      },
    });
  });

  it('GET /api/tenants/:id → anahtarlar tam olarak izin listesi, gizli alan yok', async () => {
    const res = await http.get(`/api/tenants/${tenantId}`).set('Cookie', makePlatformCookie()).expect(200);
    expectOnlyAllowedKeys(res.body);
    expect(res.body.id).toBe(tenantId);
    expect(JSON.stringify(res.body)).not.toContain('aj127-gizli-belirtec');
  });

  it('PATCH /api/tenants/:id → anahtarlar tam olarak izin listesi, gizli alan yok', async () => {
    const res = await http
      .patch(`/api/tenants/${tenantId}`)
      .set('Cookie', makePlatformCookie())
      .send({ displayName: 'Yeni Görüntü Adı' })
      .expect(200);
    expectOnlyAllowedKeys(res.body);
    expect(res.body.displayName).toBe('Yeni Görüntü Adı');
    expect(JSON.stringify(res.body)).not.toContain('aj127-gizli-belirtec');
  });

  it('POST /api/tenants → anahtarlar tam olarak izin listesi', async () => {
    const res = await http
      .post('/api/tenants')
      .set('Cookie', makePlatformCookie())
      .send({ name: 'AJ127 Kurumu', slug: 'aj127-kurumu' })
      .expect(201);
    expectOnlyAllowedKeys(res.body);
    expect(res.body.slug).toBe('aj127-kurumu');
  });
});
