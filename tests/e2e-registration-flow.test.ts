/**
 * UÇTAN UCA KAYIT AKIŞI — Faz 4 form turu (dördüncü adım: üç soru) sonrası.
 *
 * Zincir: kayıt → (admin onayı) → giriş → profil → DISC → arketip → ÜÇ SORU.
 *
 * ⚠️ BULGU (düzeltilmedi — test-setup gerçeği): `login` PENDING hesabı 403 blokluyor
 *    (authController) ve `register` token döndürmüyor → register→onboarding zinciri
 *    admin onayı gerektirir. Burada onay `testPrisma` ile SİMÜLE edilir (ürün kodu değişmez).
 *    FE _RegisterContent register sonrası doğrudan /onboarding'e push ediyor — PENDING
 *    kullanıcı token alamayacağı için bu bir tutarsızlık OLABİLİR → PO'ya not (bu tur düzeltilmez).
 *
 * ⚠️ S2/S3 zorunluluğu API'de DEĞİL FE'de: backend Zod dört alanı da .optional() tanımlar
 *    (§10.2 EK2, PO kararı) → API boş S2/S3'ü 200 kabul eder; zorunluluk ThreeQuestionsStep
 *    disabled mantığında (three-questions-step.test.tsx). Bu ayrım BİLİNÇLİDİR.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { agent, loginAs, tenantHeaders, type TestAgent } from './helpers/request.js';
import { cleanDb, testPrisma } from './helpers/db.js';
import { createTenant } from './helpers/factories.js';
import type { Tenant } from '@prisma/client';

const PW = 'Test1234!';
const DISC_ANSWERS = [1, 2, 3, 4, 5, 6, 7, 8].map((id) => ({ questionId: id, selectedOption: 'A' as const }));

/** Kayıt → (onay simülasyonu) → giriş; onboarding için token döner. */
async function registerApproveLogin(
  http: TestAgent,
  tenant: Tenant,
  email: string,
  role: 'MENTI' | 'MENTOR',
): Promise<string> {
  await http.post('/api/auth/register')
    .send({ email, password: PW, fullName: 'E2E User', role, tenantSlug: tenant.slug, kvkkConsent: true })
    .expect(201);
  // Admin onayı SİMÜLE (login PENDING'i 403 blokluyor; register token vermiyor).
  await testPrisma.user.update({ where: { email }, data: { approvalStatus: 'APPROVED' } });
  return (await loginAs(http, email, PW)).accessToken;
}

