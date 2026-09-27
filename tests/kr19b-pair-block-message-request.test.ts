/**
 * KR-19b — yönetici blok engeli mesaj gönderme ve eşleşme isteğinde de uygulanır.
 *
 * K5-Y2 denetimi: KR-19 yalnız startConversation/randevu/anlaşma yollarını kapatmıştı;
 * blok konmadan ÖNCE açılmış konuşmada mesajlaşma sürüyor, POST /api/requests ile
 * eşleşme isteği gönderilebiliyordu. Okuma (GET messages) bilinçli olarak açık — ürün kararı.
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

describe('KR-19b — engellenmiş çift mesaj ve eşleşme isteği gönderemez', () => {
  let http: TestAgent;
  let tenantId: string;
  let mentor: Awaited<ReturnType<typeof createMentor>>;
  let menti: Awaited<ReturnType<typeof createMenti>>;
  let otherMenti: Awaited<ReturnType<typeof createMenti>>;

  beforeEach(async () => {
    await cleanDb();
    http = agent();
    const tenant = await createTenant();
    tenantId = tenant.id;
    mentor = await createMentor(tenantId);
    menti = await createMenti(tenantId);
    otherMenti = await createMenti(tenantId);
  });

  async function block(fromUserId: string, toUserId: string) {
    await testPrisma.tenant.update({
      where: { id: tenantId },
      data: {
        blockedPairs: [{ fromUserId, toUserId, blockedAt: new Date().toISOString(), blockedBy: 'test-admin' }],
      },
    });
  }

  async function openConversation(u: typeof menti) {
    const res = await http
      .post('/api/conversations')
      .set(tenantHeaders(tenantId, tokenFor(u)))
      .send({ mentorUserId: mentor.id, message: 'Merhaba, tanışmak isterim.' })
      .expect(201);
    return res.body.conversation.id as string;
  }

  it('blok sonradan konursa mevcut konuşmada İKİ taraf da mesaj gönderemez (403), DB\'ye yazılmaz', async () => {
    const convId = await openConversation(menti);
    // Yön bağımsızlığı: blok mentör→menti yönünde kaydedilir, menti de etkilenmeli.
    await block(mentor.id, menti.id);

    const asMenti = await http
      .post(`/api/conversations/${convId}/messages`)
      .set(tenantHeaders(tenantId, tokenFor(menti)))
      .send({ message: 'Menti yazıyor' })
      .expect(403);
    expect(asMenti.body.error).toBe('ISLEM_YAPILAMIYOR');

    const asMentor = await http
      .post(`/api/conversations/${convId}/messages`)
      .set(tenantHeaders(tenantId, tokenFor(mentor)))
      .send({ message: 'Mentör yazıyor' })
      .expect(403);
    expect(asMentor.body.error).toBe('ISLEM_YAPILAMIYOR');

    expect(await testPrisma.message.count({ where: { conversationId: convId } })).toBe(1);

    // Okuma açık bırakıldı (ürün kararı) — geçmiş görülebilir.
    await http
      .get(`/api/conversations/${convId}/messages`)
      .set(tenantHeaders(tenantId, tokenFor(menti)))
      .expect(200);
  });

  it('engellenmiş çift eşleşme isteği gönderemez (403), DB\'ye yazılmaz', async () => {
    await block(menti.id, mentor.id);

    const res = await http
      .post('/api/requests')
      .set(tenantHeaders(tenantId, tokenFor(menti)))
      .send({ targetType: 'USER', targetId: mentor.id, requestMessage: 'Görüşebilir miyiz?' })
      .expect(403);
    expect(res.body.error).toBe('ISLEM_YAPILAMIYOR');

    expect(await testPrisma.matchRequest.count({ where: { requesterUserId: menti.id } })).toBe(0);
  });

  it('engellenmemiş çift etkilenmez: mesaj (201) ve eşleşme isteği (201) çalışır', async () => {
    // Başka bir çift engelli — otherMenti↔mentor serbest kalmalı.
    await block(menti.id, mentor.id);
    const convId = await openConversation(otherMenti);

    await http
      .post(`/api/conversations/${convId}/messages`)
      .set(tenantHeaders(tenantId, tokenFor(mentor)))
      .send({ message: 'Hoş geldin' })
      .expect(201);

    await http
      .post('/api/requests')
      .set(tenantHeaders(tenantId, tokenFor(otherMenti)))
      .send({ targetType: 'USER', targetId: mentor.id, requestMessage: 'Görüşebilir miyiz?' })
      .expect(201);
  });
});
