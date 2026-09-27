/**
 * AJ-19 — K5-Y3'ün SON parti negatif testleri.
 *
 * Kaynak: docs/raporlar/kesif/negatif-test-boslugu-2026-09-26.md — önceki altı parti
 * (`y3-yetki-kurum-izolasyonu.test.ts`, `aj04-negatif-test-devami.test.ts`,
 * `aj13-negatif-test-2-parti.test.ts`, `aj15-negatif-test-3-parti.test.ts`,
 * `aj16-negatif-test-4-parti.test.ts`, `aj17-elle-cron-kurum-kapsami.test.ts`,
 * `aj18-negatif-test-5-parti.test.ts`) raporun 134 satırının büyük çoğunluğunu kapattı.
 *
 * Bu dosya öncesinde HER kalan uç için `grep -rn <yol> tests/` ile TÜM test dosyaları
 * tarandı (yalnız önceki yedi parti değil). Bu tarama, raporun 2026-09-26 fotoğrafından
 * SONRA yazılmış veya raporun sezgisel taramasının kaçırdığı GERÇEK kapsamayı ortaya
 * çıkardı — ör. `compute-profile-idor.test.ts` (Y5), `meeting-reject-notify.test.ts`
 * (P-05), `question-global-guard.test.ts` (Y6), `checkin-visibility.test.ts` (GV-04),
 * `analytics-idor.test.ts` (yalnız tek-tenant), `aj15-negatif-test-3-parti.test.ts:485`
 * (GET /api/users liste — admin listesiyle KARIŞTIRILMAMALI, ayrı uç). Bunlar PR
 * açıklamasındaki "başka dosyada" sütununa taşındı; burada TEKRAR yazılmadı.
 *
 * Kalan GERÇEK boşluklar (bu dosyada kapatılır):
 *   - GET  /api/analytics/:userId              (a)+(c)  — analytics-idor.test.ts yalnız tek-tenant
 *   - GET  /api/conversations/:id/messages      (a)+(c)  — conversation.test.ts yalnız aynı-tenant
 *   - POST /api/conversations/:id/messages      (a)+(c)
 *   - POST /api/conversations/:id/read          (a)+(c)
 *   - POST /api/questions/respond (toplu)       (c)      — authorization.test.ts yalnız (a)
 *   - POST /api/questions/:questionId/respond   (c)      — authorization.test.ts yalnız (a)
 *   - GET  /api/tenants/:slug/preview           (a)+(b)+(c) — hiç test yok
 *
 * Desen (önceki partilerle birebir):
 *   (a) oturumsuz → 401
 *   (b) yanlış rol → 403
 *   (c) BAŞKA KURUMUN kaynağı/verisi → 403/404 VE kaynak/veri DEĞİŞMEZ (DB'den okunarak)
 *
 * Kaynak koda dokunulmadı; yalnız test eklendi. Beklenen kodlar controller/servis
 * OKUNARAK alındı (tahmin değil) — ilgili dosya/satır her blokta yorumda belirtilir.
 *
 * Raporun geri kalan hücreleri için (PR açıklamasında ayrıntı): büyük bir kısmı
 * "anlamsız" — ya (i) uç kendi oturumundaki kullanıcıyı işler ve gövdede/parametrede
 * başka bir kurumun kaynağına referans YOKTUR (self-servis: /me/*, /users/me/*,
 * /auth/reconsent, /scoring/certification/*), ya da (ii) tenantId DAİMA oturumdan
 * zorlanır ve gövdede tenant/kaynak enjekte edilemez (POST /clubs, /job-listings,
 * /admin/learning-journey/stages, PATCH /scoring/certification/topics), ya da (iii)
 * kaynak ADMIN-yalnız bir eylemdir ve "d" (aynı kurum IDOR) rol testinden (b) farklı bir
 * sonuç üretmez (ADMIN kendi kurumundaki HERHANGİ bir kaydı hedefleyebilir by design —
 * /admin/users/:id/approve|reject|request-correction|rematch|nudge, /admin/tags/:id/*,
 * /admin/visibility-optin/:id/confirm, /questions/:id PATCH|DELETE|hide|unhide,
 * /meetings/orientation-lock/:userId, /tenants/:id/settings|onboarding|invitations*).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { agent, tenantHeaders, type TestAgent } from './helpers/request.js';
import { cleanDb, testPrisma } from './helpers/db.js';
import {
  createTenant,
  createAdminUser,
  createMentor,
  createMenti,
} from './helpers/factories.js';
import { signToken } from '../src/middleware/jwtAuth.js';
import type { User, Tenant } from '@prisma/client';

type SeededUser = Awaited<ReturnType<typeof createMenti>>;

function tokenFor(u: Pick<User, 'id' | 'tenantId' | 'role' | 'fullName'>): string {
  return signToken({ sub: u.id, tenantId: u.tenantId, role: u.role, fullName: u.fullName });
}

/** İstek sahibinin kendi kurumu başlığı + kendi token'ı. */
function authAs(u: Pick<User, 'id' | 'tenantId' | 'role' | 'fullName'>): Record<string, string> {
  return tenantHeaders(u.tenantId, tokenFor(u));
}

