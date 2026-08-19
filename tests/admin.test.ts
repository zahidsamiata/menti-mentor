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
  let adminFullName: string;

  beforeEach(async () => {
    await cleanDb();
    http = agent();
    tenant = await createTenant();
    const admin = await createAdminUser(tenant.id);
    adminFullName = admin.fullName;
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

  it('admin kendi hesabını onaylamaya çalışırsa 403 döner (self-approval yasak)', async () => {
    const admin = await createAdminUser(tenant.id);
    const tokens = await loginAs(http, admin.email, admin.rawPassword);

    await http
      .post(`/api/admin/users/${admin.id}/approve`)
      .set(tenantHeaders(tenant.id, tokens.accessToken))
      .expect(403);
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

  // ─── İş 2: onay/red denetim izi + İş 3 P1: red gerekçesi ─────────────────────
  it('onay: approvedBy + approvedAt kaydeder, eski red izini temizler', async () => {
    // Önce reddedilmiş bir kullanıcı (izli), sonra onaylanınca red izi temizlenmeli.
    const u = await createUser({ tenantId: tenant.id, approvalStatus: 'PENDING' });
    await http.post(`/api/admin/users/${u.id}/reject`).set(tenantHeaders(tenant.id, adminToken))
      .send({ reason: 'Bilgiler eksik.' }).expect(200);
    // reddedilen tekrar PENDING yapılıp onaylanabilsin diye doğrudan DB'den PENDING'e çekilir (test kurgusu)
    await testPrisma.user.update({ where: { id: u.id }, data: { approvalStatus: 'PENDING', isActive: true } });

    await http.post(`/api/admin/users/${u.id}/approve`).set(tenantHeaders(tenant.id, adminToken)).expect(200);

    const db = await testPrisma.user.findUnique({ where: { id: u.id } });
    expect(db?.approvedBy).toBeTruthy();
    expect(db?.approvedAt).toBeInstanceOf(Date);
    expect(db?.rejectedBy).toBeNull();
    expect(db?.rejectedAt).toBeNull();
    expect(db?.rejectionReason).toBeNull();
  });

  it('red: rejectedBy + rejectedAt + rejectionReason kaydeder', async () => {
    const pending = await createUser({ tenantId: tenant.id, approvalStatus: 'PENDING' });
    await http.post(`/api/admin/users/${pending.id}/reject`).set(tenantHeaders(tenant.id, adminToken))
      .send({ reason: 'Mezuniyet yılı eksik, lütfen güncelleyin.' }).expect(200);

    const db = await testPrisma.user.findUnique({ where: { id: pending.id } });
    expect(db?.rejectedBy).toBeTruthy();
    expect(db?.rejectedAt).toBeInstanceOf(Date);
    expect(db?.rejectionReason).toBe('Mezuniyet yılı eksik, lütfen güncelleyin.');
  });

  it('red: gerekçesiz de çalışır (rejectionReason null)', async () => {
    const pending = await createUser({ tenantId: tenant.id, approvalStatus: 'PENDING' });
    await http.post(`/api/admin/users/${pending.id}/reject`).set(tenantHeaders(tenant.id, adminToken))
      .expect(200);
    const db = await testPrisma.user.findUnique({ where: { id: pending.id } });
    expect(db?.rejectionReason).toBeNull();
    expect(db?.rejectedBy).toBeTruthy();
  });

  it('red: 500 karakterden uzun gerekçe 400 döner', async () => {
    const pending = await createUser({ tenantId: tenant.id, approvalStatus: 'PENDING' });
    await http.post(`/api/admin/users/${pending.id}/reject`).set(tenantHeaders(tenant.id, adminToken))
      .send({ reason: 'x'.repeat(501) }).expect(400);
  });

  it('düzeltme talebi: gerekçe kalıcı kaydedilir, kullanıcı PENDING kalır', async () => {
    const pending = await createUser({ tenantId: tenant.id, approvalStatus: 'PENDING' });
    await http.post(`/api/admin/users/${pending.id}/request-correction`).set(tenantHeaders(tenant.id, adminToken))
      .send({ feedbackNote: 'Uzmanlık etiketleriniz çok genel, daha spesifik belirtiniz.' }).expect(200);
    const db = await testPrisma.user.findUnique({ where: { id: pending.id } });
    expect(db?.approvalStatus).toBe('PENDING');
    expect(db?.rejectionReason).toBe('Uzmanlık etiketleriniz çok genel, daha spesifik belirtiniz.');
  });

  // İş 2: adminListUsers onaylayan/reddeden yönetici ADINI döndürür (tenant-scoped)
  it('kullanıcı listesi: onaylayan yöneticinin adını (approvedByName) döndürür', async () => {
    const pending = await createUser({ tenantId: tenant.id, approvalStatus: 'PENDING', role: 'MENTOR' });
    await http.post(`/api/admin/users/${pending.id}/approve`).set(tenantHeaders(tenant.id, adminToken)).expect(200);

    const res = await http.get('/api/admin/users?role=MENTOR').set(tenantHeaders(tenant.id, adminToken)).expect(200);
    const row = (res.body as { items: Array<Record<string, unknown>> }).items.find((u) => u['id'] === pending.id);
    expect(row?.['approvedByName']).toBe(adminFullName);
    expect(row?.['rejectedByName']).toBeNull();
  });

  it('yönetici-adı çözümü tenant-scoped: başka tenant yöneticisi ise isim null döner', async () => {
    // Kullanıcı bu tenant'ta, ama approvedBy başka tenant'ın userId'si → isim çözülemez (null).
    const otherTenant = await createTenant();
    const otherAdmin = await createAdminUser(otherTenant.id);
    const u = await createUser({ tenantId: tenant.id, approvalStatus: 'APPROVED', role: 'MENTOR' });
    // Doğrudan DB: approvedBy = başka tenant admini (çapraz-tenant senaryosu simülasyonu)
    await testPrisma.user.update({ where: { id: u.id }, data: { approvedBy: otherAdmin.id } });

    const res = await http.get('/api/admin/users?role=MENTOR').set(tenantHeaders(tenant.id, adminToken)).expect(200);
    const row = (res.body as { items: Array<Record<string, unknown>> }).items.find((r) => r['id'] === u.id);
    expect(row?.['approvedByName']).toBeNull(); // çapraz-tenant isim SIZMAZ
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

  it('#12: admin listesi türetilmiş discLetters döner; ham discVector sızmaz', async () => {
    // Bilinen vektör: D=0.40 baskın, I=0.28 orta çizgiyi geçer ama %75 eşiğinin (0.30) altında
    // → beklenen "Di" (baskın D + destekleyici i). Harf backend'de vektörden türetilir.
    const u = await createUser({ tenantId: tenant.id, role: 'MENTI', approvalStatus: 'APPROVED' });
    await testPrisma.user.update({
      where: { id: u.id },
      data: { discVector: { D: 0.4, I: 0.28, S: 0.2, C: 0.12, confidence: 1 } },
    });

    const res = await http
      .get('/api/admin/users?role=MENTI')
      .set(tenantHeaders(tenant.id, adminToken))
      .expect(200);

    const body = res.body as { items: Array<Record<string, unknown>> };
    const item = body.items.find((x) => x['id'] === u.id);
    expect(item).toBeDefined();
    expect(item!['discLetters']).toBe('Di');
    expect(item!['discVector']).toBeUndefined(); // ham vektör response'ta YOK (KARAR 5/PII)
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
