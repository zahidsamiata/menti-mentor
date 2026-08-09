/**
 * Chat v1 — konuşma başlatma, mesajlaşma, unread ve IDOR ownership.
 *
 * Güvenlik sınırı KATILIMCIDIR: yalnız konuşmanın mentörü/mentisi (ve aynı-tenant admin
 * okuma için) erişebilir. Yabancı bir kullanıcı başkasının konuşmasını OKUYAMAZ/YAZAMAZ.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { agent, tenantHeaders, type TestAgent } from './helpers/request.js';
import { cleanDb } from './helpers/db.js';
import { createTenant, createMentor, createMenti, createAdminUser } from './helpers/factories.js';
import { signToken } from '../src/middleware/jwtAuth.js';
import type { User } from '@prisma/client';

function tokenFor(u: Pick<User, 'id' | 'tenantId' | 'role' | 'fullName'>): string {
  return signToken({ sub: u.id, tenantId: u.tenantId, role: u.role, fullName: u.fullName });
}

describe('Chat v1 — konuşma + mesajlaşma + ownership', () => {
  let http: TestAgent;
  let tenantId: string;
  let mentor: Awaited<ReturnType<typeof createMentor>>;
  let menti: Awaited<ReturnType<typeof createMenti>>;
  let stranger: Awaited<ReturnType<typeof createMenti>>;
  let admin: Awaited<ReturnType<typeof createAdminUser>>;

  beforeEach(async () => {
    await cleanDb();
    http = agent();
    const tenant = await createTenant();
    tenantId = tenant.id;
    mentor = await createMentor(tenantId);
    menti = await createMenti(tenantId);
    stranger = await createMenti(tenantId);
    admin = await createAdminUser(tenantId);
  });

  async function startConversation(msg = 'Merhaba, sizinle çalışmak istiyorum çünkü sektörünüz ilgi alanım.') {
    const res = await http
      .post('/api/conversations')
      .set(tenantHeaders(tenantId, tokenFor(menti)))
      .send({ mentorUserId: mentor.id, message: msg })
      .expect(201);
    return res.body.conversation.id as string;
  }

  it('menti zorunlu ilk mesajla konuşma başlatır (201)', async () => {
    const res = await http
      .post('/api/conversations')
      .set(tenantHeaders(tenantId, tokenFor(menti)))
      .send({ mentorUserId: mentor.id, message: 'İlk mesaj — tanışma.' })
      .expect(201);
    expect(res.body.conversation.id).toBeTruthy();
    expect(res.body.message.content).toBe('İlk mesaj — tanışma.');
  });

  it('boş mesajla başlatılamaz (400)', async () => {
    await http
      .post('/api/conversations')
      .set(tenantHeaders(tenantId, tokenFor(menti)))
      .send({ mentorUserId: mentor.id, message: '   ' })
      .expect(400);
  });

  it('mentör konuşma başlatamaz — rol MENTI zorunlu (403)', async () => {
    await http
      .post('/api/conversations')
      .set(tenantHeaders(tenantId, tokenFor(mentor)))
      .send({ mentorUserId: mentor.id, message: 'olmaz' })
      .expect(403);
  });

  it('hedef mentör değilse 400', async () => {
    await http
      .post('/api/conversations')
      .set(tenantHeaders(tenantId, tokenFor(menti)))
      .send({ mentorUserId: stranger.id, message: 'hedef menti — olmaz' })
      .expect(400);
  });

  it('mentör inbox\'ta konuşmayı ve unread=1 görür; menti unread=0', async () => {
    await startConversation();

    const mentorList = await http
      .get('/api/conversations')
      .set(tenantHeaders(tenantId, tokenFor(mentor)))
      .expect(200);
    expect(mentorList.body.total).toBe(1);
    expect(mentorList.body.items[0].unread).toBe(1);
    expect(mentorList.body.items[0].counterpart.id).toBe(menti.id);

    const mentorUnread = await http
      .get('/api/conversations/unread-count')
      .set(tenantHeaders(tenantId, tokenFor(mentor)))
      .expect(200);
    expect(mentorUnread.body.count).toBe(1);

    const mentiUnread = await http
      .get('/api/conversations/unread-count')
      .set(tenantHeaders(tenantId, tokenFor(menti)))
      .expect(200);
    expect(mentiUnread.body.count).toBe(0);
  });

  it('YABANCI kullanıcı konuşmayı okuyamaz/yazamaz/okundu işaretleyemez (404)', async () => {
    const convId = await startConversation();
    const h = tenantHeaders(tenantId, tokenFor(stranger));

    await http.get(`/api/conversations/${convId}/messages`).set(h).expect(404);
    await http.post(`/api/conversations/${convId}/messages`).set(h).send({ message: 'sızma' }).expect(404);
    await http.post(`/api/conversations/${convId}/read`).set(h).expect(404);
  });

  it('mentör thread\'i okur, cevaplar; menti unread=1 → okuyunca 0', async () => {
    const convId = await startConversation();

    const thread = await http
      .get(`/api/conversations/${convId}/messages`)
      .set(tenantHeaders(tenantId, tokenFor(mentor)))
      .expect(200);
    expect(thread.body.messages).toHaveLength(1);

    await http
      .post(`/api/conversations/${convId}/messages`)
      .set(tenantHeaders(tenantId, tokenFor(mentor)))
      .send({ message: 'Memnuniyetle, hangi konuda destek istersin?' })
      .expect(201);

    const mentiUnreadBefore = await http
      .get('/api/conversations/unread-count')
      .set(tenantHeaders(tenantId, tokenFor(menti)))
      .expect(200);
    expect(mentiUnreadBefore.body.count).toBe(1);

    await http
      .post(`/api/conversations/${convId}/read`)
      .set(tenantHeaders(tenantId, tokenFor(menti)))
      .expect(200);

    const mentiUnreadAfter = await http
      .get('/api/conversations/unread-count')
      .set(tenantHeaders(tenantId, tokenFor(menti)))
      .expect(200);
    expect(mentiUnreadAfter.body.count).toBe(0);
  });

  it('aynı-tenant admin thread\'i OKUYABİLİR (200) ama mesaj YAZAMAZ (404)', async () => {
    const convId = await startConversation();
    const h = tenantHeaders(tenantId, tokenFor(admin));

    await http.get(`/api/conversations/${convId}/messages`).set(h).expect(200);
    await http.post(`/api/conversations/${convId}/messages`).set(h).send({ message: 'admin yazamaz' }).expect(404);
  });

  it('tekrar başlatma konuşmayı çoğaltmaz — mevcut konuşmaya mesaj ekler', async () => {
    const first = await startConversation('İlk.');
    const second = await startConversation('İkinci.');
    expect(second).toBe(first);

    const thread = await http
      .get(`/api/conversations/${first}/messages`)
      .set(tenantHeaders(tenantId, tokenFor(menti)))
      .expect(200);
    expect(thread.body.messages).toHaveLength(2);
  });
});
