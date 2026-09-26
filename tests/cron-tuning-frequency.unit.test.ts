/** KR-21 — kurumun seçtiği rapor sıklığı ağırlık ayarı zamanlamasını gerçekten belirliyor. */
import { describe, expect, it } from 'vitest';
import { shouldRunTuningThisWeek } from '../src/services/cronScheduler.js';

// 2026-11-01 ayın 1. Pazarı · 2026-11-08 2. · 2026-11-15 3. · 2026-11-22 4. · 2026-11-29 5. (UTC)
const sunday = (day: number) => new Date(Date.UTC(2026, 10, day, 2, 0, 0));

describe('KR-21 · shouldRunTuningThisWeek', () => {
  it('WEEKLY her Pazar çalışır', () => {
    for (const d of [1, 8, 15, 22, 29]) expect(shouldRunTuningThisWeek('WEEKLY', sunday(d))).toBe(true);
  });

  it('BIWEEKLY yalnız ayın 1. ve 3. Pazarı', () => {
    expect([1, 8, 15, 22, 29].map((d) => shouldRunTuningThisWeek('BIWEEKLY', sunday(d)))).toEqual([true, false, true, false, false]);
  });

  it('MONTHLY yalnız ayın 1. Pazarı', () => {
    expect([1, 8, 15, 22, 29].map((d) => shouldRunTuningThisWeek('MONTHLY', sunday(d)))).toEqual([true, false, false, false, false]);
  });

  it('boş ya da bilinmeyen değer WEEKLY sayılır', () => {
    expect(shouldRunTuningThisWeek(undefined, sunday(8))).toBe(true);
    expect(shouldRunTuningThisWeek(null, sunday(8))).toBe(true);
    expect(shouldRunTuningThisWeek('YILLIK', sunday(8))).toBe(true);
  });
});
