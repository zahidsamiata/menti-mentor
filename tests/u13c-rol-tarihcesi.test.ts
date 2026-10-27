/**
 * U-13C (KARAR-83 C) — rol tarihçesi: önceki ve yeni rol, tarih, değiştiren yönetici görünür.
 * Yazanlar: rol değiştirme · yönetici yap · yöneticilikten çıkar.
 * NEGATİF: mentör/menti tarihçeyi göremez (403) · başka kurumun yöneticisi göremez (404).
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

describe('U-13C: rol tarihçesi', () => {
  let http: TestAgent;
  let tenantId: string;

  beforeEach(async () => {
    await cleanDb();
    http = agent();
    tenantId = (await createTenant()).id;
  });

  it('rol değiştirme tarihçeye yazılır: önceki → yeni · değiştiren yöneticinin adı', async () => {
    const admin = await createAdminUser(tenantId);
    const mentor = await createMentor(tenantId);
    await http.post(`/api/admin/users/${mentor.id}/role`).send({ role: 'MENTI' }).set(authAs(admin)).expect(200);

    const res = await http.get(`/api/admin/users/${mentor.id}/role-history`).set(authAs(admin)).expect(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0]).toMatchObject({ previousRole: 'MENTOR', newRole: 'MENTI', changedByName: admin.fullName });
    expect(res.body.items[0]).not.toHaveProperty('changedById');
  });

  it('yönetici yap ve yöneticilikten çıkar da yazılır (yeniden eskiye)', async () => {
    const admin = await createAdminUser(tenantId);
    const menti = await createMenti(tenantId);
    await http.post(`/api/admin/users/${menti.id}/promote-admin`).set(authAs(admin)).expect(200);
    await http.post(`/api/admin/users/${menti.id}/demote-admin`).send({ targetRole: 'MENTI' }).set(authAs(admin)).expect(200);

    const res = await http.get(`/api/admin/users/${menti.id}/role-history`).set(authAs(admin)).expect(200);
    expect(res.body.items.map((r: { previousRole: string; newRole: string }) => `${r.previousRole}>${r.newRole}`))
      .toEqual(['ADMIN>MENTI', 'MENTI>ADMIN']);
  });

  it('NEGATİF: mentör ve menti tarihçeyi göremez (403)', async () => {
    const mentor = await createMentor(tenantId);
    const menti = await createMenti(tenantId);
    await http.get(`/api/admin/users/${menti.id}/role-history`).set(authAs(mentor)).expect(403);
    await http.get(`/api/admin/users/${menti.id}/role-history`).set(authAs(menti)).expect(403);
  });

  it('NEGATİF: başka kurumun yöneticisi bu kurumun üyesinin tarihçesini göremez (404)', async () => {
    const admin = await createAdminUser(tenantId);
    const mentor = await createMentor(tenantId);
    await http.post(`/api/admin/users/${mentor.id}/role`).send({ role: 'MENTI' }).set(authAs(admin)).expect(200);

    const otherAdmin = await createAdminUser((await createTenant()).id);
    await http.get(`/api/admin/users/${mentor.id}/role-history`).set(authAs(otherAdmin)).expect(404);
    expect(await testPrisma.roleChange.count({ where: { userId: mentor.id } })).toBe(1);
  });

  it('başarısız rol değişikliği (aynı rol) tarihçeye yazılmaz', async () => {
    const admin = await createAdminUser(tenantId);
    const menti = await createMenti(tenantId);
    await http.post(`/api/admin/users/${menti.id}/role`).send({ role: 'MENTI' }).set(authAs(admin)).expect(400);
    expect(await testPrisma.roleChange.count({ where: { userId: menti.id } })).toBe(0);
  });
});
