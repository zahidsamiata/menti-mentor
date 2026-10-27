/**
 * Y1-B8 (KARAR-101 B genişletilmiş + EK) — onay bekleyen kullanıcı kapısı, uçtan uca.
 *
 * Ölçüt (kuyruk "Bitti demek"): onay bekleyen kişi şifreyle giriş yapar; kayıt süreci uçları açık;
 * mentörleri yalnız isimsiz özet olarak görür; eşleşme · mentör listesi · mesaj · talep · randevu ·
 * anlaşma uçları 403 ve KAYIT OLUŞMAZ. Onaylı kişi ve kurum yöneticisi kapıya takılmaz.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { agent, tenantHeaders, loginAs, type TestAgent } from './helpers/request.js';
import { cleanDb, testPrisma } from './helpers/db.js';
import { createTenant, createMentor, createMenti, createUser } from './helpers/factories.js';
import { K_ANONYMITY_THRESHOLD } from '../src/services/mask.js';

describe('Y1-B8: onay bekleyen kullanıcı kapısı', () => {
  let http: TestAgent;
  let tenantId: string;
  let mentorId: string;

  beforeEach(async () => {
    await cleanDb();
    http = agent();
    tenantId = (await createTenant()).id;
    const mentors = [];
    for (let i = 0; i < K_ANONYMITY_THRESHOLD; i++) {
      mentors.push(await createMentor(tenantId, { sectorTags: ['yazılım'] }));
    }
    mentorId = mentors[0]!.id;
  });

  async function pendingMentiToken(): Promise<{ id: string; token: string }> {
    const menti = await createMenti(tenantId, { approvalStatus: 'PENDING' });
    const { accessToken } = await loginAs(http, menti.email, menti.rawPassword);
    return { id: menti.id, token: accessToken };
  }

  it('onay bekleyen kişi şifreyle giriş yapar (200 + oturum), düzeltme notunu görür', async () => {
    const menti = await createMenti(tenantId, { approvalStatus: 'PENDING' });
    await testPrisma.user.update({ where: { id: menti.id }, data: { rejectionReason: 'Fotoğraf ekleyin.' } });

    const res = await http.post('/api/auth/login').send({ email: menti.email, password: menti.rawPassword });
    expect(res.status).toBe(200);
    expect(typeof res.body.accessToken).toBe('string');
    expect(res.body.user.approvalStatus).toBe('PENDING');
    expect(res.body.user.correctionNote).toBe('Fotoğraf ekleyin.');

    const me = await http.get('/api/auth/me').set(tenantHeaders(tenantId, res.body.accessToken));
    expect(me.status).toBe(200);
    expect(me.body.correctionNote).toBe('Fotoğraf ekleyin.');
    expect(me.body).not.toHaveProperty('rejectionReason');
  });

  it('onaylı kişide eski not dönmez', async () => {
    const menti = await createMenti(tenantId);
    await testPrisma.user.update({ where: { id: menti.id }, data: { rejectionReason: 'eski not' } });
    const res = await http.post('/api/auth/login').send({ email: menti.email, password: menti.rawPassword });
    expect(res.status).toBe(200);
    expect(res.body.user.correctionNote).toBeNull();
  });

  it('kayıt süreci ve kendi verisi uçları açık', async () => {
    const { token } = await pendingMentiToken();
    const h = tenantHeaders(tenantId, token);
    expect((await http.get('/api/questions').set(h)).status).not.toBe(403);
    expect((await http.get('/api/users/disc/questions').set(h)).status).not.toBe(403);
    expect((await http.get('/api/meetings/weekly-limit').set(h)).status).not.toBe(403);
  });

  it('mentörleri yalnız isimsiz özet olarak görür (sayı + alan, ad/e-posta yok)', async () => {
    const { token } = await pendingMentiToken();
    const res = await http.get('/api/users/mentor-count').set(tenantHeaders(tenantId, token));
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(K_ANONYMITY_THRESHOLD);
    expect(res.body.sectors).toEqual([{ sector: 'yazılım', count: K_ANONYMITY_THRESHOLD }]);
    const raw = JSON.stringify(res.body);
    expect(raw).not.toMatch(/Test User|@test\.local|fullName|email|avatar/i);
  });

  it('NEGATİF: mentör listesi / eşleşme / profil 403 ONAY_BEKLENIYOR', async () => {
    const { id, token } = await pendingMentiToken();
    const h = tenantHeaders(tenantId, token);
    for (const path of ['/api/users', `/api/mentis/${id}/mentor-matches`, `/api/users/${mentorId}`, '/api/conversations', '/api/agreements/active', '/api/requests']) {
      const res = await http.get(path).set(h);
      expect(res.status, path).toBe(403);
      expect(res.body.error, path).toBe('ONAY_BEKLENIYOR');
    }
  });

  it('NEGATİF: mesaj, talep, randevu, anlaşma yazılamaz (403) ve kayıt oluşmaz', async () => {
    const { token } = await pendingMentiToken();
    const h = tenantHeaders(tenantId, token);
    const before = {
      conv: await testPrisma.conversation.count(),
      req: await testPrisma.matchRequest.count(),
      meet: await testPrisma.meeting.count(),
      agr: await testPrisma.mentorshipAgreement.count(),
    };

    const attempts: Array<[string, Record<string, unknown>]> = [
      ['/api/conversations', { mentorId }],
      ['/api/requests', { targetId: mentorId, targetType: 'USER' }],
      ['/api/meetings/book', { mentorId, startTime: new Date(Date.now() + 86_400_000).toISOString() }],
      ['/api/meetings', { mentorId, scheduledAt: new Date(Date.now() + 86_400_000).toISOString() }],
      ['/api/agreements', { mentorId }],
      [`/api/mentors/${mentorId}/visibility-optin`, {}],
    ];
    for (const [path, body] of attempts) {
      const res = await http.post(path).set(h).send(body);
      expect(res.status, path).toBe(403);
      expect(res.body.error, path).toBe('ONAY_BEKLENIYOR');
    }

    expect(await testPrisma.conversation.count()).toBe(before.conv);
    expect(await testPrisma.matchRequest.count()).toBe(before.req);
    expect(await testPrisma.meeting.count()).toBe(before.meet);
    expect(await testPrisma.mentorshipAgreement.count()).toBe(before.agr);
  });

  it('onaylı menti aynı uçlarda kapıya takılmaz', async () => {
    const menti = await createMenti(tenantId);
    const { accessToken } = await loginAs(http, menti.email, menti.rawPassword);
    const res = await http.get('/api/conversations').set(tenantHeaders(tenantId, accessToken));
    expect(res.status).toBe(200);
  });

  it('onay bekleyen kurum yöneticisi kapıya takılmaz', async () => {
    const admin = await createUser({ tenantId, role: 'ADMIN', approvalStatus: 'PENDING' });
    const { accessToken } = await loginAs(http, admin.email, admin.rawPassword);
    const res = await http.get('/api/users').set(tenantHeaders(tenantId, accessToken));
    expect(res.status).not.toBe(403);
  });
});
