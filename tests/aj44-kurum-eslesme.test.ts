/**
 * AJ-44 (F-23 kalanı) — URL `:id` kurumu ile oturum kurumu eşleşmesi merkezî kapıda
 * (`authenticateTenantAdminForParam`). Entegrasyon (gerçek DB): B kurumunun yöneticisi
 * A kurumunun `:id`'siyle dört adminSettings ucunu çağırır → 403 YETKI_YOK ve A'nın
 * ayarları + engel listesi DEĞİŞMEZ, engel verisi dönmez.
 * DB'siz birim eşi (mutasyon kanıtı yerelde): tests/tenant-admin-param-match.unit.test.ts.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { agent, type TestAgent } from './helpers/request.js';
import { cleanDb, testPrisma } from './helpers/db.js';
import { createTenant, createAdminUser, createMentor, createMenti } from './helpers/factories.js';
import { signToken } from '../src/middleware/jwtAuth.js';
import { pairKey } from '../src/services/blockList.js';
import type { User } from '@prisma/client';

function tokenFor(u: Pick<User, 'id' | 'tenantId' | 'role' | 'fullName'>): string {
  return signToken({ sub: u.id, tenantId: u.tenantId, role: u.role, fullName: u.fullName });
}

describe('AJ-44 — başka kurumun yöneticisi URL :id ile bu kurumun ayar/engel uçlarına giremez', () => {
  let http: TestAgent;
  let tenantAId: string;
  let adminAToken: string;
  let foreignAdminToken: string;
  let mentorA: Awaited<ReturnType<typeof createMentor>>;
  let mentiA: Awaited<ReturnType<typeof createMenti>>;

  beforeEach(async () => {
    await cleanDb();
    http = agent();
    const tenantA = await createTenant();
    tenantAId = tenantA.id;
    adminAToken = tokenFor(await createAdminUser(tenantAId));
    mentorA = await createMentor(tenantAId);
    mentiA = await createMenti(tenantAId);

    const tenantB = await createTenant();
    foreignAdminToken = tokenFor(await createAdminUser(tenantB.id));

    // A'da bir engel kaydı olsun — DELETE/GET denemelerinin hedefi.
    await http
      .post(`/api/tenants/${tenantAId}/block-pair`)
      .set('Authorization', `Bearer ${adminAToken}`)
      .send({ fromUserId: mentorA.id, toUserId: mentiA.id })
      .expect(201);
  });

  async function snapshotA() {
    return testPrisma.tenant.findUniqueOrThrow({
      where:  { id: tenantAId },
      select: { maxMeetingsPerWeek: true, minMatchScoreThreshold: true, blockedPairs: true, updatedAt: true },
    });
  }

  it('PATCH /:id/settings → 403, ayarlar değişmez', async () => {
    const before = await snapshotA();
    const res = await http
      .patch(`/api/tenants/${tenantAId}/settings`)
      .set('Authorization', `Bearer ${foreignAdminToken}`)
      .send({ maxMeetingsPerWeek: before.maxMeetingsPerWeek === 5 ? 1 : 5 });
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'YETKI_YOK', message: 'Başka bir kurumun ayarlarını güncelleyemezsiniz.' });
    expect(await snapshotA()).toEqual(before);
  });

  it('POST /:id/block-pair → 403, engel listesi değişmez', async () => {
    const before = await snapshotA();
    const res = await http
      .post(`/api/tenants/${tenantAId}/block-pair`)
      .set('Authorization', `Bearer ${foreignAdminToken}`)
      .send({ fromUserId: mentiA.id, toUserId: mentorA.id });
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'YETKI_YOK', message: 'Başka bir kurumda kullanıcı engelleyemezsiniz.' });
    expect(await snapshotA()).toEqual(before);
  });

  it('GET /:id/block-pairs → 403, engel verisi dönmez', async () => {
    const res = await http
      .get(`/api/tenants/${tenantAId}/block-pairs`)
      .set('Authorization', `Bearer ${foreignAdminToken}`);
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'YETKI_YOK', message: 'Başka bir kurumun engel listesini göremezsiniz.' });
    expect(JSON.stringify(res.body)).not.toContain(mentorA.id);
  });

  it('DELETE /:id/block-pair/:pairId → 403, engel kaydı yerinde kalır', async () => {
    const before = await snapshotA();
    const res = await http
      .delete(`/api/tenants/${tenantAId}/block-pair/${pairKey(mentorA.id, mentiA.id)}`)
      .set('Authorization', `Bearer ${foreignAdminToken}`);
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'YETKI_YOK', message: 'Başka bir kurumun engelini kaldıramazsınız.' });
    const after = await snapshotA();
    expect(after).toEqual(before);
    expect(Array.isArray(after.blockedPairs) ? after.blockedPairs.length : 0).toBe(1);
  });
});
