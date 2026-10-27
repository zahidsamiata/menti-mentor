/**
 * U-12B (KARAR-82 B) — kurum yöneticisi toplu davet bağlantısını iptal eder; iptal edilen bağlantıyla
 * katılım reddedilir ve kayıt otomatik onay almaz.
 * NEGATİF: başka kurumun yöneticisi iptal edemez / göremez, kayıt değişmez · mentör/menti listeleyemez.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import jwt from 'jsonwebtoken';
import { agent, type TestAgent } from './helpers/request.js';
import { cleanDb, testPrisma } from './helpers/db.js';
import { createTenant, createAdminUser, createMentor } from './helpers/factories.js';
import { signToken } from '../src/middleware/jwtAuth.js';
import { config } from '../src/config.js';
import { resetRateLimiters } from '../src/middleware/rateLimiter.js';
import type { User } from '@prisma/client';

function bearer(u: Pick<User, 'id' | 'tenantId' | 'role' | 'fullName'>): Record<string, string> {
  return { Authorization: `Bearer ${signToken({ sub: u.id, tenantId: u.tenantId, role: u.role, fullName: u.fullName })}` };
}

describe('U-12B: iptal edilebilir davet bağlantısı', () => {
  let http: TestAgent;
  let tenantId: string;
  let admin: User;

  beforeEach(async () => {
    await cleanDb();
    resetRateLimiters();
    http = agent();
    tenantId = (await createTenant()).id;
    admin = await createAdminUser(tenantId);
  });

  async function createLink(): Promise<{ token: string; linkId: string }> {
    const res = await http.post(`/api/tenants/${tenantId}/invitations`).set(bearer(admin)).send({ role: 'MENTI' }).expect(201);
    const token = res.body.token as string;
    const linkId = (jwt.decode(token) as { lid?: string }).lid!;
    return { token, linkId };
  }

  it('üretilen bağlantı kayıtlıdır, listede ACTIVE görünür; token listede dönmez', async () => {
    const { linkId } = await createLink();
    const row = await testPrisma.invitationLink.findUnique({ where: { id: linkId } });
    expect(row?.tenantId).toBe(tenantId);
    expect(row?.createdById).toBe(admin.id);

    const list = await http.get(`/api/tenants/${tenantId}/invitations`).set(bearer(admin)).expect(200);
    expect(list.body.items).toHaveLength(1);
    expect(list.body.items[0]).toMatchObject({ id: linkId, role: 'MENTI', status: 'ACTIVE' });
    expect(JSON.stringify(list.body)).not.toContain('token');
  });

  it('iptal edilen bağlantıyla katılım reddedilir (401), iptalden önce çalışır', async () => {
    const { token, linkId } = await createLink();
    expect((await http.get(`/api/invitations/${token}/join`)).status).not.toBe(401);

    await http.post(`/api/tenants/${tenantId}/invitations/${linkId}/revoke`).set(bearer(admin)).expect(200);
    const res = await http.get(`/api/invitations/${token}/join`);
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('TOKEN_GECERSIZ');

    const list = await http.get(`/api/tenants/${tenantId}/invitations`).set(bearer(admin)).expect(200);
    expect(list.body.items[0].status).toBe('REVOKED');
  });

  it('iptal edilen bağlantıyla kayıt OTOMATİK ONAY almaz (PENDING)', async () => {
    const { token, linkId } = await createLink();
    await http.post(`/api/tenants/${tenantId}/invitations/${linkId}/revoke`).set(bearer(admin)).expect(200);
    const tenant = await testPrisma.tenant.findUnique({ where: { id: tenantId }, select: { slug: true } });
    const email = `iptal-${Date.now()}@test.local`;
    await http.post('/api/auth/register').send({
      email, password: 'Gizli-Sifre-2026!', fullName: 'Davetli Kişi', role: 'MENTI',
      tenantSlug: tenant!.slug, inviteToken: token, kvkkConsent: true,
    }).expect(201);
    const user = await testPrisma.user.findUnique({ where: { email }, select: { approvalStatus: true } });
    expect(user?.approvalStatus).toBe('PENDING');
  });

  it('iptal edilmemiş bağlantıyla kayıt otomatik onay alır (APPROVED) — kontrol', async () => {
    const { token } = await createLink();
    const tenant = await testPrisma.tenant.findUnique({ where: { id: tenantId }, select: { slug: true } });
    const email = `gecerli-${Date.now()}@test.local`;
    await http.post('/api/auth/register').send({
      email, password: 'Gizli-Sifre-2026!', fullName: 'Davetli Kişi', role: 'MENTI',
      tenantSlug: tenant!.slug, inviteToken: token, kvkkConsent: true,
    }).expect(201);
    const user = await testPrisma.user.findUnique({ where: { email }, select: { approvalStatus: true } });
    expect(user?.approvalStatus).toBe('APPROVED');
  });

  it('U-12B öncesi (lid taşımayan) bağlantı süresi içinde çalışmaya devam eder', async () => {
    const legacy = jwt.sign({ tenantId, role: 'MENTI', type: 'invitation', typ: 'invitation' }, config.jwt.secret, { expiresIn: '7d' });
    expect((await http.get(`/api/invitations/${legacy}/join`)).status).not.toBe(401);
  });

  it('NEGATİF: başka kurumun yöneticisi iptal edemez ve listeyi göremez (403); bağlantı geçerli kalır', async () => {
    const { token, linkId } = await createLink();
    const otherTenantId = (await createTenant()).id;
    const otherAdmin = await createAdminUser(otherTenantId);

    await http.post(`/api/tenants/${tenantId}/invitations/${linkId}/revoke`).set(bearer(otherAdmin)).expect(403);
    await http.get(`/api/tenants/${tenantId}/invitations`).set(bearer(otherAdmin)).expect(403);
    // kendi kurum yolundan başka kurumun bağlantı kimliğiyle → 404, değişmez
    await http.post(`/api/tenants/${otherTenantId}/invitations/${linkId}/revoke`).set(bearer(otherAdmin)).expect(404);

    const row = await testPrisma.invitationLink.findUnique({ where: { id: linkId } });
    expect(row?.revokedAt).toBeNull();
    expect((await http.get(`/api/invitations/${token}/join`)).status).not.toBe(401);
  });

  it('NEGATİF: mentör listeleyemez ve iptal edemez (403); bağlantı değişmez', async () => {
    const { linkId } = await createLink();
    const mentor = await createMentor(tenantId);
    await http.get(`/api/tenants/${tenantId}/invitations`).set(bearer(mentor)).expect(403);
    await http.post(`/api/tenants/${tenantId}/invitations/${linkId}/revoke`).set(bearer(mentor)).expect(403);
    const row = await testPrisma.invitationLink.findUnique({ where: { id: linkId } });
    expect(row?.revokedAt).toBeNull();
  });

  it('iki kez iptal 404 (zaten iptal)', async () => {
    const { linkId } = await createLink();
    await http.post(`/api/tenants/${tenantId}/invitations/${linkId}/revoke`).set(bearer(admin)).expect(200);
    await http.post(`/api/tenants/${tenantId}/invitations/${linkId}/revoke`).set(bearer(admin)).expect(404);
  });
});
