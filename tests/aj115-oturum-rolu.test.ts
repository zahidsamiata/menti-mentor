/**
 * AJ-115 — oturum yanıtlarındaki rol (`/auth/me`, login ve refresh gövdesi) = oturum kurumundaki
 * AKTİF üyelik rolü (`TenantMembership.role`), kişi-genel `User.role` DEĞİL.
 *
 * Sorun: arka uç yetki kararını kurum-içi rolle veriyor (requireTenant her istekte üyelikten
 * düzeltir, AJ-105), ama ön yüz ekran seçimini (yönetici paneli / mentör / menti) bu yanıtlardaki
 * `role` alanından yapıyor. Yanıtlar `User.role` döndürdüğü için çok kurumlu kişide ekran ile yetki
 * ayrışıyor, yanlış panel açılıyordu.
 *
 * Kişiler (ana kurumu B — login/refresh oturumu ana kurumda açar):
 *  - P: A'da MENTOR, B'de MENTI (User.role = MENTOR) → B oturumunda rol MENTI.
 *  - Q: A'da MENTI, B'de MENTOR (User.role = MENTI)  → B oturumunda rol MENTOR.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { agent, loginAs, tenantHeaders, type TestAgent } from './helpers/request.js';
import { cleanDb, testPrisma } from './helpers/db.js';
import { createTenant, createUser } from './helpers/factories.js';
import { signToken } from '../src/middleware/jwtAuth.js';
import type { Tenant, User, UserRole } from '@prisma/client';

type Seeded = Awaited<ReturnType<typeof createUser>>;

function tokenFor(u: Pick<User, 'id' | 'role' | 'fullName'>, tenantId: string): string {
  return signToken({ sub: u.id, tenantId, role: u.role, fullName: u.fullName });
}

let tenantA: Tenant;
let tenantB: Tenant;
let p: Seeded; // A'da MENTOR, B'de MENTI
let q: Seeded; // A'da MENTI, B'de MENTOR

/** Ana kurumu B olan, User.role = userRole; B üyeliği roleInB, A üyeliği roleInA olan kişi. */
async function createSplitRoleUser(userRole: UserRole, roleInA: UserRole, roleInB: UserRole): Promise<Seeded> {
  const u = await createUser({ tenantId: tenantB.id, role: userRole });
  await testPrisma.tenantMembership.update({
    where: { userId_tenantId: { userId: u.id, tenantId: tenantB.id } },
    data:  { role: roleInB },
  });
  await testPrisma.tenantMembership.create({
    data: { userId: u.id, tenantId: tenantA.id, role: roleInA, isActive: true },
  });
  return u;
}

beforeEach(async () => {
  await cleanDb();
  tenantA = await createTenant();
  tenantB = await createTenant();
  p = await createSplitRoleUser('MENTOR', 'MENTOR', 'MENTI');
  q = await createSplitRoleUser('MENTI', 'MENTI', 'MENTOR');
});

describe('AJ-115: /auth/me rolü oturum kurumundaki üyelikten', () => {
  it('A\'da MENTOR, B\'de MENTI kişi — B oturumunda /auth/me rolü MENTI', async () => {
    const res = await agent().get('/api/auth/me').set(tenantHeaders(tenantB.id, tokenFor(p, tenantB.id))).expect(200);
    expect(res.body.role).toBe('MENTI');
    expect(res.body.tenantId).toBe(tenantB.id);
  });

  it('ters yön — A\'da MENTI, B\'de MENTOR kişi — B oturumunda /auth/me rolü MENTOR', async () => {
    const res = await agent().get('/api/auth/me').set(tenantHeaders(tenantB.id, tokenFor(q, tenantB.id))).expect(200);
    expect(res.body.role).toBe('MENTOR');
  });

  it('tek kurumlu kişide değişiklik yok — rol User.role ile aynı', async () => {
    const plain = await createUser({ tenantId: tenantB.id, role: 'MENTOR' });
    const res = await agent().get('/api/auth/me').set(tenantHeaders(tenantB.id, tokenFor(plain, tenantB.id))).expect(200);
    expect(res.body.role).toBe('MENTOR');
  });
});

describe('AJ-115: login ve refresh gövdesindeki rol oturum kurumundaki üyelikten', () => {
  let http: TestAgent;
  beforeEach(() => { http = agent(); });

  it('login — P (B\'de MENTI) için user.role MENTI', async () => {
    const res = await http.post('/api/auth/login').send({ email: p.email, password: p.rawPassword }).expect(200);
    expect(res.body.user.role).toBe('MENTI');
    expect(res.body.user.tenantId).toBe(tenantB.id);
  });

  it('refresh — Q (B\'de MENTOR) için user.role MENTOR', async () => {
    await loginAs(http, q.email, q.rawPassword);
    const res = await http.post('/api/auth/refresh').expect(200);
    expect(res.body.user.role).toBe('MENTOR');
  });

  it('login — oturum kurumunda aktif üyelik yoksa yanıt şekli bozulmaz (User.role döner)', async () => {
    await testPrisma.tenantMembership.update({
      where: { userId_tenantId: { userId: p.id, tenantId: tenantB.id } },
      data:  { isActive: false },
    });
    const res = await http.post('/api/auth/login').send({ email: p.email, password: p.rawPassword }).expect(200);
    expect(res.body.user.role).toBe('MENTOR');
  });
});
