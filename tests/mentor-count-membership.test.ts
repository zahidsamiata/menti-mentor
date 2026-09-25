/**
 * P-16 — GET /api/users/mentor-count kurum-içi rol kaynağından (TenantMembership.role) sayar.
 * Genel User.role'ü MENTOR olup bu kurumdaki üyeliği MENTI olan kişi sayılmaz; pasif üyelik sayılmaz.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { agent, tenantHeaders, type TestAgent } from './helpers/request.js';
import { cleanDb, testPrisma } from './helpers/db.js';
import { createTenant, createMentor, createMenti } from './helpers/factories.js';
import { signToken } from '../src/middleware/jwtAuth.js';
import type { User } from '@prisma/client';

function tokenFor(u: Pick<User, 'id' | 'tenantId' | 'role' | 'fullName'>): string {
  return signToken({ sub: u.id, tenantId: u.tenantId, role: u.role, fullName: u.fullName });
}

describe('P-16: mentor-count üyelik rolünden', () => {
  let http: TestAgent;
  let tenantId: string;
  let viewer: Awaited<ReturnType<typeof createMenti>>;

  beforeEach(async () => {
    await cleanDb();
    http = agent();
    const tenant = await createTenant();
    tenantId = tenant.id;
    viewer = await createMenti(tenantId);
    for (let i = 0; i < 3; i++) await createMentor(tenantId);
  });

  const count = async () =>
    (await http.get('/api/users/mentor-count').set(tenantHeaders(tenantId, tokenFor(viewer))).expect(200)).body;

  it('bu kurumda aktif MENTOR üyeliği olan onaylı kişiler sayılır', async () => {
    expect(await count()).toEqual({ count: 3, suppressed: false });
  });

  it('negatif: genel rolü MENTOR ama bu kurumdaki üyeliği MENTI olan kişi sayılmaz', async () => {
    const extra = await createMentor(tenantId);
    await testPrisma.tenantMembership.update({
      where: { userId_tenantId: { userId: extra.id, tenantId } },
      data: { role: 'MENTI' },
    });
    expect(await count()).toEqual({ count: 3, suppressed: false });
  });

  it('negatif: bu kurumdaki üyeliği pasif mentör sayılmaz', async () => {
    const extra = await createMentor(tenantId);
    await testPrisma.tenantMembership.update({
      where: { userId_tenantId: { userId: extra.id, tenantId } },
      data: { isActive: false },
    });
    expect(await count()).toEqual({ count: 3, suppressed: false });
  });
});
