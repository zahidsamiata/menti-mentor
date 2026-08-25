/**
 * listUserReports maskeleme — birim testi (DB gerektirmez).
 *
 * Kapsam (madde 80 regresyonu): platform /user-reports yanıtında reporter/target `fullName`
 * PII'sı maskeli döner; ham ad response'a girmez. Rapor İÇERİĞİ (reason/description/durum/
 * tarih/kurum) admin işini görebilsin diye korunur.
 *
 * Saf `maskUserReportRow` üzerinden çalışır — canlı DB'ye dokunmaz (TEST_DATABASE_URL guard'ına saygı).
 *
 * Tek başına koşum: npx vitest run tests/platform-user-reports-mask.unit.test.ts --reporter=verbose
 */

import { describe, it, expect } from 'vitest';
import { maskUserReportRow } from '../src/controllers/platformController.js';

const tenantNameById = new Map<string, string>([['t1', 'Örnek Kurum']]);

describe('maskUserReportRow — reporter/target kimliği maskeli döner', () => {
  it('reporter/target fullName yalnız ilk harf, ham ad sızmaz', () => {
    const row = {
      id: 'r1',
      tenantId: 't1',
      reason: 'HARASSMENT',
      description: 'içerik',
      status: 'OPEN',
      reviewNote: null,
      createdAt: new Date('2026-08-25T00:00:00Z'),
      reporter: { fullName: 'Alfa Kullanici' },
      target: { fullName: 'Mega Kullanici' },
    };

    const out = maskUserReportRow(row, tenantNameById);

    // Kimlik maskeli (yalnız ilk harf)
    expect(out.reporter.fullName).toBe('A***');
    expect(out.target.fullName).toBe('M***');
    // Ham ad sızmıyor (kanıt)
    expect(out.reporter.fullName).not.toContain('lfa');
    expect(out.target.fullName).not.toContain('ega');

    // Rapor içeriği admin işini görsün diye KORUNUR
    expect(out.reason).toBe('HARASSMENT');
    expect(out.description).toBe('içerik');
    expect(out.status).toBe('OPEN');
    expect(out.tenantName).toBe('Örnek Kurum');
  });

  it('null/eksik ilişki → *** (patlamaz)', () => {
    const row = {
      id: 'r2',
      tenantId: 'bilinmeyen',
      reason: 'OTHER',
      description: null,
      status: 'REVIEWED',
      reviewNote: null,
      createdAt: new Date('2026-08-25T00:00:00Z'),
      reporter: null,
      target: { fullName: null },
    };

    const out = maskUserReportRow(row, tenantNameById);

    expect(out.reporter.fullName).toBe('***');
    expect(out.target.fullName).toBe('***');
    // Kurum eşleşmezse tenantId fallback döner (kurum adı uydurulmaz)
    expect(out.tenantName).toBe('bilinmeyen');
  });
});
