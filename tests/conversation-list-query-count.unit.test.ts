/**
 * AJ-06 + F-27 (AJ-45) — konuşma listesi (GET /api/conversations) sayfa başına SABİT sorgu.
 *
 * conversation.test.ts yalnız çok-konuşmalı doğruluğu ölçüyordu; N+1 geri gelse (her konuşma
 * için ayrı unread-count + son-mesaj sorgusu) hiçbir test kırılmazdı. Bu test prisma'yı
 * her model çağrısını SAYAN bir vekille (Proxy) değiştirir ve listConversations'ı 1 ve 25
 * konuşmalı sayfalarla çağırır:
 * - toplam sorgu sayısı sayfa boyutundan BAĞIMSIZ ve 4'tür (count · findMany · groupBy · $queryRaw);
 * - konuşma başına `message.count` / `message.findFirst` hiç çağrılmaz;
 * - sayfa boşken mesaj tablosuna hiç sorgu atılmaz;
 * - sonuç doğru eşlenir (okunmamış sayısı + son mesaj önizlemesi konuşmasına gider).
 * DB gerekmez (birim testi).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Response } from 'express';
import type { RequestWithTenant } from '../src/types.js';

type Call = { model: string; method: string; args: unknown[] };

const { calls, state, prismaProxy } = vi.hoisted(() => {
  const calls: Array<{ model: string; method: string; args: unknown[] }> = [];
  const state: { convos: Array<Record<string, unknown>>; unread: Array<Record<string, unknown>>; last: Array<Record<string, unknown>> } = {
    convos: [], unread: [], last: [],
  };
  const answer = (model: string, method: string): unknown => {
    if (model === 'conversation' && method === 'count') return state.convos.length;
    if (model === 'conversation' && method === 'findMany') return state.convos;
    if (model === 'message' && method === 'groupBy') return state.unread;
    if (model === '$queryRaw') return state.last;
    if (method === 'count') return 0;
    if (method === 'findMany' || method === 'groupBy') return [];
    return null;
  };
  const prismaProxy = new Proxy({}, {
    get(_t, model: string) {
      if (model === 'then') return undefined;
      if (model.startsWith('$')) {
        return (...args: unknown[]) => { calls.push({ model, method: model, args }); return Promise.resolve(answer(model, model)); };
      }
      return new Proxy({}, {
        get(_m, method: string) {
          return (...args: unknown[]) => { calls.push({ model, method, args }); return Promise.resolve(answer(model, method)); };
        },
      });
    },
  });
  return { calls, state, prismaProxy };
});

vi.mock('../src/db.js', () => ({ prisma: prismaProxy }));

import { listConversations } from '../src/controllers/conversationController.js';

const ME = 'user-me';

function convo(i: number) {
  return {
    id: `c${i}`,
    tenantId: 't1',
    mentorUserId: ME,
    mentiUserId: `menti-${i}`,
    mentorLastReadAt: null,
    mentiLastReadAt: null,
    lastMessageAt: new Date(Date.UTC(2026, 8, 1, 0, i)),
    mentor: { id: ME, fullName: 'Test Mentor', avatarUrl: null, role: 'MENTOR' },
    menti: { id: `menti-${i}`, fullName: `Test Menti ${i}`, avatarUrl: null, role: 'MENTI' },
  };
}

function seedPage(n: number) {
  state.convos = Array.from({ length: n }, (_, i) => convo(i));
  state.unread = state.convos.map((c, i) => ({ conversationId: c.id, _count: { _all: i + 1 } }));
  state.last = state.convos.map((c) => ({ conversationId: c.id, content: `son mesaj ${String(c.id)}` }));
}

async function callList(limit: number) {
  const res = {
    body: undefined as unknown,
    status() { return this; },
    json(payload: unknown) { this.body = payload; return this; },
  };
  const req = {
    auth: { userId: ME, role: 'MENTOR' },
    tenant: { tenantId: 't1' },
    query: { limit: String(limit) },
  } as unknown as RequestWithTenant;
  await listConversations(req, res as unknown as Response);
  return res.body as { items: Array<{ id: string; unread: number; lastMessagePreview: string | null }>; total: number };
}

const perConvoMessageQueries = (list: Call[]) =>
  list.filter((c) => c.model === 'message' && (c.method === 'count' || c.method === 'findFirst')).length;

describe('Konuşma listesi — sabit sorgu sayısı (AJ-06 / F-27)', () => {
  beforeEach(() => {
    calls.length = 0;
  });

  it('1 konuşmalı ve 25 konuşmalı sayfada sorgu sayısı aynıdır (4) — N+1 yok', async () => {
    seedPage(1);
    await callList(30);
    const small = calls.length;
    const smallPerConvo = perConvoMessageQueries(calls);

    calls.length = 0;
    seedPage(25);
    const body = await callList(30);
    const large = calls.length;

    expect(body.items).toHaveLength(25);
    expect(small).toBe(4);
    expect(large).toBe(4);
    expect(smallPerConvo).toBe(0);
    expect(perConvoMessageQueries(calls)).toBe(0);
    expect(calls.map((c) => `${c.model}.${c.method}`).sort()).toEqual(
      ['$queryRaw.$queryRaw', 'conversation.count', 'conversation.findMany', 'message.groupBy'].sort(),
    );
  });

  it('sayfa boşken mesaj tablosuna hiç sorgu atılmaz', async () => {
    seedPage(0);
    const body = await callList(30);
    expect(body.items).toEqual([]);
    expect(calls.map((c) => `${c.model}.${c.method}`).sort()).toEqual(['conversation.count', 'conversation.findMany']);
  });

  it('toplu sorgu sonuçları doğru konuşmaya eşlenir ve sayfa boyutu findMany\'ye iner', async () => {
    seedPage(3);
    const body = await callList(3);
    const findMany = calls.find((c) => c.model === 'conversation' && c.method === 'findMany')!;
    expect((findMany.args[0] as { take: number }).take).toBe(3);
    expect(body.items.map((i) => [i.id, i.unread, i.lastMessagePreview])).toEqual([
      ['c0', 1, 'son mesaj c0'],
      ['c1', 2, 'son mesaj c1'],
      ['c2', 3, 'son mesaj c2'],
    ]);
  });
});
