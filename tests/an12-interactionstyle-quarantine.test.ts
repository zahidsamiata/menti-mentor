/**
 * AN-12 — `interactionStyle` KARANTİNA regresyon testleri.
 *
 * Arka plan: `interactionStyle` DONDURULMUŞ bir alan (KARAR 2 revize,
 * `docs/kararlar/konu/degerlendirme-sistemi-tasarim-2026-08-27.md:574-586`, 2026-08-29).
 * Şema alanı ŞEMADA KALIR (migration YOK) — bu tur yalnız üç YAZMA yolunu (createUser,
 * updateUser, completeProfile) karantinaya alır: değer gönderilse bile artık kaydedilmez.
 * SİLME PROTOKOLÜ gereği hiçbir veri silinmiyor, yalnız yazma devre dışı.
 *
 * Bu dosya kanıtlar:
 *  1. PATCH /api/users/:id (admin updateUser) — interactionStyle gönderilir, DİĞER alanlar
 *     kaydedilir (istek reddedilmiyor), ama interactionStyle DB'de DEĞİŞMEZ.
 *  2. POST  /api/users     (admin createUser) — interactionStyle gönderilse bile yeni
 *     kullanıcı interactionStyle=null ile oluşur.
 *  3. POST  /api/users/profile/complete (completeProfile) — interactionStyle gönderilir,
 *     DİĞER alanlar (sectorTags/skills/timeCommitment) yazılır ama interactionStyle
 *     DEĞİŞMEZ (var olan değer korunur — burada baştan null).
 *  4. Okuma yolu bozulmadı: mevcut (DB'de zaten var olan) bir interactionStyle değeri
 *     GET /api/users/:id üzerinden hâlâ doğru döner (karantina okuma yolunu etkilemez).
 *  5. Eşleştirme motoru (matching.ts) davranışı DEĞİŞMEDİ: interactionStyle bonusu hâlâ
 *     yalnızca DB'de fiilen eşit iki değer olduğunda tetiklenir — yazma karantinası bu
 *     mantığa dokunmadı (matching.ts hâlâ okuma yapıyor, bkz. matching-* unit testleri).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { agent, loginAs, tenantHeaders, type TestAgent } from './helpers/request.js';
import { cleanDb, testPrisma } from './helpers/db.js';
import { createTenant, createUser, createAdminUser } from './helpers/factories.js';
import type { Tenant } from '@prisma/client';

describe('AN-12 — interactionStyle karantina (yazma yolları)', () => {
  let http: TestAgent;
  let tenant: Tenant;

  beforeEach(async () => {
    await cleanDb();
    http = agent();
    tenant = await createTenant();
  });

  it('PATCH /api/users/:id — interactionStyle gönderilir ama kaydedilmez, diğer alanlar YAZILIR', async () => {
    const admin = await createAdminUser(tenant.id);
    const tokens = await loginAs(http, admin.email, admin.rawPassword);
    const target = await createUser({ tenantId: tenant.id, role: 'MENTOR', approvalStatus: 'APPROVED' });

    const res = await http
      .patch(`/api/users/${target.id}`)
      .set(tenantHeaders(tenant.id, tokens.accessToken))
      .send({
        fullName: 'Guncellenmis Mentor',
        interactionStyle: 'GOREV_BAZLI',
      })
      .expect(200);

    // İstek REDDEDİLMEDİ — diğer alan yazıldı (karantina isteği bloke etmiyor).
    expect(res.body.fullName).toBe('Guncellenmis Mentor');

    const dbUser = await testPrisma.user.findUnique({ where: { id: target.id } });
    expect(dbUser!.fullName).toBe('Guncellenmis Mentor');
    // ⭐ Asıl kanıt: gönderilen interactionStyle DB'ye YAZILMADI.
    expect(dbUser!.interactionStyle).toBeNull();
  });

  it('POST /api/users — interactionStyle gönderilse bile yeni kullanıcı null ile oluşur', async () => {
    const admin = await createAdminUser(tenant.id);
    const tokens = await loginAs(http, admin.email, admin.rawPassword);

    const res = await http
      .post('/api/users')
      .set(tenantHeaders(tenant.id, tokens.accessToken))
      .send({
        role: 'MENTI',
        email: `an12-create-${Date.now()}@example.com`,
        fullName: 'Yeni Menti',
        interactionStyle: 'SOHBET_BAZLI',
      })
      .expect(201);

    expect(res.body.fullName).toBe('Yeni Menti');

    const dbUser = await testPrisma.user.findUnique({ where: { id: res.body.id } });
    expect(dbUser!.interactionStyle).toBeNull();
  });

  it('POST /api/users/profile/complete — interactionStyle gönderilir ama kaydedilmez, sectorTags/timeCommitment YAZILIR', async () => {
    const user = await createUser({ tenantId: tenant.id, role: 'MENTOR', approvalStatus: 'APPROVED' });
    const tokens = await loginAs(http, user.email, user.rawPassword);

    const res = await http
      .post('/api/users/profile/complete')
      .set(tenantHeaders(tenant.id, tokens.accessToken))
      .send({
        sector: 'Teknoloji',
        skills: ['React'],
        experienceYears: 3,
        timeCommitment: 'HAFTADA_1',
        interactionStyle: 'GOREV_BAZLI',
      })
      .expect(200);

    expect(res.body).toBeTruthy();

    const dbUser = await testPrisma.user.findUnique({ where: { id: user.id } });
    // Diğer rol-spesifik alan yazıldı — karantina yalnız interactionStyle'a özgü.
    expect(dbUser!.timeCommitment).toBe('HAFTADA_1');
    expect(dbUser!.sectorTags).toContain('teknoloji');
    // ⭐ Asıl kanıt: interactionStyle hâlâ null (hiç yazılmadı).
    expect(dbUser!.interactionStyle).toBeNull();
  });

  it('okuma yolu bozulmadı: DB\'de zaten var olan interactionStyle GET /api/users/:id üzerinden hâlâ döner', async () => {
    const user = await createUser({ tenantId: tenant.id, role: 'MENTOR', approvalStatus: 'APPROVED' });
    // Karantina ÖNCESİ zaten yazılmış olabilecek değeri simüle et — doğrudan DB'ye (yazma
    // yolu değil, mevcut veri senaryosu). Hiçbir kullanıcı verisi silinmediğinin kanıtı.
    await testPrisma.user.update({ where: { id: user.id }, data: { interactionStyle: 'SOHBET_BAZLI' } });

    const tokens = await loginAs(http, user.email, user.rawPassword);
    const res = await http
      .get(`/api/users/${user.id}`)
      .set(tenantHeaders(tenant.id, tokens.accessToken))
      .expect(200);

    expect(res.body.interactionStyle).toBe('SOHBET_BAZLI');
  });
});