describe('E2E kayıt akışı — form turu sonrası', () => {
  let http: TestAgent;
  let tenant: Tenant;

  beforeEach(async () => {
    await cleanDb();
    http = agent();
    tenant = await createTenant();
  });

  it('SENARYO 1 — menti: kayıt→consent→profil→DISC→arketip→üç soru', async () => {
    const email = 'menti-e2e@test.local';

    // 1. KAYIT (KVKK+18 tek kutu) → User + Consent dual-write
    await http.post('/api/auth/register')
      .send({ email, password: PW, fullName: 'Menti E2E', role: 'MENTI', tenantSlug: tenant.slug, kvkkConsent: true })
      .expect(201);

    const u0 = await testPrisma.user.findUnique({ where: { email }, select: { id: true, kvkkConsentAt: true } });
    expect(u0?.kvkkConsentAt).not.toBeNull();
    const consents = await testPrisma.consent.findMany({ where: { userId: u0!.id } });
    expect(consents).toHaveLength(2);
    expect(new Set(consents.map((c) => c.type))).toEqual(new Set(['AYDINLATMA', 'ACIK_RIZA']));
    expect(consents.every((c) => c.source === 'FORM')).toBe(true);

    // Onay + giriş
    await testPrisma.user.update({ where: { email }, data: { approvalStatus: 'APPROVED' } });
    const token = (await loginAs(http, email, PW)).accessToken;
    const h = tenantHeaders(tenant.id, token);

    // 2. PROFİL → expectationCategories
    await http.post('/api/users/profile/complete').set(h)
      .send({ sector: 'Teknoloji', skills: ['React'], experienceYears: 3, expectationCategories: ['KARIYER_YONLENDIRME'] })
      .expect(200);
    const uProfile = await testPrisma.user.findUnique({ where: { id: u0!.id }, select: { expectationCategories: true } });
    expect(uProfile!.expectationCategories).toContain('KARIYER_YONLENDIRME');

    // 3. DISC → discVector + UserProfile
    const disc = await http.post('/api/users/disc/submit').set(h).send({ answers: DISC_ANSWERS }).expect(200);
    const uDisc = await testPrisma.user.findUnique({ where: { id: u0!.id }, select: { discType: true, discVector: true } });
    expect(uDisc!.discType).not.toBeNull();
    expect(uDisc!.discVector).not.toBeNull();
    const profileRow = await testPrisma.userProfile.findUnique({ where: { userId: u0!.id } });
    expect(profileRow).not.toBeNull();

    // 4. ARKETİP
    expect(disc.body.resultCard.archetype).toBeTruthy();

    // 5. ÜÇ SORU
    // (a) S1 BOŞ gönderilebilir (opsiyonel) → 200
    await http.patch('/api/users/me/matching-preferences').set(h)
      .send({ supportApproach: 'BIRLIKTE_DUSUNME', priorityValue: 'LEARNING' }).expect(200);
    // (b) S2 boş → API 200 (zorunluluk FE'de, API'de DEĞİL — EK2)
    await http.patch('/api/users/me/matching-preferences').set(h)
      .send({ mentiNeeds: ['KARAR_VEREMIYORUM'], priorityValue: 'RESULT' }).expect(200);
    // (c) Tam geçerli gönderim → alanlar dolar
    await http.patch('/api/users/me/matching-preferences').set(h)
      .send({ mentiNeeds: ['KARAR_VEREMIYORUM', 'GUVENMIYORUM'], supportApproach: 'BIRLIKTE_DUSUNME', priorityValue: 'LEARNING' })
      .expect(200);
    const uFinal = await testPrisma.user.findUnique({
      where: { id: u0!.id },
      select: { mentiNeeds: true, supportApproach: true, priorityValue: true },
    });
    expect(uFinal!.mentiNeeds).toEqual(['KARAR_VEREMIYORUM', 'GUVENMIYORUM']);
    expect(uFinal!.supportApproach).toBe('BIRLIKTE_DUSUNME');
    expect(uFinal!.priorityValue).toBe('LEARNING');

    // Rol uyumu: menti mentorStrengths gönderemez → 403
    await http.patch('/api/users/me/matching-preferences').set(h)
      .send({ mentorStrengths: ['YON_BULMA'] }).expect(403);
  });

  it('SENARYO 2 — mentör: interactionStyle sorulmuyor + rol uyumu', async () => {
    const email = 'mentor-e2e@test.local';
    const token = await registerApproveLogin(http, tenant, email, 'MENTOR');
    const h = tenantHeaders(tenant.id, token);

    // Profil (mentör: zaman kotası) — interactionStyle GÖNDERİLMEZ (soru kaldırıldı)
    await http.post('/api/users/profile/complete').set(h)
      .send({ sector: 'Finans', skills: ['Liderlik'], experienceYears: 10, timeCommitment: 'AYDA_2_3' })
      .expect(200);

    await http.post('/api/users/disc/submit').set(h).send({ answers: DISC_ANSWERS }).expect(200);

    // Üç soru: mentorStrengths + S2 + S3
    await http.patch('/api/users/me/matching-preferences').set(h)
      .send({ mentorStrengths: ['YON_BULMA', 'AG_KURMA'], supportApproach: 'YOL_GOSTERME', priorityValue: 'RESULT' })
      .expect(200);

    const u = await testPrisma.user.findUnique({
      where: { email },
      select: { mentorStrengths: true, supportApproach: true, priorityValue: true, interactionStyle: true },
    });
    expect(u!.mentorStrengths).toEqual(['YON_BULMA', 'AG_KURMA']);
    expect(u!.supportApproach).toBe('YOL_GOSTERME');
    expect(u!.priorityValue).toBe('RESULT');
    // ⭐ interactionStyle sütunu DURUYOR ama NULL (soru sorulmadı, dokunulmadı)
    expect(u!.interactionStyle).toBeNull();

    // S1 (mentorStrengths) boş bırakılabilir → 200
    await http.patch('/api/users/me/matching-preferences').set(h)
      .send({ supportApproach: 'DINLEME', priorityValue: 'PERSPECTIVE' }).expect(200);

    // Rol uyumu: mentör mentiNeeds gönderemez → 403
    await http.patch('/api/users/me/matching-preferences').set(h)
      .send({ mentiNeeds: ['KARAR_VEREMIYORUM'] }).expect(403);
  });

  it('SENARYO 3 — regresyon: mükerrer e-posta + yarım kayıt', async () => {
    const email = 'dup-e2e@test.local';

    // İlk kayıt
    await http.post('/api/auth/register')
      .send({ email, password: PW, fullName: 'Dup One', role: 'MENTI', tenantSlug: tenant.slug, kvkkConsent: true })
      .expect(201);
    // İkinci kayıt aynı e-posta — enumeration-safe (başarı döner) ama İKİNCİ user OLUŞMAZ
    await http.post('/api/auth/register')
      .send({ email, password: PW, fullName: 'Dup Two', role: 'MENTI', tenantSlug: tenant.slug, kvkkConsent: true })
      .expect(201);
    const count = await testPrisma.user.count({ where: { email } });
    expect(count).toBe(1);

    // Yarım kayıt: onboarding hiç yapılmadan User VAR + üç-soru alanları BOŞ (bozulma yok)
    const half = await testPrisma.user.findUnique({
      where: { email },
      select: { id: true, mentiNeeds: true, supportApproach: true, priorityValue: true },
    });
    expect(half).not.toBeNull();
    expect(half!.mentiNeeds).toEqual([]);
    expect(half!.supportApproach).toBeNull();
    expect(half!.priorityValue).toBeNull();
  });
});
