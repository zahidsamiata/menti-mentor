/**
 * AJ-124 — KVKK "verilerimi indir" çıktısı kurum üyeliği verisini içerir (entegrasyon).
 *
 * NEDEN: KVKK Md.11 erişim hakkı — kurum-içi rol, sertifika durumu/denemeleri/bekleme ve öğrenme
 * yolculuğu tamamlama TenantMembership'te tutulur; önceki dışa aktarma bunları döndürmüyordu.
 *
 * Ölçüt:
 *  - Kişi kendi verisini indirince (GET /api/me/data-export ve GET /api/users/<kendi id>/export)
 *    TÜM kurum üyelikleri (iki kurum) kişisel alanlarıyla çıktıda;
 *  - başka kişinin üyeliği (aynı kurumlarda) çıktıda YOK;
 *  - kurum yöneticisi başkasını dışa aktarırken yalnız KENDİ kurumundaki üyeliği görür
 *    (kişinin diğer kurum bilgisi sızmaz); başka kurumun yöneticisi → 404 (değişmedi).
 *  - Kurum filtresi (src/db.ts RLS) 'all' kapsamında BİLİNÇLİ aşılır — yalnız kişinin KENDİ kaydı için:
 *    kişi misafir üyesi olduğu kurumun oturumundayken de /me/data-export → 200 + iki üyelik
 *    (önceden ev kurumu araması bulamıyor → 500); aynı kurumdaki başka üye bu yolu başkası için
 *    kullanamaz (403).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { cleanDb, testPrisma } from './helpers/db.js';
import { createTenant, createUser } from './helpers/factories.js';
import { agent, loginAs, tenantHeaders, type TestAgent } from './helpers/request.js';
import { signToken } from '../src/middleware/jwtAuth.js';

type MembershipOut = {
  tenantId: string;
  tenant: { name: string; slug: string };
  role: string;
  certificationStatus: string;
  certAttempts: number;
  cooldownUntil: string | null;
  learningJourneyCompletedAt: string | null;
  createdAt: string;
  [k: string]: unknown;
};

describe('AJ-124 — dışa aktarmada kurum üyelikleri', () => {
  let http: TestAgent;
  let tenantA: { id: string; name: string; slug: string };
  let tenantB: { id: string; name: string; slug: string };
  let person: Awaited<ReturnType<typeof createUser>>;
  let other: Awaited<ReturnType<typeof createUser>>;
  let adminA: Awaited<ReturnType<typeof createUser>>;
  let adminB: Awaited<ReturnType<typeof createUser>>;
  const cooldown = new Date('2026-10-05T10:00:00.000Z');
  const journeyDone = new Date('2026-09-01T08:00:00.000Z');

  beforeEach(async () => {
    await cleanDb();
    http = agent();
    tenantA = await createTenant({ name: 'Kurum Alfa AJ124' });
    tenantB = await createTenant({ name: 'Kurum Beta AJ124' });

    // Kişi: ev kurumu A'da MENTI, B'de MENTOR (sertifika denemesi + bekleme + yolculuk tamam).
    person = await createUser({ tenantId: tenantA.id, role: 'MENTI' });
    await testPrisma.tenantMembership.create({
      data: {
        userId: person.id,
        tenantId: tenantB.id,
        role: 'MENTOR',
        isActive: true,
        certificationStatus: 'FAILED',
        certAttempts: 2,
        cooldownUntil: cooldown,
        certWrongTopics: ['aktif-dinleme'],
        learningJourneyCompletedAt: journeyDone,
      },
    });

    // Başka kişi: iki kurumda da üye, ayırt edici sertifika deneme sayısıyla.
    other = await createUser({ tenantId: tenantA.id, role: 'MENTOR' });
    await testPrisma.tenantMembership.update({
      where: { userId_tenantId: { userId: other.id, tenantId: tenantA.id } },
      data: { certAttempts: 77 },
    });
    await testPrisma.tenantMembership.create({
      data: { userId: other.id, tenantId: tenantB.id, role: 'ADMIN', isActive: true, certAttempts: 77 },
    });

    adminA = await createUser({ tenantId: tenantA.id, role: 'ADMIN' });
    adminB = await createUser({ tenantId: tenantB.id, role: 'ADMIN' });
  });

  function assertOnlyOwnMemberships(body: { memberships: MembershipOut[] }) {
    const blob = JSON.stringify(body);
    expect(blob).not.toContain(other.id);
    expect(blob).not.toContain(adminA.id);
    expect(blob).not.toContain(adminB.id);
    expect(body.memberships.some((m) => m.certAttempts === 77)).toBe(false);
  }

  function assertBothMemberships(memberships: MembershipOut[]) {
    expect(memberships).toHaveLength(2);
    const a = memberships.find((m) => m.tenantId === tenantA.id)!;
    const b = memberships.find((m) => m.tenantId === tenantB.id)!;
    expect(a).toBeDefined();
    expect(b).toBeDefined();

    expect(a.role).toBe('MENTI');
    expect(a.tenant).toEqual({ name: tenantA.name, slug: tenantA.slug });
    expect(typeof a.createdAt).toBe('string'); // katılım tarihi

    expect(b.role).toBe('MENTOR');
    expect(b.tenant).toEqual({ name: tenantB.name, slug: tenantB.slug });
    expect(b.certificationStatus).toBe('FAILED');
    expect(b.certAttempts).toBe(2);
    expect(b.cooldownUntil).toBe(cooldown.toISOString());
    expect(b.certWrongTopics).toEqual(['aktif-dinleme']);
    expect(b.learningJourneyCompletedAt).toBe(journeyDone.toISOString());

    // Hariç tutulanlar (gerekçe: gdprMembershipExport.ts) yanıtta yok.
    for (const m of memberships) {
      expect(m).not.toHaveProperty('id');
      expect(m).not.toHaveProperty('userId');
      expect(m).not.toHaveProperty('qualityMultiplier');
    }
  }

  it('GET /api/me/data-export → kişinin İKİ kurum üyeliği de çıktıda; başka kişinin üyeliği yok', async () => {
    const { accessToken } = await loginAs(http, person.email, person.rawPassword);
    const res = await http.get('/api/me/data-export').set(tenantHeaders(tenantA.id, accessToken)).expect(200);

    // Geriye uyum: mevcut alanlar aynen duruyor.
    expect(res.body.userId).toBe(person.id);
    expect(res.body.profile.email).toBe(person.email);
    expect(Array.isArray(res.body.consents)).toBe(true);

    assertBothMemberships(res.body.memberships);
    assertOnlyOwnMemberships(res.body);
  });

  it('GET /api/users/<kendi id>/export → kendi isteği: iki üyelik de çıktıda', async () => {
    const { accessToken } = await loginAs(http, person.email, person.rawPassword);
    const res = await http
      .get(`/api/users/${person.id}/export`)
      .set(tenantHeaders(tenantA.id, accessToken))
      .expect(200);
    assertBothMemberships(res.body.memberships);
    assertOnlyOwnMemberships(res.body);
  });

  it('kurum A yöneticisi kişiyi dışa aktarınca yalnız A üyeliği görünür (B bilgisi sızmaz)', async () => {
    const { accessToken } = await loginAs(http, adminA.email, adminA.rawPassword);
    const res = await http
      .get(`/api/users/${person.id}/export`)
      .set(tenantHeaders(tenantA.id, accessToken))
      .expect(200);
    const memberships = res.body.memberships as MembershipOut[];
    expect(memberships).toHaveLength(1);
    expect(memberships[0]!.tenantId).toBe(tenantA.id);
    const blob = JSON.stringify(res.body);
    expect(blob).not.toContain(tenantB.id);
    expect(blob).not.toContain(tenantB.name);
    assertOnlyOwnMemberships(res.body);
  });

  it('başka kurumun (B) yöneticisi kişinin verisini dışa aktaramaz → 404, üyelik dönmez', async () => {
    const { accessToken } = await loginAs(http, adminB.email, adminB.rawPassword);
    const res = await http
      .get(`/api/users/${person.id}/export`)
      .set(tenantHeaders(tenantB.id, accessToken))
      .expect(404);
    expect(res.body).not.toHaveProperty('memberships');
    expect(res.body).not.toHaveProperty('profile');
  });

  it('misafir üye olduğu kurumun (B) oturumunda /me/data-export → 200, iki üyelik (500 değil)', async () => {
    // Kişinin ev kurumu A; B'de MENTOR üyeliği var. B bağlamında oturum anahtarı.
    const token = signToken({ sub: person.id, tenantId: tenantB.id, role: 'MENTOR', fullName: person.fullName });
    const res = await http.get('/api/me/data-export').set(tenantHeaders(tenantB.id, token)).expect(200);
    expect(res.body.userId).toBe(person.id);
    expect(res.body.profile.email).toBe(person.email);
    assertBothMemberships(res.body.memberships);
    assertOnlyOwnMemberships(res.body);

    // Aynı kurumda /users/<kendi id>/export da kendi isteği → iki üyelik.
    const own = await http
      .get(`/api/users/${person.id}/export`)
      .set(tenantHeaders(tenantB.id, token))
      .expect(200);
    assertBothMemberships(own.body.memberships);
  });

  it('kurum filtresinin aşılması başka kişi için kullanılamaz: aynı kurumdaki üye → 403, veri yok', async () => {
    const { accessToken } = await loginAs(http, other.email, other.rawPassword);
    const res = await http
      .get(`/api/users/${person.id}/export`)
      .set(tenantHeaders(tenantA.id, accessToken))
      .expect(403);
    expect(res.body).not.toHaveProperty('memberships');
    expect(res.body).not.toHaveProperty('profile');
    expect(JSON.stringify(res.body)).not.toContain(tenantB.id);
  });
});
