/**
 * U-08 — eşleşme önerileri onay kapısı.
 * Onayı bekleyen (PENDING) ya da reddedilmiş kullanıcı eşleşme önerilerini göremez;
 * onaylı kullanıcı ve kurum yöneticisi görür. Komşu uç: GET /api/users (listUsers).
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

describe('U-08: eşleşme uçlarında onay kapısı', () => {
  let http: TestAgent;
  let tenantId: string;

  beforeEach(async () => {
    await cleanDb();
    http = agent();
    const tenant = await createTenant();
    tenantId = tenant.id;
    await createMentor(tenantId); // havuzda en az bir onaylı mentör
  });

  it('onaylı menti kendi eşleşme önerilerini görür (200)', async () => {
    const menti = await createMenti(tenantId);
    const res = await http.get(`/api/mentis/${menti.id}/mentor-matches`).set(tenantHeaders(tenantId, tokenFor(menti)));
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.items)).toBe(true);
  });

  it('negatif: onay bekleyen menti eşleşme önerilerini göremez (403, liste yok)', async () => {
    const menti = await createMenti(tenantId, { approvalStatus: 'PENDING' });
    const res = await http.get(`/api/mentis/${menti.id}/mentor-matches`).set(tenantHeaders(tenantId, tokenFor(menti)));
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('ONAY_BEKLENIYOR');
    expect(res.body.items).toBeUndefined();
  });

  it('negatif: reddedilmiş menti de göremez (403)', async () => {
    const menti = await createMenti(tenantId, { approvalStatus: 'REJECTED' });
    const res = await http.get(`/api/mentis/${menti.id}/mentor-matches`).set(tenantHeaders(tenantId, tokenFor(menti)));
    expect(res.status).toBe(403);
  });

  it('negatif: onay bekleyen mentör menti adaylarını göremez (403)', async () => {
    const mentor = await createMentor(tenantId, { approvalStatus: 'PENDING' });
    const res = await http.get(`/api/mentors/${mentor.id}/candidates`).set(tenantHeaders(tenantId, tokenFor(mentor)));
    expect(res.status).toBe(403);
    expect(res.body.items).toBeUndefined();
  });

  it('kurum yöneticisi kapıya takılmaz (200)', async () => {
    const menti = await createMenti(tenantId, { approvalStatus: 'PENDING' });
    const admin = await createAdminUser(tenantId);
    const res = await http.get(`/api/mentis/${menti.id}/mentor-matches`).set(tenantHeaders(tenantId, tokenFor(admin)));
    expect(res.status).toBe(200);
  });
});
