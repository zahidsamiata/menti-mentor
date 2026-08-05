/**
 * IDOR: GET /api/analytics/:userId — self + admin ownership.
 *
 * Endpoint ham DISC vektöründen türetilmiş tam profil döndürür (PII). requireSelfOrAdmin
 * ile korunuyor: bir kullanıcı :userId'yi başkasınınkiyle değiştirerek başkasının DISC
 * türevli profilini göremez (403). Sahibi ve ADMIN görebilir.
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

describe('IDOR: GET /api/analytics/:userId — self+admin ownership', () => {
  let http: TestAgent;
  let tenantId: string;
  let alice: Awaited<ReturnType<typeof createMenti>>;
  let bob: Awaited<ReturnType<typeof createMenti>>;
  let admin: Awaited<ReturnType<typeof createAdminUser>>;

  beforeEach(async () => {
    await cleanDb();
    http = agent();
    const tenant = await createTenant();
    tenantId = tenant.id;
    // discType → getAnalytics 200 için gerekli (yoksa 422). Guard ownership'i test ediyoruz.
    alice = await createMenti(tenantId, { discType: 'D' });
    bob = await createMenti(tenantId, { discType: 'C' });
    admin = await createAdminUser(tenantId);
  });

  it('kullanıcı KENDİ analitiğini görebilir (200)', async () => {
    await http
      .get(`/api/analytics/${alice.id}`)
      .set(tenantHeaders(tenantId, tokenFor(alice)))
      .expect(200);
  });

  it('kullanıcı BAŞKASININ analitiğini göremez (403) — ham DISC PII sızıntısı engellenir', async () => {
    const res = await http
      .get(`/api/analytics/${bob.id}`)
      .set(tenantHeaders(tenantId, tokenFor(alice)))
      .expect(403);
    expect(res.body.error).toBe('YETKI_YETERSIZ');
  });

  it('ADMIN başka kullanıcının analitiğini görebilir (200)', async () => {
    await http
      .get(`/api/analytics/${bob.id}`)
      .set(tenantHeaders(tenantId, tokenFor(admin)))
      .expect(200);
  });
});
