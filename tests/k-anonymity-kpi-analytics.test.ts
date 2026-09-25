/**
 * V-05 — KPI ve platform kurum analizi k-anonimlik.
 * Eşiğin (3) altındaki grup/örnek yanıta girmez: küçük kurumda tek kişinin DISC tipi ya da
 * tek bir geri bildirim puanı okunamaz. Eşik ve üstü normal görünür.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { agent, tenantHeaders, type TestAgent } from './helpers/request.js';
import { cleanDb, testPrisma } from './helpers/db.js';
import { createTenant, createMentor, createMenti, createAdminUser } from './helpers/factories.js';
import { signToken, PLATFORM_AUDIENCE } from '../src/middleware/jwtAuth.js';
import type { User } from '@prisma/client';

function tokenFor(u: Pick<User, 'id' | 'tenantId' | 'role' | 'fullName'>): string {
  return signToken({ sub: u.id, tenantId: u.tenantId, role: u.role, fullName: u.fullName });
}
function platformCookie(): string {
  const token = signToken(
    { sub: 'platform-admin', tenantId: '__platform__', role: 'ADMIN', fullName: 'Platform Yöneticisi', isPlatformAdmin: true },
    { audience: PLATFORM_AUDIENCE },
  );
  return `platform_token=${encodeURIComponent(token)}`;
}

describe('V-05: platform kurum analizi — DISC dağılımı', () => {
  let http: TestAgent;
  beforeEach(async () => { await cleanDb(); http = agent(); });

  it('negatif: 3 kişiden az DISC grubu listede yok, toplam yalnız görünen gruplardan', async () => {
    const tenant = await createTenant();
    for (let i = 0; i < 4; i++) await createMenti(tenant.id, { discType: 'D' });
    await createMenti(tenant.id, { discType: 'I' }); // tek kişilik grup — görünmemeli

    const res = await http.get(`/api/platform/tenants/${tenant.id}/analytics`).set('Cookie', platformCookie()).expect(200);

    expect(res.body.discDistribution).toEqual([{ discType: 'D', count: 4 }]);
    expect(res.body.totalWithDisc).toBe(4);
    expect(res.body.suppressedGroups).toBe(1);
    expect(JSON.stringify(res.body.discDistribution)).not.toContain('"I"');
  });
});

describe('V-05: yönetici KPI — dönem NPS ortalaması', () => {
  let http: TestAgent;
  let tenantId: string;
  let admin: Awaited<ReturnType<typeof createAdminUser>>;
  let mentor: Awaited<ReturnType<typeof createMentor>>;

  beforeEach(async () => {
    await cleanDb();
    http = agent();
    const tenant = await createTenant();
    tenantId = tenant.id;
    admin = await createAdminUser(tenantId);
    mentor = await createMentor(tenantId);
  });

  async function addPhase3Log(npsScore: number) {
    const menti = await createMenti(tenantId);
    await testPrisma.feedbackLog.create({
      data: { tenantId, mentorId: mentor.id, mentiId: menti.id, phase: 3, starRating: 4, npsScore, goalAchieved: 'EVET' },
    });
  }

  it('negatif: 3 yanıttan az dönem için ortalama ve örnek sayısı gösterilmez', async () => {
    await addPhase3Log(9);
    await addPhase3Log(2);
    const res = await http.get('/api/admin/kpi').set(tenantHeaders(tenantId, tokenFor(admin))).expect(200);
    expect(res.body.stats.feedback.avgNpsByPhase.phase3).toEqual({ avgNps: null, sampleSize: 0 });
    expect(res.body.stats.feedback.successRate).toBeNull();
  });

  it('3 ve üzeri yanıtta ortalama görünür', async () => {
    await addPhase3Log(9);
    await addPhase3Log(6);
    await addPhase3Log(3);
    const res = await http.get('/api/admin/kpi').set(tenantHeaders(tenantId, tokenFor(admin))).expect(200);
    expect(res.body.stats.feedback.avgNpsByPhase.phase3).toEqual({ avgNps: 6, sampleSize: 3 });
  });
});
