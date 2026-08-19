/**
 * #37 — Kurum (STK) başvurusu "düzeltme iste" akışı.
 *
 * Kapsam:
 *  - Platform admin düzeltme ister → CORRECTION_REQUESTED + correctionNote (verificationNote EZİLMEZ).
 *  - Yetki: yalnız platform admin (cookie yoksa 401).
 *  - Onaylı kuruma düzeltme istenmez (409). Kısa not reddedilir (400).
 *  - Kurum admini tekrar gönderir → PENDING_REVIEW; correctionNote KORUNUR (geçmiş); IDOR yok.
 *  - getMe: correctionNote yalnız ADMIN'e döner, MENTI'ye null.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { agent, type TestAgent, loginAs, tenantHeaders } from './helpers/request.js';
import { cleanDb, testPrisma } from './helpers/db.js';
import { createTenant, createAdminUser, createUser } from './helpers/factories.js';
import { signToken, PLATFORM_AUDIENCE } from '../src/middleware/jwtAuth.js';

function makePlatformCookie(): string {
  const token = signToken(
    { sub: 'platform-admin', tenantId: '__platform__', role: 'ADMIN', fullName: 'Platform Yöneticisi', isPlatformAdmin: true },
    { audience: PLATFORM_AUDIENCE },
  );
  return `platform_token=${encodeURIComponent(token)}`;
}

const EVIDENCE = JSON.stringify({ institutionRole: 'Kulüp Başkanı', proof: 'https://instagram.com/kulup' });

describe('#37 Platform admin: kurum düzeltme iste', () => {
  let http: TestAgent;

  beforeEach(async () => {
    await cleanDb();
    http = agent();
  });

  it('PENDING_REVIEW kuruma düzeltme iste → CORRECTION_REQUESTED + not; verificationNote EZİLMEZ', async () => {
    const tenant = await createTenant({ verificationStatus: 'PENDING_REVIEW' });
    await testPrisma.tenant.update({ where: { id: tenant.id }, data: { verificationNote: EVIDENCE } });

    await http
      .post(`/api/platform/tenants/${tenant.id}/request-correction`)
      .set('Cookie', makePlatformCookie())
      .send({ note: 'Lütfen kurumsal e-posta veya resmi belge ekleyin.' })
      .expect(200);

    const after = await testPrisma.tenant.findUnique({ where: { id: tenant.id } });
    expect(after?.verificationStatus).toBe('CORRECTION_REQUESTED');
    expect(after?.correctionNote).toBe('Lütfen kurumsal e-posta veya resmi belge ekleyin.');
    expect(after?.verificationNote).toBe(EVIDENCE); // KANIT KORUNDU
  });

  it('onaylı kuruma düzeltme istenemez (409)', async () => {
    const tenant = await createTenant({ verificationStatus: 'APPROVED' });
    await http
      .post(`/api/platform/tenants/${tenant.id}/request-correction`)
      .set('Cookie', makePlatformCookie())
      .send({ note: 'Bir düzeltme notu metni.' })
      .expect(409);
  });

  it('çok kısa not reddedilir (400)', async () => {
    const tenant = await createTenant({ verificationStatus: 'PENDING_REVIEW' });
    await http
      .post(`/api/platform/tenants/${tenant.id}/request-correction`)
      .set('Cookie', makePlatformCookie())
      .send({ note: 'kısa' })
      .expect(400);
  });

  it('yetki: platform cookie olmadan 401', async () => {
    const tenant = await createTenant({ verificationStatus: 'PENDING_REVIEW' });
    await http
      .post(`/api/platform/tenants/${tenant.id}/request-correction`)
      .send({ note: 'Bir düzeltme notu metni.' })
      .expect(401);
  });
});

describe('#37 Kurum admini: düzeltme sonrası tekrar gönderim', () => {
  let http: TestAgent;

  beforeEach(async () => {
    await cleanDb();
    http = agent();
  });

  it('CORRECTION_REQUESTED → resubmit → PENDING_REVIEW; correctionNote KORUNUR; kanıt güncellenir', async () => {
    const tenant = await createTenant({ verificationStatus: 'CORRECTION_REQUESTED' });
    await testPrisma.tenant.update({
      where: { id: tenant.id },
      data:  { correctionNote: 'Belge ekleyin', verificationNote: EVIDENCE },
    });
    const admin = await createAdminUser(tenant.id);
    const { accessToken } = await loginAs(http, admin.email, admin.rawPassword);

    const res = await http
      .post('/api/tenants/self-serve/resubmit')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ institutionRole: 'Başkan', verificationNote: 'https://yeni-belge.org/kanit' })
      .expect(200);

    expect(res.body.verificationStatus).toBe('PENDING_REVIEW');

    const after = await testPrisma.tenant.findUnique({ where: { id: tenant.id } });
    expect(after?.verificationStatus).toBe('PENDING_REVIEW');
    expect(after?.correctionNote).toBe('Belge ekleyin'); // GEÇMİŞ KORUNDU (silinmedi)
    expect(after?.verificationNote).toContain('yeni-belge.org'); // güncel kanıt yazıldı
  });

  it('düzeltme beklenmeyen durumda resubmit reddedilir (409)', async () => {
    const tenant = await createTenant({ verificationStatus: 'PENDING_REVIEW' });
    const admin = await createAdminUser(tenant.id);
    const { accessToken } = await loginAs(http, admin.email, admin.rawPassword);

    await http
      .post('/api/tenants/self-serve/resubmit')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ verificationNote: 'https://belge.org' })
      .expect(409);
  });

  it('IDOR yok: admin yalnız KENDİ kurumunu tekrar gönderir (başka kurum etkilenmez)', async () => {
    const mine = await createTenant({ verificationStatus: 'CORRECTION_REQUESTED' });
    const other = await createTenant({ verificationStatus: 'CORRECTION_REQUESTED' });
    const admin = await createAdminUser(mine.id);
    const { accessToken } = await loginAs(http, admin.email, admin.rawPassword);

    await http
      .post('/api/tenants/self-serve/resubmit')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ verificationNote: 'https://belge.org/mine' })
      .expect(200);

    // Kendi kurumu PENDING_REVIEW; diğer kurum DEĞİŞMEDİ
    const mineAfter = await testPrisma.tenant.findUnique({ where: { id: mine.id } });
    const otherAfter = await testPrisma.tenant.findUnique({ where: { id: other.id } });
    expect(mineAfter?.verificationStatus).toBe('PENDING_REVIEW');
    expect(otherAfter?.verificationStatus).toBe('CORRECTION_REQUESTED');
  });
});

describe('#37 getMe: kurum düzeltme notu görünürlüğü', () => {
  let http: TestAgent;

  beforeEach(async () => {
    await cleanDb();
    http = agent();
  });

  it('ADMIN correctionNote görür; MENTI görmez (null)', async () => {
    const tenant = await createTenant({ verificationStatus: 'CORRECTION_REQUESTED' });
    await testPrisma.tenant.update({ where: { id: tenant.id }, data: { correctionNote: 'Belge ekleyin' } });
    const admin = await createAdminUser(tenant.id);
    const menti = await createUser({ tenantId: tenant.id, role: 'MENTI' });

    const adminTok = await loginAs(http, admin.email, admin.rawPassword);
    const adminMe = await http.get('/api/auth/me').set(tenantHeaders(tenant.id, adminTok.accessToken)).expect(200);
    expect(adminMe.body.tenant.verificationStatus).toBe('CORRECTION_REQUESTED');
    expect(adminMe.body.tenant.correctionNote).toBe('Belge ekleyin');

    const mentiTok = await loginAs(http, menti.email, menti.rawPassword);
    const mentiMe = await http.get('/api/auth/me').set(tenantHeaders(tenant.id, mentiTok.accessToken)).expect(200);
    expect(mentiMe.body.tenant.correctionNote).toBeNull(); // MENTI'ye sızmaz
  });
});
