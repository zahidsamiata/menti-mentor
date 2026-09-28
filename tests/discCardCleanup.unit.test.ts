/**
 * AJ-50 (KVKK): eski discResultCard kayıtlarından ham discVector/rawScores temizliği.
 * (1) saf dönüşüm: kart → temiz kart · (2) KURU ÇALIŞMA hiçbir yazma yapmaz (prisma mock) ·
 * (3) UYGULA: önce tarihli yedek, sonra tek JSON güncellemesi; sayılar tutmazsa hata · (4) onay kapısı.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  DIRTY_CARD_WHERE,
  STRIP_EXPRESSION,
  backupTableName,
  checkApplyAllowed,
  hasRawDiscKeys,
  maskId,
  runDiscCardCleanup,
  stripRawDiscKeys,
  type CleanupDb,
} from '../src/services/discCardCleanup.js';

const legacyCard = {
  archetype: 'Lider',
  icon: '🦁',
  dominant: 'D',
  completedAt: '2026-09-01T00:00:00.000Z',
  strengths: ['a', 'b'],
  discVector: { D: 0.7, I: 0.1, S: 0.1, C: 0.1, confidence: 0.8 },
  rawScores: { D: 5, I: 1, S: 1, C: 1 },
};

describe('stripRawDiscKeys / hasRawDiscKeys (saf dönüşüm)', () => {
  it('ham discVector + rawScores düşer, kart alanları aynen kalır, girdi değişmez', () => {
    const out = stripRawDiscKeys(legacyCard) as Record<string, unknown>;
    expect(out).not.toHaveProperty('discVector');
    expect(out).not.toHaveProperty('rawScores');
    expect(out).toEqual({
      archetype: 'Lider', icon: '🦁', dominant: 'D',
      completedAt: '2026-09-01T00:00:00.000Z', strengths: ['a', 'b'],
    });
    expect(legacyCard).toHaveProperty('discVector');
    expect(hasRawDiscKeys(legacyCard)).toBe(true);
    expect(hasRawDiscKeys(out)).toBe(false);
  });

  it('yalnız birini taşıyan kart da kirli sayılır; null/dizi/temiz kart dokunulmaz', () => {
    expect(hasRawDiscKeys({ archetype: 'x', rawScores: {} })).toBe(true);
    expect(hasRawDiscKeys(null)).toBe(false);
    expect(hasRawDiscKeys([{ discVector: 1 }])).toBe(false);
    expect(stripRawDiscKeys(null)).toBeNull();
  });

  it('SQL ifadesi aynı iki anahtarı düşürür ve koşul ikisini de hedefler', () => {
    expect(STRIP_EXPRESSION).toBe(`"discResultCard" - 'discVector' - 'rawScores'`);
    expect(DIRTY_CARD_WHERE).toContain(`?| ARRAY['discVector','rawScores']`);
    expect(DIRTY_CARD_WHERE).toContain(`jsonb_typeof("discResultCard") = 'object'`);
  });
});

describe('yardımcılar', () => {
  it('yedek tablo adı tarihli (UTC)', () => {
    expect(backupTableName(new Date('2026-09-27T10:00:00Z'))).toBe('User_discResultCard_yedek_20260927');
  });
  it('kimlik maskeli yazılır — tam kimlik görünmez', () => {
    const id = 'cmabcdefghijklmnop12';
    expect(maskId(id)).toBe('cmab…12');
    expect(maskId(id)).not.toContain('efghij');
  });
});

describe('checkApplyAllowed (onay kapısı — istisna YOK)', () => {
  const live = 'postgresql://u:p@ep-real-host.neon.tech/db?sslmode=require';
  const livePooler = 'postgresql://u2:p2@ep-real-host.neon.tech:5432/db';
  const local = 'postgresql://u:p@localhost:5432/test';

  it('(a) TEST_DATABASE_URL canlıyla AYNI host iken onaysız --uygula REDDEDİLİR', () => {
    const r = checkApplyAllowed({ targetUrl: live, testUrl: livePooler, confirmation: undefined });
    expect(r.ok).toBe(false);
    expect(r.ok ? '' : r.reason).toContain('CANLI DESENLİ');
    expect(checkApplyAllowed({ targetUrl: live, testUrl: live, confirmation: undefined }).ok).toBe(false);
  });

  it('(b) canlı desenli host + yanlış/eksik/kısmi onay REDDEDİLİR', () => {
    for (const confirmation of [undefined, 'evet', 'TEMIZLE baska-host.neon.tech', 'TEMIZLE ep-real-host', 'temizle ep-real-host.neon.tech']) {
      expect(checkApplyAllowed({ targetUrl: live, testUrl: undefined, confirmation }).ok).toBe(false);
    }
  });

  it('yerel/test hedefi de onaysız REDDEDİLİR (test DB istisnası yok)', () => {
    expect(checkApplyAllowed({ targetUrl: local, testUrl: local, confirmation: undefined }).ok).toBe(false);
  });

  it('host\'u içeren birebir onayla izin verir; canlı + test-aynı-host uyarısı döner', () => {
    const r = checkApplyAllowed({ targetUrl: live, testUrl: livePooler, confirmation: 'TEMIZLE ep-real-host.neon.tech' });
    expect(r.ok).toBe(true);
    expect(r.ok && r.warnings.join(' ')).toMatch(/CANLI.*TEST_DATABASE_URL/s);
    expect(checkApplyAllowed({ targetUrl: local, testUrl: local, confirmation: 'TEMIZLE localhost' }).ok).toBe(true);
  });

  it('host okunamazsa REDDEDİLİR', () => {
    expect(checkApplyAllowed({ targetUrl: 'bozuk', testUrl: undefined, confirmation: 'TEMIZLE (bilinmiyor)' }).ok).toBe(false);
  });
});

type Calls = { queries: string[]; executes: string[]; transactions: number };

function mockDb(opts: { dirty: number; backupExists?: boolean; backedUp?: number; updated?: number; remaining?: number }) {
  const calls: Calls = { queries: [], executes: [], transactions: 0 };
  let countCalls = 0;
  const tx = {
    $queryRawUnsafe: vi.fn(async (q: string) => {
      calls.queries.push(q);
      if (q.includes('to_regclass')) return [{ t: opts.backupExists ? 'User_discResultCard_yedek_20260927' : null }];
      if (q.includes('COUNT(*)') && q.includes('_yedek_')) return [{ n: BigInt(opts.backedUp ?? opts.dirty) }];
      if (q.includes('COUNT(*)')) {
        countCalls += 1;
        return [{ n: BigInt(countCalls === 1 ? opts.dirty : (opts.remaining ?? 0)) }];
      }
      if (q.startsWith('SELECT id FROM')) return [{ id: 'cmabcdefghijklmnop12' }, { id: 'cmzyxwvutsrqponml34' }];
      return [];
    }),
    $executeRawUnsafe: vi.fn(async (q: string) => {
      calls.executes.push(q);
      if (q.startsWith('UPDATE')) return opts.updated ?? opts.dirty;
      return 0;
    }),
  };
  const db = {
    ...tx,
    $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => { calls.transactions += 1; return fn(tx); }),
  };
  return { db: db as unknown as CleanupDb, calls };
}

const NOW = new Date('2026-09-27T10:00:00Z');

describe('runDiscCardCleanup — KURU ÇALIŞMA', () => {
  it('yalnız sayar + maskeli örnek döner; hiçbir yazma/transaction yapmaz', async () => {
    const { db, calls } = mockDb({ dirty: 7 });
    const report = await runDiscCardCleanup(db, { apply: false, now: NOW });
    expect(report).toMatchObject({ mode: 'KURU', affected: 7, backupTable: 'User_discResultCard_yedek_20260927' });
    expect(report.sampleMaskedIds).toEqual(['cmab…12', 'cmzy…34']);
    expect(calls.executes).toHaveLength(0);
    expect(calls.transactions).toBe(0);
    expect(calls.queries.every((q) => q.trimStart().startsWith('SELECT'))).toBe(true);
    expect(JSON.stringify(report)).not.toContain('cmabcdefghijklmnop12');
  });
});

describe('runDiscCardCleanup — UYGULA', () => {
  it('önce tarihli yedek (id + kart), sonra tek JSON güncellemesi — aynı koşulla, tek transaction', async () => {
    const { db, calls } = mockDb({ dirty: 3 });
    const report = await runDiscCardCleanup(db, { apply: true, now: NOW });
    expect(calls.transactions).toBe(1);
    expect(calls.executes).toEqual([
      `CREATE TABLE "User_discResultCard_yedek_20260927" AS SELECT id, "discResultCard" FROM "User" WHERE ${DIRTY_CARD_WHERE}`,
      `UPDATE "User" SET "discResultCard" = ${STRIP_EXPRESSION} WHERE ${DIRTY_CARD_WHERE}`,
    ]);
    expect(report).toMatchObject({ mode: 'UYGULA', affected: 3, backedUp: 3, updated: 3, remaining: 0 });
  });

  it('yedek tablo zaten varsa DURUR — yazma yok', async () => {
    const { db, calls } = mockDb({ dirty: 3, backupExists: true });
    await expect(runDiscCardCleanup(db, { apply: true, now: NOW })).rejects.toThrow(/yedek tablo zaten var/);
    expect(calls.executes).toHaveLength(0);
  });

  it('yedek sayısı tutmazsa güncellemeye GEÇMEZ', async () => {
    const { db, calls } = mockDb({ dirty: 3, backedUp: 2 });
    await expect(runDiscCardCleanup(db, { apply: true, now: NOW })).rejects.toThrow(/yedek sayısı/);
    expect(calls.executes.some((q) => q.startsWith('UPDATE'))).toBe(false);
  });

  it('güncellenen sayı ya da kalan tutmazsa hata (transaction geri alınır)', async () => {
    await expect(runDiscCardCleanup(mockDb({ dirty: 3, updated: 2 }).db, { apply: true, now: NOW })).rejects.toThrow(/güncellenen/);
    await expect(runDiscCardCleanup(mockDb({ dirty: 3, remaining: 1 }).db, { apply: true, now: NOW })).rejects.toThrow(/kalan 1/);
  });

  it('etkilenecek kayıt 0 ise yedek almaz, yazmaz', async () => {
    const { db, calls } = mockDb({ dirty: 0 });
    const report = await runDiscCardCleanup(db, { apply: true, now: NOW });
    expect(report.affected).toBe(0);
    expect(calls.executes).toHaveLength(0);
    expect(calls.transactions).toBe(0);
  });
});
