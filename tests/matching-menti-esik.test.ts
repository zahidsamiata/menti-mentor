/**
 * PS-A4 · KARAR-6 ek(1) — menti kendisine UYGUN OLMAYAN mentörü listede görmesin.
 *
 * `rankMentorsForMenti` (menti → mentör yönü) daha önce HİÇ eşik uygulamıyordu; ham liste
 * `?limit=100` ile gelirdi. Bu dosya, `rankMentisForMentor` (mentör → menti) tarafındaki
 * `tenant.minMatchScoreThreshold` davranışının SİMETRİĞİNİ doğrular — sabit sayı YOK,
 * taban kurumun kendi barajıdır.
 *
 * Skor kurgusu (varsayılan ağırlık sektör %60 / DISC %40, DISC_COMPATIBILITY matrisi):
 *   - menti: discType 'D', sectorTags ['t1','t2']
 *   - "dusuk" aday: discType 'D', sectorTags ['t1']  → sektör 50 + DISC(D→D=60) → totalScore 54
 *   - "yuksek" aday: discType 'C', sectorTags ['t1'] → sektör 50 + DISC(C→D=85) → totalScore 64
 * 60 barajıyla 54 < 60 < 64 → net bir "altında/üstünde" ayrımı verir.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { agent, loginAs, tenantHeaders, type TestAgent } from './helpers/request.js';
import { cleanDb, testPrisma } from './helpers/db.js';
import { createTenant, createMentor, createMenti } from './helpers/factories.js';
import type { Tenant } from '@prisma/client';

type MentorMatchItem = { mentorId: string; matchScore: number };

async function setThreshold(tenant: Tenant, value: number): Promise<void> {
  await testPrisma.tenant.update({ where: { id: tenant.id }, data: { minMatchScoreThreshold: value } });
}

describe('PS-A4 · menti → mentör alt uyum eşiği (KARAR-6 ek(1))', () => {
  let http: TestAgent;
  let tenant: Tenant;

  beforeEach(async () => {
    await cleanDb();
    http = agent();
    tenant = await createTenant();
  });

  async function seedMentiAndCandidates() {
    const menti = await createMenti(tenant.id, { discType: 'D', sectorTags: ['t1', 't2'] });
    const dusuk  = await createMentor(tenant.id, { discType: 'D', sectorTags: ['t1'] }); // totalScore 54
    const yuksek = await createMentor(tenant.id, { discType: 'C', sectorTags: ['t1'] }); // totalScore 64
    return { menti, dusuk, yuksek };
  }

  async function mentorMatchesOf(
    menti: { id: string; email: string; rawPassword: string },
    query = '',
  ): Promise<MentorMatchItem[]> {
    const { accessToken } = await loginAs(http, menti.email, menti.rawPassword);
    const res = await http
      .get(`/api/mentis/${menti.id}/mentor-matches${query}`)
      .set(tenantHeaders(tenant.id, accessToken))
      .expect(200);
    return (res.body as { items: MentorMatchItem[] }).items;
  }

  it('eşik altındaki mentör menti listesinde yok (eşik 60 → skoru 54 olan yok, 64 olan var)', async () => {
    await setThreshold(tenant, 60);
    const { menti, dusuk, yuksek } = await seedMentiAndCandidates();

    const ids = (await mentorMatchesOf(menti)).map((i) => i.mentorId);
    expect(ids).not.toContain(dusuk.id);
    expect(ids).toContain(yuksek.id);
  });

  it('kurum eşiği değişince liste değişir — sabit sayı YOK, kurumun kendi ayarı geçerli', async () => {
    await setThreshold(tenant, 60);
    const { menti, dusuk, yuksek } = await seedMentiAndCandidates();

    const idsHighThreshold = (await mentorMatchesOf(menti)).map((i) => i.mentorId);
    expect(idsHighThreshold).not.toContain(dusuk.id);
    expect(idsHighThreshold).toContain(yuksek.id);

    await setThreshold(tenant, 40);
    const idsLowThreshold = (await mentorMatchesOf(menti)).map((i) => i.mentorId);
    expect(idsLowThreshold).toContain(dusuk.id);
    expect(idsLowThreshold).toContain(yuksek.id);

    expect(idsLowThreshold.length).toBeGreaterThan(idsHighThreshold.length);
  });

  it('fallback: hiç mentör eşiği geçmiyorsa (küçük/yeni kurum) deadlock yok — liste boş dönmez', async () => {
    // Kurum barajı gerçekçi hiçbir eşleşmenin geçemeyeceği kadar yüksek (mentör tarafındaki
    // level-3 kaçışıyla SİMETRİK senaryo, bkz. matching.ts rankMentisForMentor).
    await setThreshold(tenant, 90);
    const { menti, dusuk, yuksek } = await seedMentiAndCandidates();

    const ids = (await mentorMatchesOf(menti)).map((i) => i.mentorId);
    // PS-10: "uygun mentör yok" mesajı yalnız GERÇEKTEN mentör yokken görünmeli — baraj
    // yüzünden değil. Eşik kimseyi geçirmiyorsa atlanır, mevcut adaylar (soluk olsa bile) döner.
    expect(ids).toContain(dusuk.id);
    expect(ids).toContain(yuksek.id);
  });

  it('negatif: başka kurumun mentörü hiçbir durumda (fallback dahil) listede yok', async () => {
    await setThreshold(tenant, 90); // fallback tetikler — kaçış hâlinde bile izolasyon bozulmamalı
    const { menti } = await seedMentiAndCandidates();

    const otherTenant = await createTenant({ isSharedPoolActive: false });
    // Paylaşım yok; bu aday menti'nin kendi tenant'ından çok daha yüksek skor alırdı (94)
    // ama farklı kurumda olduğu için hiçbir koşulda görünmemeli.
    const foreignMentor = await createMentor(otherTenant.id, { discType: 'C', sectorTags: ['t1', 't2'] });

    const ids = (await mentorMatchesOf(menti)).map((i) => i.mentorId);
    expect(ids).not.toContain(foreignMentor.id);
  });

  it('negatif: istemci eşik parametresi gönderse de kurum barajı gevşemez (sunucu tenant değerini kullanır)', async () => {
    await setThreshold(tenant, 60);
    const { menti, dusuk, yuksek } = await seedMentiAndCandidates();

    // Route'ta böyle bir query alanı TANIMLI DEĞİL (MentorMatchQuerySchema yalnız `limit` alır) —
    // gönderilse de zod tarafından sessizce yok sayılır. Menti kendi eşiğini gevşetemez.
    const ids = (await mentorMatchesOf(menti, '?minMatchScore=0&minMatchScoreThreshold=0')).map((i) => i.mentorId);
    expect(ids).not.toContain(dusuk.id);
    expect(ids).toContain(yuksek.id);
  });
});
