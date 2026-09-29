/**
 * AN-27 — "Zaman önerisi" mesaj tipi (KARAR-53 CEVAP ②④), HTTP + DB.
 *
 * Menti, mevcut mesaj ucundan (POST /api/conversations/:id/messages) yapılandırılmış bir mesaj
 * gönderir: gerekçe (message) + talep edilen zaman (proposedStartAt), kind='TIME_PROPOSAL'.
 * Negatifler: mentör gönderemez · konuşma dışı kişi / başka kurum 404 · geçmiş tarih 400 · engelli
 * çift 403 — hepsinde DB'ye mesaj YAZILMAZ. Sıradan mesaj davranışı değişmedi.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { agent, tenantHeaders, type TestAgent } from './helpers/request.js';
import { cleanDb, testPrisma } from './helpers/db.js';
import { createTenant, createMentor, createMenti } from './helpers/factories.js';
import { signToken } from '../src/middleware/jwtAuth.js';
import type { User } from '@prisma/client';

function tokenFor(u: Pick<User, 'id' | 'tenantId' | 'role' | 'fullName'>): string {
  return signToken({ sub: u.id, tenantId: u.tenantId, role: u.role, fullName: u.fullName });
}

const DAY = 24 * 60 * 60 * 1000;
const REASON = 'Kariyer geçişim hakkında sizinle konuşmak istiyorum.';

describe('AN-27 — zaman önerisi mesajı', () => {
  let http: TestAgent;
  let tenantId: string;
  let mentor: Awaited<ReturnType<typeof createMentor>>;
  let menti: Awaited<ReturnType<typeof createMenti>>;
  let convoId: string;
  let future: string;

  beforeEach(async () => {
    await cleanDb();
    http = agent();
    const tenant = await createTenant();
    tenantId = tenant.id;
    mentor = await createMentor(tenantId);
    menti = await createMenti(tenantId);
    const res = await http
      .post('/api/conversations')
      .set(tenantHeaders(tenantId, tokenFor(menti)))
      .send({ mentorUserId: mentor.id, message: 'Merhaba, tanışmak isterim.' })
      .expect(201);
    convoId = res.body.conversation.id as string;
    future = new Date(Date.now() + 3 * DAY).toISOString();
  });

  const messageCount = () => testPrisma.message.count({ where: { conversationId: convoId } });

  it('menti zaman önerisi gönderir (201); mentör thread\'inde kind + zaman + gerekçe ile görür', async () => {
    const sent = await http
      .post(`/api/conversations/${convoId}/messages`)
      .set(tenantHeaders(tenantId, tokenFor(menti)))
      .send({ message: REASON, kind: 'TIME_PROPOSAL', proposedStartAt: future })
      .expect(201);
    expect(sent.body.message.kind).toBe('TIME_PROPOSAL');
    expect(new Date(sent.body.message.proposedStartAt).toISOString()).toBe(future);

    const thread = await http
      .get(`/api/conversations/${convoId}/messages`)
      .set(tenantHeaders(tenantId, tokenFor(mentor)))
      .expect(200);
    const [first, proposal] = thread.body.messages;
    expect(first.kind).toBeNull();
    expect(first.proposedStartAt).toBeNull();
    expect(proposal.kind).toBe('TIME_PROPOSAL');
    expect(proposal.content).toBe(REASON);
    expect(new Date(proposal.proposedStartAt).toISOString()).toBe(future);

    // Gelen kutusu önizlemesi zaman önerisini ayırt eder.
    const list = await http.get('/api/conversations').set(tenantHeaders(tenantId, tokenFor(mentor))).expect(200);
    expect(list.body.items[0].lastMessagePreview).toBe(`Zaman önerisi · ${REASON}`);
  });

  it('mentör zaman önerisi GÖNDEREMEZ (403), DB değişmez', async () => {
    const before = await messageCount();
    const res = await http
      .post(`/api/conversations/${convoId}/messages`)
      .set(tenantHeaders(tenantId, tokenFor(mentor)))
      .send({ message: REASON, kind: 'TIME_PROPOSAL', proposedStartAt: future })
      .expect(403);
    expect(res.body.error).toBe('YALNIZ_MENTI');
    expect(await messageCount()).toBe(before);
  });

  it('konuşma dışındaki menti (aynı kurum) gönderemez (404), DB değişmez', async () => {
    const stranger = await createMenti(tenantId);
    const before = await messageCount();
    await http
      .post(`/api/conversations/${convoId}/messages`)
      .set(tenantHeaders(tenantId, tokenFor(stranger)))
      .send({ message: REASON, kind: 'TIME_PROPOSAL', proposedStartAt: future })
      .expect(404);
    expect(await messageCount()).toBe(before);
  });

  it('başka kurumdaki menti gönderemez (404), DB değişmez', async () => {
    const other = await createTenant();
    const outsider = await createMenti(other.id);
    const before = await messageCount();
    await http
      .post(`/api/conversations/${convoId}/messages`)
      .set(tenantHeaders(other.id, tokenFor(outsider)))
      .send({ message: REASON, kind: 'TIME_PROPOSAL', proposedStartAt: future })
      .expect(404);
    expect(await messageCount()).toBe(before);
  });

  it('geçmiş tarih → 400 (Türkçe mesaj), DB değişmez', async () => {
    const before = await messageCount();
    const res = await http
      .post(`/api/conversations/${convoId}/messages`)
      .set(tenantHeaders(tenantId, tokenFor(menti)))
      .send({ message: REASON, kind: 'TIME_PROPOSAL', proposedStartAt: new Date(Date.now() - DAY).toISOString() })
      .expect(400);
    expect(res.body.error).toBe('VALIDATION');
    expect(res.body.message).toBe('Önerilen zaman ileri bir tarih olmalıdır.');
    expect(await messageCount()).toBe(before);
  });

  it('tarihsiz öneri, kısa gerekçe, bilinmeyen tip, sıradan mesaja tarih → 400', async () => {
    const h = tenantHeaders(tenantId, tokenFor(menti));
    const before = await messageCount();
    await http.post(`/api/conversations/${convoId}/messages`).set(h)
      .send({ message: REASON, kind: 'TIME_PROPOSAL' }).expect(400);
    await http.post(`/api/conversations/${convoId}/messages`).set(h)
      .send({ message: 'kısa', kind: 'TIME_PROPOSAL', proposedStartAt: future }).expect(400);
    await http.post(`/api/conversations/${convoId}/messages`).set(h)
      .send({ message: REASON, kind: 'BASKA_TIP', proposedStartAt: future }).expect(400);
    await http.post(`/api/conversations/${convoId}/messages`).set(h)
      .send({ message: REASON, proposedStartAt: future }).expect(400);
    expect(await messageCount()).toBe(before);
  });

  it('yönetici tarafından engellenmiş çift zaman önerisi gönderemez (403), DB değişmez', async () => {
    await testPrisma.tenant.update({
      where: { id: tenantId },
      data: {
        blockedPairs: [
          { fromUserId: menti.id, toUserId: mentor.id, blockedAt: new Date().toISOString(), blockedBy: 'test-admin' },
        ],
      },
    });
    const before = await messageCount();
    const res = await http
      .post(`/api/conversations/${convoId}/messages`)
      .set(tenantHeaders(tenantId, tokenFor(menti)))
      .send({ message: REASON, kind: 'TIME_PROPOSAL', proposedStartAt: future })
      .expect(403);
    expect(res.body.error).toBe('ISLEM_YAPILAMIYOR');
    expect(await messageCount()).toBe(before);
  });

  it('sıradan mesaj davranışı değişmedi: iki taraf da yazar, kind/proposedStartAt boş', async () => {
    await http
      .post(`/api/conversations/${convoId}/messages`)
      .set(tenantHeaders(tenantId, tokenFor(mentor)))
      .send({ message: 'Mentörden sıradan cevap.' })
      .expect(201);
    const res = await http
      .post(`/api/conversations/${convoId}/messages`)
      .set(tenantHeaders(tenantId, tokenFor(menti)))
      .send({ message: 'Mentiden sıradan mesaj.' })
      .expect(201);
    expect(res.body.message.kind).toBeNull();
    expect(res.body.message.proposedStartAt).toBeNull();
    const rows = await testPrisma.message.findMany({ where: { conversationId: convoId } });
    expect(rows.every((r) => r.kind === null && r.proposedStartAt === null)).toBe(true);

    const list = await http.get('/api/conversations').set(tenantHeaders(tenantId, tokenFor(mentor))).expect(200);
    expect(list.body.items[0].lastMessagePreview).toBe('Mentiden sıradan mesaj.');
  });
});
