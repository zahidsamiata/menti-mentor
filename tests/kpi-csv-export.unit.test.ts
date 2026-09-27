/**
 * F-18 — KPI raporu CSV üretimi (saf fonksiyonlar, DB yok).
 * Kaçış, formül enjeksiyonu önlemi, BOM ve k-anonim hücrenin "gizli" gösterimi.
 */
import { describe, it, expect } from 'vitest';
import { escapeCsvCell, toCsv, CSV_BOM } from '../src/services/csv.js';
import {
  buildKpiReportRows,
  kpiReportFileName,
  SUPPRESSED_CELL_TEXT,
  KPI_CSV_HEADER,
  type KpiStats,
} from '../src/services/kpiReport.service.js';

describe('escapeCsvCell', () => {
  it('düz metin ve sayı olduğu gibi', () => {
    expect(escapeCsvCell('Mentör')).toBe('Mentör');
    expect(escapeCsvCell(42)).toBe('42');
    expect(escapeCsvCell(-3)).toBe('-3');
    expect(escapeCsvCell(null)).toBe('');
    expect(escapeCsvCell(undefined)).toBe('');
    expect(escapeCsvCell(Number.NaN)).toBe('');
  });

  it('ayırıcı, tırnak ve yeni satır tırnaklanır; iç tırnak ikilenir', () => {
    expect(escapeCsvCell('a;b')).toBe('"a;b"');
    expect(escapeCsvCell('a,b')).toBe('"a,b"');
    expect(escapeCsvCell('dedi "merhaba"')).toBe('"dedi ""merhaba"""');
    expect(escapeCsvCell('satır1\nsatır2')).toBe('"satır1\nsatır2"');
  });

  it('formül enjeksiyonu: = + - @ ile başlayan metin \' ile etkisizleşir', () => {
    expect(escapeCsvCell('=HYPERLINK("http://x")')).toBe('"\'=HYPERLINK(""http://x"")"');
    expect(escapeCsvCell('+1+1')).toBe("'+1+1");
    expect(escapeCsvCell('-2+3')).toBe("'-2+3");
    expect(escapeCsvCell('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(escapeCsvCell('\t=1')).toBe("'\t=1");
  });
});

describe('toCsv', () => {
  it('BOM ile başlar, ; ayırır, CRLF ile biter', () => {
    const csv = toCsv([['a', 'b'], [1, 'ş;ğ']]);
    expect(csv.startsWith(CSV_BOM)).toBe(true);
    expect(csv).toBe(`${CSV_BOM}a;b\r\n1;"ş;ğ"\r\n`);
  });
});

function stats(overrides: Partial<KpiStats['feedback']> = {}): KpiStats {
  return {
    totalActiveUsers: 12,
    usersByRole: { MENTI: 7, MENTOR: 4, ADMIN: 1 },
    matching: { activeMatches: 3, pendingOptIns: 2, rematchPriorityUsers: 1 },
    feedback: {
      totalFeedbackLogs: 5,
      npsByPhase: [
        { phase: 1, avgNps: null, sampleSize: 0, suppressed: true },
        { phase: 3, avgNps: 8, sampleSize: 4, suppressed: false },
      ],
      successRate: 8,
      ...overrides,
    },
    activeJobListings: 0,
  };
}

describe('buildKpiReportRows', () => {
  const meta = { tenantName: 'Örnek Dernek', generatedAt: new Date('2026-09-26T10:00:00Z') };

  it('başlık satırı Türkçe ve 4 sütun', () => {
    const rows = buildKpiReportRows(stats(), meta);
    expect(rows[0]).toEqual([...KPI_CSV_HEADER]);
    expect(rows.every((r) => r.length === 4)).toBe(true);
  });

  it('k-anonim: eşik altı dönem "gizli" yazılır, 0 olarak görünmez', () => {
    const rows = buildKpiReportRows(stats(), meta);
    const phase1 = rows.filter((r) => String(r[1]).startsWith('1. ay'));
    expect(phase1).toHaveLength(2);
    for (const r of phase1) {
      expect(r[2]).toBe(SUPPRESSED_CELL_TEXT);
      expect(r[2]).not.toBe(0);
    }
    const phase3Avg = rows.find((r) => r[1] === '3. ay NPS ortalaması (0-10)');
    expect(phase3Avg?.[2]).toBe(8);
  });

  it('3. ay gizliyse başarı satırı da gizli', () => {
    const rows = buildKpiReportRows(
      stats({ npsByPhase: [{ phase: 3, avgNps: null, sampleSize: 0, suppressed: true }], successRate: null }),
      meta,
    );
    expect(rows.find((r) => r[1] === '3. ay başarı (NPS ortalaması)')?.[2]).toBe(SUPPRESSED_CELL_TEXT);
  });

  it('rol satırları Türkçe etiketli ve sabit sırada', () => {
    const labels = buildKpiReportRows(stats(), meta).filter((r) => r[0] === 'Kullanıcılar').map((r) => r[1]);
    expect(labels).toEqual([
      'Toplam aktif kullanıcı',
      'Aktif Yönetici sayısı',
      'Aktif Mentör sayısı',
      'Aktif Menti sayısı',
    ]);
  });
});

describe('kpiReportFileName', () => {
  it('kpi-raporu-<slug>-<YYYY-MM-DD>.csv; başlığı bozabilecek karakterler süzülür', () => {
    const d = new Date('2026-09-26T23:00:00Z');
    expect(kpiReportFileName('ornek-dernek', d)).toBe('kpi-raporu-ornek-dernek-2026-09-26.csv');
    expect(kpiReportFileName('a"b\r\nc', d)).toBe('kpi-raporu-a-b-c-2026-09-26.csv');
    expect(kpiReportFileName('', d)).toBe('kpi-raporu-kurum-2026-09-26.csv');
  });
});
