/**
 * AJ-103 — kurumlar arası paylaşım kapısı SIRASI (konuşma · eşleşme isteği · görünürlük opt-in).
 *
 * Sorun: üç uçta hedef kişi okunduktan sonra ÖNCE rol/aktiflik kontrolü, SONRA paylaşım kapısı
 * (canCrossTenantMatch) çalışıyordu. Paylaşımı kapalı başka kurumdaki bir kimlik için yanıt kodu
 * farkı (yok/pasif/yanlış rol → 400/404 · var-aktif-doğru rol → 403 SHARED_POOL_KAPALI) o kişinin
 * durumunu ele veriyordu.
 * Düzeltme: resolveCrossTenantTarget kapısı rol/aktiflik kontrolünden ÖNCE; paylaşımı kapalı
 * kurumdaki hedef, "hedef yok" ile AYNI kod + AYNI gövdeyi alır.
 *
 * Her uçta: var-olmayan kimlik yanıtı referans alınır; paylaşımı kapalı kurumdaki aktif-doğru rol /
 * pasif / farklı rol hedeflerin HEPSİ bu referansla birebir aynı olmalı ve DB'ye yazılmamalı.
 * Pozitif kontrol: açık havuzda ve aynı kurumda mevcut davranış (rol hatası) değişmez.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { agent, tenantHeaders, type TestAgent } from './helpers/request.js';
import { cleanDb, testPrisma } from './helpers/db.js';
import { createTenant, createMentor, createMenti, createAdminUser } from './helpers/factories.js';
import { signToken } from '../src/middleware/jwtAuth.js';
import type { User } from '@prisma/client';

type SeededUser = Awaited<ReturnType<typeof createMenti>>;

function tokenFor(u: Pick<User, 'id' | 'tenantId' | 'role' | 'fullName'>): string {
  return signToken({ sub: u.id, tenantId: u.tenantId, role: u.role, fullName: u.fullName });
}

function authAs(u: SeededUser): Record<string, string> {
  return tenantHeaders(u.tenantId, tokenFor(u));
}

// Hiçbir kullanıcıya ait olmayan, şemadan geçen (min 5) kimlik.
const MISSING_ID = 'aj103-yok-boyle-bir-kullanici';

type Outcome = { status: number; body: unknown };

async function deactivate(u: SeededUser): Promise<SeededUser> {
  await testPrisma.user.update({ where: { id: u.id }, data: { isActive: false } });
  return u;
}

let http: TestAgent;
let closedTenantId: string;

beforeEach(async () => {
  await cleanDb();
  http = agent();
  // Hedeflerin kurumu: paylaşım KAPALI.
  closedTenantId = (await createTenant({ isSharedPoolActive: false })).id;
});

// ─── POST /api/conversations ─────────────────────────────────────────────────
describe('AJ-103: POST /api/conversations — paylaşımı kapalı kurumdaki hedef durumu sızmaz', () => {
  let menti: SeededUser;

  beforeEach(async () => {
    const own = await createTenant({ isSharedPoolActive: true });
    menti = await createMenti(own.id);
  });

  const start = async (mentorUserId: string): Promise<Outcome> => {
    const res = await http
      .post('/api/conversations')
      .set(authAs(menti))
      .send({ mentorUserId, message: 'aj103 ilk mesaj' });
    return { status: res.status, body: res.body };
  };

  it('var-olmayan / aktif mentör / pasif mentör / farklı rol → aynı kod + aynı gövde; konuşma oluşmaz', async () => {
    const missing = await start(MISSING_ID);
    expect(missing.status).toBe(400);

    const activeMentor = await createMentor(closedTenantId);
    const inactiveMentor = await deactivate(await createMentor(closedTenantId));
    const otherRole = await createMenti(closedTenantId);
    const admin = await createAdminUser(closedTenantId);

    for (const target of [activeMentor, inactiveMentor, otherRole, admin]) {
      expect(await start(target.id)).toEqual(missing);
    }
    expect(await testPrisma.conversation.count()).toBe(0);
    expect(await testPrisma.matchRequest.count()).toBe(0);
  });

  it('pozitif kontrol: açık havuzdaki pasif mentör → rol/aktiflik hatası (mevcut davranış)', async () => {
    const openTenant = await createTenant({ isSharedPoolActive: true });
    const inactiveOpen = await deactivate(await createMentor(openTenant.id));
    const res = await start(inactiveOpen.id);
    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toBe('TARGET');
  });

  it('pozitif kontrol: açık havuzdaki aktif mentöre konuşma açılır (201)', async () => {
    const openTenant = await createTenant({ isSharedPoolActive: true });
    const mentor = await createMentor(openTenant.id);
    expect((await start(mentor.id)).status).toBe(201);
  });
});

// ─── POST /api/requests (targetType=USER) ────────────────────────────────────
describe('AJ-103: POST /api/requests — paylaşımı kapalı kurumdaki hedef durumu sızmaz', () => {
  let menti: SeededUser;

  beforeEach(async () => {
    const own = await createTenant({ isSharedPoolActive: true });
    menti = await createMenti(own.id);
  });

  const request = async (targetId: string): Promise<Outcome> => {
    const res = await http
      .post('/api/requests')
      .set(authAs(menti))
      .send({ targetType: 'USER', targetId, requestMessage: 'aj103 talep' });
    return { status: res.status, body: res.body };
  };

  it('var-olmayan / aktif mentör / pasif mentör / farklı rol → aynı kod + aynı gövde; talep oluşmaz', async () => {
    const missing = await request(MISSING_ID);
    expect(missing.status).toBe(400);

    const activeMentor = await createMentor(closedTenantId);
    const inactiveMentor = await deactivate(await createMentor(closedTenantId));
    const otherRole = await createMenti(closedTenantId);
    const admin = await createAdminUser(closedTenantId);

    for (const target of [activeMentor, inactiveMentor, otherRole, admin]) {
      expect(await request(target.id)).toEqual(missing);
    }
    expect(await testPrisma.matchRequest.count()).toBe(0);
  });

  it('pozitif kontrol: açık havuzdaki aktif mentöre talep oluşur (201)', async () => {
    const openTenant = await createTenant({ isSharedPoolActive: true });
    const mentor = await createMentor(openTenant.id);
    expect((await request(mentor.id)).status).toBe(201);
  });
});

// ─── POST /api/mentors/:mentorId/visibility-optin ────────────────────────────
describe('AJ-103: POST /api/mentors/:mentorId/visibility-optin — paylaşımı kapalı kurumdaki hedef durumu sızmaz', () => {
  let mentor: SeededUser;

  beforeEach(async () => {
    const own = await createTenant({ isSharedPoolActive: true });
    mentor = await createMentor(own.id);
  });

  const optIn = async (mentiId: string): Promise<Outcome> => {
    const res = await http
      .post(`/api/mentors/${mentor.id}/visibility-optin`)
      .set(authAs(mentor))
      .send({ mentiId, status: 'APPROVED' });
    return { status: res.status, body: res.body };
  };

  it('var-olmayan / aktif menti / pasif menti / farklı rol → aynı kod + aynı gövde; opt-in oluşmaz', async () => {
    const missing = await optIn(MISSING_ID);
    expect(missing.status).toBe(404);

    const activeMenti = await createMenti(closedTenantId);
    const inactiveMenti = await deactivate(await createMenti(closedTenantId));
    const otherRole = await createMentor(closedTenantId);

    for (const target of [activeMenti, inactiveMenti, otherRole]) {
      expect(await optIn(target.id)).toEqual(missing);
    }
    expect(await testPrisma.visibilityOptIn.count()).toBe(0);
  });

  it('pozitif kontrol: açık havuzdaki pasif menti → 400 GECERSIZ_ROL (mevcut davranış)', async () => {
    const openTenant = await createTenant({ isSharedPoolActive: true });
    const inactiveOpen = await deactivate(await createMenti(openTenant.id));
    const res = await optIn(inactiveOpen.id);
    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toBe('GECERSIZ_ROL');
  });

  it('pozitif kontrol: açık havuzdaki aktif menti için opt-in yazılır (200)', async () => {
    const openTenant = await createTenant({ isSharedPoolActive: true });
    const menti = await createMenti(openTenant.id);
    expect((await optIn(menti.id)).status).toBe(200);
  });
});
