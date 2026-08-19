/**
 * Çift (mentör-menti) verimsizlik/risk sinyali — SAF hesaplama (DB'siz, birim-test dostu).
 *
 * Kaynak: bu çiftin son görüşmelerindeki MeetingCheckIn kayıtları (overallRating +
 * continueIntent). Sinyal GREEN/YELLOW/RED üretir; yönetici ilişki sağlığını metrikten izler
 * (KARAR: yönetici herkesi tek tek arayamaz → metrikten takip). Kişinin kendisi bu sinyali GÖRMEZ.
 *
 * Bu modül meetingCheckInController (tekil /pair-signal endpoint'i) ile adminController
 * (toplu eşleşme listesi) arasında paylaşılır — eşik mantığı TEK yerde kalır (DRY).
 */

export type PairSignal = 'GREEN' | 'YELLOW' | 'RED' | 'INSUFFICIENT_DATA';

export interface PairSignalResult {
  signal: PairSignal;
  reasons: string[];
  avgRating: number | null;
  exitIntents: number;
  checkInCount: number;
}

// Sinyal eşikleri — tek kaynak (sihirli sayı yasağı). Değişirse burada değişir.
export const PAIR_SIGNAL_CONFIG = {
  recentMeetingsWindow: 5,   // Son kaç görüşmenin check-in'ine bakılır
  avgRatingRed:    2.5,      // Ortalama puan bunun ALTINDA → RED
  avgRatingYellow: 3.5,      // Ortalama puan bunun altında (ama >= red) → YELLOW
  exitIntentRed:   2,        // "devam etmek istemiyorum" (HAYIR) sayısı >= bu → RED
} as const;

type CheckInLike = { overallRating: number; continueIntent: string };

/**
 * Check-in dizisinden sinyal türetir. Boş dizi → INSUFFICIENT_DATA (yeterli veri yok).
 * Not: caller sinyali doğrudan kullanır; "yeterli veri yok" durumunu ayrıca ele almak
 * istemiyorsa INSUFFICIENT_DATA'yı nötr/"—" gösterebilir.
 */
export function computePairSignalFromCheckIns(checkIns: CheckInLike[]): PairSignalResult {
  if (checkIns.length === 0) {
    return { signal: 'INSUFFICIENT_DATA', reasons: [], avgRating: null, exitIntents: 0, checkInCount: 0 };
  }

  const avgRating =
    checkIns.reduce((s, c) => s + c.overallRating, 0) / checkIns.length;
  const exitIntents = checkIns.filter((c) => c.continueIntent === 'HAYIR').length;

  let signal: Exclude<PairSignal, 'INSUFFICIENT_DATA'> = 'GREEN';
  const reasons: string[] = [];

  if (avgRating < PAIR_SIGNAL_CONFIG.avgRatingRed) {
    signal = 'RED';
    reasons.push(`Ortalama puan düşük: ${avgRating.toFixed(1)}/5`);
  } else if (avgRating < PAIR_SIGNAL_CONFIG.avgRatingYellow) {
    signal = 'YELLOW';
    reasons.push(`Ortalama puan orta: ${avgRating.toFixed(1)}/5`);
  }

  if (exitIntents >= PAIR_SIGNAL_CONFIG.exitIntentRed) {
    signal = 'RED';
    reasons.push(`${exitIntents} kez "devam etmek istemiyorum" yanıtı`);
  }

  return { signal, reasons, avgRating, exitIntents, checkInCount: checkIns.length };
}
