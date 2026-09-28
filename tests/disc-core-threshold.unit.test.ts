/**
 * AJ-80 (G2-09 / md.102) — iki DISC yolunun "temel soru (CORE)" eşiğini KİLİTLEYEN test.
 *
 * Neden: uyarlanabilir test motoru (`adaptiveTestEngine.ts`, `MIN_CORE_RESPONSES = 5`) ile
 * soru servisi (`questionService.ts`, `coreThreshold = coreCount`) farklı eşik kullanıyor.
 * Farkın gerekçesi bulunamadı (ikisi de toplu commit de6be04). Tek sabite bağlamak kullanıcının
 * gördüğü soru akışını değiştirir → KARAR-57'ye ("esas test hangisi") bağlı. Karar gelene dek
 * bugünkü davranış bu testle sabitlenir; eşiklerden biri sessizce değişirse test KIRMIZI olur.
 *
 * DB'siz — prisma sahte (vi.mock):
 *   npx vitest run tests/disc-core-threshold.unit.test.ts
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  question: { findMany: vi.fn() },
  userResponse: { findMany: vi.fn() },
  questionHide: { findMany: vi.fn() },
  user: { update: vi.fn() },
}));

vi.mock('../src/db.js', () => ({ prisma: prismaMock }));

import { computeProgress, getNextQuestion } from '../src/services/adaptiveTestEngine.js';
import { calcPoolMeta, calcAdaptiveProgress } from '../src/services/questionService.js';

// Uyarlanabilir motorun bugünkü eşiği — bilerek sabit sayı (sabit değişirse test kırmızı olmalı).
const ADAPTIVE_THRESHOLD_TODAY = 5;

type Q = { id: string; text: string; type: 'CORE' | 'DEEPENING'; discDimension: 'D' | 'I' | 'S' | 'C' | 'GENERAL'; order: number; tenantId: null; category: null };

function makePool(coreCount: number, deepeningCount: number): Q[] {
  const dims = ['D', 'I', 'S', 'C'] as const;
  const core: Q[] = Array.from({ length: coreCount }, (_, i) => ({
    id: `core-${i + 1}`, text: `Temel ${i + 1}`, type: 'CORE', discDimension: dims[i % 4], order: i + 1, tenantId: null, category: null,
  }));
  // DEEPENING: GENERAL boyutlu → dominant boyut ne çıkarsa çıksın "ilgili" sayılır (akış deterministik).
  const deep: Q[] = Array.from({ length: deepeningCount }, (_, i) => ({
    id: `deep-${i + 1}`, text: `Derin ${i + 1}`, type: 'DEEPENING', discDimension: 'GENERAL', order: i + 1, tenantId: null, category: null,
  }));
  return [...core, ...deep];
}

function answer(ids: string[]) {
  return ids.map((questionId) => ({ questionId, value: 4 }));
}

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.questionHide.findMany.mockResolvedValue([]);
  prismaMock.user.update.mockResolvedValue({});
});

// ─── Uyarlanabilir yol (adaptiveTestEngine) ─────────────────────────────────

describe('AJ-80 · uyarlanabilir test — CORE eşiği sabit 5', () => {
  it('ilerleme: 4. CORE cevabında derinleşme AÇILMAZ, 5.de AÇILIR (havuzda 20 CORE olsa da)', () => {
    const at4 = computeProgress(ADAPTIVE_THRESHOLD_TODAY - 1, 20, 0, 0, false);
    const at5 = computeProgress(ADAPTIVE_THRESHOLD_TODAY, 20, 0, 0, false);
    expect(at4.isDeepening).toBe(false);
    expect(at5.isDeepening).toBe(true);
    expect(at5.coreThreshold).toBe(ADAPTIVE_THRESHOLD_TODAY);
  });

  it('soru sunumu: havuzda 5 CORE, hepsi cevaplı → sıradaki soru DEEPENING', async () => {
    const pool = makePool(5, 2);
    prismaMock.question.findMany.mockResolvedValue(pool);
    prismaMock.userResponse.findMany.mockResolvedValue(answer(pool.filter((q) => q.type === 'CORE').map((q) => q.id)));

    const r = await getNextQuestion('u1', 't1');
    expect(r.done).toBe(false);
    if (r.done) return;
    expect(r.question.id).toBe('deep-1');
    expect(r.progress.isDeepening).toBe(true);
  });

  it('soru sunumu: havuzda yalnız 4 CORE, hepsi cevaplı → derinleşme AÇILMAZ (yer tutucu döner)', async () => {
    const pool = makePool(4, 2);
    prismaMock.question.findMany.mockResolvedValue(pool);
    prismaMock.userResponse.findMany.mockResolvedValue(answer(pool.filter((q) => q.type === 'CORE').map((q) => q.id)));

    const r = await getNextQuestion('u1', 't1');
    expect(r.done).toBe(false);
    if (r.done) return;
    expect(r.question.id).toBe('PLACEHOLDER');
    expect(r.progress.isDeepening).toBe(false);
  });

  it('soru sunumu: 20 CORE havuzunda 5 cevaplı → hâlâ CORE sunulur (DEEPENING soruları tüm CORE bitince gelir)', async () => {
    const pool = makePool(20, 2);
    prismaMock.question.findMany.mockResolvedValue(pool);
    prismaMock.userResponse.findMany.mockResolvedValue(answer(['core-1', 'core-2', 'core-3', 'core-4', 'core-5']));

    const r = await getNextQuestion('u1', 't1');
    expect(r.done).toBe(false);
    if (r.done) return;
    expect(r.question.id).toBe('core-6');
    // Bugünkü davranış: soru CORE olsa da ilerleme göstergesi derinleşme fazını bildirir.
    expect(r.progress.isDeepening).toBe(true);
  });
});

// ─── Soru servisi yolu (questionService) ────────────────────────────────────

describe('AJ-80 · soru servisi — CORE eşiği = havuzdaki tüm CORE', () => {
  it('calcPoolMeta: eşik havuzdaki CORE sayısına eşittir (sabit 5 değil)', () => {
    expect(calcPoolMeta(makePool(20, 12)).coreThreshold).toBe(20);
    expect(calcPoolMeta(makePool(8, 0)).coreThreshold).toBe(8);
  });

  it('20 CORE havuzunda 5 cevap → derinleşme AÇILMAZ', async () => {
    prismaMock.question.findMany.mockResolvedValue(makePool(20, 12));
    prismaMock.userResponse.findMany.mockResolvedValue(answer(['core-1', 'core-2', 'core-3', 'core-4', 'core-5']));

    const p = await calcAdaptiveProgress('u1', 't1');
    expect(p.coreThreshold).toBe(20);
    expect(p.isDeepening).toBe(false);
  });

  it('19/20 CORE → açılmaz; 20/20 CORE → açılır', async () => {
    const pool = makePool(20, 12);
    const coreIds = pool.filter((q) => q.type === 'CORE').map((q) => q.id);
    prismaMock.question.findMany.mockResolvedValue(pool);

    prismaMock.userResponse.findMany.mockResolvedValueOnce(answer(coreIds.slice(0, 19)));
    expect((await calcAdaptiveProgress('u1', 't1')).isDeepening).toBe(false);

    prismaMock.userResponse.findMany.mockResolvedValueOnce(answer(coreIds));
    expect((await calcAdaptiveProgress('u1', 't1')).isDeepening).toBe(true);
  });
});
