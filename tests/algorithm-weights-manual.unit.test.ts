/**
 * 9a — Manuel eşleştirme ağırlığı doğrulama BİRİM testleri (DB bağımsız).
 *
 * Tek başına çalışabilir:
 *   npx vitest run tests/algorithm-weights-manual.unit.test.ts --reporter=verbose
 *
 * Kapsam: validateManualWeights saf fonksiyonu — PO doğrulama kuralları.
 */

import { describe, it, expect } from 'vitest';
import { validateManualWeights } from '../src/services/algorithmTuner.js';

describe('validateManualWeights: PO doğrulama kuralları', () => {
  it('geçerli değer (0.60) geçer + discWeight otomatik türetilir (0.40)', () => {
    const r = validateManualWeights({ sectorWeight: 0.6 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.sectorWeight).toBe(0.6);
      expect(r.discWeight).toBe(0.4);
    }
  });

  it('sınır değerler MIN (0.40) ve MAX (0.70) geçer', () => {
    expect(validateManualWeights({ sectorWeight: 0.4 }).ok).toBe(true);
    expect(validateManualWeights({ sectorWeight: 0.7 }).ok).toBe(true);
  });

  it('küsürat (0.53) reddedilir — %5 katı değil', () => {
    const r = validateManualWeights({ sectorWeight: 0.53 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("Ağırlık %5'in katı olmalıdır.");
  });

  it('MIN altı (0.30) reddedilir', () => {
    const r = validateManualWeights({ sectorWeight: 0.3 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('Sektör ağırlığı %40-%70 arasında olmalıdır.');
  });

  it('MAX üstü (0.80) reddedilir', () => {
    const r = validateManualWeights({ sectorWeight: 0.8 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('Sektör ağırlığı %40-%70 arasında olmalıdır.');
  });

  it('sayı olmayan girdi reddedilir', () => {
    expect(validateManualWeights({ sectorWeight: 'abc' }).ok).toBe(false);
    expect(validateManualWeights({ sectorWeight: undefined }).ok).toBe(false);
    expect(validateManualWeights({ sectorWeight: NaN }).ok).toBe(false);
  });

  it('discWeight de gönderilir ve toplam=1.00 tutarlıysa geçer', () => {
    const r = validateManualWeights({ sectorWeight: 0.65, discWeight: 0.35 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.discWeight).toBe(0.35);
  });

  it('discWeight gönderilir ama toplam ≠ 1.00 ise reddedilir', () => {
    const r = validateManualWeights({ sectorWeight: 0.6, discWeight: 0.5 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('Sektör ve DISC ağırlıklarının toplamı %100 olmalıdır.');
  });
});
