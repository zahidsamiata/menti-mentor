/**
 * Madde 38 regresyon testi — updateUser + submitTemperamentTest PII/parola sızıntısı.
 *
 * Kök hata: `prisma.user.update({ data })` (select'siz) ham User objesini döndürüp
 * `res.json` ile response'a taşıyordu → `password` hash + `discVector` + `selfProfile`
 * + `email` + serbest-metin CV alanları sızıyordu.
 *
 * Çözüm iki katmanlı:
 *  (a) Global omit (`db.ts`): `password` hiçbir default-return'de dönmez.
 *  (b) Explicit `select` (updateUser → USER_FULL_SELECT, temperament → dar set).
 *
 * Bu test HTTP yanıtında `password` anahtarının HİÇ bulunmadığını + ham psikometri/
 * selfProfile gibi hassas alanların sızmadığını kanıtlar. Guard'a saygılıdır: cleanDb
 * yalnızca izole test DB'sinde çalışır (assertSafeTestDatabase).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { agent, loginAs, tenantHeaders, type TestAgent } from './helpers/request.js';
import { cleanDb, testPrisma } from './helpers/db.js';
import { createTenant, createUser, createAdminUser } from './helpers/factories.js';
import type { Tenant } from '@prisma/client';

describe('Madde 38 — updateUser / temperament yanıtında PII+parola sızıntısı yok', () => {
  let http: TestAgent;
  let tenant: Tenant;
  let adminToken: string;
  let targetId: string;

  beforeEach(async () => {
    await cleanDb();
    http = agent();
    tenant = await createTenant();

    const admin = await createAdminUser(tenant.id);
    const tokens = await loginAs(http, admin.email, admin.rawPassword);
    adminToken = tokens.accessToken;

    const target = await createUser({ tenantId: tenant.id, role: 'MENTOR', approvalStatus: 'APPROVED' });
    targetId = target.id;

    // Hedefe ham hassas veri yerleştir (sızarsa test yakalasın): discVector + selfProfile.
    await testPrisma.user.update({
      where: { id: targetId },
      data: {
        discVector: { D: 0.9, I: 0.1, S: 0.2, C: 0.3 },
        selfProfile: { gizliNot: 'bu sizmamali' },
      },
    });
  });

  it('PATCH /api/users/:id yanıtı password hash içermez ve ham PII sızdırmaz', async () => {
    const res = await http
      .patch(`/api/users/${targetId}`)
      .set(tenantHeaders(tenant.id, adminToken))
      .send({ fullName: 'Guncellenmis Isim', bioSummary: 'Yeni bio' })
      .expect(200);

    const body = res.body as Record<string, unknown>;

    // İş gerçekten yapıldı (yanıt beklenen alanları döndürüyor).
    expect(body.fullName).toBe('Guncellenmis Isim');
    expect(body.bioSummary).toBe('Yeni bio');

    // Kanıt: parola hash'i response'ta HİÇ yok.
    expect(body).not.toHaveProperty('password');

    // Kanıt: ham selfProfile (serbest-metin, gizli) sızmıyor.
    expect(body).not.toHaveProperty('selfProfile');
  });

  it('POST /api/users/:id/temperament-test yanıtı password/discVector/selfProfile sızdırmaz', async () => {
    const answers = [1, 2, 3, 4, 5, 6, 7].map((questionId) => ({
      questionId,
      selectedDisc: 'D' as const,
    }));

    const res = await http
      .post(`/api/users/${targetId}/temperament-test`)
      .set(tenantHeaders(tenant.id, adminToken))
      .send({ answers })
      .expect(200);

    const body = res.body as { user: Record<string, unknown>; analysis: unknown };

    // İş yapıldı: analiz + güncellenen discType dönüyor.
    expect(body.analysis).toBeTruthy();
    expect(body.user).toHaveProperty('discType');

    // Kanıt: user objesi parola/ham vektör/selfProfile taşımıyor.
    expect(body.user).not.toHaveProperty('password');
    expect(body.user).not.toHaveProperty('discVector');
    expect(body.user).not.toHaveProperty('selfProfile');
    expect(body.user).not.toHaveProperty('email');
  });

  it('global omit: default-return sorgu (select/omit yazmayan) password taşımaz', async () => {
    // db.ts global omit'i doğrula — uygulama prisma'sı (extension'lı) üzerinden.
    const { prisma } = await import('../src/db.js');
    const u = (await prisma.user.findFirst({ where: { id: targetId } })) as Record<string, unknown> | null;
    expect(u).toBeTruthy();
    expect(u).not.toHaveProperty('password');
  });
});
