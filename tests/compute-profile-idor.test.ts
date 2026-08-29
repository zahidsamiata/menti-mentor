/**
 * 3b-2 / Y5 — compute-profile yetki regresyonu.
 *
 * Açık (yetki haritası 2026-08-29): POST /api/scoring/compute-profile `userId` + `role`'ü
 * GÖVDEDEN alıyor, self/admin kontrolü YOKtu → bir üye başkasının OCEAN/archetype/archetypeRole'ünü
 * (rol flip dahil) ezebiliyordu. Fix: non-admin yalnız kendi userId'sini hesaplar; role token'dan zorlanır.
 *
 * İddia: peer, başkasının profilini hesaplayamaz (403); kendi hesaplar; gövdeyle rol flip edilemez.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { cleanDb } from './helpers/db.js';
import { createTenant, createUser, createUserProfile } from './helpers/factories.js';
import { agent, loginAs, tenantHeaders, type TestAgent } from './helpers/request.js';

describe('Y5 — POST /api/scoring/compute-profile IDOR + rol flip', () => {
  let http: TestAgent;
  let tenantId: string;
  let userA: string;
  let userB: string;
  let tokenA: string;

  beforeEach(async () => {
    await cleanDb();
    http = agent();
    const tenant = await createTenant();
    tenantId = tenant.id;
    const a = await createUser({ tenantId, role: 'MENTI' });
    const b = await createUser({ tenantId, role: 'MENTI' });
    userA = a.id;
    userB = b.id;
    // A'nın profili olmalı (computeAndStoreProfile UserProfile ister).
    await createUserProfile(userA, { discD: 8, discI: 2, discS: 5, discC: 5 });
    ({ accessToken: tokenA } = await loginAs(http, a.email, a.rawPassword));
  });

  it('peer, başkasının (B) profilini hesaplayamaz → 403', async () => {
    const res = await http
      .post('/api/scoring/compute-profile')
      .set(tenantHeaders(tenantId, tokenA))
      .send({ userId: userB, role: 'MENTI' });
    expect(res.status).toBe(403);
  });

  it('kendi profilini hesaplayabilir → 200', async () => {
    const res = await http
      .post('/api/scoring/compute-profile')
      .set(tenantHeaders(tenantId, tokenA))
      .send({ userId: userA, role: 'MENTI' });
    expect(res.status).toBe(200);
    expect(res.body.userId).toBe(userA);
  });

  it('gövdeyle rol FLIP edilemez: MENTI, role:ADMIN gönderse de archetypeRole MENTI kalır', async () => {
    const res = await http
      .post('/api/scoring/compute-profile')
      .set(tenantHeaders(tenantId, tokenA))
      .send({ userId: userA, role: 'ADMIN' });
    expect(res.status).toBe(200);
    expect(res.body.role).toBe('MENTI'); // token'dan zorlandı, gövdedeki ADMIN yok sayıldı
  });
});
