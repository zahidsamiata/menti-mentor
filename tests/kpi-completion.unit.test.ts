/**
 * AJ-78 — KPI tamamlama oranları (saf fonksiyonlar, DB yok).
 * "Kaydını tamamlayan üye %", "DISC tamamlama %" ve "tamamlanan görüşme" — panel ile CSV aynı kaynaktan.
 * k-anonimlik PAY ve PAYDA için ayrı ayrı: biri eşik altındaysa yüzde de sayılar da gizli.
 */
import { describe, it, expect } from 'vitest';
import {
  buildCompletionRate,
  buildKpiReportRows,
  SUPPRESSED_CELL_TEXT,
  type KpiStats,
  type KpiCompletion,
} from '../src/services/kpiReport.service.js';
import { K_ANONYMITY_THRESHOLD } from '../src/services/mask.js';

describe('buildCompletionRate — k-anonim oran', () => {
  it('pay ve payda eşik üstünde → yuvarlı yüzde + sayılar görünür', () => {
    expect(buildCompletionRate(3, 4)).toEqual({ completed: 3, eligible: 4, percent: 75, suppressed: false });
    expect(buildCompletionRate(3, 9)).toEqual({ completed: 3, eligible: 9, percent: 33, suppressed: false });
    expect(buildCompletionRate(5, 5)).toEqual({ completed: 5, eligible: 5, percent: 100, suppressed: false });
  });

  it('negatif: payda eşik altında (2 kişilik grup) → gizli, "%100" bile görünmez', () => {
    expect(buildCompletionRate(2, 2)).toEqual({ completed: 0, eligible: 0, percent: null, suppressed: true });
    expect(buildCompletionRate(1, 1)).toEqual({ completed: 0, eligible: 0, percent: null, suppressed: true });
  });

  it('negatif: payda yeterli ama pay eşik altında (10 kişiden 1\'i) → gizli', () => {
    expect(buildCompletionRate(1, 10)).toEqual({ completed: 0, eligible: 0, percent: null, suppressed: true });
    expect(buildCompletionRate(K_ANONYMITY_THRESHOLD - 1, 50).suppressed).toBe(true);
    expect(buildCompletionRate(0, 50).suppressed).toBe(true);
  });

  it('eşik tam sınırda (pay = payda = eşik) görünür', () => {
    expect(buildCompletionRate(K_ANONYMITY_THRESHOLD, K_ANONYMITY_THRESHOLD).suppressed).toBe(false);
  });
});

function statsWith(completion: KpiCompletion): KpiStats {
  return {
    totalActiveUsers: 12,
    usersByRole: { MENTI: 7, MENTOR: 4, ADMIN: 1 },
    matching: { activeMatches: 3, pendingOptIns: 2, rematchPriorityUsers: 1 },
    feedback: { totalFeedbackLogs: 0, npsByPhase: [], successRate: null },
    activeJobListings: 0,
    completion,
  };
}

describe('buildKpiReportRows — Tamamlama bölümü', () => {
  const meta = { tenantName: 'Örnek Dernek', generatedAt: new Date('2026-09-28T10:00:00Z') };
  const rowOf = (rows: unknown[][], metric: string) => rows.find((r) => r[0] === 'Tamamlama' && r[1] === metric);

  it('görünür oranlar yüzde değeri + "pay/payda kişi" açıklamasıyla; tamamlanan görüşme sayı olarak', () => {
    const rows = buildKpiReportRows(
      statsWith({
        registration: { completed: 9, eligible: 11, percent: 82, suppressed: false },
        disc: { completed: 4, eligible: 11, percent: 36, suppressed: false },
        completedMeetings: 7,
        minGroupSize: 3,
      }),
      meta,
    );
    expect(rows.filter((r) => r[0] === 'Tamamlama').map((r) => r[1])).toEqual([
      'Kaydını tamamlayan üye (%)',
      'DISC tamamlama (%)',
      'Tamamlanan görüşme',
    ]);
    expect(rowOf(rows, 'Kaydını tamamlayan üye (%)')?.[2]).toBe(82);
    expect(String(rowOf(rows, 'Kaydını tamamlayan üye (%)')?.[3])).toMatch(/^9\/11 kişi\./);
    expect(rowOf(rows, 'DISC tamamlama (%)')?.[2]).toBe(36);
    expect(rowOf(rows, 'Tamamlanan görüşme')?.[2]).toBe(7);
  });

  it('negatif: gizli oran "gizli" metniyle yazılır; hücrede ne yüzde ne pay/payda var', () => {
    const rows = buildKpiReportRows(
      statsWith({
        registration: { completed: 0, eligible: 0, percent: null, suppressed: true },
        disc: { completed: 0, eligible: 0, percent: null, suppressed: true },
        completedMeetings: 0,
        minGroupSize: 3,
      }),
      meta,
    );
    for (const metric of ['Kaydını tamamlayan üye (%)', 'DISC tamamlama (%)']) {
      const row = rowOf(rows, metric);
      expect(row?.[2]).toBe(SUPPRESSED_CELL_TEXT);
      expect(String(row?.[3])).not.toMatch(/\d+\/\d+/);
    }
    expect(rowOf(rows, 'Tamamlanan görüşme')?.[2]).toBe(0);
  });
});
