/**
 * GÜVENLİK — mentor-count k-anonimlik BİRİM testleri (DB bağımsız).
 *
 * Tek başına çalışabilir:
 *   npx vitest run tests/mentor-count-k-anonymity.unit.test.ts --reporter=verbose
 *
 * Neden bu test var: `GET /api/users/mentor-count` ham mentör sayısını KOŞULSUZ dönüyordu;
 * k-anonimlik koruması yalnızca frontend'deydi (`menti/page.tsx` `count >= 3` kontrolü).
 * Uç `requireAuth()` ile PENDING kullanıcıya da açık olduğundan istemci onu doğrudan
 * çağırıp 1 veya 2 değerini okuyabiliyordu → küçük kurumda kimlik çıkarımı.
 * Kapı artık backend'de (`applyKAnonymity`); bu testler eşiğin altındaki gerçek sayının
 * SIZMADIĞINI ve eşik üstünde doğru sayının döndüğünü sabitler.
 */

import { describe, it, expect } from 'vitest';
import { applyKAnonymity, K_ANONYMITY_THRESHOLD } from '../src/services/mask.js';

describe('applyKAnonymity: eşik ALTINDA gerçek sayı sızmaz', () => {
  it('n=1 → gerçek sayı dönmez (count 0, suppressed true)', () => {
    const r = applyKAnonymity(1);
    expect(r.count).toBe(0);
    expect(r.suppressed).toBe(true);
    expect(r.count).not.toBe(1); // ham değer response'a girmedi
  });

  it('n=2 → gerçek sayı dönmez (sınır-1)', () => {
    const r = applyKAnonymity(2);
    expect(r.count).toBe(0);
    expect(r.suppressed).toBe(true);
    expect(r.count).not.toBe(2);
  });

  it('n=0 → 0 döner ve gizlendi olarak işaretlenir', () => {
    expect(applyKAnonymity(0)).toEqual({ count: 0, suppressed: true });
  });

  it('eşik altındaki ham sayı, gövdenin HİÇBİR alanında görünmez', () => {
    // Sızıntı yalnız `count`ta değil, gövdenin herhangi bir alanında olabilir → tüm değerleri tara.
    // n=0 hariç tutuldu: orada 0 zaten meşru çıktıdır, "sızıntı" testi anlamsız olurdu.
    for (let n = 1; n < K_ANONYMITY_THRESHOLD; n++) {
      expect(Object.values(applyKAnonymity(n))).not.toContain(n);
    }
  });
});

describe('applyKAnonymity: eşik ÜSTÜNDE doğru sayı döner', () => {
  it('n=3 (eşiğin kendisi) → gerçek sayı döner', () => {
    expect(applyKAnonymity(K_ANONYMITY_THRESHOLD)).toEqual({ count: 3, suppressed: false });
  });

  it('n=4 ve n=250 → gerçek sayı aynen döner', () => {
    expect(applyKAnonymity(4).count).toBe(4);
    expect(applyKAnonymity(250).count).toBe(250);
    expect(applyKAnonymity(250).suppressed).toBe(false);
  });
});

describe('applyKAnonymity: frontend sözleşmesi bozulmaz', () => {
  // Frontend tek tüketici: frontend/src/app/(dashboard)/menti/page.tsx:189
  //   {mentorCountData && mentorCountData.count >= 3 ? <gerçek sayı> : <jenerik metin>}
  // Tip sözleşmesi: frontend/src/lib/api/matching.ts:28 → `{ count: number }`
  const frontendGate = (body: { count: number }) => body.count >= 3;

  it('eşik altı yanıt, frontend kapısından GEÇMEZ (jenerik metin gösterilir)', () => {
    expect(frontendGate(applyKAnonymity(1))).toBe(false);
    expect(frontendGate(applyKAnonymity(2))).toBe(false);
  });

  it('eşik üstü yanıt, frontend kapısından GEÇER (sayı gösterilir)', () => {
    expect(frontendGate(applyKAnonymity(3))).toBe(true);
    expect(frontendGate(applyKAnonymity(9))).toBe(true);
  });

  it('`count` her zaman number — tip sözleşmesi korunur', () => {
    for (const n of [0, 1, 2, 3, 10]) {
      expect(typeof applyKAnonymity(n).count).toBe('number');
    }
  });
});

describe('K_ANONYMITY_THRESHOLD sabiti', () => {
  it('sihirli sayı değil, adlandırılmış sabit ve değeri 3', () => {
    expect(K_ANONYMITY_THRESHOLD).toBe(3);
  });
});
