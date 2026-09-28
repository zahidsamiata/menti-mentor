/**
 * AJ-118 — kurum-yönetici uçları (`/api/tenants/:id/settings`, `/block-pair(s)`, `/invitations`,
 * `/invitation-templates`) yöneticiliği YALNIZ kurum üyeliğinin rolünden (`TenantMembership.role`)
 * belirler; anahtardaki kişi-genel `role` claim'i (= User.role) ön-kontrol DEĞİLDİR.
 *
 * Sorun: `authenticateTenantAdmin` önce `payload.role !== 'ADMIN'` → 403 diyordu. Üyelikte ADMIN olup
 * User.role'ü MENTOR olan kişi AJ-115 sonrası yönetici panelini görüyor ama bu uçlar onu reddediyordu.
 *
 * Kişiler (aynı kurum):
 *  - X: üyelikte ADMIN, User.role = MENTOR → uçlara erişir.
 *  - Y: üyelikte MENTOR, User.role = ADMIN → 403, veri değişmez (negatif).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { agent, type TestAgent } from './helpers/request.js';
import { cleanDb, testPrisma } from './helpers/db.js';
import { createTenant, createUser, createMentor, createMenti } from './helpers/factories.js';
import { signToken, PLATFORM_AUDIENCE } from '../src/middleware/jwtAuth.js';
import type { Tenant, User, UserRole } from '@prisma/client';

type Seeded = Awaited<ReturnType<typeof createUser>>;

function tokenFor(u: Pick<User, 'id' | 'role' | 'fullName'>, tenantId: string): string {
  return signToken({ sub: u.id, tenantId, role: u.role, fullName: u.fullName });
}

let http: TestAgent;
let tenant: Tenant;
let x: Seeded; // üyelikte ADMIN, User.role MENTOR
let y: Seeded; // üyelikte MENTOR, User.role ADMIN
let mentor: Seeded;
let menti: Seeded;

async function createSplitRoleUser(userRole: UserRole, membershipRole: UserRole): Promise<Seeded> {
  const u = await createUser({ tenantId: tenant.id, role: userRole, approvalStatus: 'APPROVED' });
  await testPrisma.tenantMembership.update({
    where: { userId_tenantId: { userId: u.id, tenantId: tenant.id } },
    data:  { role: membershipRole },
  });
  return u;
}

beforeEach(async () => {
  await cleanDb();
  http = agent();
  tenant = await createTenant();
  x = await createSplitRoleUser('MENTOR', 'ADMIN');
  y = await createSplitRoleUser('ADMIN', 'MENTOR');
  mentor = await createMentor(tenant.id);
  menti = await createMenti(tenant.id);
});

const auth = (bearer: string) => ({ Authorization: `Bearer ${bearer}` });

describe('AJ-118: üyelikte ADMIN / User.role MENTOR kişi yönetici uçlarına erişir', () => {
  it('PATCH /settings → 200, ayar değişir', async () => {
    const res = await http.patch(`/api/tenants/${tenant.id}/settings`).set(auth(tokenFor(x, tenant.id))).send({ maxMeetingsPerWeek: 4 });
    expect(res.status).toBe(200);
    const after = await testPrisma.tenant.findUnique({ where: { id: tenant.id } });
    expect(after?.maxMeetingsPerWeek).toBe(4);
  });

  it('POST /block-pair → 201 ve GET /block-pairs listede görünür', async () => {
    const res = await http.post(`/api/tenants/${tenant.id}/block-pair`).set(auth(tokenFor(x, tenant.id)))
      .send({ fromUserId: mentor.id, toUserId: menti.id });
    expect(res.status).toBe(201);
    const list = await http.get(`/api/tenants/${tenant.id}/block-pairs`).set(auth(tokenFor(x, tenant.id)));
    expect(list.status).toBe(200);
    expect(list.body.total).toBe(1);
  });

  it('POST /invitations → 201', async () => {
    const res = await http.post(`/api/tenants/${tenant.id}/invitations`).set(auth(tokenFor(x, tenant.id))).send({ role: 'MENTI' });
    expect(res.status).toBe(201);
    expect(res.body.tenant.id).toBe(tenant.id);
  });

  it('GET/PUT /invitation-templates → 200', async () => {
    const put = await http.put(`/api/tenants/${tenant.id}/invitation-templates`).set(auth(tokenFor(x, tenant.id)))
      .send({ role: 'MENTOR', format: 'EMAIL', content: 'Merhaba, programımıza davetlisiniz.' });
    expect(put.status).toBe(200);
    const get = await http.get(`/api/tenants/${tenant.id}/invitation-templates`).set(auth(tokenFor(x, tenant.id)));
    expect(get.status).toBe(200);
  });
});

describe('AJ-118 negatif: üyelikte MENTOR / User.role ADMIN kişi → 403, veri değişmez', () => {
  it('PATCH /settings → 403 UYELIK_BULUNAMADI, ayar değişmez', async () => {
    const before = await testPrisma.tenant.findUnique({ where: { id: tenant.id } });
    const res = await http.patch(`/api/tenants/${tenant.id}/settings`).set(auth(tokenFor(y, tenant.id))).send({ maxMeetingsPerWeek: 4 });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('UYELIK_BULUNAMADI');
    const after = await testPrisma.tenant.findUnique({ where: { id: tenant.id } });
    expect(after?.maxMeetingsPerWeek).toBe(before?.maxMeetingsPerWeek);
  });

  it('POST /block-pair → 403, engel listesi boş kalır', async () => {
    const res = await http.post(`/api/tenants/${tenant.id}/block-pair`).set(auth(tokenFor(y, tenant.id)))
      .send({ fromUserId: mentor.id, toUserId: menti.id });
    expect(res.status).toBe(403);
    const after = await testPrisma.tenant.findUnique({ where: { id: tenant.id } });
    expect(Array.isArray(after?.blockedPairs) ? after?.blockedPairs : []).toHaveLength(0);
  });

  it('POST /invitations ve PUT /invitation-templates → 403, şablon yazılmaz', async () => {
    const inv = await http.post(`/api/tenants/${tenant.id}/invitations`).set(auth(tokenFor(y, tenant.id))).send({ role: 'MENTI' });
    expect(inv.status).toBe(403);
    const put = await http.put(`/api/tenants/${tenant.id}/invitation-templates`).set(auth(tokenFor(y, tenant.id)))
      .send({ role: 'MENTOR', format: 'EMAIL', content: 'Merhaba, programımıza davetlisiniz.' });
    expect(put.status).toBe(403);
    expect(await testPrisma.invitationTemplate.count({ where: { tenantId: tenant.id } })).toBe(0);
  });
});

describe('AJ-118: platform anahtarı (aud) → eski yanıt aynen', () => {
  it('üyelikte ADMIN kişinin platform anahtarı → 403 YETKI_YOK (aynı gövde), ayar değişmez', async () => {
    const platformToken = signToken(
      { sub: x.id, tenantId: tenant.id, role: 'ADMIN', fullName: x.fullName, isPlatformAdmin: true },
      { audience: PLATFORM_AUDIENCE },
    );
    const before = await testPrisma.tenant.findUnique({ where: { id: tenant.id } });
    const res = await http.patch(`/api/tenants/${tenant.id}/settings`).set(auth(platformToken)).send({ maxMeetingsPerWeek: 4 });
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'YETKI_YOK', message: 'Bu işlem için yönetici yetkisi gereklidir.' });
    const after = await testPrisma.tenant.findUnique({ where: { id: tenant.id } });
    expect(after?.maxMeetingsPerWeek).toBe(before?.maxMeetingsPerWeek);
  });
});
