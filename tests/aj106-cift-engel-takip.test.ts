/**
 * AJ-106 — Çift engelleme (E-3d) takip kalemleri.
 *
 * 1) POST /api/tenants/:id/block-pair artık SystemLog'a AUDIT kaydı yazıyor (unblockPair gibi):
 *    kim (actorId), hangi kurum (tenantId), hangi çift (pairId — isim/e-posta YOK).
 * 2) Eşzamanlı yazımlar birbirini ezmiyor: blockedPairs tek JSON dizisi; eskiden "oku → ekle →
 *    tamamını yaz" kilitsizdi, aynı anda gelen iki engelden biri kayboluyordu. Artık iyimser
 *    kontrol (dizi okunduğu gibi duruyorsa yaz, değilse yeniden oku) — bkz. changeBlockedPairs.
 * 3) GET /api/admin/users `search` parametresi: seçim listesi ilk sayfa dışındaki üyeyi de bulur.
 * Negatif: MENTOR / MENTI / başka kurum yöneticisi engel koyamaz, dizi değişmez, AUDIT yazılmaz.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { agent, tenantHeaders, type TestAgent } from './helpers/request.js';
import { cleanDb, testPrisma } from './helpers/db.js';
import { createTenant, createAdminUser, createMentor, createMenti } from './helpers/factories.js';
import { signToken } from '../src/middleware/jwtAuth.js';
import { pairKey, sanitizeBlockedPairs } from '../src/services/blockList.js';
import type { User } from '@prisma/client';

function tokenFor(u: Pick<User, 'id' | 'tenantId' | 'role' | 'fullName'>): string {
  return signToken({ sub: u.id, tenantId: u.tenantId, role: u.role, fullName: u.fullName });
}

const AUDIT_MESSAGE = 'Çift engeli eklendi';

// logger.info fire-and-forget (void) → yanıt döndükten sonra SystemLog yazımı tamamlanabilir.
async function waitForAuditLog(tenantId: string, tries = 30): Promise<Record<string, unknown> | null> {
  for (let i = 0; i < tries; i++) {
    const logs = await testPrisma.systemLog.findMany({
      where: { category: 'AUDIT', message: AUDIT_MESSAGE },
      orderBy: { createdAt: 'desc' },
    });
    const log = logs.find((l) => (l.meta as Record<string, unknown> | null)?.['tenantId'] === tenantId);
    if (log) return log as unknown as Record<string, unknown>;
    await new Promise((r) => setTimeout(r, 50));
  }
  return null;
}

async function blockedPairsOf(tenantId: string) {
  const t = await testPrisma.tenant.findUnique({ where: { id: tenantId }, select: { blockedPairs: true } });
  return sanitizeBlockedPairs(t?.blockedPairs);
}

describe('AJ-106 — çift engeli: denetim izi + eşzamanlılık + seçim araması', () => {
  let http: TestAgent;
  let tenantId: string;
  let admin: Awaited<ReturnType<typeof createAdminUser>>;
  let mentor: Awaited<ReturnType<typeof createMentor>>;
  let menti: Awaited<ReturnType<typeof createMenti>>;
  let adminToken: string;

  beforeEach(async () => {
    await cleanDb();
    http = agent();
    const tenant = await createTenant();
    tenantId = tenant.id;
    admin = await createAdminUser(tenantId);
    mentor = await createMentor(tenantId);
    menti = await createMenti(tenantId);
    adminToken = tokenFor(admin);
  });

  // ─── 1) AUDIT ────────────────────────────────────────────────────────────

  it('engel koyma SystemLog AUDIT kaydı üretir (actorId + tenantId + pairId); PII yok', async () => {
    await http
      .post(`/api/tenants/${tenantId}/block-pair`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ fromUserId: mentor.id, toUserId: menti.id })
      .expect(201);

    const log = await waitForAuditLog(tenantId);
    expect(log).not.toBeNull();
    const meta = log!['meta'] as Record<string, unknown>;
    expect(meta['actorId']).toBe(admin.id);
    expect(meta['tenantId']).toBe(tenantId);
    expect(meta['pairId']).toBe(pairKey(mentor.id, menti.id));

    const raw = JSON.stringify(log);
    for (const u of [admin, mentor, menti]) {
      expect(raw).not.toContain(u.email);
      expect(raw).not.toContain(u.fullName);
    }
  });

  // ─── 2) Eşzamanlılık ─────────────────────────────────────────────────────

  it('aynı anda gelen iki engel isteğinin İKİSİ de dizide kalır', async () => {
    const admin2 = await createAdminUser(tenantId);
    const menti2 = await createMenti(tenantId);

    const [r1, r2] = await Promise.all([
      http.post(`/api/tenants/${tenantId}/block-pair`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ fromUserId: mentor.id, toUserId: menti.id }),
      http.post(`/api/tenants/${tenantId}/block-pair`)
        .set('Authorization', `Bearer ${tokenFor(admin2)}`)
        .send({ fromUserId: mentor.id, toUserId: menti2.id }),
    ]);
    expect(r1.status).toBe(201);
    expect(r2.status).toBe(201);

    const keys = (await blockedPairsOf(tenantId)).map((p) => pairKey(p.fromUserId, p.toUserId)).sort();
    expect(keys).toEqual([pairKey(mentor.id, menti.id), pairKey(mentor.id, menti2.id)].sort());
  });

  it('beş eşzamanlı engel isteğinin hepsi korunur (kayıp güncelleme yok)', async () => {
    const mentis = await Promise.all(Array.from({ length: 5 }, () => createMenti(tenantId)));

    const results = await Promise.all(
      mentis.map((m) =>
        http.post(`/api/tenants/${tenantId}/block-pair`)
          .set('Authorization', `Bearer ${adminToken}`)
          .send({ fromUserId: mentor.id, toUserId: m.id }),
      ),
    );
    expect(results.map((r) => r.status)).toEqual([201, 201, 201, 201, 201]);

    const pairs = await blockedPairsOf(tenantId);
    expect(pairs).toHaveLength(5);
    expect(new Set(pairs.map((p) => p.toUserId))).toEqual(new Set(mentis.map((m) => m.id)));
  });

  it('eşzamanlı engel ekleme + başka bir engeli kaldırma: yeni engel kaybolmaz', async () => {
    const menti2 = await createMenti(tenantId);
    await http
      .post(`/api/tenants/${tenantId}/block-pair`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ fromUserId: mentor.id, toUserId: menti.id })
      .expect(201);

    const [add, remove] = await Promise.all([
      http.post(`/api/tenants/${tenantId}/block-pair`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ fromUserId: mentor.id, toUserId: menti2.id }),
      http.delete(`/api/tenants/${tenantId}/block-pair/${encodeURIComponent(pairKey(mentor.id, menti.id))}`)
        .set('Authorization', `Bearer ${adminToken}`),
    ]);
    expect(add.status).toBe(201);
    expect(remove.status).toBe(200);

    const keys = (await blockedPairsOf(tenantId)).map((p) => pairKey(p.fromUserId, p.toUserId));
    expect(keys).toEqual([pairKey(mentor.id, menti2.id)]);
  });

  it('aynı çift aynı anda iki kez engellenirse dizide TEK kayıt kalır (biri 409)', async () => {
    const [r1, r2] = await Promise.all([
      http.post(`/api/tenants/${tenantId}/block-pair`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ fromUserId: mentor.id, toUserId: menti.id }),
      http.post(`/api/tenants/${tenantId}/block-pair`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ fromUserId: menti.id, toUserId: mentor.id }),
    ]);
    expect([r1.status, r2.status].sort()).toEqual([201, 409]);
    expect(await blockedPairsOf(tenantId)).toHaveLength(1);
  });

  // ─── Negatif: yetkisiz engel koyamaz, dizi değişmez, AUDIT yazılmaz ──────

  it.each([
    ['MENTOR', () => mentor],
    ['MENTI',  () => menti],
  ] as const)('%s engel koyamaz (403), dizi değişmez, AUDIT yazılmaz', async (_role, who) => {
    await http
      .post(`/api/tenants/${tenantId}/block-pair`)
      .set('Authorization', `Bearer ${tokenFor(who())}`)
      .send({ fromUserId: mentor.id, toUserId: menti.id })
      .expect(403);

    expect(await blockedPairsOf(tenantId)).toEqual([]);
    expect(await waitForAuditLog(tenantId, 3)).toBeNull();
  });

  it('başka kurumun yöneticisi bu kuruma engel koyamaz (403), dizi değişmez, AUDIT yazılmaz', async () => {
    const otherTenant = await createTenant();
    const otherAdmin = await createAdminUser(otherTenant.id);

    await http
      .post(`/api/tenants/${tenantId}/block-pair`)
      .set('Authorization', `Bearer ${tokenFor(otherAdmin)}`)
      .send({ fromUserId: mentor.id, toUserId: menti.id })
      .expect(403);

    expect(await blockedPairsOf(tenantId)).toEqual([]);
    expect(await waitForAuditLog(tenantId, 3)).toBeNull();
  });

  // ─── 3) Seçim listesi araması ────────────────────────────────────────────

  it('GET /api/admin/users?search= ilk sayfa dışındaki onaylı üyeyi ada göre bulur', async () => {
    // 3 ek menti; aranan kişi sayfa boyutu 1 iken ilk sayfada OLMAYAN kayıt olsun.
    const target = await createMenti(tenantId);
    await testPrisma.user.update({ where: { id: target.id }, data: { fullName: 'Aranan Üye' } });
    await createMenti(tenantId);
    await createMenti(tenantId);

    const firstPage = await http
      .get('/api/admin/users?role=MENTI&approvalStatus=APPROVED&pageSize=1')
      .set(tenantHeaders(tenantId, adminToken))
      .expect(200);
    const firstIds = (firstPage.body.items as Array<{ id: string }>).map((u: { id: string }) => u.id);
    expect(firstIds).not.toContain(target.id);

    const res = await http
      .get(`/api/admin/users?role=MENTI&approvalStatus=APPROVED&pageSize=1&search=${encodeURIComponent('aranan')}`)
      .set(tenantHeaders(tenantId, adminToken))
      .expect(200);
    const items = res.body.items as Array<{ id: string }>;
    expect(items.map((u) => u.id)).toEqual([target.id]);
  });

  it('search başka kurumun üyesini döndürmez (kurum izolasyonu)', async () => {
    const otherTenant = await createTenant();
    const foreign = await createMenti(otherTenant.id);
    await testPrisma.user.update({ where: { id: foreign.id }, data: { fullName: 'Yabancı Kurumüyesi' } });

    const res = await http
      .get(`/api/admin/users?role=MENTI&search=${encodeURIComponent('Kurumüyesi')}`)
      .set(tenantHeaders(tenantId, adminToken))
      .expect(200);
    const items = res.body.items as Array<{ id: string }>;
    expect(items).toEqual([]);
  });
});
