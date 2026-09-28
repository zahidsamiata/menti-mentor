/**
 * AJ-116 — kurum yöneticisi bildirim alıcılarında reddedilmiş (approvalStatus = REJECTED) hesap
 * elenir.
 *
 * Sorun: `findTenantAdminUsers` (services/membership.ts) aktif ADMIN üyelik + aktif hesap arıyor,
 * onay durumuna bakmıyordu. Reddedilen kişi panele giremiyor (membershipAccess.ts:
 * REJECTED → erişim yok) ve yönetici sayımına girmiyor (adminController listAdmins, AJ-01), ama
 * kurumun bildirim e-postalarını (yeni kullanıcının adı/rolü — kişi verisi) almaya devam ediyordu.
 *
 * Koşul erişim kapısıyla AYNI: yalnız REJECTED elenir; PENDING kapıda da engellenmediği için alır.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { agent, tenantHeaders, type TestAgent } from './helpers/request.js';
import { cleanDb } from './helpers/db.js';
import { createTenant, createUser } from './helpers/factories.js';
import { signToken } from '../src/middleware/jwtAuth.js';
import type { Tenant, User } from '@prisma/client';

const emailMocks = vi.hoisted(() => ({ sendAdminNewUserNotification: vi.fn(async () => undefined) }));
vi.mock('../src/services/emailService.js', async (orig) => ({
  ...(await orig<typeof import('../src/services/emailService.js')>()),
  sendAdminNewUserNotification: emailMocks.sendAdminNewUserNotification,
}));

function tokenFor(u: Pick<User, 'id' | 'role' | 'fullName'>, tenantId: string): string {
  return signToken({ sub: u.id, tenantId, role: u.role, fullName: u.fullName });
}

let http: TestAgent;
let tenant: Tenant;

beforeEach(async () => {
  await cleanDb();
  http = agent();
  emailMocks.sendAdminNewUserNotification.mockClear();
  tenant = await createTenant();
});

describe('AJ-116: reddedilmiş yönetici kurum bildirimi almaz', () => {
  it('yeni kullanıcı bildirimi — REJECTED yönetici almaz; onaylı ve onay bekleyen yönetici alır', async () => {
    const approvedAdmin = await createUser({ tenantId: tenant.id, role: 'ADMIN' });
    const rejectedAdmin = await createUser({ tenantId: tenant.id, role: 'ADMIN', approvalStatus: 'REJECTED' });
    const pendingAdmin  = await createUser({ tenantId: tenant.id, role: 'ADMIN', approvalStatus: 'PENDING' });

    await http.post('/api/users').set(tenantHeaders(tenant.id, tokenFor(approvedAdmin, tenant.id)))
      .send({ role: 'MENTI', email: 'aj116-yeni-menti@test.local', fullName: 'Yeni Menti' })
      .expect(201);

    const recipients = emailMocks.sendAdminNewUserNotification.mock.calls
      .map((c) => (c as unknown as [{ toEmail: string }])[0].toEmail)
      .sort();
    expect(recipients).not.toContain(rejectedAdmin.email);
    expect(recipients).toEqual([approvedAdmin.email, pendingAdmin.email].sort());
  });
});
