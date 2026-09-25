/**
 * GV-11 — Üyeliği kapatılmış yönetici kurum ayarlarını değiştiremez.
 *
 * `/api/tenants/:id/settings`, `/block-pair` ve self-serve yönetici uçları `requireTenant`
 * zincirinden geçmiyor; kapı `authenticateTenantAdmin` (middleware/tenantAdminAuth.ts).
 * Kural `requireTenant` adım 4 ile aynı: TenantMembership aktif + üyelik rolü ADMIN olmalı.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { agent, type TestAgent } from './helpers/request.js';
import { cleanDb, testPrisma } from './helpers/db.js';
import { createTenant, createAdminUser, createMentor, createMenti } from './helpers/factories.js';
import { signToken, PLATFORM_AUDIENCE } from '../src/middleware/jwtAuth.js';
import type { User } from '@prisma/client';

function tokenFor(u: Pick<User, 'id' | 'tenantId' | 'role' | 'fullName'>): string {
  return signToken({ sub: u.id, tenantId: u.tenantId, role: u.role, fullName: u.fullName });
}

describe('GV-11 — pasif üyelikli yönetici kurum yönetici uçlarına erişemez', () => {
  let http: TestAgent;
  let tenantId: string;
  let admin: Awaited<ReturnType<typeof createAdminUser>>;
  let token: string;

  beforeEach(async () => {
    await cleanDb();
    http = agent();
    const tenant = await createTenant();
    tenantId = tenant.id;
    admin = await createAdminUser(tenantId);
    token = tokenFor(admin);
  });

  async function deactivateMembership(): Promise<void> {
    await testPrisma.tenantMembership.update({
      where: { userId_tenantId: { userId: admin.id, tenantId } },
      data:  { isActive: false },
    });
  }

  const patchSettings = (id: string, bearer: string) =>
    http
      .patch(`/api/tenants/${id}/settings`)
      .set('Authorization', `Bearer ${bearer}`)
      .send({ maxMeetingsPerWeek: 3 });

  it('aktif yönetici kurum ayarını değiştirebilir (200)', async () => {
    const res = await patchSettings(tenantId, token);
    expect(res.status).toBe(200);
    expect(res.body.settings.maxMeetingsPerWeek).toBe(3);
  });

  it('üyeliği pasif yönetici kurum ayarını değiştiremez (403) ve ayar değişmez', async () => {
    const before = await testPrisma.tenant.findUnique({ where: { id: tenantId } });
    await deactivateMembership();

    const res = await patchSettings(tenantId, token);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('UYELIK_BULUNAMADI');

    const after = await testPrisma.tenant.findUnique({ where: { id: tenantId } });
    expect(after?.maxMeetingsPerWeek).toBe(before?.maxMeetingsPerWeek);
  });

  it('üyeliği pasif yönetici üye engelleyemez (403) ve engel listesi değişmez', async () => {
    const mentor = await createMentor(tenantId);
    const menti = await createMenti(tenantId);
    await deactivateMembership();

    const res = await http
      .post(`/api/tenants/${tenantId}/block-pair`)
      .set('Authorization', `Bearer ${token}`)
      .send({ fromUserId: mentor.id, toUserId: menti.id });
    expect(res.status).toBe(403);

    const after = await testPrisma.tenant.findUnique({ where: { id: tenantId } });
    expect(Array.isArray(after?.blockedPairs) ? after?.blockedPairs : []).toHaveLength(0);
  });

  it('üyeliği pasif yönetici self-serve yönetici uçlarını da açamaz (davet şablonu 403)', async () => {
    await deactivateMembership();
    const res = await http
      .get(`/api/tenants/${tenantId}/invitation-templates`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('UYELIK_BULUNAMADI');
  });

  it('kurum-içi rolü yöneticilikten düşürülmüş kullanıcı (User.role hâlâ ADMIN) ayar değiştiremez (403)', async () => {
    await testPrisma.tenantMembership.update({
      where: { userId_tenantId: { userId: admin.id, tenantId } },
      data:  { role: 'MENTOR' },
    });
    const res = await patchSettings(tenantId, token);
    expect(res.status).toBe(403);
  });

  it('başka kurumun yöneticisi bu kurumun ayarını değiştiremez (403)', async () => {
    const other = await createTenant();
    const otherAdmin = await createAdminUser(other.id);
    const res = await patchSettings(tenantId, tokenFor(otherAdmin));
    expect(res.status).toBe(403);
  });

  it('platform token\'ı (aud: platform) kurum yönetici ucunda geçmez (403)', async () => {
    const platformToken = signToken(
      { sub: admin.id, tenantId, role: 'ADMIN', fullName: admin.fullName, isPlatformAdmin: true },
      { audience: PLATFORM_AUDIENCE },
    );
    const res = await patchSettings(tenantId, platformToken);
    expect(res.status).toBe(403);
  });
});
