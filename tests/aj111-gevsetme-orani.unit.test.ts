/**
 * AJ-111 (md.111 / G2-06) — eşleştirme gevşetme oranı BİRİM testleri (DB bağımsız).
 *
 * Tek başına çalışabilir:
 *   npx vitest run tests/aj111-gevsetme-orani.unit.test.ts --reporter=verbose
 *
 * Kapsam: özet hesabı (oran · yetersiz veri) · İstanbul günü · eşzamanlı ilk yazım yarışı (P2002) ·
 * sayaç yazımı hata verse de eşleştirme yanıtı AYNI (yangın-ve-unut, AJ-105b dersi).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Prisma } from '@prisma/client';

const upsert = vi.fn();
const update = vi.fn();
const logWarn = vi.fn();

vi.mock('../src/db.js', () => ({
  prisma: {
    matchingFallbackDailyStat: {
      upsert: (...a: unknown[]) => upsert(...a),
      update: (...a: unknown[]) => update(...a),
    },
  },
}));

vi.mock('../src/services/logger.js', () => ({
  logger: {
    info: vi.fn().mockResolvedValue(undefined),
    warn: (...a: unknown[]) => { logWarn(...a); return Promise.resolve(); },
    error: vi.fn().mockResolvedValue(undefined),
  },
}));

const rankMentisForMentor = vi.fn();
vi.mock('../src/services/matching.js', () => ({
  rankMentisForMentor: (...a: unknown[]) => rankMentisForMentor(...a),
  rankMentorsForMenti: vi.fn(),
  MAX_MATCH_CANDIDATES: 500,
}));

import {
  istanbulDay,
  recordMatchingFallback,
  summarizeMatchingFallback,
  MATCHING_FALLBACK_MIN_SAMPLE,
} from '../src/services/matchingFallbackStats.js';
import { getRankedMentisForMentor } from '../src/controllers/matchingController.js';

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('AJ-111 · summarizeMatchingFallback', () => {
  it('10 istekten 4 gevşetilmiş → %40, kademe dağılımı ayrı', () => {
    const r = summarizeMatchingFallback([
      { level: 0, count: 6 },
      { level: 1, count: 1 },
      { level: 3, count: 3 },
    ]);
    expect(r).toEqual({
      windowDays: 30,
      totalRequests: 10,
      relaxedRequests: 4,
      byLevel: { level1: 1, level2: 0, level3: 3 },
      ratePercent: 40,
      insufficientData: false,
      minSample: MATCHING_FALLBACK_MIN_SAMPLE,
    });
  });

  it('oran tek ondalığa yuvarlanır (1/6 → 16,7)', () => {
    expect(summarizeMatchingFallback([{ level: 0, count: 5 }, { level: 2, count: 1 }]).ratePercent).toBe(16.7);
  });

  it('hiç gevşetme yoksa %0 (null değil)', () => {
    expect(summarizeMatchingFallback([{ level: 0, count: 5 }]).ratePercent).toBe(0);
  });

  it('toplam eşiğin altındaysa yetersiz veri — oran null', () => {
    const r = summarizeMatchingFallback([{ level: 3, count: MATCHING_FALLBACK_MIN_SAMPLE - 1 }]);
    expect(r.insufficientData).toBe(true);
    expect(r.ratePercent).toBeNull();
    expect(r.totalRequests).toBe(MATCHING_FALLBACK_MIN_SAMPLE - 1);
  });

  it('tam eşikte oran görünür', () => {
    const r = summarizeMatchingFallback([{ level: 1, count: MATCHING_FALLBACK_MIN_SAMPLE }]);
    expect(r.insufficientData).toBe(false);
    expect(r.ratePercent).toBe(100);
  });

  it('hiç kayıt yoksa yetersiz veri', () => {
    const r = summarizeMatchingFallback([]);
    expect(r.totalRequests).toBe(0);
    expect(r.insufficientData).toBe(true);
    expect(r.ratePercent).toBeNull();
  });
});

describe('AJ-111 · istanbulDay', () => {
  it('UTC 21:30 → İstanbul ertesi günü (UTC+3)', () => {
    expect(istanbulDay(new Date('2026-09-28T21:30:00Z')).toISOString()).toBe('2026-09-29T00:00:00.000Z');
  });

  it('UTC 20:59 → aynı gün', () => {
    expect(istanbulDay(new Date('2026-09-28T20:59:00Z')).toISOString()).toBe('2026-09-28T00:00:00.000Z');
  });
});

describe('AJ-111 · recordMatchingFallback', () => {
  beforeEach(() => { upsert.mockReset(); update.mockReset(); });

  it('upsert + increment: yoksa 1 ile oluşturur, varsa 1 artırır', async () => {
    upsert.mockResolvedValue({});
    await recordMatchingFallback('t1', 2, new Date('2026-09-29T10:00:00Z'));
    expect(upsert).toHaveBeenCalledWith({
      where: { tenantId_day_level: { tenantId: 't1', day: new Date('2026-09-29T00:00:00.000Z'), level: 2 } },
      create: { tenantId: 't1', day: new Date('2026-09-29T00:00:00.000Z'), level: 2, count: 1 },
      update: { count: { increment: 1 } },
    });
    expect(update).not.toHaveBeenCalled();
  });

  it('eşzamanlı ilk yazım yarışı (P2002) → bir kez update ile artırır, sayım kaybolmaz', async () => {
    upsert.mockRejectedValue(new Prisma.PrismaClientKnownRequestError('unique', { code: 'P2002', clientVersion: 'test' }));
    update.mockResolvedValue({});
    await recordMatchingFallback('t1', 0, new Date('2026-09-29T10:00:00Z'));
    expect(update).toHaveBeenCalledWith({
      where: { tenantId_day_level: { tenantId: 't1', day: new Date('2026-09-29T00:00:00.000Z'), level: 0 } },
      data: { count: { increment: 1 } },
    });
  });

  it('başka hata yukarı fırlatılır (çağıran yutar)', async () => {
    upsert.mockRejectedValue(new Error('db down'));
    await expect(recordMatchingFallback('t1', 1)).rejects.toThrow('db down');
  });
});

describe('AJ-111 · eşleştirme ucu — sayaç hatası yanıtı değiştirmez', () => {
  const RESULT = {
    items: [{
      mentiId: 'm1', mentiName: 'Menti', mentiTenantId: 't1', mentiAvatarUrl: null,
      totalScore: 50, sectorScore: 50, discScore: 50, confidence: 1, qualityMultiplier: 1,
      skills: [], fallbackLevel: 3 as const, warnings: ['uyarı'],
    }],
    fallbackLevel: 3 as const,
  };

  function call() {
    const json = vi.fn();
    const status = vi.fn(() => ({ json }));
    const req = {
      params: { mentorId: 'admin-1' },
      query: {},
      auth: { userId: 'admin-1', role: 'ADMIN' },
      tenant: { tenantId: 't1' },
    };
    return { run: () => getRankedMentisForMentor(req as never, { json, status } as never), json, status };
  }

  beforeEach(() => {
    upsert.mockReset(); update.mockReset(); logWarn.mockReset();
    rankMentisForMentor.mockReset().mockResolvedValue(RESULT);
  });

  it('sayaç yazımı reddedilse de yanıt gövdesi, yazım başarılı olduğundakiyle AYNI; hata loglanır', async () => {
    upsert.mockResolvedValue({});
    const ok = call();
    await ok.run();
    await flush();
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(upsert.mock.calls[0]![0]).toMatchObject({ where: { tenantId_day_level: { tenantId: 't1', level: 3 } } });

    upsert.mockReset().mockRejectedValue(new Error('db down'));
    const failed = call();
    await failed.run();
    await flush();

    expect(failed.status).not.toHaveBeenCalled();
    expect(failed.json).toHaveBeenCalledTimes(1);
    expect(failed.json.mock.calls[0]![0]).toEqual(ok.json.mock.calls[0]![0]);
    expect(logWarn).toHaveBeenCalledWith('SYSTEM', 'Eşleştirme gevşetme sayacı yazılamadı', expect.objectContaining({ tenantId: 't1', level: 3 }));
  });

  it('yanıt sayaç yazımını BEKLEMEZ (asılı kalan yazım yanıtı geciktirmez)', async () => {
    upsert.mockReturnValue(new Promise(() => {})); // hiç çözülmeyen yazım
    const c = call();
    await c.run();
    expect(c.json).toHaveBeenCalledTimes(1);
  });

  it('boş sonuç sayılmaz (aday yokluğu gevşetme değildir)', async () => {
    rankMentisForMentor.mockResolvedValue({ items: [], fallbackLevel: 3 });
    const c = call();
    await c.run();
    await flush();
    expect(upsert).not.toHaveBeenCalled();
    expect(c.json).toHaveBeenCalledWith({ items: [], fallbackLevel: 3 });
  });
});
