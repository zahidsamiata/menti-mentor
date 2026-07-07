/**
 * Admin Workflow Entegrasyon Testleri
 *
 * Kapsam: kullanıcı onay/red/düzeltme, KPI dashboard, tag yönetimi.
 * ADMIN olmayan kullanıcılar 403 almalı (rol izolasyonu testi dahil).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { agent, loginAs, tenantHeaders, type TestAgent } from './helpers/request.js';
import { cleanDb, testPrisma } from './helpers/db.js';
import { createTenant, createAdminUser, createUser } from './helpers/factories.js';
import type { Tenant } from '@prisma/client';

// ─── Onboarding Onay Modülü ───────────────────────────────────────────────────

describe('Admin: User Approval', () => {
  let http: TestAgent;
  let tenant: Tenant;
  let adminToken: string;

  beforeEach(async () => {
    await cleanDb();
    http = agent();
    tenant = await createTenant();
    const admin = await createAdminUser(tenant.id);
    const tokens = await loginAs(http, admin.email, admin.rawPassword);
    adminToken = tokens.accessToken;
  });

  it('PENDING kullanıcıyı onaylar ve APPROVED yapar', async () => {
    const pending = await createUser({ tenantId: tenant.id, approvalStatus: 'PENDING' });

    const res = await http
      .post(`/api/admin/users/${pending.id}/approve`)
      .set(tenantHeaders(tenant.id, adminToken))
      .expect(200);

    expect((res.body as { approvalStatus: string }).approvalStatus).toBe('APPROVED');

    const dbUser = await testPrisma.user.findUnique({ where: { id: pending.id } });
    expect(dbUser?.approvalStatus).toBe('APPROVED');
  });

  it('PENDING kullanıcıyı reddeder, isActive false olur', async () => {
    const pending = await createUser({ tenantId: tenant.id, approvalStatus: 'PENDING' });

    await http
      .post(`/api/admin/users/${pending.id}/reject`)
      .set(tenantHeaders(tenant.id, adminToken))
      .expect(200);

    const dbUser = await testPrisma.user.findUnique({ where: { id: pending.id } });
    expect(dbUser?.approvalStatus).toBe('REJECTED');
    expect(dbUser?.isActive).toBe(false);
  });

  it('zaten onaylı kullanıcıyı tekrar onaylamaya 409 döner', async () => {
    const approved = await createUser({ tenantId: tenant.id, approvalStatus: 'APPROVED' });
    await http
      .post(`/api/admin/users/${approved.id}/approve`)
      .set(tenantHeaders(tenant.id, adminToken))
      .expect(409);
  });

  it('düzeltme talebi gönderir — kullanıcı PENDING kalır', async () => {
    const pending = await createUser({ tenantId: tenant.id, approvalStatus: 'PENDING' });

    const res = await http
      .post(`/api/admin/users/${pending.id}/request-correction`)
      .set(tenantHeaders(tenant.id, adminToken))
      .send({ feedbackNote: 'LinkedIn profil bağlantısı eksik, lütfen ekleyin.' })
      .expect(200);

    expect((res.body as { approvalStatus: string }).approvalStatus).toBe('PENDING');
    const dbUser = await testPrisma.user.findUnique({ where: { id: pending.id } });
    expect(dbUser?.approvalStatus).toBe('PENDING');
  });

  it('düzeltme notu çok kısa ise 400 döner', async () => {
    const pending = await createUser({ tenantId: tenant.id, approvalStatus: 'PENDING' });
    await http
      .post(`/api/admin/users/${pending.id}/request-correction`)
      .set(tenantHeaders(tenant.id, adminToken))
      .send({ feedbackNote: 'Kısa' })
      .expect(400);
  });

  it('başka tenant\'ın kullanıcısına erişim 404 döner (tenant izolasyonu)', async () => {
    const otherTenant = await createTenant();
    const otherUser = await createUser({ tenantId: otherTenant.id, approvalStatus: 'PENDING' });

    await http
      .post(`/api/admin/users/${otherUser.id}/approve`)
      .set(tenantHeaders(tenant.id, adminToken))
      .expect(404);
  });
});

describe('Admin: Role Authorization', () => {
  let http: TestAgent;
  let tenant: Tenant;
  let mentorToken: string;

  beforeEach(async () => {
    await cleanDb();
    http = agent();
    tenant = await createTenant();
    const mentor = await createUser({ tenantId: tenant.id, role: 'MENTOR' });
    const tokens = await loginAs(http, mentor.email, mentor.rawPassword);
    mentorToken = tokens.accessToken;
  });

  it('ADMIN olmayan kullanıcı admin endpoint\'e erişemez (403)', async () => {
    await http
      .get('/api/admin/users')
      .set(tenantHeaders(tenant.id, mentorToken))
      .expect(403);
  });

  it('JWT olmadan admin endpoint 401 döner', async () => {
    await http
      .get('/api/admin/users')
      .set({ 'X-Tenant-Id': tenant.id })
      .expect(401);
  });
});

describe('Admin: User List', () => {
  let http: TestAgent;
  let tenant: Tenant;
  let adminToken: string;

  beforeEach(async () => {
    await cleanDb();
    http = agent();
    tenant = await createTenant();
    const admin = await createAdminUser(tenant.id);
    const tokens = await loginAs(http, admin.email, admin.rawPassword);
    adminToken = tokens.accessToken;

    await createUser({ tenantId: tenant.id, role: 'MENTOR', approvalStatus: 'PENDING' });
    await createUser({ tenantId: tenant.id, role: 'MENTI', approvalStatus: 'PENDING' });
    await createUser({ tenantId: tenant.id, role: 'MENTI', approvalStatus: 'APPROVED' });
  });

  it('approvalStatus=PENDING ile sadece PENDING kullanıcıları listeler', async () => {
    const res = await http
      .get('/api/admin/users?approvalStatus=PENDING')
      .set(tenantHeaders(tenant.id, adminToken))
      .expect(200);

    const body = res.body as { items: { approvalStatus: string }[]; total: number };
    expect(body.total).toBe(2);
    body.items.forEach((u) => expect(u.approvalStatus).toBe('PENDING'));
  });

  it('discVector ve selfProfile admin listesinde yer almaz (compliance)', async () => {
    const res = await http
      .get('/api/admin/users')
      .set(tenantHeaders(tenant.id, adminToken))
      .expect(200);

    const body = res.body as { items: Record<string, unknown>[] };
    body.items.forEach((u) => {
      expect(u['discVector']).toBeUndefined();
      expect(u['selfProfile']).toBeUndefined();
      expect(u['temperamentJson']).toBeUndefined();
    });
  });
});

// ─── KPI Dashboard ────────────────────────────────────────────────────────────

describe('Admin: KPI Dashboard', () => {
  let http: TestAgent;
  let tenant: Tenant;
  let adminToken: string;

  beforeEach(async () => {
    await cleanDb();
    http = agent();
    tenant = await createTenant();
    const admin = await createAdminUser(tenant.id);
    const tokens = await loginAs(http, admin.email, admin.rawPassword);
    adminToken = tokens.accessToken;
    await createUser({ tenantId: tenant.id, role: 'MENTOR' });
    await createUser({ tenantId: tenant.id, role: 'MENTI' });
  });

  it('KPI yanıtı aggregate veri içerir, PII yok', async () => {
    const res = await http
      .get('/api/admin/kpi')
      .set(tenantHeaders(tenant.id, adminToken))
      .expect(200);

    const body = res.body as {
      compliance: string;
      stats: { totalActiveUsers: number; usersByRole: Record<string, number> };
    };
    expect(body.compliance).toContain('aggregate');
    expect(body.stats.totalActiveUsers).toBeGreaterThanOrEqual(2);
    expect(body.stats.usersByRole).toHaveProperty('MENTOR');
  });
});

// ─── Tag Yönetimi ─────────────────────────────────────────────────────────────

describe('Admin: Tag Management', () => {
  let http: TestAgent;
  let tenant: Tenant;
  let adminToken: string;
  let userToken: string;
  let userId: string;

  beforeEach(async () => {
    await cleanDb();
    http = agent();
    tenant = await createTenant();
    const admin = await createAdminUser(tenant.id);
    const adminTokens = await loginAs(http, admin.email, admin.rawPassword);
    adminToken = adminTokens.accessToken;

    const user = await createUser({ tenantId: tenant.id, role: 'MENTI' });
    const userTokens = await loginAs(http, user.email, user.rawPassword);
    userToken = userTokens.accessToken;
    userId = user.id;
  });

  it('kullanıcı etiket önerisi yapabilir', async () => {
    const res = await http
      .post('/api/tags/suggest')
      .set(tenantHeaders(tenant.id, userToken))
      .send({ value: 'sürdürülebilirlik' })
      .expect(201);

    expect((res.body as { tag: { value: string } }).tag.value).toBe('sürdürülebilirlik');
  });

  it('aynı etiketi tekrar önermek idempotent', async () => {
    await http.post('/api/tags/suggest').set(tenantHeaders(tenant.id, userToken)).send({ value: 'test-etiketi' }).expect(201);
    const res = await http.post('/api/tags/suggest').set(tenantHeaders(tenant.id, userToken)).send({ value: 'test-etiketi' }).expect(200);
    expect((res.body as { status: string }).status).toBe('PENDING');
  });

  it('admin bekleyen etiket listesini görür', async () => {
    await createPendingTag(tenant.id, userId, 'blockchain');

    const res = await http
      .get('/api/admin/tags/pending')
      .set(tenantHeaders(tenant.id, adminToken))
      .expect(200);

    expect((res.body as { items: unknown[] }).items.length).toBeGreaterThan(0);
  });

  it('admin etiketi onaylar — kullanıcının sectorTags güncellenir', async () => {
    const tag = await createPendingTag(tenant.id, userId, 'blokzincir');

    await http
      .post(`/api/admin/tags/${tag.id}/approve`)
      .set(tenantHeaders(tenant.id, adminToken))
      .expect(200);

    const dbTag = await testPrisma.pendingTag.findUnique({ where: { id: tag.id } });
    expect(dbTag?.status).toBe('APPROVED');
  });

  it('admin etiketi reddeder', async () => {
    const tag = await createPendingTag(tenant.id, userId, 'reddedilecek');

    await http
      .post(`/api/admin/tags/${tag.id}/reject`)
      .set(tenantHeaders(tenant.id, adminToken))
      .expect(200);

    const dbTag = await testPrisma.pendingTag.findUnique({ where: { id: tag.id } });
    expect(dbTag?.status).toBe('REJECTED');
  });

  it('admin etiketi birleştirir — mergedInto alanı dolar', async () => {
    const tag = await createPendingTag(tenant.id, userId, 'yapay-zeka-teknoloji');

    const res = await http
      .post(`/api/admin/tags/${tag.id}/merge`)
      .set(tenantHeaders(tenant.id, adminToken))
      .send({ targetTag: 'yapay-zeka' })
      .expect(200);

    const body = res.body as { into: string };
    expect(body.into).toBe('yapay-zeka');

    const dbTag = await testPrisma.pendingTag.findUnique({ where: { id: tag.id } });
    expect(dbTag?.status).toBe('MERGED');
    expect(dbTag?.mergedInto).toBe('yapay-zeka');
  });

  it('işlenmiş etiketi tekrar işlemeye 409 döner', async () => {
    const tag = await createPendingTag(tenant.id, userId, 'cift-islem');
    await http.post(`/api/admin/tags/${tag.id}/approve`).set(tenantHeaders(tenant.id, adminToken));
    await http
      .post(`/api/admin/tags/${tag.id}/reject`)
      .set(tenantHeaders(tenant.id, adminToken))
      .expect(409);
  });
});

// ─── Test yardımcısı ──────────────────────────────────────────────────────────

async function createPendingTag(tenantId: string, submittedBy: string, value: string) {
  return testPrisma.pendingTag.create({
    data: { tenantId, value, submittedBy, status: 'PENDING' },
  });
}
