// ─────────────────────────────────────────────────────────────────────────────
// Sertifika sınavı — GÜNLÜK deneme sınırı (madde 158 · I-08).
//
// Kural (madde 158): "günde 2 deneme, üçüncüsü için bekleme; bekleme süresince öğrenme
// yolculuğuna yönlendirme". Gün = Türkiye takvim günü (Europe/Istanbul) — mentörün
// "bugün" dediği gün; sunucu saati (UTC) değil. Aksi halde İstanbul'da 00:00-03:00
// arası yapılan deneme bir önceki güne sayılırdı.
//
// Neden eski "her 2 başarısız denemede 24 saat" kuralının YERİNE geçti:
//  - Eski kural günleri değil deneme çiftlerini sayıyordu: pazartesi 1 + çarşamba 1
//    deneme yapan mentör çarşamba ikinci hakkını kullanamadan 24 saat bekliyordu.
//  - Geçen deneme sayılmıyordu: başarısız → geçti → başarısız → başarısız dizisi aynı
//    günde 4 değerlendirmeye izin veriyordu (parite `certAttempts % 2` kayıyordu).
// Bu dosya DB'siz, saf fonksiyonlardır (birim testi: tests/certAttemptWindow.unit.test.ts).
// ─────────────────────────────────────────────────────────────────────────────

/** Deneme gününün saat dilimi (Türkiye). */
export const CERT_ATTEMPT_TIME_ZONE = 'Europe/Istanbul';

/** TenantMembership'teki deneme penceresi alanları (yalnız okunanlar). */
export interface CertAttemptState {
  cooldownUntil: Date | null;
  certLastAttemptAt: Date | null;
  certDayAttempts: number | null;
}

interface WallClock { year: number; month: number; day: number; hour: number; minute: number; second: number }

function wallClock(instant: Date, timeZone: string): WallClock {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instant);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)?.value);
  return {
    year: get('year'), month: get('month'), day: get('day'),
    hour: get('hour'), minute: get('minute'), second: get('second'),
  };
}

/** Anın verilen dilimdeki takvim günü, 'YYYY-MM-DD'. */
export function calendarDayKey(instant: Date, timeZone = CERT_ATTEMPT_TIME_ZONE): string {
  const w = wallClock(instant, timeZone);
  return `${w.year}-${String(w.month).padStart(2, '0')}-${String(w.day).padStart(2, '0')}`;
}

/** Dilimin o andaki UTC farkı (ms): duvar saati − UTC. */
function zoneOffsetMs(instant: Date, timeZone: string): number {
  const w = wallClock(instant, timeZone);
  const wallAsUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
  return wallAsUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/** Anın ertesi takvim gününün başlangıcı (dilimde 00:00) — mutlak an olarak. */
export function nextDayStart(instant: Date, timeZone = CERT_ATTEMPT_TIME_ZONE): Date {
  const w = wallClock(instant, timeZone);
  const midnightAsUtc = Date.UTC(w.year, w.month - 1, w.day + 1, 0, 0, 0);
  // Farkı gece yarısının kendisinde ölç (yaz saati geçişi olan dilimlerde de doğru gün).
  let result = midnightAsUtc - zoneOffsetMs(new Date(midnightAsUtc), timeZone);
  result = midnightAsUtc - zoneOffsetMs(new Date(result), timeZone);
  return new Date(result);
}

/** Bugün (dilimde) kaç sınav değerlendirildi. Son deneme başka günse sayaç 0'dır. */
export function attemptsToday(state: CertAttemptState, now: Date, timeZone = CERT_ATTEMPT_TIME_ZONE): number {
  if (!state.certLastAttemptAt) return 0;
  if (calendarDayKey(state.certLastAttemptAt, timeZone) !== calendarDayKey(now, timeZone)) return 0;
  return state.certDayAttempts ?? 0;
}

/**
 * Yeni deneme şu an kilitli mi? Kilitliyse kilidin bittiği an, değilse null.
 * - Süren mola (cooldownUntil > now) — I-08 öncesi yazılmış 24 saatlik molalar da dahil.
 * - Bugünkü hak dolmuş (geçen deneme de sayılır) → ertesi gün 00:00'a kadar.
 */
export function certAttemptLock(
  state: CertAttemptState,
  now: Date,
  dailyLimit: number,
  timeZone = CERT_ATTEMPT_TIME_ZONE,
): Date | null {
  if (state.cooldownUntil && state.cooldownUntil.getTime() > now.getTime()) return state.cooldownUntil;
  if (attemptsToday(state, now, timeZone) >= dailyLimit) return nextDayStart(now, timeZone);
  return null;
}

/**
 * Değerlendirilen bir denemeden sonra yazılacak pencere alanları.
 * Günün son hakkı başarısızsa mola (cooldownUntil) ertesi gün 00:00'a kadar sürer;
 * geçen denemede mola yazılmaz (sertifika alındı) ama günlük sayaç yine artar.
 */
export function recordAttempt(
  state: CertAttemptState,
  now: Date,
  passed: boolean,
  dailyLimit: number,
  timeZone = CERT_ATTEMPT_TIME_ZONE,
): { certDayAttempts: number; certLastAttemptAt: Date; cooldownUntil: Date | null } {
  const certDayAttempts = attemptsToday(state, now, timeZone) + 1;
  const cooldownUntil = !passed && certDayAttempts >= dailyLimit ? nextDayStart(now, timeZone) : null;
  return { certDayAttempts, certLastAttemptAt: now, cooldownUntil };
}
