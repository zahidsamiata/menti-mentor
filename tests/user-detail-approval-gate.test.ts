/**
 * GV-24 — GET /api/users/:id, komşu uç GET /api/users (listUsers) ile aynı iki onay kapısını uygular:
 *   (1) onaylanmamış çağıran başkasının kaydını göremez (403 ONAY_BEKLENIYOR),
 *   (2) onaylanmamış hedef yalnız kendisine ve ADMIN'e görünür (peer için 404 — listede de yok).
 * Kendi kaydı ve ADMIN davranışı değişmez.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { agent, tenantHeaders, type TestAgent } from './helpers/request.js';
import { cleanDb } from './helpers/db.js';
import { createTenant, createMentor, createMenti, createAdminUser } from './helpers/factories.js';
import { signToken } from '../src/middleware/jwtAuth.js';
import type { User } from '@prisma/client';

function tokenFor(u: Pick<User, 'id' | 'tenantId' | 'role' | 'fullName'>): string {
  return signToken({ sub: u.id, tenantId: u.tenantId, role: u.role, fullName: u.fullName });
}

describe('GV-24: kullanıcı detay ucu onay kapısı', () => {
  let http: TestAgent;
  let tenantId: string;

  beforeEach(async () => {
    await cleanDb();
    http = agent();
    tenantId = (await createTenant()).id;
  });

  it('negatif: onay bekleyen kullanıcı başkasının profilini çekemez (403)', async () => {
    const pending = await createMenti(tenantId, { approvalStatus: 'PENDING' });
    const mentor = await createMentor(tenantId);
    const res = await http.get(`/api/users/${mentor.id}`).set(tenantHeaders(tenantId, tokenFor(pending)));
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('ONAY_BEKLENIYOR');
    expect(res.body).not.toHaveProperty('fullName');
  });

  it('negatif: reddedilmiş kullanıcı başkasının profilini çekemez (401, oturum GV-10 ile geçersiz kılınır)', async () => {
    // GV-10: requireTenant REJECTED hesabı route'a hiç ulaştırmadan 401 HESAP_PASIF ile keser
    // (session-revocation.test.ts ile aynı davranış) — bu yüzden buradaki 403 ONAY_BEKLENIYOR
    // kapısına hiç gelinmez. PENDING farklıdır: PENDING middleware'de engellenmez (bkz. üstteki test).
    const rejected = await createMentor(tenantId, { approvalStatus: 'REJECTED' });
    const menti = await createMenti(tenantId);
    const res = await http.get(`/api/users/${menti.id}`).set(tenantHeaders(tenantId, tokenFor(rejected)));
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('HESAP_PASIF');
  });

  it('negatif: onaylı kullanıcı onaylanmamış kişiyi göremez (404, listedeki gibi yok sayılır)', async () => {
    const mentor = await createMentor(tenantId);
    const pending = await createMenti(tenantId, { approvalStatus: 'PENDING' });
    const rejected = await createMenti(tenantId, { approvalStatus: 'REJECTED' });
    for (const target of [pending, rejected]) {
      const res = await http.get(`/api/users/${target.id}`).set(tenantHeaders(tenantId, tokenFor(mentor)));
      expect(res.status).toBe(404);
      expect(res.body).not.toHaveProperty('fullName');
    }
  });

  it('onay bekleyen kullanıcı KENDİ kaydını tam veriyle görür', async () => {
    const pending = await createMenti(tenantId, { approvalStatus: 'PENDING' });
    const res = await http.get(`/api/users/${pending.id}`).set(tenantHeaders(tenantId, tokenFor(pending)));
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(pending.id);
    expect(res.body).toHaveProperty('email');
    expect(res.body.approvalStatus).toBe('PENDING');
  });

  it('ADMIN onay bekleyen kullanıcının kaydını tam veriyle görür', async () => {
    const admin = await createAdminUser(tenantId);
    const pending = await createMenti(tenantId, { approvalStatus: 'PENDING' });
    const res = await http.get(`/api/users/${pending.id}`).set(tenantHeaders(tenantId, tokenFor(admin)));
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('email');
  });

  it('onaylı kullanıcı onaylı kişinin herkese açık profilini görmeye devam eder', async () => {
    const menti = await createMenti(tenantId);
    const mentor = await createMentor(tenantId);
    const res = await http.get(`/api/users/${menti.id}`).set(tenantHeaders(tenantId, tokenFor(mentor)));
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(menti.id);
    expect(res.body).not.toHaveProperty('email');
  });
});
