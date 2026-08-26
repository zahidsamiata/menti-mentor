/**
 * 9a — Manuel eşleştirme ağırlığı ENTEGRASYON testleri.
 *
 * Kapsam:
 *  - PUT /api/admin/algorithm-tuner/weights geçerli değeri kaydeder (0.55/0.45)
 *  - Küsürat / sınır dışı / toplam≠1.00 reddedilir (400, Türkçe mesaj)
 *  - Tenant izolasyonu: bir kurumun admin'i BAŞKA kurumun ağırlığını değiştiremez
 *  - Bekleyen otomatik kalibrasyon önerisi manuel ayarla temizlenir (pendingCleared)
 *  - Audit izi SystemLog'a AUDIT kategorisiyle (actorUserId + previous/newWeights) yazılır
 *  - Yalnız ADMIN erişebilir (MENTOR 403)
 *
 * TEST_DATABASE_URL guard'ına saygılı: cleanDb assertSafeTestDatabase ile korunur;
 * izole DB yoksa suite guard'da durur (canlı Neon'a yazmaz).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { agent, loginAs, tenantHeaders, type TestAgent } from './helpers/request.js';
import { cleanDb, testPrisma } from './helpers/db.js';
import { createTenant, createAdminUser, createUser } from './helpers/factories.js';
import type { Tenant } from '@prisma/client';

const WEIGHTS_PATH = '/api/admin/algorithm-tuner/weights';

describe('9a: PUT /algorithm-tuner/weights — manuel ağırlık ayarı', () => {
  let http: TestAgent;
  let tenant: Tenant;
  let adminToken: string;
  let adminId: string;
  let adminName: string;

  beforeEach(async () => {
    await cleanDb();
    http = agent();
    tenant = await createTenant();
    const admin = await createAdminUser(tenant.id);
    adminId = admin.id;
    adminName = admin.fullName;
    const tokens = await loginAs(http, admin.email, admin.rawPassword);
    adminToken = tokens.accessToken;
  });

  it('geçerli değer (0.55) kaydedilir, discWeight otomatik 0.45 türetilir', async () => {
    const res = await http
      .put(WEIGHTS_PATH)
      .set(tenantHeaders(tenant.id, adminToken))
      .send({ sectorWeight: 0.55 })
      .expect(200);

    expect(res.body.weights.sectorWeight).toBe(0.55);
    expect(res.body.weights.discWeight).toBe(0.45);

    // DB'ye gerçekten yazıldı mı?
    const dbTenant = await testPrisma.tenant.findUnique({ where: { id: tenant.id } });
    const vocab = dbTenant?.tenantVocabulary as Record<string, { sectorWeight: number }>;
    expect(vocab.algorithmWeights.sectorWeight).toBe(0.55);
  });

  it('küsürat (0.53) reddedilir (400) — Türkçe mesaj', async () => {
    const res = await http
      .put(WEIGHTS_PATH)
      .set(tenantHeaders(tenant.id, adminToken))
      .send({ sectorWeight: 0.53 })
      .expect(400);
    expect(res.body.message).toBe("Ağırlık %5'in katı olmalıdır.");
  });

  it('MIN altı (0.30) reddedilir (400)', async () => {
    const res = await http
      .put(WEIGHTS_PATH)
      .set(tenantHeaders(tenant.id, adminToken))
      .send({ sectorWeight: 0.3 })
      .expect(400);
    expect(res.body.message).toBe('Sektör ağırlığı %40-%70 arasında olmalıdır.');
  });

  it('MAX üstü (0.80) reddedilir (400)', async () => {
    await http
      .put(WEIGHTS_PATH)
      .set(tenantHeaders(tenant.id, adminToken))
      .send({ sectorWeight: 0.8 })
      .expect(400);
  });

  it('discWeight gönderilir ama toplam ≠ 1.00 ise reddedilir (400)', async () => {
    const res = await http
      .put(WEIGHTS_PATH)
      .set(tenantHeaders(tenant.id, adminToken))
      .send({ sectorWeight: 0.6, discWeight: 0.5 })
      .expect(400);
    expect(res.body.message).toBe('Sektör ve DISC ağırlıklarının toplamı %100 olmalıdır.');
  });

  it('MENTOR rolü erişemez (403)', async () => {
    const mentor = await createUser({ tenantId: tenant.id, role: 'MENTOR' });
    const mentorTokens = await loginAs(http, mentor.email, mentor.rawPassword);
    await http
      .put(WEIGHTS_PATH)
      .set(tenantHeaders(tenant.id, mentorTokens.accessToken))
      .send({ sectorWeight: 0.55 })
      .expect(403);
  });

  it('TENANT İZOLASYONU: A kurumu admin\'i B kurumunun ağırlığını değiştiremez', async () => {
    // B kurumu ayrı admin ile
    const tenantB = await createTenant();
    const adminB = await createAdminUser(tenantB.id);

    // A admin'inin token'ıyla B'nin header'ını kullanmak → cross-tenant, middleware 403.
    await http
      .put(WEIGHTS_PATH)
      .set(tenantHeaders(tenantB.id, adminToken))
      .send({ sectorWeight: 0.55 })
      .expect(403);

    // B'nin ağırlığı DEĞİŞMEMİŞ olmalı (hiç yazılmamış → varsayılan, algorithmWeights yok)
    const dbTenantB = await testPrisma.tenant.findUnique({ where: { id: tenantB.id } });
    const vocabB = (dbTenantB?.tenantVocabulary as Record<string, unknown>) ?? {};
    expect(vocabB['algorithmWeights']).toBeUndefined();

    // Sağlama: B kendi admin'iyle kendi ağırlığını ayarlayabilir, A'ya sızmaz.
    const httpB = agent();
    const tokensB = await loginAs(httpB, adminB.email, adminB.rawPassword);
    await httpB
      .put(WEIGHTS_PATH)
      .set(tenantHeaders(tenantB.id, tokensB.accessToken))
      .send({ sectorWeight: 0.7 })
      .expect(200);

    // A'nın ağırlığı hâlâ yazılmamış (B'nin ayarı A'ya sızmadı)
    const dbTenantA = await testPrisma.tenant.findUnique({ where: { id: tenant.id } });
    const vocabA = (dbTenantA?.tenantVocabulary as Record<string, unknown>) ?? {};
    expect(vocabA['algorithmWeights']).toBeUndefined();
  });

  it('bekleyen otomatik kalibrasyon önerisi manuel ayarla temizlenir (pendingCleared=true)', async () => {
    // Önce sahte bir pendingAlgorithmAdjustment yerleştir.
    await testPrisma.tenant.update({
      where: { id: tenant.id },
      data: {
        tenantVocabulary: {
          pendingAlgorithmAdjustment: { proposedAt: new Date().toISOString(), reason: 'test' },
        },
      },
    });

    const res = await http
      .put(WEIGHTS_PATH)
      .set(tenantHeaders(tenant.id, adminToken))
      .send({ sectorWeight: 0.6 })
      .expect(200);

    expect(res.body.pendingCleared).toBe(true);

    const dbTenant = await testPrisma.tenant.findUnique({ where: { id: tenant.id } });
    const vocab = dbTenant?.tenantVocabulary as Record<string, unknown>;
    expect(vocab['pendingAlgorithmAdjustment']).toBeUndefined();
    expect((vocab['algorithmWeights'] as { sectorWeight: number }).sectorWeight).toBe(0.6);
  });

  it('audit izi SystemLog\'a AUDIT kategorisiyle yazılır (actorUserId + previous/new)', async () => {
    await http
      .put(WEIGHTS_PATH)
      .set(tenantHeaders(tenant.id, adminToken))
      .send({ sectorWeight: 0.65 })
      .expect(200);

    // logger asenkron (void) — kısa bekleme yerine yazımın tamamlanması için poll.
    let log: { meta: unknown } | null = null;
    for (let i = 0; i < 20 && !log; i++) {
      log = await testPrisma.systemLog.findFirst({
        where: { category: 'AUDIT', message: { contains: 'manuel ayarladı' } },
        orderBy: { createdAt: 'desc' },
      });
      if (!log) await new Promise((r) => setTimeout(r, 50));
    }

    expect(log).not.toBeNull();
    const meta = log?.meta as {
      actorUserId: string;
      previousWeights: { sectorWeight: number };
      newWeights: { sectorWeight: number };
      timestamp: string;
    };
    expect(meta.actorUserId).toBe(adminId);
    expect(meta.newWeights.sectorWeight).toBe(0.65);
    expect(meta.previousWeights).toBeDefined();
    expect(meta.timestamp).toBeDefined();
  });

  // ─── 95: GET /weights "son değişiklik" izi — kim / ne zaman / eski→yeni ──────

  it('GET /weights: hiç değişiklik yapılmadıysa lastChange = null (uydurma yok)', async () => {
    const res = await http
      .get(WEIGHTS_PATH)
      .set(tenantHeaders(tenant.id, adminToken))
      .expect(200);
    expect(res.body.weights.sectorWeight).toBe(0.6); // varsayılan
    expect(res.body.lastChange).toBeNull();
  });

  it('GET /weights: manuel ayardan sonra lastChange aktör ADI + eski→yeni döner', async () => {
    // Varsayılan 0.60 → 0.65 değiştir.
    await http
      .put(WEIGHTS_PATH)
      .set(tenantHeaders(tenant.id, adminToken))
      .send({ sectorWeight: 0.65 })
      .expect(200);

    // AUDIT log'u asenkron (void) — yazımın tamamlanması için lastChange dolana dek poll et.
    let lastChange: {
      actorName: string | null;
      at: string;
      previousSectorWeight: number;
      previousDiscWeight: number;
      newSectorWeight: number;
      newDiscWeight: number;
    } | null = null;
    for (let i = 0; i < 20 && !lastChange; i++) {
      const res = await http
        .get(WEIGHTS_PATH)
        .set(tenantHeaders(tenant.id, adminToken))
        .expect(200);
      lastChange = res.body.lastChange;
      if (!lastChange) await new Promise((r) => setTimeout(r, 50));
    }

    expect(lastChange).not.toBeNull();
    expect(lastChange?.actorName).toBe(adminName); // ad — e-posta DEĞİL
    expect(lastChange?.previousSectorWeight).toBe(0.6);
    expect(lastChange?.newSectorWeight).toBe(0.65);
    expect(lastChange?.newDiscWeight).toBe(0.35);
    expect(lastChange?.at).toBeDefined();
    // PII minimizasyonu: yanıtta e-posta sızmasın.
    expect(JSON.stringify(lastChange)).not.toContain('@');
  });

  it('TENANT İZOLASYONU (okuma): A kurumunun izi B kurumunun GET /weights yanıtında görünmez', async () => {
    // A değişiklik yapar.
    await http
      .put(WEIGHTS_PATH)
      .set(tenantHeaders(tenant.id, adminToken))
      .send({ sectorWeight: 0.65 })
      .expect(200);

    // A'da izin oturması için bekle.
    for (let i = 0; i < 20; i++) {
      const res = await http.get(WEIGHTS_PATH).set(tenantHeaders(tenant.id, adminToken)).expect(200);
      if (res.body.lastChange) break;
      await new Promise((r) => setTimeout(r, 50));
    }

    // B kurumu hiç değişiklik yapmadı → kendi GET'inde lastChange null (A'nın izi sızmaz).
    const tenantB = await createTenant();
    const adminB = await createAdminUser(tenantB.id);
    const httpB = agent();
    const tokensB = await loginAs(httpB, adminB.email, adminB.rawPassword);
    const resB = await httpB
      .get(WEIGHTS_PATH)
      .set(tenantHeaders(tenantB.id, tokensB.accessToken))
      .expect(200);
    expect(resB.body.lastChange).toBeNull();
  });
});
