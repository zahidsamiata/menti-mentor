/**
 * listUsers (peer havuzu) onay filtresi testi.
 *
 * GET /api/users, menti'nin mentör-tarama havuzunu besler. "Yönetici onayına kadar
 * havuzda görünmez" ilkesi: onaylanmamış (PENDING) üye başka üyelere DÖNMEZ — hem mentör
 * hem menti yönünde (rol-bağımsız). Admin PENDING'i AYRI endpoint'ten görür
 * (adminListUsers → /api/admin/users), bu endpoint yalnız peer taramasıdır.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { agent, loginAs, tenantHeaders, type TestAgent } from './helpers/request.js';
import { cleanDb } from './helpers/db.js';
import { createTenant, createMentor, createMenti } from './helpers/factories.js';
import type { Tenant } from '@prisma/client';

describe('listUsers — onaysız üye peer havuzunda görünmez', () => {
  let http: TestAgent;
  let tenant: Tenant;
  let callerToken: string;

  beforeEach(async () => {
    await cleanDb();
    http = agent();
    tenant = await createTenant();
    // Çağıran: APPROVED mentör (peer havuzunu görebilmek için onaylı olmalı — caller gate).
    const caller = await createMentor(tenant.id);
    const tokens = await loginAs(http, caller.email, caller.rawPassword);
    callerToken = tokens.accessToken;
  });

  it('role=MENTOR: APPROVED mentör görünür, PENDING mentör GÖRÜNMEZ', async () => {
    const approved = await createMentor(tenant.id, { approvalStatus: 'APPROVED' });
    const pending  = await createMentor(tenant.id, { approvalStatus: 'PENDING' });

    const res = await http
      .get('/api/users?role=MENTOR&isActive=true&pageSize=100')
      .set(tenantHeaders(tenant.id, callerToken))
      .expect(200);

    const ids = (res.body as { items: { id: string }[] }).items.map((u) => u.id);
    expect(ids).toContain(approved.id);
    expect(ids).not.toContain(pending.id);
  });

  it('role=MENTI: APPROVED menti görünür, PENDING menti GÖRÜNMEZ (kural rol-bağımsız)', async () => {
    const approved = await createMenti(tenant.id, { approvalStatus: 'APPROVED' });
    const pending  = await createMenti(tenant.id, { approvalStatus: 'PENDING' });

    const res = await http
      .get('/api/users?role=MENTI')
      .set(tenantHeaders(tenant.id, callerToken))
      .expect(200);

    const ids = (res.body as { items: { id: string }[] }).items.map((u) => u.id);
    expect(ids).toContain(approved.id);
    expect(ids).not.toContain(pending.id);
  });
});
