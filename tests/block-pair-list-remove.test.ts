/**
 * E-3d — GET /api/tenants/:id/block-pairs (liste) + DELETE /api/tenants/:id/block-pair/:pairId (kaldır).
 *
 * Admin panelinde koyulan engel görünür olmalı VE geri alınabilir olmalı (E-3d denetimi:
 * yalnız POST /block-pair vardı, liste/kaldırma yoktu → geri dönülemez bir işlemdi).
 * Auth zinciri POST /block-pair ile AYNI: authenticateTenantAdmin + tenantId eşleşmesi.
 * `pairId` = services/blockList.ts pairKey (yön bağımsız, iki userId'den türeyen deterministik
 * anahtar — şema değişmedi, ayrı bir id sütunu YOK).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { agent, tenantHeaders, type TestAgent } from './helpers/request.js';
import { cleanDb, testPrisma } from './helpers/db.js';
import { createTenant, createAdminUser, createMentor, createMenti } from './helpers/factories.js';
import { signToken } from '../src/middleware/jwtAuth.js';
import type { User } from '@prisma/client';

function tokenFor(u: Pick<User, 'id' | 'tenantId' | 'role' | 'fullName'>): string {
  return signToken({ sub: u.id, tenantId: u.tenantId, role: u.role, fullName: u.fullName });
}

describe('E-3d — çift engeli listeleme + kaldırma', () => {
  let http: TestAgent;
  let tenantId: string;
  let admin: Awaited<ReturnType<typeof createAdminUser>>;
  let mentor: Awaited<ReturnType<typeof createMentor>>;
  let menti: Awaited<ReturnType<typeof createMenti>>;
  let adminToken: string;

  beforeEach(async () => {
    await cleanDb();
    http = agent();
    const tenant = await createTenant();
    tenantId = tenant.id;
    admin = await createAdminUser(tenantId);
    mentor = await createMentor(tenantId);
    menti = await createMenti(tenantId);
    adminToken = tokenFor(admin);
  });

  async function blockThePair(): Promise<void> {
    await http
      .post(`/api/tenants/${tenantId}/block-pair`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ fromUserId: mentor.id, toUserId: menti.id })
      .expect(201);
  }

  // ─── GET /block-pairs ────────────────────────────────────────────────────

  it('admin engellediği çifti listede taraf adları + tarihle görür', async () => {
    await blockThePair();

    const res = await http
      .get(`/api/tenants/${tenantId}/block-pairs`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(res.body.total).toBe(1);
    expect(res.body.items).toHaveLength(1);
    const item = res.body.items[0];
    expect(item.fromUser).toEqual({ id: mentor.id, fullName: mentor.fullName });
    expect(item.toUser).toEqual({ id: menti.id, fullName: menti.fullName });
    expect(typeof item.blockedAt).toBe('string');
    expect(typeof item.pairId).toBe('string');
    // PII sızıntısı yok — email response'ta hiç bulunmamalı
    expect(JSON.stringify(res.body)).not.toContain(mentor.email);
    expect(JSON.stringify(res.body)).not.toContain(menti.email);
  });

  it('hiç engel yoksa boş liste döner', async () => {
    const res = await http
      .get(`/api/tenants/${tenantId}/block-pairs`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(res.body).toEqual({ items: [], total: 0 });
  });

  it('ADMIN olmayan (mentör) listeyi göremez (403)', async () => {
    await blockThePair();
    const res = await http
      .get(`/api/tenants/${tenantId}/block-pairs`)
      .set('Authorization', `Bearer ${tokenFor(mentor)}`)
      .expect(403);
    expect(res.body.error).toBeDefined();
  });

  it('başka kurumun yöneticisi bu kurumun listesini göremez (403)', async () => {
    await blockThePair();
    const otherTenant = await createTenant();
    const otherAdmin = await createAdminUser(otherTenant.id);
    await http
      .get(`/api/tenants/${tenantId}/block-pairs`)
      .set('Authorization', `Bearer ${tokenFor(otherAdmin)}`)
      .expect(403);
  });

  // ─── DELETE /block-pair/:pairId ──────────────────────────────────────────

  it('admin engeli kaldırır (200), liste boşalır', async () => {
    await blockThePair();
    const list = await http
      .get(`/api/tenants/${tenantId}/block-pairs`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const pairId = list.body.items[0].pairId as string;

    const del = await http
      .delete(`/api/tenants/${tenantId}/block-pair/${pairId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(del.body.totalBlockedPairs).toBe(0);

    const after = await testPrisma.tenant.findUnique({ where: { id: tenantId } });
    expect(after?.blockedPairs).toEqual([]);
  });

  it('ADMIN olmayan (mentör) engeli kaldıramaz (403), kayıt DB\'de kalır', async () => {
    await blockThePair();
    const list = await http
      .get(`/api/tenants/${tenantId}/block-pairs`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const pairId = list.body.items[0].pairId as string;

    await http
      .delete(`/api/tenants/${tenantId}/block-pair/${pairId}`)
      .set('Authorization', `Bearer ${tokenFor(mentor)}`)
      .expect(403);

    const after = await testPrisma.tenant.findUnique({ where: { id: tenantId } });
    expect(Array.isArray(after?.blockedPairs) ? after?.blockedPairs : []).toHaveLength(1);
  });

  it('olmayan bir pairId için 404 döner', async () => {
    const res = await http
      .delete(`/api/tenants/${tenantId}/block-pair/uydurma-pair-id`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(404);
    expect(res.body.error).toBe('ENGEL_BULUNAMADI');
  });

  it('IDOR: başka kurumun engel kaydı bu kurumdan kaldırılamaz (404, kayıt DB\'de kalır)', async () => {
    // Kendi tenant'ımızda BİR engel var (mentor↔menti).
    await blockThePair();

    // Başka bir tenant'ta FARKLI bir çift engellensin — kendi pairId'sini üretir.
    const otherTenant = await createTenant();
    const otherAdmin  = await createAdminUser(otherTenant.id);
    const otherMentor = await createMentor(otherTenant.id);
    const otherMenti  = await createMenti(otherTenant.id);
    await http
      .post(`/api/tenants/${otherTenant.id}/block-pair`)
      .set('Authorization', `Bearer ${tokenFor(otherAdmin)}`)
      .send({ fromUserId: otherMentor.id, toUserId: otherMenti.id })
      .expect(201);

    const otherList = await http
      .get(`/api/tenants/${otherTenant.id}/block-pairs`)
      .set('Authorization', `Bearer ${tokenFor(otherAdmin)}`)
      .expect(200);
    const otherPairId = otherList.body.items[0].pairId as string;

    // Kendi tenant'ımızın admin'i, KENDİ tenantId'sinde (auth geçer) ama BAŞKA kurumun
    // pairId'sini vererek silmeyi dener — kendi diziside böyle bir kayıt yok → 404 (IDOR kapalı).
    const res = await http
      .delete(`/api/tenants/${tenantId}/block-pair/${otherPairId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(404);
    expect(res.body.error).toBe('ENGEL_BULUNAMADI');

    // Her iki kurumun kaydı da bozulmamış olmalı.
    const mine  = await testPrisma.tenant.findUnique({ where: { id: tenantId } });
    const other = await testPrisma.tenant.findUnique({ where: { id: otherTenant.id } });
    expect(Array.isArray(mine?.blockedPairs)  ? mine?.blockedPairs  : []).toHaveLength(1);
    expect(Array.isArray(other?.blockedPairs) ? other?.blockedPairs : []).toHaveLength(1);
  });

  // ─── KR-19 yüzeyi ile uçtan uca doğrulama ────────────────────────────────

  it('engel kaldırılınca çift YENİDEN konuşma başlatabilir (KR-19 mesajlaşma yüzeyi)', async () => {
    await blockThePair();

    // Engelliyken konuşma başlatılamaz (409/403 — mevcut KR-19 davranışı, conversation.test.ts'te de kanıtlı).
    const blockedAttempt = await http
      .post('/api/conversations')
      .set(tenantHeaders(tenantId, tokenFor(menti)))
      .send({ mentorUserId: mentor.id, message: 'Merhaba, sizinle çalışmak istiyorum çünkü sektörünüz ilgi alanım.' });
    expect(blockedAttempt.status).toBe(403);

    const list = await http
      .get(`/api/tenants/${tenantId}/block-pairs`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const pairId = list.body.items[0].pairId as string;

    await http
      .delete(`/api/tenants/${tenantId}/block-pair/${pairId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const afterUnblock = await http
      .post('/api/conversations')
      .set(tenantHeaders(tenantId, tokenFor(menti)))
      .send({ mentorUserId: mentor.id, message: 'Merhaba, sizinle çalışmak istiyorum çünkü sektörünüz ilgi alanım.' })
      .expect(201);
    expect(afterUnblock.body.conversation.id).toBeTruthy();
  });
});
