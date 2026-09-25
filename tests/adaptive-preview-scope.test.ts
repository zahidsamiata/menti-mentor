/**
 * KR-04 — GET /api/users/:id/adaptive-test/preview kurum kapsamı.
 * Kişi kendi ön izlemesini, kurum yöneticisi kendi kurumundaki üyeninkini görür;
 * başka kurumun yöneticisi hiçbir sonuç alamaz (404), aynı kurumdaki başka üye 403.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { agent, tenantHeaders, type TestAgent } from './helpers/request.js';
import { cleanDb } from './helpers/db.js';
import { createTenant, createMenti, createAdminUser } from './helpers/factories.js';
import { signToken } from '../src/middleware/jwtAuth.js';
import type { User } from '@prisma/client';

function tokenFor(u: Pick<User, 'id' | 'tenantId' | 'role' | 'fullName'>): string {
  return signToken({ sub: u.id, tenantId: u.tenantId, role: u.role, fullName: u.fullName });
}

describe('KR-04: adaptive-test/preview kurum kapsamı', () => {
  let http: TestAgent;
  let tenantId: string;
  let menti: Awaited<ReturnType<typeof createMenti>>;

  beforeEach(async () => {
    await cleanDb();
    http = agent();
    const tenant = await createTenant();
    tenantId = tenant.id;
    menti = await createMenti(tenantId);
  });

  const url = (id: string) => `/api/users/${id}/adaptive-test/preview`;

  it('kişi kendi ön izlemesini görür (200)', async () => {
    const res = await http.get(url(menti.id)).set(tenantHeaders(tenantId, tokenFor(menti))).expect(200);
    expect(res.body).toHaveProperty('discVector');
  });

  it('kurum yöneticisi kendi kurumundaki üyenin ön izlemesini görür (200)', async () => {
    const admin = await createAdminUser(tenantId);
    await http.get(url(menti.id)).set(tenantHeaders(tenantId, tokenFor(admin))).expect(200);
  });

  it('negatif: başka kurumun yöneticisi sonuç alamaz (404, discVector yok)', async () => {
    const other = await createTenant();
    const otherAdmin = await createAdminUser(other.id);
    const res = await http.get(url(menti.id)).set(tenantHeaders(other.id, tokenFor(otherAdmin))).expect(404);
    expect(res.body).not.toHaveProperty('discVector');
  });

  it('negatif: aynı kurumdaki başka üye 403 alır', async () => {
    const peer = await createMenti(tenantId);
    const res = await http.get(url(menti.id)).set(tenantHeaders(tenantId, tokenFor(peer))).expect(403);
    expect(res.body).not.toHaveProperty('discVector');
  });
});
