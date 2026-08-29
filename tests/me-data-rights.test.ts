/**
 * G1-05 — Self-servis KVKK hak ekranı (backend).
 *
 * Kapsam:
 *  1. GET  /api/me/data-export    → kullanıcı KENDİ verisini indirir (userId TOKEN'dan; IDOR yok).
 *  2. POST /api/me/delete-account → kullanıcı KENDİ hesabını kapatır (anonimleştirme, e-posta teyidi).
 *
 * Güvenlik iddiaları:
 *  - Export'ta yalnız KENDİ verisi; mesaj İÇERİĞİ değil yalnız SAYI (karşı taraf PII'si sızmaz).
 *  - Yanlış teyit e-postası ile silme REDDEDİLİR (yanlışlıkla tetikleme önlenir).
 *  - Kurumun SON aktif admin'i kendini kapatamaz (kurum sahipsiz kalmasın).
 *  - Kapatma sonrası ACIK_RIZA revokedAt dolar (satır SİLİNMEZ — denetim izi) ve oturum düşer.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { cleanDb, testPrisma } from './helpers/db.js';
import { createTenant, createUser } from './helpers/factories.js';
import { agent, loginAs, tenantHeaders, type TestAgent } from './helpers/request.js';
import { recordSignupConsent } from '../src/services/consentService.js';
import { anonymizeUser } from '../src/services/gdprService.js';

describe('GET /api/me/data-export — kendi verisini indirir', () => {
  let http: TestAgent;
  let tenantId: string;
  let userA: string;
  let emailA: string;
  let tokenA: string;

  beforeEach(async () => {
    await cleanDb();
    http = agent();
    const tenant = await createTenant();
    tenantId = tenant.id;
    const a = await createUser({ tenantId, role: 'MENTOR' });
    const b = await createUser({ tenantId, role: 'MENTI' });
    userA = a.id;
    emailA = a.email;

    // A ve B arasında sohbet: her iki taraftan birer mesaj.
    const conversation = await testPrisma.conversation.create({
      data: { tenantId, mentorUserId: userA, mentiUserId: b.id },
    });
    await testPrisma.message.create({
      data: { conversationId: conversation.id, senderUserId: userA, content: 'A mesajı' },
    });
    await testPrisma.message.create({
      data: { conversationId: conversation.id, senderUserId: b.id, content: 'B mesajı' },
    });

    await recordSignupConsent({ userId: userA }, 'SELF_SERVE');

    ({ accessToken: tokenA } = await loginAs(http, a.email, a.rawPassword));
  });

  it('kendi profil + rıza + mesaj SAYISI döner (içerik değil)', async () => {
    const res = await http
      .get('/api/me/data-export')
      .set(tenantHeaders(tenantId, tokenA))
      .expect(200);

    expect(res.body.userId).toBe(userA);
    expect(res.body.profile.email).toBe(emailA);
    // Rıza denetim izi
    expect(Array.isArray(res.body.consents)).toBe(true);
    expect(res.body.consents.length).toBeGreaterThan(0);
    // Yalnız KENDİ gönderdiği mesajın SAYISI (B'nin mesajı sayılmaz, içerik yok).
    expect(res.body.messageCount).toBe(1);
    const blob = JSON.stringify(res.body);
    expect(blob).not.toContain('B mesajı');
    expect(blob).not.toContain('A mesajı'); // içerik hiç dışa aktarılmaz
  });

  it('token olmadan 401 (kimlik doğrulaması zorunlu)', async () => {
    await http
      .get('/api/me/data-export')
      .set(tenantHeaders(tenantId))
      .expect(401);
  });
});

describe('POST /api/me/delete-account — kendi hesabını kapatır', () => {
  let http: TestAgent;
  let tenantId: string;

  beforeEach(async () => {
    await cleanDb();
    http = agent();
    const tenant = await createTenant();
    tenantId = tenant.id;
  });

  it('yanlış teyit e-postası → 400, hesap kapatılmaz', async () => {
    const user = await createUser({ tenantId, role: 'MENTOR' });
    const { accessToken } = await loginAs(http, user.email, user.rawPassword);

    const res = await http
      .post('/api/me/delete-account')
      .set(tenantHeaders(tenantId, accessToken))
      .send({ confirmEmail: 'yanlis@example.com' })
      .expect(400);
    expect(res.body.error).toBe('EPOSTA_ESLESMEDI');

    // Hesap DOKUNULMADI
    const u = await testPrisma.user.findUnique({ where: { id: user.id } });
    expect(u!.isActive).toBe(true);
    expect(u!.email).toBe(user.email);
  });

  it('doğru e-posta (MENTOR) → anonimleştirilir, ACIK_RIZA revokedAt dolar, oturum düşer', async () => {
    const user = await createUser({ tenantId, role: 'MENTOR' });
    await recordSignupConsent({ userId: user.id }, 'SELF_SERVE');
    const { accessToken } = await loginAs(http, user.email, user.rawPassword);

    const res = await http
      .post('/api/me/delete-account')
      .set(tenantHeaders(tenantId, accessToken))
      .send({ confirmEmail: user.email.toUpperCase() }) // büyük/küçük harf normalize edilir
      .expect(200);
    expect(res.body.anonymizedInstead).toBe(true);

    // Anonimleştirildi
    const u = await testPrisma.user.findUnique({ where: { id: user.id } });
    expect(u!.isActive).toBe(false);
    expect(u!.email).toContain('@anon.invalid');

    // ACIK_RIZA geri çekildi (satır silinmez); AYDINLATMA aktif kalır
    const acikRiza = await testPrisma.consent.findFirst({ where: { userId: user.id, type: 'ACIK_RIZA' } });
    expect(acikRiza!.revokedAt).not.toBeNull();
    const aydinlatma = await testPrisma.consent.findFirst({ where: { userId: user.id, type: 'AYDINLATMA' } });
    expect(aydinlatma!.revokedAt).toBeNull();

    // Oturum düştü: eski token artık reddedilir (membership pasif)
    const after = await http.get('/api/users/mentor-count').set(tenantHeaders(tenantId, accessToken));
    expect(after.status).toBe(403);
  });

  it('kurumun SON aktif admin\'i → 409, hesap kapatılmaz', async () => {
    const admin = await createUser({ tenantId, role: 'ADMIN' });
    const { accessToken } = await loginAs(http, admin.email, admin.rawPassword);

    const res = await http
      .post('/api/me/delete-account')
      .set(tenantHeaders(tenantId, accessToken))
      .send({ confirmEmail: admin.email })
      .expect(409);
    expect(res.body.error).toBe('SON_ADMIN');

    // Admin DOKUNULMADI
    const u = await testPrisma.user.findUnique({ where: { id: admin.id } });
    expect(u!.isActive).toBe(true);
    expect(u!.email).toBe(admin.email);
  });

  it('başka aktif admin varsa admin kendini kapatabilir → 200', async () => {
    const admin1 = await createUser({ tenantId, role: 'ADMIN' });
    await createUser({ tenantId, role: 'ADMIN' }); // ikinci admin → kurum sahipsiz kalmaz
    const { accessToken } = await loginAs(http, admin1.email, admin1.rawPassword);

    const res = await http
      .post('/api/me/delete-account')
      .set(tenantHeaders(tenantId, accessToken))
      .send({ confirmEmail: admin1.email })
      .expect(200);
    expect(res.body.anonymizedInstead).toBe(true);

    const u = await testPrisma.user.findUnique({ where: { id: admin1.id } });
    expect(u!.isActive).toBe(false);
  });
});

describe('anonymizeUser → ACIK_RIZA geri çekilir (servis düzeyi)', () => {
  it('anonimleştirme aktif ACIK_RIZA satırına revokedAt yazar (satır silinmez)', async () => {
    await cleanDb();
    const tenant = await createTenant();
    const user = await createUser({ tenantId: tenant.id, role: 'MENTI' });
    await recordSignupConsent({ userId: user.id }, 'SELF_SERVE');

    await anonymizeUser(user.id, tenant.id);

    const rows = await testPrisma.consent.findMany({ where: { userId: user.id, type: 'ACIK_RIZA' } });
    expect(rows.length).toBe(1); // satır DURUYOR
    expect(rows[0]!.revokedAt).not.toBeNull(); // geri çekildi
  });
});
