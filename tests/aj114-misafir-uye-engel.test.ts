/**
 * AJ-114 — Çift engelinde misafir üye.
 *
 * Sorun: POST /api/tenants/:id/block-pair iki kişiyi ana kurumlarından (`User.tenantId`) doğruluyordu;
 * seçim listesi ise kurum üyeliğinden (TenantMembership) geliyor. Ana kurumu başka olan misafir üye
 * seçilince "bu kurumda bulunamadı" (404) dönüyor, yönetici engeli koyamıyordu — oysa eşleştirme bu
 * kurumun engel listesini misafir üyede de okuyor.
 * Düzeltme: iki kişi istek kurumundaki AKTİF üyelikten doğrulanır.
 *
 * Pozitif: misafir üye (ana kurum başka, bu kurumda aktif üyelik) engellenir → 201 + dizide; kaldırma
 *   (DELETE) ve liste (GET) misafirde de çalışır.
 * Negatif: kurumda hiç üyeliği olmayan kişi / pasif üyelik → 404, dizi DEĞİŞMEZ.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { agent, type TestAgent } from './helpers/request.js';
import { cleanDb, testPrisma } from './helpers/db.js';
import { createTenant, createAdminUser, createMentor, createUser } from './helpers/factories.js';
import { signToken } from '../src/middleware/jwtAuth.js';
import { pairKey, sanitizeBlockedPairs } from '../src/services/blockList.js';
import type { User } from '@prisma/client';

function tokenFor(u: Pick<User, 'id' | 'tenantId' | 'role' | 'fullName'>): string {
  return signToken({ sub: u.id, tenantId: u.tenantId, role: u.role, fullName: u.fullName });
}

async function blockedPairsOf(tenantId: string) {
  const t = await testPrisma.tenant.findUnique({ where: { id: tenantId }, select: { blockedPairs: true } });
  return sanitizeBlockedPairs(t?.blockedPairs);
}

describe('AJ-114 — çift engeli: misafir üye kurum üyeliğinden doğrulanır', () => {
  let http: TestAgent;
  let tenantId: string;
  let otherTenantId: string;
  let adminToken: string;
  let mentor: Awaited<ReturnType<typeof createMentor>>;

  beforeEach(async () => {
    await cleanDb();
    http = agent();
    const tenant = await createTenant();
    const other  = await createTenant();
    tenantId      = tenant.id;
    otherTenantId = other.id;
    const admin = await createAdminUser(tenantId);
    adminToken = tokenFor(admin);
    mentor = await createMentor(tenantId);
  });

  /** Ana kurumu `otherTenantId` olan, bu kurumda verilen durumda üyeliği olan kişi. */
  async function guestMember(isActive: boolean) {
    const u = await createUser({ tenantId: otherTenantId, role: 'MENTI' });
    await testPrisma.tenantMembership.create({
      data: { userId: u.id, tenantId, role: 'MENTI', isActive },
    });
    return u;
  }

  function block(fromUserId: string, toUserId: string) {
    return http
      .post(`/api/tenants/${tenantId}/block-pair`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ fromUserId, toUserId });
  }

  // ─── Pozitif ─────────────────────────────────────────────────────────────

  it('misafir üye (ana kurum başka, bu kurumda aktif üyelik) engellenir → 201, dizide, yanıtta adı var', async () => {
    const guest = await guestMember(true);

    const res = await block(mentor.id, guest.id).expect(201);
    expect(res.body.toUser).toEqual({ id: guest.id, fullName: guest.fullName });
    expect(res.body.fromUser).toEqual({ id: mentor.id, fullName: mentor.fullName });
    expect(res.body.totalBlockedPairs).toBe(1);

    const keys = (await blockedPairsOf(tenantId)).map((p) => pairKey(p.fromUserId, p.toUserId));
    expect(keys).toEqual([pairKey(mentor.id, guest.id)]);
  });

  it('misafir üyeli engel listede görünür ve kaldırılabilir (DELETE → 200, dizi boşalır)', async () => {
    const guest = await guestMember(true);
    await block(guest.id, mentor.id).expect(201);
    const pairId = pairKey(guest.id, mentor.id);

    const list = await http
      .get(`/api/tenants/${tenantId}/block-pairs`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(list.body.items).toHaveLength(1);
    expect(list.body.items[0].pairId).toBe(pairId);
    expect(list.body.items[0].fromUser).toEqual({ id: guest.id, fullName: guest.fullName });

    const del = await http
      .delete(`/api/tenants/${tenantId}/block-pair/${encodeURIComponent(pairId)}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(del.body.totalBlockedPairs).toBe(0);
    expect(await blockedPairsOf(tenantId)).toEqual([]);
  });

  // ─── Negatif ─────────────────────────────────────────────────────────────

  it('bu kurumda hiç üyeliği olmayan kişi → 404, dizi değişmez', async () => {
    const outsider = await createUser({ tenantId: otherTenantId, role: 'MENTI' });

    const res = await block(mentor.id, outsider.id).expect(404);
    expect(res.body.error).toBe('KULLANICI_BULUNAMADI');
    expect(await blockedPairsOf(tenantId)).toEqual([]);
  });

  it('bu kurumdaki üyeliği pasif misafir → 404, dizi değişmez', async () => {
    const inactiveGuest = await guestMember(false);

    await block(mentor.id, inactiveGuest.id).expect(404);
    expect(await blockedPairsOf(tenantId)).toEqual([]);
  });

  it('ana kurumu bu kurum olsa da üyeliği pasifleştirilmiş kişi → 404, dizi değişmez', async () => {
    const removed = await createUser({ tenantId, role: 'MENTI' });
    await testPrisma.tenantMembership.update({
      where: { userId_tenantId: { userId: removed.id, tenantId } },
      data:  { isActive: false },
    });

    await block(mentor.id, removed.id).expect(404);
    expect(await blockedPairsOf(tenantId)).toEqual([]);
  });
});
