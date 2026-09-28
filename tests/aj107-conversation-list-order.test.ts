/**
 * AJ-107 — konuşma listesi (GET /api/conversations) eşit `lastMessageAt`'te kararlı sıralanır.
 *
 * Neden: sıralama yalnız `lastMessageAt` üzerindeydi; aynı anda gelen mesajlarda (eşit damga)
 * satır sırası belirsizdi → offset sayfalamasında sayfa sınırında bir konuşma iki kez gelir,
 * bir diğeri hiç gelmez. İkincil anahtar `id` (desc) ile sıra tekildir.
 * Ayrıca: 31 konuşmalı mentinin ilk sayfası 30 kayıt döner ama `total` 31'dir
 * (menti paneli "Gönderilen Talepler" sayacı bu `total`'ı gösterir — AJ-42).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { agent, tenantHeaders, type TestAgent } from './helpers/request.js';
import { cleanDb, testPrisma } from './helpers/db.js';
import { createTenant, createMentor, createMenti } from './helpers/factories.js';
import { signToken } from '../src/middleware/jwtAuth.js';
import { CONVERSATION_PAGE_DEFAULT } from '../src/controllers/conversationController.js';
import type { User } from '@prisma/client';

function tokenFor(u: Pick<User, 'id' | 'tenantId' | 'role' | 'fullName'>): string {
  return signToken({ sub: u.id, tenantId: u.tenantId, role: u.role, fullName: u.fullName });
}

const CONVERSATION_COUNT = CONVERSATION_PAGE_DEFAULT + 1; // 31 — bir sayfadan fazlası
const SAME_INSTANT = new Date('2026-09-01T10:00:00.000Z');
const LATER_INSTANT = new Date('2026-09-02T10:00:00.000Z');

describe('AJ-107 · konuşma listesi — eşit lastMessageAt kararlı sıra + total', () => {
  let http: TestAgent;
  let tenantId: string;
  let menti: Awaited<ReturnType<typeof createMenti>>;
  let latestId: string;
  let tiedIds: string[];

  beforeEach(async () => {
    await cleanDb();
    http = agent();
    const tenant = await createTenant();
    tenantId = tenant.id;
    menti = await createMenti(tenantId);

    tiedIds = [];
    for (let i = 0; i < CONVERSATION_COUNT; i += 1) {
      const mentor = await createMentor(tenantId);
      // Kimlikler ekleme sırasıyla ARTAN verilir; beklenen sıra (id desc) ekleme sırasının
      // tersidir → ikincil anahtar yoksa fiziksel sıra beklenenle örtüşmez.
      const id = `aj107-conv-${String(i).padStart(3, '0')}`;
      const isLatest = i === 0;
      await testPrisma.conversation.create({
        data: {
          id,
          tenantId,
          mentorUserId: mentor.id,
          mentiUserId: menti.id,
          lastMessageAt: isLatest ? LATER_INSTANT : SAME_INSTANT,
        },
      });
      if (isLatest) latestId = id;
      else tiedIds.push(id);
    }
  });

  it('31 konuşma: ilk sayfa 30 kayıt, total 31', async () => {
    const res = await http
      .get('/api/conversations')
      .set(tenantHeaders(tenantId, tokenFor(menti)))
      .expect(200);
    expect(res.body.total).toBe(CONVERSATION_COUNT);
    expect(res.body.items).toHaveLength(CONVERSATION_PAGE_DEFAULT);
  });

  it('eşit damgalı konuşmalar id azalan sırada; en yeni mesajlı konuşma başta', async () => {
    const res = await http
      .get(`/api/conversations?limit=${CONVERSATION_COUNT}`)
      .set(tenantHeaders(tenantId, tokenFor(menti)))
      .expect(200);
    const ids = (res.body.items as { id: string }[]).map((c) => c.id);
    const expectedTied = [...tiedIds].sort().reverse();
    expect(ids).toEqual([latestId, ...expectedTied]);
  });

  it('küçük sayfalarla gezilince sayfa sınırında tekrar/kayıp yok ve sıra tek sorguyla aynı', async () => {
    const pageSize = 4;
    const collected: string[] = [];
    for (let offset = 0; offset < CONVERSATION_COUNT; offset += pageSize) {
      const res = await http
        .get(`/api/conversations?limit=${pageSize}&offset=${offset}`)
        .set(tenantHeaders(tenantId, tokenFor(menti)))
        .expect(200);
      expect(res.body.total).toBe(CONVERSATION_COUNT);
      collected.push(...(res.body.items as { id: string }[]).map((c) => c.id));
    }
    expect(collected).toHaveLength(CONVERSATION_COUNT);
    expect(new Set(collected).size).toBe(CONVERSATION_COUNT);
    expect(collected).toEqual([latestId, ...[...tiedIds].sort().reverse()]);
  });
});
