/**
 * I-08 (madde 158) — sertifika sınavında Türkiye takvim günü başına en fazla 2 deneme.
 * Saf pencere fonksiyonları; DB'ye bağlanmaz. (DB'li uçtan uca: certification-retry.test.ts)
 */
import { describe, expect, it } from 'vitest';
import {
  attemptsToday,
  calendarDayKey,
  certAttemptLock,
  nextDayStart,
  recordAttempt,
  type CertAttemptState,
} from '../src/services/certAttemptWindow.js';

const LIMIT = 2;
// İstanbul = UTC+3 (2016'dan beri yaz saati yok): İstanbul 23:59 = 20:59Z, 00:01 = 21:01Z.
const IST_2359 = new Date('2026-09-28T20:59:00Z');
const IST_0001 = new Date('2026-09-28T21:01:00Z'); // İstanbul 29 Eylül 00:01
const IST_29_MIDNIGHT = new Date('2026-09-28T21:00:00Z'); // İstanbul 29 Eylül 00:00
const IST_30_MIDNIGHT = new Date('2026-09-29T21:00:00Z');

const empty: CertAttemptState = { cooldownUntil: null, certLastAttemptAt: null, certDayAttempts: null };

/** Bir denemeyi uygula ve yeni durumu döndür (servisin yazdığı alanlarla). */
function attempt(state: CertAttemptState, now: Date, passed = false): CertAttemptState {
  expect(certAttemptLock(state, now, LIMIT)).toBeNull();
  return { ...state, ...recordAttempt(state, now, passed, LIMIT) };
}

describe('I-08 · takvim günü İstanbul saatine göre', () => {
  it('UTC aynı gün olsa bile İstanbul 00:01 ertesi gündür', () => {
    expect(calendarDayKey(IST_2359)).toBe('2026-09-28');
    expect(calendarDayKey(IST_0001)).toBe('2026-09-29');
    expect(IST_2359.toISOString().slice(0, 10)).toBe(IST_0001.toISOString().slice(0, 10)); // UTC'de aynı gün
  });

  it('ertesi günün başı İstanbul 00:00 (UTC 21:00)', () => {
    expect(nextDayStart(IST_2359).toISOString()).toBe(IST_29_MIDNIGHT.toISOString());
    expect(nextDayStart(IST_0001).toISOString()).toBe(IST_30_MIDNIGHT.toISOString());
    expect(nextDayStart(new Date('2026-09-29T08:00:00Z')).toISOString()).toBe(IST_30_MIDNIGHT.toISOString());
  });
});

describe('I-08 · günde en fazla 2 deneme', () => {
  it('aynı gün 3. deneme kilitli; kilit ertesi gün 00:00 İstanbul’da biter', () => {
    const morning = new Date('2026-09-29T06:00:00Z'); // İstanbul 09:00
    let s = attempt(empty, morning);
    expect(s.cooldownUntil).toBeNull();
    s = attempt(s, new Date('2026-09-29T07:00:00Z'));
    expect(s.certDayAttempts).toBe(2);
    expect(s.cooldownUntil!.toISOString()).toBe(IST_30_MIDNIGHT.toISOString());

    const third = new Date('2026-09-29T20:59:00Z'); // İstanbul 23:59 — hâlâ aynı gün
    expect(certAttemptLock(s, third, LIMIT)!.toISOString()).toBe(IST_30_MIDNIGHT.toISOString());
    // Ertesi gün 00:01 → yeni gün, hak yenilendi.
    expect(certAttemptLock(s, new Date('2026-09-29T21:01:00Z'), LIMIT)).toBeNull();
  });

  it('23:59 → 00:01 sınırında sayaç sıfırlanır (iki gün × 1 deneme mola başlatmaz)', () => {
    let s = attempt(empty, IST_2359);
    expect(attemptsToday(s, IST_0001)).toBe(0);
    s = attempt(s, IST_0001);
    expect(s.certDayAttempts).toBe(1);
    expect(s.cooldownUntil).toBeNull(); // eski kural burada 24 saat mola verirdi (2. başarısız)
    // Yeni günün 2. denemesi hakkı doldurur.
    s = attempt(s, new Date('2026-09-28T21:30:00Z'));
    expect(s.certDayAttempts).toBe(2);
    expect(certAttemptLock(s, new Date('2026-09-28T22:00:00Z'), LIMIT)).not.toBeNull();
  });

  it('geçen deneme de sayılır: başarısız + geçti → aynı gün 3. deneme yine kilitli', () => {
    let s = attempt(empty, new Date('2026-09-29T06:00:00Z'));
    s = attempt(s, new Date('2026-09-29T06:30:00Z'), true);
    expect(s.cooldownUntil).toBeNull(); // geçene mola yazılmaz
    expect(certAttemptLock(s, new Date('2026-09-29T07:00:00Z'), LIMIT)!.toISOString())
      .toBe(IST_30_MIDNIGHT.toISOString());
  });

  it('24 saatlik eski kuralın YERİNE geçti: mola ertesi gün 00:00, 24 saat değil', () => {
    const late = new Date('2026-09-29T20:00:00Z'); // İstanbul 23:00
    let s = attempt(empty, new Date('2026-09-29T19:00:00Z'));
    s = attempt(s, late);
    const end = s.cooldownUntil!.getTime();
    expect(end).toBe(IST_30_MIDNIGHT.getTime());
    expect(end - late.getTime()).toBe(60 * 60 * 1000); // 1 saat, 24 değil
  });

  it('I-08 öncesi yazılmış 24 saatlik mola aynen geçerli (mevcut kayıtlara dokunulmaz)', () => {
    const legacy: CertAttemptState = {
      cooldownUntil: new Date('2026-09-30T10:00:00Z'), certLastAttemptAt: null, certDayAttempts: null,
    };
    const now = new Date('2026-09-30T05:00:00Z'); // yeni gün, sayaç boş — ama mola sürüyor
    expect(certAttemptLock(legacy, now, LIMIT)!.toISOString()).toBe('2026-09-30T10:00:00.000Z');
    expect(certAttemptLock(legacy, new Date('2026-09-30T10:00:01Z'), LIMIT)).toBeNull();
  });
});
