/**
 * U-13 (KARAR-83 A) — kurum yöneticisi üyenin rolünü MENTOR↔MENTI değiştirir; yöneticilikten düşürmede
 * hedef rol açıkça seçilir (eskiden her zaman MENTOR yazılıyordu → menti olan yönetici mentöre dönüşüyordu).
 * Rol iki yerde birlikte: User.role + TenantMembership.role.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { agent, tenantHeaders, type TestAgent } from './helpers/request.js';
import { cleanDb, testPrisma } from './helpers/db.js';
import { createTenant, createAdminUser, createMentor, createMenti } from './helpers/factories.js';
import { signToken } from '../src/middleware/jwtAuth.js';
import type { User } from '@prisma/client';

function authAs(u: Pick<User, 'id' | 'tenantId' | 'role' | 'fullName'>): Record<string, string> {
  return tenantHeaders(u.tenantId, signToken({ sub: u.id, tenantId: u.tenantId, role: u.role, fullName: u.fullName }));
}

async function roles(userId: string, tenantId: string) {
  const user = await testPrisma.user.findUnique({ where: { id: userId }, select: { role: true } });
  const m = await testPrisma.tenantMembership.findUnique({
    where: { userId_tenantId: { userId, tenantId } },
    select: { role: true },
  });
  return { user: user?.role, membership: m?.role };
}

describe('U-13: rol değiştirme', () => {
  let http: TestAgent;
  let tenantId: string;

  beforeEach(async () => {
    await cleanDb();
    http = agent();
    tenantId = (await createTenant()).id;
  });

  it('yönetici mentörü menti yapar — iki tabloda birlikte', async () => {
    const admin = await createAdminUser(tenantId);
    const mentor = await createMentor(tenantId);
    const res = await http.post(`/api/admin/users/${mentor.id}/role`).send({ role: 'MENTI' }).set(authAs(admin));
    expect(res.status).toBe(200);
    expect(res.body.role).toBe('MENTI');
    expect(await roles(mentor.id, tenantId)).toEqual({ user: 'MENTI', membership: 'MENTI' });
  });

  it('yönetici mentiyi mentör yapar', async () => {
    const admin = await createAdminUser(tenantId);
    const menti = await createMenti(tenantId);
    await http.post(`/api/admin/users/${menti.id}/role`).send({ role: 'MENTOR' }).set(authAs(admin)).expect(200);
    expect(await roles(menti.id, tenantId)).toEqual({ user: 'MENTOR', membership: 'MENTOR' });
  });

  it('NEGATİF: mentör ve menti rol değiştiremez (403) ve kayıt değişmez', async () => {
    const mentor = await createMentor(tenantId);
    const menti = await createMenti(tenantId);
    await http.post(`/api/admin/users/${menti.id}/role`).send({ role: 'MENTOR' }).set(authAs(mentor)).expect(403);
    await http.post(`/api/admin/users/${mentor.id}/role`).send({ role: 'MENTI' }).set(authAs(menti)).expect(403);
    expect(await roles(menti.id, tenantId)).toEqual({ user: 'MENTI', membership: 'MENTI' });
    expect(await roles(mentor.id, tenantId)).toEqual({ user: 'MENTOR', membership: 'MENTOR' });
  });

  it('NEGATİF: başka kurumun yöneticisi bu kurumun üyesini göremez (404) ve kayıt değişmez', async () => {
    const otherTenantId = (await createTenant()).id;
    const otherAdmin = await createAdminUser(otherTenantId);
    const menti = await createMenti(tenantId);
    await http.post(`/api/admin/users/${menti.id}/role`).send({ role: 'MENTOR' }).set(authAs(otherAdmin)).expect(404);
    expect(await roles(menti.id, tenantId)).toEqual({ user: 'MENTI', membership: 'MENTI' });
  });

  it('NEGATİF: yöneticinin rolü bu uçtan değişmez; ADMIN hedef rol olarak verilemez', async () => {
    const admin = await createAdminUser(tenantId);
    const admin2 = await createAdminUser(tenantId);
    const menti = await createMenti(tenantId);
    const r1 = await http.post(`/api/admin/users/${admin2.id}/role`).send({ role: 'MENTI' }).set(authAs(admin));
    expect(r1.status).toBe(400);
    expect(r1.body.error).toBe('YONETICI_ROLU');
    await http.post(`/api/admin/users/${menti.id}/role`).send({ role: 'ADMIN' }).set(authAs(admin)).expect(400);
    expect(await roles(admin2.id, tenantId)).toEqual({ user: 'ADMIN', membership: 'ADMIN' });
    expect(await roles(menti.id, tenantId)).toEqual({ user: 'MENTI', membership: 'MENTI' });
  });

  it('aynı role değiştirme 400 ROL_AYNI', async () => {
    const admin = await createAdminUser(tenantId);
    const menti = await createMenti(tenantId);
    const res = await http.post(`/api/admin/users/${menti.id}/role`).send({ role: 'MENTI' }).set(authAs(admin));
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('ROL_AYNI');
  });
});

describe('U-13: yöneticilikten düşürmede hedef rol', () => {
  let http: TestAgent;
  let tenantId: string;

  beforeEach(async () => {
    await cleanDb();
    http = agent();
    tenantId = (await createTenant()).id;
  });

  it('düşürülen yönetici seçilen role (MENTI) geçer — artık sabit MENTOR değil', async () => {
    const admin = await createAdminUser(tenantId);
    const admin2 = await createAdminUser(tenantId);
    const res = await http.post(`/api/admin/users/${admin2.id}/demote-admin`).send({ targetRole: 'MENTI' }).set(authAs(admin));
    expect(res.status).toBe(200);
    expect(await roles(admin2.id, tenantId)).toEqual({ user: 'MENTI', membership: 'MENTI' });
  });

  it('NEGATİF: hedef rol seçilmezse 400 ve yönetici olarak kalır', async () => {
    const admin = await createAdminUser(tenantId);
    const admin2 = await createAdminUser(tenantId);
    await http.post(`/api/admin/users/${admin2.id}/demote-admin`).send({}).set(authAs(admin)).expect(400);
    expect(await roles(admin2.id, tenantId)).toEqual({ user: 'ADMIN', membership: 'ADMIN' });
  });
});
