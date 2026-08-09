/**
 * Chat v1 — okundu-bazlı e-posta kuralı.
 *
 * Kural: Alıcının o konuşmada okunmamış mesajı YOKKEN gelen ilk yeni mesajda mail atılır.
 * Zaten okunmamışı varsa tekrar atılmaz; alıcı okuyunca sıfırlanır, sonraki mesajda tekrar atılır.
 * Gerçek SMTP gönderimi mock'lanır — yalnızca tetik mantığı doğrulanır.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { agent, tenantHeaders, type TestAgent } from './helpers/request.js';
import { cleanDb } from './helpers/db.js';
import { createTenant, createMentor, createMenti } from './helpers/factories.js';
import { signToken } from '../src/middleware/jwtAuth.js';
import type { User } from '@prisma/client';

const mocks = vi.hoisted(() => ({ sendChatEmail: vi.fn() }));

// Partial mock: yalnız chat mail fonksiyonunu değiştir; diğer export'lar gerçek kalır.
vi.mock('../src/services/emailService.js', async (orig) => ({
  ...(await orig<typeof import('../src/services/emailService.js')>()),
  sendNewChatMessageEmail: mocks.sendChatEmail,
}));

function tokenFor(u: Pick<User, 'id' | 'tenantId' | 'role' | 'fullName'>): string {
  return signToken({ sub: u.id, tenantId: u.tenantId, role: u.role, fullName: u.fullName });
}

describe('Chat v1 — okundu-bazlı e-posta', () => {
  let http: TestAgent;
  let tenantId: string;
  let mentor: Awaited<ReturnType<typeof createMentor>>;
  let menti: Awaited<ReturnType<typeof createMenti>>;

  beforeEach(async () => {
    await cleanDb();
    mocks.sendChatEmail.mockClear();
    http = agent();
    const tenant = await createTenant();
    tenantId = tenant.id;
    mentor = await createMentor(tenantId);
    menti = await createMenti(tenantId);
  });

  const start = (message: string) =>
    http
      .post('/api/conversations')
      .set(tenantHeaders(tenantId, tokenFor(menti)))
      .send({ mentorUserId: mentor.id, message })
      .expect(201);

  it('ilk mesajda alıcıya (mentör) mail atılır', async () => {
    await start('İlk mesaj — tanışma metni.');
    expect(mocks.sendChatEmail).toHaveBeenCalledTimes(1);
  });

  it('okunmadan gelen 2. mesajda mail ATILMAZ; okununca sonraki mesajda tekrar atılır', async () => {
    const res = await start('Birinci mesaj.');
    const convId = res.body.conversation.id as string;
    expect(mocks.sendChatEmail).toHaveBeenCalledTimes(1);

    // Mentör henüz okumadı → 2. mesajda tekrar mail YOK.
    await start('İkinci mesaj — mentör henüz okumadı.');
    expect(mocks.sendChatEmail).toHaveBeenCalledTimes(1);

    // Mentör okur → okundu-bazlı sayaç sıfırlanır.
    await http
      .post(`/api/conversations/${convId}/read`)
      .set(tenantHeaders(tenantId, tokenFor(mentor)))
      .expect(200);

    // Okuduktan sonraki ilk mesajda tekrar mail atılır.
    await start('Üçüncü mesaj — mentör okuduktan sonra.');
    expect(mocks.sendChatEmail).toHaveBeenCalledTimes(2);
  });

  it('mentör cevabı, güncel olan mentiye mail atar', async () => {
    const res = await start('Merhaba mentör.');
    const convId = res.body.conversation.id as string;
    mocks.sendChatEmail.mockClear(); // başlatma mailini sıfırla

    // Menti başlatınca kendi tarafı okunmuş sayılır (güncel) → mentör cevabı mentiye mail atar.
    await http
      .post(`/api/conversations/${convId}/messages`)
      .set(tenantHeaders(tenantId, tokenFor(mentor)))
      .send({ message: 'Merhaba, hangi konuda yardımcı olabilirim?' })
      .expect(201);
    expect(mocks.sendChatEmail).toHaveBeenCalledTimes(1);
  });
});