describe('AJ-19 negatif test kovası — son parti', () => {
  let http: TestAgent;
  let tenantA: Tenant;
  let tenantB: Tenant;
  let adminB: SeededUser;
  let mentorA: SeededUser;
  let mentiA: SeededUser;

  beforeEach(async () => {
    await cleanDb();
    http = agent();
    tenantA = await createTenant();
    tenantB = await createTenant();
    adminB = await createAdminUser(tenantB.id);
    mentorA = await createMentor(tenantA.id);
    mentiA = await createMenti(tenantA.id);
  });

  // ─── AJ19-1: GET /api/analytics/:userId (a)+(c) ────────────────────────────
  // analyticsController.ts:getAnalytics — requireSelfOrAdmin ADMIN rolünü tenant
  // bakmaksızın geçirir; asıl kurum izolasyonu controller'daki
  // `findFirst({ id: userId, tenantId: req.tenant.tenantId })`dedir (satır 10-13).
  // analytics-idor.test.ts YALNIZ tek-tenant (self/peer/admin) senaryosunu kapsıyor;
  // (a) ve çapraz-kurum admin (c) hiç test edilmemiş.
  describe('AJ19-1: GET /api/analytics/:userId', () => {
    it('(a) oturumsuz → 401', async () => {
      await http.get(`/api/analytics/${mentiA.id}`).set(tenantHeaders(tenantA.id)).expect(401);
    });

    it('(c) başka kurumun yöneticisi → 404, ham DISC verisi dönmez', async () => {
      await testPrisma.user.update({
        where: { id: mentiA.id },
        data: { discVector: { D: 0.8, I: 0.1, S: 0.05, C: 0.05, confidence: 0.9 } },
      });
      const res = await http.get(`/api/analytics/${mentiA.id}`).set(authAs(adminB)).expect(404);
      expect(res.body.error).toBe('NOT_FOUND');
      expect(JSON.stringify(res.body)).not.toContain('0.8');
    });
  });

  // ─── AJ19-2: konuşma uçlarında çapraz-kurum erişimi (a)+(c) ────────────────
  // conversationController.ts: getMessages canAccess() (satır 68-72) katılımcı VEYA
  // AYNI-tenant admin'e izin verir — farklı tenant admin'i (c) 404 alır (kod okunarak).
  // sendMessage/markRead ise yalnız katılımcıya izin verir (admin dahi değil; satır
  // 222-225, 388-390) — farklı-tenant admin de "YABANCI" ile AYNI 404 yolunu izler,
  // ama bu spesifik senaryo (cross-tenant, participant DEĞİL, admin) hiçbir dosyada
  // AÇIKÇA test edilmemiş. conversation.test.ts yalnız aynı-tenant (yabancı/admin)
  // senaryolarını kapsıyor; (a) 401 hiçbir uçta test edilmemiş.
  describe('AJ19-2: GET/POST /api/conversations/:id/* — çapraz kurum + oturumsuz', () => {
    let convoId: string;

    beforeEach(async () => {
      const convo = await testPrisma.conversation.create({
        data: { tenantId: tenantA.id, mentorUserId: mentorA.id, mentiUserId: mentiA.id },
      });
      convoId = convo.id;
      await testPrisma.message.create({
        data: { conversationId: convoId, senderUserId: mentiA.id, content: 'İlk mesaj — gizli içerik.' },
      });
    });

    it('GET /:id/messages (a) oturumsuz → 401', async () => {
      await http.get(`/api/conversations/${convoId}/messages`).set(tenantHeaders(tenantA.id)).expect(401);
    });

    it('GET /:id/messages (c) başka kurumun yöneticisi (katılımcı değil) → 404, mesaj sızmaz', async () => {
      const res = await http.get(`/api/conversations/${convoId}/messages`).set(authAs(adminB)).expect(404);
      expect(res.body.error).toBe('NOT_FOUND');
      expect(JSON.stringify(res.body)).not.toContain('gizli içerik');
    });

    it('POST /:id/messages (a) oturumsuz → 401; mesaj oluşmaz', async () => {
      await http
        .post(`/api/conversations/${convoId}/messages`)
        .set(tenantHeaders(tenantA.id))
        .send({ message: 'sızma denemesi' })
        .expect(401);
      const count = await testPrisma.message.count({ where: { conversationId: convoId } });
      expect(count).toBe(1);
    });

    it('POST /:id/messages (c) başka kurumun yöneticisi → 404; mesaj oluşmaz', async () => {
      await http
        .post(`/api/conversations/${convoId}/messages`)
        .set(authAs(adminB))
        .send({ message: 'başka kurumun admini yazıyor' })
        .expect(404);
      const count = await testPrisma.message.count({ where: { conversationId: convoId } });
      expect(count).toBe(1);
    });

    it('POST /:id/read (a) oturumsuz → 401; okundu bilgisi değişmez', async () => {
      const before = await testPrisma.conversation.findUnique({ where: { id: convoId } });
      await http.post(`/api/conversations/${convoId}/read`).set(tenantHeaders(tenantA.id)).expect(401);
      const after = await testPrisma.conversation.findUnique({ where: { id: convoId } });
      expect(after?.mentorLastReadAt).toEqual(before?.mentorLastReadAt);
      expect(after?.mentiLastReadAt).toEqual(before?.mentiLastReadAt);
    });

    it('POST /:id/read (c) başka kurumun yöneticisi → 404; okundu bilgisi değişmez', async () => {
      const before = await testPrisma.conversation.findUnique({ where: { id: convoId } });
      await http.post(`/api/conversations/${convoId}/read`).set(authAs(adminB)).expect(404);
      const after = await testPrisma.conversation.findUnique({ where: { id: convoId } });
      expect(after?.mentorLastReadAt).toEqual(before?.mentorLastReadAt);
      expect(after?.mentiLastReadAt).toEqual(before?.mentiLastReadAt);
    });
  });

  // ─── AJ19-3/4: sorulara yanıt — çapraz kurum soru ID'si (c) ────────────────
  // questionService.ts:validateQuestionIds (satır 236-250) — tenant-scoped (global
  // olmayan) bir soru yalnız KENDİ tenant'ından erişilebilir (`OR: [{tenantId:null},
  // {tenantId}]`). authorization.test.ts yalnız (a) oturumsuz-401'i kapsıyor; başka
  // kurumun tenant-scoped sorusuna cevap verilmeye çalışılması (c) hiç test edilmemiş.
  describe('AJ19-3/4: POST /api/questions/respond + /:questionId/respond (c)', () => {
    let foreignQuestionId: string;

    beforeEach(async () => {
      const q = await testPrisma.question.create({
        data: {
          text: 'Tenant B\'ye özel soru — tenant A bunu göremez/yanıtlayamaz.',
          type: 'CORE',
          discDimension: 'GENERAL',
          category: 'STK_CUSTOM',
          tenantId: tenantB.id,
          order: 1,
        },
      });
      foreignQuestionId = q.id;
    });

    it('POST /respond (toplu) — başka kurumun sorusuna cevap veremez → 400 GECERSIZ_SORU; kayıt oluşmaz', async () => {
      const res = await http
        .post('/api/questions/respond')
        .set(authAs(mentiA))
        .send({ responses: [{ questionId: foreignQuestionId, value: 4 }] })
        .expect(400);
      expect(res.body.error).toBe('GECERSIZ_SORU');
      const saved = await testPrisma.userResponse.findFirst({
        where: { userId: mentiA.id, questionId: foreignQuestionId },
      });
      expect(saved).toBeNull();
    });

    it('POST /:questionId/respond (tekil) — başka kurumun sorusuna cevap veremez → 404 SORU_BULUNAMADI; kayıt oluşmaz', async () => {
      const res = await http
        .post(`/api/questions/${foreignQuestionId}/respond`)
        .set(authAs(mentiA))
        .send({ value: 4 })
        .expect(404);
      expect(res.body.error).toBe('SORU_BULUNAMADI');
      const saved = await testPrisma.userResponse.findFirst({
        where: { userId: mentiA.id, questionId: foreignQuestionId },
      });
      expect(saved).toBeNull();
    });
  });

  // ─── AJ19-5: GET /api/tenants/:slug/preview (a)+(b)+(c) ────────────────────
  // selfServeController.ts:getTenantPreview (satır 474-499) — authenticateTenantAdmin
  // (JWT Bearer, X-Tenant-Id KULLANMAZ) + `payload.tenantId !== tenant.id` → 403
  // YETKI_YOK. Hiç HTTP testi bulunamadı (grep boş).
  describe('AJ19-5: GET /api/tenants/:slug/preview', () => {
    it('(a) oturumsuz (Bearer yok) → 401', async () => {
      const res = await http.get(`/api/tenants/${tenantA.slug}/preview`).expect(401);
      expect(res.body.error).toBe('KIMLIK_DOGRULANMADI');
    });

    it('(b) yanlış rol (MENTOR/MENTI) → 403 YETKI_YOK', async () => {
      const res = await http
        .get(`/api/tenants/${tenantA.slug}/preview`)
        .set('Authorization', `Bearer ${tokenFor(mentorA)}`)
        .expect(403);
      expect(res.body.error).toBe('YETKI_YOK');
    });

    it('(c) başka kurumun yöneticisi → 403 YETKI_YOK, DISC/persona verisi dönmez', async () => {
      const res = await http
        .get(`/api/tenants/${tenantA.slug}/preview`)
        .set('Authorization', `Bearer ${tokenFor(adminB)}`)
        .expect(403);
      expect(res.body.error).toBe('YETKI_YOK');
      expect(res.body.preview).toBeUndefined();
    });
  });
});
