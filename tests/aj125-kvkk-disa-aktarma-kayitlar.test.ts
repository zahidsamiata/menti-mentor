/**
 * AJ-125 — KVKK "verilerimi indir" çıktısında görüşme geri bildirimi (FeedbackLog) ve eşleşme
 * isteği (MatchRequest) kayıtları TÜM kurumlardan gelir (entegrasyon).
 *
 * NEDEN: iki model kurum filtreli (src/db.ts TENANT_SCOPED); önceden üst düzey findMany yalnız
 * isteğin kurumundaki satırları döndürüyordu → misafir üye olunan kurumdaki kayıtlar kişinin kendi
 * dışa aktarımında çıkmıyordu (KVKK Md.11 erişim hakkı eksik). Kaynak: 7b #296 madde 5.
 *
 * Ölçüt:
 *  - Kişi kendi verisini indirince (ev kurumu oturumu VE misafir kurum oturumu) iki kurumdaki
 *    kendi geri bildirim + eşleşme isteği kayıtları çıktıda;
 *  - yalnız kişinin taraf olduğu satırlar (başka kişilerin arasındaki kayıt yok);
 *  - alan kümesi değişmedi (karşı tarafın kimliği/kişisel verisi eklenmedi);
 *  - kurum yöneticisi başkasını dışa aktarırken yalnız KENDİ kurumundaki kayıtları görür (değişmedi).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { cleanDb, testPrisma } from './helpers/db.js';
import { createTenant, createUser } from './helpers/factories.js';
import { agent, loginAs, tenantHeaders, type TestAgent } from './helpers/request.js';
import { signToken } from '../src/middleware/jwtAuth.js';

type FeedbackLogOut = { difficulty: string | null; [k: string]: unknown };
type MatchRequestOut = { targetId: string; [k: string]: unknown };
type ExportBody = { feedbackLogs: FeedbackLogOut[]; matchRequests: MatchRequestOut[] };

const FB_A = 'aj125-geri-bildirim-kurum-a';
const FB_B = 'aj125-geri-bildirim-kurum-b';
const FB_FOREIGN = 'aj125-geri-bildirim-yabanci';
const REQ_A = 'aj125-ilan-kurum-a';
const REQ_B = 'aj125-ilan-kurum-b';
const REQ_FOREIGN = 'aj125-ilan-yabanci';

describe('AJ-125 — dışa aktarmada tüm kurumlardaki geri bildirim + eşleşme istekleri', () => {
  let http: TestAgent;
  let tenantA: { id: string };
  let tenantB: { id: string };
  let person: Awaited<ReturnType<typeof createUser>>;
  let mentorA: Awaited<ReturnType<typeof createUser>>;
  let mentiB: Awaited<ReturnType<typeof createUser>>;
  let adminA: Awaited<ReturnType<typeof createUser>>;

  beforeEach(async () => {
    await cleanDb();
    http = agent();
    tenantA = await createTenant({ name: 'Kurum Alfa AJ125' });
    tenantB = await createTenant({ name: 'Kurum Beta AJ125' });

    // Kişi: ev kurumu A'da MENTI, B'de misafir MENTOR üyeliği.
    person = await createUser({ tenantId: tenantA.id, role: 'MENTI' });
    await testPrisma.tenantMembership.create({
      data: { userId: person.id, tenantId: tenantB.id, role: 'MENTOR', isActive: true },
    });
    mentorA = await createUser({ tenantId: tenantA.id, role: 'MENTOR' });
    mentiB = await createUser({ tenantId: tenantB.id, role: 'MENTI' });
    adminA = await createUser({ tenantId: tenantA.id, role: 'ADMIN' });

    await testPrisma.feedbackLog.createMany({
      data: [
        // A'da kişi MENTİ tarafında
        { tenantId: tenantA.id, mentorId: mentorA.id, mentiId: person.id, phase: 1, starRating: 4, difficulty: FB_A },
        // B'de kişi MENTOR tarafında (misafir kurum)
        { tenantId: tenantB.id, mentorId: person.id, mentiId: mentiB.id, phase: 2, starRating: 5, difficulty: FB_B },
        // Kişinin taraf OLMADIĞI kayıt — çıktıda olmamalı
        { tenantId: tenantB.id, mentorId: mentorA.id, mentiId: mentiB.id, phase: 3, starRating: 2, difficulty: FB_FOREIGN },
      ],
    });
    await testPrisma.matchRequest.createMany({
      data: [
        { tenantId: tenantA.id, requesterUserId: person.id, targetType: 'JOB_LISTING', targetId: REQ_A },
        { tenantId: tenantB.id, requesterUserId: person.id, targetType: 'JOB_LISTING', targetId: REQ_B },
        { tenantId: tenantB.id, requesterUserId: mentiB.id, targetType: 'JOB_LISTING', targetId: REQ_FOREIGN },
      ],
    });
  });

  function assertFieldSetUnchanged(body: ExportBody) {
    // Alan kümesi yönetici yolu ve önceki çıktı ile aynı — karşı taraf kimliği/tenantId eklenmedi.
    for (const f of body.feedbackLogs) {
      expect(Object.keys(f).sort()).toEqual(['createdAt', 'difficulty', 'npsScore', 'phase', 'starRating']);
    }
    for (const r of body.matchRequests) {
      expect(Object.keys(r).sort()).toEqual(['createdAt', 'targetId', 'targetType']);
    }
    const blob = JSON.stringify({ f: body.feedbackLogs, r: body.matchRequests });
    expect(blob).not.toContain(mentorA.id);
    expect(blob).not.toContain(mentiB.id);
    expect(blob).not.toContain(adminA.id);
  }

  function assertAllOwnRecords(body: ExportBody) {
    const difficulties = body.feedbackLogs.map((f) => f.difficulty).sort();
    expect(difficulties).toEqual([FB_A, FB_B]);
    const targets = body.matchRequests.map((r) => r.targetId).sort();
    expect(targets).toEqual([REQ_A, REQ_B]);
    expect(JSON.stringify(body)).not.toContain(FB_FOREIGN);
    expect(JSON.stringify(body)).not.toContain(REQ_FOREIGN);
    assertFieldSetUnchanged(body);
  }

  it('ev kurumu (A) oturumunda /me/data-export → iki kurumdaki kendi kayıtları, başkasınınki yok', async () => {
    const { accessToken } = await loginAs(http, person.email, person.rawPassword);
    const res = await http.get('/api/me/data-export').set(tenantHeaders(tenantA.id, accessToken)).expect(200);
    assertAllOwnRecords(res.body as ExportBody);

    const own = await http
      .get(`/api/users/${person.id}/export`)
      .set(tenantHeaders(tenantA.id, accessToken))
      .expect(200);
    assertAllOwnRecords(own.body as ExportBody);
  });

  it('misafir kurum (B) oturumunda /me/data-export → iki kurumdaki kendi kayıtları', async () => {
    const token = signToken({ sub: person.id, tenantId: tenantB.id, role: 'MENTOR', fullName: person.fullName });
    const res = await http.get('/api/me/data-export').set(tenantHeaders(tenantB.id, token)).expect(200);
    expect(res.body.userId).toBe(person.id);
    assertAllOwnRecords(res.body as ExportBody);
  });

  it('kurum A yöneticisi kişiyi dışa aktarınca yalnız A kayıtları görünür (değişmedi)', async () => {
    const { accessToken } = await loginAs(http, adminA.email, adminA.rawPassword);
    const res = await http
      .get(`/api/users/${person.id}/export`)
      .set(tenantHeaders(tenantA.id, accessToken))
      .expect(200);
    const body = res.body as ExportBody;
    expect(body.feedbackLogs.map((f) => f.difficulty)).toEqual([FB_A]);
    expect(body.matchRequests.map((r) => r.targetId)).toEqual([REQ_A]);
    const blob = JSON.stringify(body);
    expect(blob).not.toContain(FB_B);
    expect(blob).not.toContain(REQ_B);
    expect(blob).not.toContain(tenantB.id);
    assertFieldSetUnchanged(body);
  });
});
