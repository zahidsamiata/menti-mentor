/**
 * İŞ A — IDOR ownership testleri.
 *
 * GET /users/:id ve GET /users/:userId/clubs artık requireSelfOrAdmin ile
 * korunuyor: bir kullanıcı :id'yi başkasınınkiyle değiştirerek kaynağına
 * (PII profili / kulüp üyelikleri) erişemez. Sahibi ve ADMIN erişebilir.
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

describe('IDOR: GET /users/:id — self+admin ownership', () => {
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
    alice = await createMenti(tenantId);
    bob = await createMenti(tenantId);
    admin = await createAdminUser(tenantId);
  });

  it('kullanıcı KENDİ profilini görebilir (200)', async () => {
    await http
      .get(`/api/users/${alice.id}`)
      .set(tenantHeaders(tenantId, tokenFor(alice)))
      .expect(200);
  });

  it('kullanıcı BAŞKASININ profilini göremez (403) — PII sızıntısı engellenir', async () => {
    const res = await http
      .get(`/api/users/${bob.id}`)
      .set(tenantHeaders(tenantId, tokenFor(alice)))
      .expect(403);
    expect(res.body.error).toBe('YETKI_YETERSIZ');
  });

  it('ADMIN başka kullanıcının profilini görebilir (200)', async () => {
    await http
      .get(`/api/users/${bob.id}`)
      .set(tenantHeaders(tenantId, tokenFor(admin)))
      .expect(200);
  });
});

describe('IDOR: GET /users/:userId/clubs — self+admin ownership', () => {
  let http: TestAgent;
  let tenantId: string;
  let alice: Awaited<ReturnType<typeof createMenti>>;
  let bob: Awaited<ReturnType<typeof createMenti>>;

  beforeEach(async () => {
    await cleanDb();
    http = agent();
    const tenant = await createTenant();
    tenantId = tenant.id;
    alice = await createMenti(tenantId);
    bob = await createMenti(tenantId);
  });

  it('kullanıcı KENDİ kulüplerini görebilir (200)', async () => {
    await http
      .get(`/api/users/${alice.id}/clubs`)
      .set(tenantHeaders(tenantId, tokenFor(alice)))
      .expect(200);
  });

  it('kullanıcı BAŞKASININ kulüp üyeliklerini göremez (403)', async () => {
    const res = await http
      .get(`/api/users/${bob.id}/clubs`)
      .set(tenantHeaders(tenantId, tokenFor(alice)))
      .expect(403);
    expect(res.body.error).toBe('YETKI_YETERSIZ');
  });
});
